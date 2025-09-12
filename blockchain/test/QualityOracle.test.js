const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("QualityOracle", function () {
    let qualityOracle;
    let core, assessor, otherUser;

    beforeEach(async function () {
        [core, assessor, otherUser] = await ethers.getSigners();
        
        const QualityOracle = await ethers.getContractFactory("QualityOracle");
        qualityOracle = await QualityOracle.deploy();
        await qualityOracle.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the deployer as core", async function () {
            expect(await qualityOracle.core()).to.equal(core.address);
        });
    });

    describe("Quality Assessment", function () {
        it("Should assess quality correctly for Grade A", async function () {
            await expect(
                qualityOracle.assessQuality(
                    1,
                    90,
                    "Low",
                    "QmQualityHash123",
                    20
                )
            ).to.emit(qualityOracle, "QualityAssessed")
             .withArgs(1, 90, 0, core.address, "QmQualityHash123", 20); // Grade A = 0
        });

        it("Should assess quality correctly for Grade B", async function () {
            await expect(
                qualityOracle.assessQuality(
                    1,
                    75,
                    "Medium",
                    "QmQualityHash123",
                    15
                )
            ).to.emit(qualityOracle, "QualityAssessed")
             .withArgs(1, 75, 1, core.address, "QmQualityHash123", 15); // Grade B = 1
        });

        it("Should assess quality correctly for Grade C", async function () {
            await expect(
                qualityOracle.assessQuality(
                    1,
                    60,
                    "High",
                    "QmQualityHash123",
                    10
                )
            ).to.emit(qualityOracle, "QualityAssessed")
             .withArgs(1, 60, 2, core.address, "QmQualityHash123", 10); // Grade C = 2
        });

        it("Should assess quality correctly for Rejected", async function () {
            await expect(
                qualityOracle.assessQuality(
                    1,
                    30,
                    "Critical",
                    "QmQualityHash123",
                    5
                )
            ).to.emit(qualityOracle, "QualityAssessed")
             .withArgs(1, 30, 3, core.address, "QmQualityHash123", 5); // Rejected = 3
        });

        it("Should only allow core to assess quality", async function () {
            await expect(
                qualityOracle.connect(otherUser).assessQuality(
                    1,
                    90,
                    "Low",
                    "QmQualityHash123",
                    20
                )
            ).to.be.revertedWith("Only core");
        });

        it("Should store quality history", async function () {
            await qualityOracle.assessQuality(1, 90, "Low", "QmHash1", 20);
            await qualityOracle.assessQuality(1, 85, "Medium", "QmHash2", 18);

            const history = await qualityOracle.getQualityHistory(1);
            expect(history.length).to.equal(2);
            expect(history[0].score).to.equal(90);
            expect(history[1].score).to.equal(85);
        });
    });

    describe("View Functions", function () {
        it("Should return empty history for new product", async function () {
            const history = await qualityOracle.getQualityHistory(999);
            expect(history.length).to.equal(0);
        });

        it("Should return complete quality history", async function () {
            await qualityOracle.assessQuality(1, 90, "Low", "QmHash1", 20);
            await qualityOracle.assessQuality(1, 80, "Medium", "QmHash2", 15);
            await qualityOracle.assessQuality(1, 70, "High", "QmHash3", 10);

            const history = await qualityOracle.getQualityHistory(1);
            expect(history.length).to.equal(3);
            
            expect(history[0].score).to.equal(90);
            expect(history[0].grade).to.equal(0); // Grade A
            expect(history[0].damageLevel).to.equal("Low");
            expect(history[0].temperature).to.equal(20);
            
            expect(history[2].score).to.equal(70);
            expect(history[2].grade).to.equal(1); // Grade B
            expect(history[2].damageLevel).to.equal("High");
            expect(history[2].temperature).to.equal(10);
        });
    });
});