const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgriTrace Integration Tests", function () {
    let agriTraceCore, emergencyManager, qualityOracle;
    let admin, farmer, distributor, retailer, consumer;

    beforeEach(async function () {
        [admin, farmer, distributor, retailer, consumer] = await ethers.getSigners();

        // Deploy contracts
        const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
        agriTraceCore = await AgriTraceCore.deploy();
        await agriTraceCore.waitForDeployment();

        const emergencyAddress = await agriTraceCore.emergency();
        emergencyManager = await ethers.getContractAt("EmergencyManager", emergencyAddress);

        const QualityOracle = await ethers.getContractFactory("QualityOracle");
        qualityOracle = await QualityOracle.deploy();
        await qualityOracle.waitForDeployment();

        // Setup roles
        await agriTraceCore.assignRole(farmer.address, 1);
        await agriTraceCore.assignRole(distributor.address, 2);
        await agriTraceCore.assignRole(retailer.address, 3);
    });

    describe("Complete Product Journey", function () {
        it("Should handle complete product lifecycle", async function () {
            // Step 1: Farmer creates product
            const expiresAt = (await time.latest()) + 86400 * 30;
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Organic Apples",
                    expiresAt,
                    "Green Valley Farm",
                    ethers.parseEther("0.05"),
                    200
                )
            ).to.emit(agriTraceCore, "ProductCreated");

            const productId = 1;

            // Step 2: Store farm data
            await agriTraceCore.connect(farmer).storeFarmDataHash(productId, "QmFarmData123");

            // Step 3: Transfer to distributor
            await agriTraceCore.connect(farmer).transferToDistributor(
                productId,
                distributor.address,
                ethers.parseEther("0.08")
            );

            // Step 4: Distributor quality check
            await agriTraceCore.connect(distributor).storeDistributorQuality(
                productId,
                88,
                "Minimal",
                15,
                "QmDistributorData123"
            );

            // Step 5: Create batch
            await agriTraceCore.connect(distributor).createBatch([productId]);
            const batchId = 1;

            // Step 6: Send to retailer
            await agriTraceCore.connect(distributor).sendBatchToRetailer(
                batchId,
                retailer.address,
                [ethers.parseEther("0.12")]
            );

            // Step 7: Retailer quality check
            await agriTraceCore.connect(retailer).storeRetailerQuality(
                productId,
                85,
                "Good",
                12,
                "QmRetailerData123"
            );

            // Step 8: List for consumers
            await agriTraceCore.connect(retailer).listProductForConsumer(productId);

            // Step 9: Consumer purchase
            await agriTraceCore.connect(retailer).markProductAsBuyed(
                productId,
                consumer.address,
                100
            );

            // Verify final state
            const product = await agriTraceCore.getProduct(productId);
            expect(product.currentStage).to.equal(2); // RETAIL
            expect(product.retailData.buyedQuantity).to.equal(100);
            expect(product.retailData.consumer).to.equal(consumer.address);

            // Verify trace
            const trace = await agriTraceCore.getFullTrace(productId);
            expect(trace[0]).to.equal(productId);
            expect(trace[2]).to.equal("QmFarmData123");
            expect(trace[3]).to.equal("QmDistributorData123");
            expect(trace[4]).to.equal("QmRetailerData123");
        });

        it("Should handle multiple products in a batch", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            const productIds = [];

            // Create multiple products
            for (let i = 0; i < 3; i++) {
                await agriTraceCore.connect(farmer).createProduct(
                    `Product ${i + 1}`,
                    expiresAt,
                    "Test Farm",
                    ethers.parseEther("0.1"),
                    50
                );
                productIds.push(i + 1);

                // Transfer to distributor
                await agriTraceCore.connect(farmer).transferToDistributor(
                    i + 1,
                    distributor.address,
                    ethers.parseEther("0.15")
                );

                // Quality check
                await agriTraceCore.connect(distributor).storeDistributorQuality(
                    i + 1,
                    85,
                    "Good",
                    18,
                    `QmHash${i + 1}`
                );
            }

            // Create batch with all products
            await agriTraceCore.connect(distributor).createBatch(productIds);

            // Send to retailer
            const prices = [
                ethers.parseEther("0.2"),
                ethers.parseEther("0.2"),
                ethers.parseEther("0.2")
            ];
            await agriTraceCore.connect(distributor).sendBatchToRetailer(1, retailer.address, prices);

            // Verify all products are at retailer
            for (let i = 0; i < 3; i++) {
                const product = await agriTraceCore.getProduct(i + 1);
                expect(product.currentStage).to.equal(2); // RETAIL
                expect(product.retailData.retailer).to.equal(retailer.address);
            }
        });

        it("Should handle product rejection scenarios", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Test Product",
                expiresAt,
                "Test Farm",
                ethers.parseEther("0.1"),
                100
            );

            await agriTraceCore.connect(farmer).transferToDistributor(
                1,
                distributor.address,
                ethers.parseEther("0.15")
            );

            // Reject due to low temperature
            await expect(
                agriTraceCore.connect(distributor).storeDistributorQuality(
                    1,
                    85,
                    "Good",
                    3, // Below MIN_TEMP
                    "QmHash"
                )
            ).to.emit(agriTraceCore, "ProductRejected");

            const product = await agriTraceCore.getProduct(1);
            expect(product.currentState).to.equal(3); // REJECTED
            expect(product.isActive).to.equal(false);
        });
    });

    describe("Reputation System Integration", function () {
        it("Should update reputation scores throughout the journey", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            
            // Initial reputation scores
            const initialFarmerRep = await agriTraceCore.reputationScores(1, farmer.address);
            const initialDistributorRep = await agriTraceCore.reputationScores(2, distributor.address);
            const initialRetailerRep = await agriTraceCore.reputationScores(3, retailer.address);

            // Create and process high-quality product
            await agriTraceCore.connect(farmer).createProduct(
                "Premium Product",
                expiresAt,
                "Premium Farm",
                ethers.parseEther("0.2"),
                50
            );

            await agriTraceCore.connect(farmer).transferToDistributor(
                1,
                distributor.address,
                ethers.parseEther("0.3")
            );

            // High quality score at distributor
            await agriTraceCore.connect(distributor).storeDistributorQuality(
                1,
                95, // Grade A
                "Excellent",
                20,
                "QmDistHash"
            );

            await agriTraceCore.connect(distributor).createBatch([1]);
            await agriTraceCore.connect(distributor).sendBatchToRetailer(
                1,
                retailer.address,
                [ethers.parseEther("0.4")]
            );

            // High quality score at retailer
            await agriTraceCore.connect(retailer).storeRetailerQuality(
                1,
                90, // Grade A
                "Excellent",
                18,
                "QmRetailHash"
            );

            // Check reputation improvements
            const newFarmerRep = await agriTraceCore.reputationScores(1, farmer.address);
            const newDistributorRep = await agriTraceCore.reputationScores(2, distributor.address);
            const newRetailerRep = await agriTraceCore.reputationScores(3, retailer.address);

            expect(newFarmerRep).to.be.gt(initialFarmerRep);
            expect(newDistributorRep).to.be.gt(initialDistributorRep);
            expect(newRetailerRep).to.be.gt(initialRetailerRep);
        });
    });

    describe("Emergency Controls Integration", function () {
        it("Should prevent operations when system is paused", async function () {
            await emergencyManager.pause();

            const expiresAt = (await time.latest()) + 86400 * 30;
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Test Product",
                    expiresAt,
                    "Test Farm",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.be.revertedWith("System paused");
        });

        it("Should prevent blacklisted users from operating", async function () {
            await emergencyManager.blacklist(farmer.address);

            const expiresAt = (await time.latest()) + 86400 * 30;
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Test Product",
                    expiresAt,
                    "Test Farm",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.be.revertedWith("User blacklisted");
        });
    });

    describe("Gas Optimization Tests", function () {
        it("Should handle batch operations efficiently", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            const batchSize = 10;
            const productIds = [];

            // Create multiple products
            for (let i = 0; i < batchSize; i++) {
                await agriTraceCore.connect(farmer).createProduct(
                    `Batch Product ${i}`,
                    expiresAt,
                    "Batch Farm",
                    ethers.parseEther("0.1"),
                    100
                );
                
                await agriTraceCore.connect(farmer).transferToDistributor(
                    i + 1,
                    distributor.address,
                    ethers.parseEther("0.15")
                );

                await agriTraceCore.connect(distributor).storeDistributorQuality(
                    i + 1,
                    85,
                    "Good",
                    15,
                    `QmHash${i}`
                );

                productIds.push(i + 1);
            }

            // Create batch - should handle multiple products efficiently
            const tx = await agriTraceCore.connect(distributor).createBatch(productIds);
            const receipt = await tx.wait();
            
            console.log(`Gas used for batch of ${batchSize} products:`, receipt.gasUsed.toString());
            
            // Verify batch creation
            const batch = await agriTraceCore.getBatchDetails(1);
            expect(batch.productIds.length).to.equal(batchSize);
        });
    });
});