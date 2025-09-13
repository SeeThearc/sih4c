const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgriTraceLib", function () {
    let testContract;
    let owner;

    // Deploy a test contract that uses the library
    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Create a test contract that uses AgriTraceLib
        const TestLibContract = await ethers.getContractFactory("TestAgriTraceLib");
        testContract = await TestLibContract.deploy();
        await testContract.waitForDeployment();
    });

    describe("Constants Verification", function () {
        it("Should have correct grade thresholds", async function () {
            expect(await testContract.GRADE_A()).to.equal(85);
            expect(await testContract.GRADE_B()).to.equal(70);
            expect(await testContract.GRADE_C()).to.equal(55);
            expect(await testContract.MAX_SCORE()).to.equal(100);
        });

        it("Should verify grade hierarchy", async function () {
            const gradeA = await testContract.GRADE_A();
            const gradeB = await testContract.GRADE_B();
            const gradeC = await testContract.GRADE_C();

            expect(gradeA).to.be.above(gradeB);
            expect(gradeB).to.be.above(gradeC);
            expect(gradeA).to.be.at.most(await testContract.MAX_SCORE());
        });
    });

    describe("Enum Values", function () {
        it("Should have correct Role enum values", async function () {
            expect(await testContract.getRoleValue("NONE")).to.equal(0);
            expect(await testContract.getRoleValue("FARMER")).to.equal(1);
            expect(await testContract.getRoleValue("DISTRIBUTOR")).to.equal(2);
            expect(await testContract.getRoleValue("RETAILER")).to.equal(3);
            expect(await testContract.getRoleValue("ADMIN")).to.equal(4);
        });

        it("Should have correct Stage enum values", async function () {
            expect(await testContract.getStageValue("FARM")).to.equal(0);
            expect(await testContract.getStageValue("DISTRIBUTION")).to.equal(1);
            expect(await testContract.getStageValue("RETAIL")).to.equal(2);
        });

        it("Should have correct Grade enum values", async function () {
            expect(await testContract.getGradeValue("A")).to.equal(0);
            expect(await testContract.getGradeValue("B")).to.equal(1);
            expect(await testContract.getGradeValue("C")).to.equal(2);
            expect(await testContract.getGradeValue("REJECTED")).to.equal(3);
        });

        it("Should have correct ProductState enum values", async function () {
            expect(await testContract.getProductStateValue("PENDING_PICKUP")).to.equal(0);
            expect(await testContract.getProductStateValue("RECEIVED")).to.equal(1);
            expect(await testContract.getProductStateValue("VERIFIED")).to.equal(2);
            expect(await testContract.getProductStateValue("REJECTED")).to.equal(3);
            expect(await testContract.getProductStateValue("LISTED")).to.equal(4);
            expect(await testContract.getProductStateValue("BUYED")).to.equal(5);
        });
    });

    describe("Struct Creation and Validation", function () {
        it("Should create Quality struct correctly", async function () {
            const qualityData = {
                score: 85,
                grade: 0, // Grade A
                damageLevel: "Minimal",
                temperature: 10,
                timestamp: Math.floor(Date.now() / 1000),
                assessor: owner.address
            };

            const quality = await testContract.createQuality(
                qualityData.score,
                qualityData.grade,
                qualityData.damageLevel,
                qualityData.temperature,
                qualityData.timestamp,
                qualityData.assessor
            );

            expect(quality.score).to.equal(qualityData.score);
            expect(quality.grade).to.equal(qualityData.grade);
            expect(quality.damageLevel).to.equal(qualityData.damageLevel);
            expect(quality.temperature).to.equal(qualityData.temperature);
            expect(quality.timestamp).to.equal(qualityData.timestamp);
            expect(quality.assessor).to.equal(qualityData.assessor);
        });

        it("Should create FarmData struct correctly", async function () {
            const farmData = {
                productType: "Organic Tomatoes",
                farmer: owner.address,
                createdAt: Math.floor(Date.now() / 1000),
                expiresAt: Math.floor(Date.now() / 1000) + 86400,
                origin: "California Farm",
                priceFarm: ethers.parseEther("10"),
                quantity: 100
            };

            const farm = await testContract.createFarmData(
                farmData.productType,
                farmData.farmer,
                farmData.createdAt,
                farmData.expiresAt,
                farmData.origin,
                farmData.priceFarm,
                farmData.quantity
            );

            expect(farm.productType).to.equal(farmData.productType);
            expect(farm.farmer).to.equal(farmData.farmer);
            expect(farm.createdAt).to.equal(farmData.createdAt);
            expect(farm.expiresAt).to.equal(farmData.expiresAt);
            expect(farm.origin).to.equal(farmData.origin);
            expect(farm.priceFarm).to.equal(farmData.priceFarm);
            expect(farm.quantity).to.equal(farmData.quantity);
        });

        it("Should create Batch struct correctly", async function () {
            const batchData = {
                batchId: 1,
                distributor: owner.address,
                retailer: ethers.ZeroAddress,
                productIds: [1, 2, 3],
                createdAt: Math.floor(Date.now() / 1000),
                isDistributedToRetailer: false
            };

            const batch = await testContract.createBatch(
                batchData.batchId,
                batchData.distributor,
                batchData.retailer,
                batchData.productIds,
                batchData.createdAt,
                batchData.isDistributedToRetailer
            );

            expect(batch.batchId).to.equal(batchData.batchId);
            expect(batch.distributor).to.equal(batchData.distributor);
            expect(batch.retailer).to.equal(batchData.retailer);
            expect(batch.productIds.length).to.equal(batchData.productIds.length);
            expect(batch.createdAt).to.equal(batchData.createdAt);
            expect(batch.isDistributedToRetailer).to.equal(batchData.isDistributedToRetailer);
        });
    });

    describe("Grade Validation Logic", function () {
        it("Should correctly validate grade thresholds", async function () {
            // Test Grade A threshold
            expect(await testContract.validateGradeThreshold(85)).to.equal(0); // Grade A
            expect(await testContract.validateGradeThreshold(100)).to.equal(0); // Grade A
            
            // Test Grade B threshold
            expect(await testContract.validateGradeThreshold(70)).to.equal(1); // Grade B
            expect(await testContract.validateGradeThreshold(84)).to.equal(1); // Grade B
            
            // Test Grade C threshold
            expect(await testContract.validateGradeThreshold(55)).to.equal(2); // Grade C
            expect(await testContract.validateGradeThreshold(69)).to.equal(2); // Grade C
            
            // Test REJECTED threshold
            expect(await testContract.validateGradeThreshold(54)).to.equal(3); // REJECTED
            expect(await testContract.validateGradeThreshold(0)).to.equal(3); // REJECTED
        });
    });
});