const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgriTraceCore", function () {
    let agriTraceCore;
    let emergencyManager;
    let qualityOracle;
    let admin, farmer, distributor, retailer, consumer;
    let productId, batchId, txId;

    beforeEach(async function () {
        [admin, farmer, distributor, retailer, consumer] = await ethers.getSigners();

        // Deploy AgriTraceCore
        const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
        agriTraceCore = await AgriTraceCore.deploy();
        await agriTraceCore.waitForDeployment();

        // Get EmergencyManager address
        const emergencyAddress = await agriTraceCore.emergency();
        emergencyManager = await ethers.getContractAt("EmergencyManager", emergencyAddress);

        // Deploy QualityOracle
        const QualityOracle = await ethers.getContractFactory("QualityOracle");
        qualityOracle = await QualityOracle.deploy();
        await qualityOracle.waitForDeployment();

        // Assign roles
        await agriTraceCore.assignRole(farmer.address, 1); // FARMER
        await agriTraceCore.assignRole(distributor.address, 2); // DISTRIBUTOR
        await agriTraceCore.assignRole(retailer.address, 3); // RETAILER
    });

    describe("Role Management", function () {
        it("Should assign roles correctly", async function () {
            expect(await agriTraceCore.getRole(farmer.address)).to.equal(1);
            expect(await agriTraceCore.getRole(distributor.address)).to.equal(2);
            expect(await agriTraceCore.getRole(retailer.address)).to.equal(3);
        });

        it("Should only allow admin to assign roles", async function () {
            await expect(
                agriTraceCore.connect(farmer).assignRole(consumer.address, 1)
            ).to.be.revertedWith("Only admin");
        });

        it("Should initialize reputation scores", async function () {
            expect(await agriTraceCore.reputationScores(1, farmer.address)).to.equal(50);
            expect(await agriTraceCore.reputationScores(2, distributor.address)).to.equal(50);
            expect(await agriTraceCore.reputationScores(3, retailer.address)).to.equal(50);
        });
    });

    describe("Product Creation (Farm Stage)", function () {
        it("Should create a product successfully", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30; // 30 days from now
            
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Organic Tomatoes",
                    expiresAt,
                    "Farm Location XYZ",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.emit(agriTraceCore, "ProductCreated")
             .withArgs(1, farmer.address);

            const product = await agriTraceCore.getProduct(1);
            expect(product.farmData.productType).to.equal("Organic Tomatoes");
            expect(product.farmData.farmer).to.equal(farmer.address);
            expect(product.farmData.quantity).to.equal(100);
            expect(product.currentStage).to.equal(0); // FARM
            expect(product.currentState).to.equal(0); // PENDING_PICKUP
        });

        it("Should reject product creation with invalid parameters", async function () {
            const pastTime = (await time.latest()) - 86400; // 1 day ago
            
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Tomatoes",
                    pastTime,
                    "Farm XYZ",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.be.revertedWith("Invalid params");
        });

        it("Should only allow farmers to create products", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            
            await expect(
                agriTraceCore.connect(distributor).createProduct(
                    "Tomatoes",
                    expiresAt,
                    "Farm XYZ",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.be.revertedWith("Not farmer");
        });

        it("Should store farm data hash", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Tomatoes",
                expiresAt,
                "Farm XYZ",
                ethers.parseEther("0.1"),
                100
            );

            await expect(
                agriTraceCore.connect(farmer).storeFarmDataHash(1, "QmFarmDataHash123")
            ).to.emit(agriTraceCore, "DataStored")
             .withArgs(1, "QmFarmDataHash123", 0);

            const product = await agriTraceCore.getProduct(1);
            expect(product.farmDataHash).to.equal("QmFarmDataHash123");
        });
    });

    describe("Distribution Stage", function () {
        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Organic Tomatoes",
                expiresAt,
                "Farm Location XYZ",
                ethers.parseEther("0.1"),
                100
            );
            productId = 1;
        });

        it("Should transfer product to distributor", async function () {
            await expect(
                agriTraceCore.connect(farmer).transferToDistributor(
                    productId,
                    distributor.address,
                    ethers.parseEther("0.15")
                )
            ).to.emit(agriTraceCore, "ProductTransferred")
             .withArgs(productId, farmer.address, distributor.address);

            const product = await agriTraceCore.getProduct(productId);
            expect(product.currentStage).to.equal(1); // DISTRIBUTION
            expect(product.currentState).to.equal(1); // RECEIVED
            expect(product.distributionData.distributor).to.equal(distributor.address);
        });

        it("Should store distributor quality data", async function () {
            await agriTraceCore.connect(farmer).transferToDistributor(
                productId,
                distributor.address,
                ethers.parseEther("0.15")
            );

            await expect(
                agriTraceCore.connect(distributor).storeDistributorQuality(
                    productId,
                    90,
                    "Low",
                    20,
                    "QmDistributorQualityHash"
                )
            ).to.emit(agriTraceCore, "DataStored")
             .withArgs(productId, "QmDistributorQualityHash", 1);

            const quality = await agriTraceCore.getDistributorQuality(productId);
            expect(quality.score).to.equal(90);
            expect(quality.grade).to.equal(0); // Grade A
            expect(quality.temperature).to.equal(20);

            const product = await agriTraceCore.getProduct(productId);
            expect(product.currentState).to.equal(2); // VERIFIED
        });

        it("Should reject product with low temperature", async function () {
            await agriTraceCore.connect(farmer).transferToDistributor(
                productId,
                distributor.address,
                ethers.parseEther("0.15")
            );

            await expect(
                agriTraceCore.connect(distributor).storeDistributorQuality(
                    productId,
                    90,
                    "Low",
                    3, // Below MIN_TEMP
                    "QmDistributorQualityHash"
                )
            ).to.emit(agriTraceCore, "ProductRejected")
             .withArgs(productId, "Quality failed");

            const product = await agriTraceCore.getProduct(productId);
            expect(product.currentState).to.equal(3); // REJECTED
            expect(product.isActive).to.equal(false);
        });

        it("Should create batch successfully", async function () {
            await agriTraceCore.connect(farmer).transferToDistributor(
                productId,
                distributor.address,
                ethers.parseEther("0.15")
            );

            await agriTraceCore.connect(distributor).storeDistributorQuality(
                productId,
                90,
                "Low",
                20,
                "QmDistributorQualityHash"
            );

            await expect(
                agriTraceCore.connect(distributor).createBatch([productId])
            ).to.emit(agriTraceCore, "BatchCreated")
             .withArgs(1, distributor.address);

            const batch = await agriTraceCore.getBatchDetails(1);
            expect(batch.distributor).to.equal(distributor.address);
            expect(batch.productIds.length).to.equal(1);
            expect(batch.productIds[0]).to.equal(productId);
        });
    });

    describe("Retail Stage", function () {
        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Organic Tomatoes",
                expiresAt,
                "Farm Location XYZ",
                ethers.parseEther("0.1"),
                100
            );
            productId = 1;

            await agriTraceCore.connect(farmer).transferToDistributor(
                productId,
                distributor.address,
                ethers.parseEther("0.15")
            );

            await agriTraceCore.connect(distributor).storeDistributorQuality(
                productId,
                90,
                "Low",
                20,
                "QmDistributorQualityHash"
            );

            await agriTraceCore.connect(distributor).createBatch([productId]);
            batchId = 1;
        });

        it("Should send batch to retailer", async function () {
            await expect(
                agriTraceCore.connect(distributor).sendBatchToRetailer(
                    batchId,
                    retailer.address,
                    [ethers.parseEther("0.2")]
                )
            ).to.emit(agriTraceCore, "BatchSentToRetailer")
             .withArgs(batchId, retailer.address);

            const product = await agriTraceCore.getProduct(productId);
            expect(product.currentStage).to.equal(2); // RETAIL
            expect(product.retailData.retailer).to.equal(retailer.address);
        });

        it("Should store retailer quality and list product", async function () {
            await agriTraceCore.connect(distributor).sendBatchToRetailer(
                batchId,
                retailer.address,
                [ethers.parseEther("0.2")]
            );

            await agriTraceCore.connect(retailer).storeRetailerQuality(
                productId,
                85,
                "Minimal",
                18,
                "QmRetailerQualityHash"
            );

            await expect(
                agriTraceCore.connect(retailer).listProductForConsumer(productId)
            ).to.emit(agriTraceCore, "ProductStateChanged")
             .withArgs(productId, 4); // LISTED

            const product = await agriTraceCore.getProduct(productId);
            expect(product.currentState).to.equal(4); // LISTED
        });

        it("Should mark product as bought", async function () {
            await agriTraceCore.connect(distributor).sendBatchToRetailer(
                batchId,
                retailer.address,
                [ethers.parseEther("0.2")]
            );

            await agriTraceCore.connect(retailer).storeRetailerQuality(
                productId,
                85,
                "Minimal",
                18,
                "QmRetailerQualityHash"
            );

            await agriTraceCore.connect(retailer).listProductForConsumer(productId);

            await expect(
                agriTraceCore.connect(retailer).markProductAsBuyed(
                    productId,
                    consumer.address,
                    50
                )
            ).to.emit(agriTraceCore, "ProductBuyed")
             .withArgs(productId, consumer.address, 50);

            const product = await agriTraceCore.getProduct(productId);
            expect(product.retailData.buyedQuantity).to.equal(50);
            expect(product.retailData.consumer).to.equal(consumer.address);
        });
    });

    describe("Reputation System", function () {
        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Organic Tomatoes",
                expiresAt,
                "Farm Location XYZ",
                ethers.parseEther("0.1"),
                100
            );
            productId = 1;

            await agriTraceCore.connect(farmer).transferToDistributor(
                productId,
                distributor.address,
                ethers.parseEther("0.15")
            );
        });

        it("Should boost reputation for Grade A", async function () {
            const initialFarmerRep = await agriTraceCore.reputationScores(1, farmer.address);
            const initialDistributorRep = await agriTraceCore.reputationScores(2, distributor.address);

            await agriTraceCore.connect(distributor).storeDistributorQuality(
                productId,
                90, // Grade A
                "Low",
                20,
                "QmDistributorQualityHash"
            );

            const newFarmerRep = await agriTraceCore.reputationScores(1, farmer.address);
            const newDistributorRep = await agriTraceCore.reputationScores(2, distributor.address);

            expect(newFarmerRep).to.equal(initialFarmerRep + 2n);
            expect(newDistributorRep).to.equal(initialDistributorRep + 2n);
        });

        it("Should reduce reputation for rejected products", async function () {
            const initialFarmerRep = await agriTraceCore.reputationScores(1, farmer.address);
            const initialDistributorRep = await agriTraceCore.reputationScores(2, distributor.address);

            await agriTraceCore.connect(distributor).storeDistributorQuality(
                productId,
                30, // Rejected
                "High",
                20,
                "QmDistributorQualityHash"
            );

            const newFarmerRep = await agriTraceCore.reputationScores(1, farmer.address);
            const newDistributorRep = await agriTraceCore.reputationScores(2, distributor.address);

            expect(newFarmerRep).to.equal(initialFarmerRep - 2n);
            expect(newDistributorRep).to.equal(initialDistributorRep - 2n);
        });
    });

    describe("Full Trace Function", function () {
        it("Should return complete trace information", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Organic Tomatoes",
                expiresAt,
                "Farm Location XYZ",
                ethers.parseEther("0.1"),
                100
            );
            productId = 1;

            await agriTraceCore.connect(farmer).storeFarmDataHash(productId, "QmFarmHash");

            const trace = await agriTraceCore.getFullTrace(productId);
            expect(trace[0]).to.equal(productId); // id
            expect(trace[1]).to.equal(0); // Grade A
            expect(trace[2]).to.equal("QmFarmHash"); // farmDataHash
            expect(trace[5]).to.equal(0); // buyedQuantity
        });

        it("Should revert for non-existent product", async function () {
            await expect(
                agriTraceCore.getFullTrace(999)
            ).to.be.revertedWith("Product not found");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Organic Tomatoes",
                expiresAt,
                "Farm Location XYZ",
                ethers.parseEther("0.1"),
                100
            );
            productId = 1;
        });

        it("Should get products by farmer", async function () {
            const products = await agriTraceCore.getProductsByFarmer(farmer.address);
            expect(products.length).to.equal(1);
            expect(products[0]).to.equal(productId);
        });

        it("Should get total products", async function () {
            expect(await agriTraceCore.getTotalProducts()).to.equal(1);
        });

        it("Should get reputation scores", async function () {
            expect(await agriTraceCore.getReputation(1, farmer.address)).to.equal(50);
        });
    });

    describe("Emergency Controls", function () {
        it("Should pause and unpause system", async function () {
            await emergencyManager.pause();
            expect(await emergencyManager.paused()).to.equal(true);

            const expiresAt = (await time.latest()) + 86400 * 30;
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Tomatoes",
                    expiresAt,
                    "Farm XYZ",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.be.revertedWith("System paused");

            await emergencyManager.unpause();
            expect(await emergencyManager.paused()).to.equal(false);
        });

        it("Should blacklist users", async function () {
            await emergencyManager.blacklist(farmer.address);
            expect(await emergencyManager.blacklisted(farmer.address)).to.equal(true);

            const expiresAt = (await time.latest()) + 86400 * 30;
            await expect(
                agriTraceCore.connect(farmer).createProduct(
                    "Tomatoes",
                    expiresAt,
                    "Farm XYZ",
                    ethers.parseEther("0.1"),
                    100
                )
            ).to.be.revertedWith("User blacklisted");
        });
    });
});