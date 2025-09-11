const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Performance Tests", function () {
    let agriTraceCore;
    let admin, farmer, distributor, retailer;

    beforeEach(async function () {
        [admin, farmer, distributor, retailer] = await ethers.getSigners();

        const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
        agriTraceCore = await AgriTraceCore.deploy();
        await agriTraceCore.waitForDeployment();

        await agriTraceCore.assignRole(farmer.address, 1);
        await agriTraceCore.assignRole(distributor.address, 2);
        await agriTraceCore.assignRole(retailer.address, 3);
    });

    describe("Scalability Tests", function () {
        it("Should handle large number of products efficiently", async function () {
            const productCount = 100;
            const expiresAt = (await time.latest()) + 86400 * 30;

            console.log(`Creating ${productCount} products...`);
            const startTime = Date.now();

            for (let i = 0; i < productCount; i++) {
                await agriTraceCore.connect(farmer).createProduct(
                    `Product ${i}`,
                    expiresAt,
                    `Farm ${i}`,
                    ethers.parseEther("0.1"),
                    100
                );
            }

            const endTime = Date.now();
            const totalTime = endTime - startTime;
            
            console.log(`Created ${productCount} products in ${totalTime}ms`);
            console.log(`Average time per product: ${totalTime / productCount}ms`);

            expect(await agriTraceCore.getTotalProducts()).to.equal(productCount);
        });

        it("Should handle large batches efficiently", async function () {
            const batchSize = 50;
            const expiresAt = (await time.latest()) + 86400 * 30;
            const productIds = [];

            // Create products
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
                    18,
                    `QmHash${i}`
                );

                productIds.push(i + 1);
            }

            // Measure batch creation time
            const startTime = Date.now();
            const tx = await agriTraceCore.connect(distributor).createBatch(productIds);
            const receipt = await tx.wait();
            const endTime = Date.now();

            console.log(`Batch creation time: ${endTime - startTime}ms`);
            console.log(`Gas used: ${receipt.gasUsed.toString()}`);
            console.log(`Gas per product: ${receipt.gasUsed / BigInt(batchSize)}`);

            const batch = await agriTraceCore.getBatchDetails(1);
            expect(batch.productIds.length).to.equal(batchSize);
        });
    });

    describe("Gas Optimization Tests", function () {
        it("Should optimize gas usage for product creation", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;

            const tx = await agriTraceCore.connect(farmer).createProduct(
                "Gas Test Product",
                expiresAt,
                "Gas Test Farm",
                ethers.parseEther("0.1"),
                100
            );

            const receipt = await tx.wait();
            console.log(`Product creation gas usage: ${receipt.gasUsed.toString()}`);

            // Store the baseline for comparison
            const baselineGas = receipt.gasUsed;
            expect(baselineGas).to.be.lt(300000n); // Should be under 300k gas
        });

        it("Should optimize gas for quality storage", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            await agriTraceCore.connect(farmer).createProduct(
                "Quality Test Product",
                expiresAt,
                "Quality Test Farm",
                ethers.parseEther("0.1"),
                100
            );

            await agriTraceCore.connect(farmer).transferToDistributor(
                1,
                distributor.address,
                ethers.parseEther("0.15")
            );

            const tx = await agriTraceCore.connect(distributor).storeDistributorQuality(
                1,
                85,
                "Good quality",
                18,
                "QmQualityTestHash"
            );

            const receipt = await tx.wait();
            console.log(`Quality storage gas usage: ${receipt.gasUsed.toString()}`);

            expect(receipt.gasUsed).to.be.lt(200000n); // Should be under 200k gas
        });
    });

    describe("Memory Usage Tests", function () {
        it("Should handle products with large data efficiently", async function () {
            const expiresAt = (await time.latest()) + 86400 * 30;
            const longDescription = "A".repeat(1000); // Large string

            await agriTraceCore.connect(farmer).createProduct(
                longDescription,
                expiresAt,
                "Large Data Farm",
                ethers.parseEther("0.1"),
                100
            );

            const product = await agriTraceCore.getProduct(1);
            expect(product.farmData.productType).to.equal(longDescription);
        });
    });

    describe("Query Performance Tests", function () {
        beforeEach(async function () {
            // Create test data
            const expiresAt = (await time.latest()) + 86400 * 30;
            const productCount = 20;

            for (let i = 0; i < productCount; i++) {
                await agriTraceCore.connect(farmer).createProduct(
                    `Query Product ${i}`,
                    expiresAt,
                    `Query Farm ${i}`,
                    ethers.parseEther("0.1"),
                    100
                );
            }
        });

        it("Should retrieve farmer products efficiently", async function () {
            const startTime = Date.now();
            const products = await agriTraceCore.getProductsByFarmer(farmer.address);
            const endTime = Date.now();

            console.log(`Retrieved ${products.length} products in ${endTime - startTime}ms`);
            expect(products.length).to.equal(20);
        });

        it("Should handle full trace queries efficiently", async function () {
            const startTime = Date.now();
            const trace = await agriTraceCore.getFullTrace(1);
            const endTime = Date.now();

            console.log(`Full trace query time: ${endTime - startTime}ms`);
            expect(trace[0]).to.equal(1); // Product ID
        });
    });
});