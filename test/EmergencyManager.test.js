const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EmergencyManager", function () {
    let emergencyManager;
    let admin, user1, user2;

    beforeEach(async function () {
        [admin, user1, user2] = await ethers.getSigners();
        
        const EmergencyManager = await ethers.getContractFactory("EmergencyManager");
        emergencyManager = await EmergencyManager.deploy();
        await emergencyManager.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the deployer as admin", async function () {
            expect(await emergencyManager.admin()).to.equal(admin.address);
        });

        it("Should start unpaused", async function () {
            expect(await emergencyManager.paused()).to.equal(false);
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow admin to pause", async function () {
            await expect(emergencyManager.pause())
                .to.emit(emergencyManager, "Paused")
                .withArgs(admin.address);
            
            expect(await emergencyManager.paused()).to.equal(true);
        });

        it("Should allow admin to unpause", async function () {
            await emergencyManager.pause();
            
            await expect(emergencyManager.unpause())
                .to.emit(emergencyManager, "Unpaused")
                .withArgs(admin.address);
            
            expect(await emergencyManager.paused()).to.equal(false);
        });

        it("Should not allow non-admin to pause", async function () {
            await expect(
                emergencyManager.connect(user1).pause()
            ).to.be.revertedWith("Only admin");
        });
    });

    describe("Blacklist Functionality", function () {
        it("Should allow admin to blacklist users", async function () {
            await expect(emergencyManager.blacklist(user1.address))
                .to.emit(emergencyManager, "Blacklisted")
                .withArgs(user1.address);
            
            expect(await emergencyManager.blacklisted(user1.address)).to.equal(true);
        });

        it("Should allow admin to unblacklist users", async function () {
            await emergencyManager.blacklist(user1.address);
            
            await expect(emergencyManager.unblacklist(user1.address))
                .to.emit(emergencyManager, "Unblacklisted")
                .withArgs(user1.address);
            
            expect(await emergencyManager.blacklisted(user1.address)).to.equal(false);
        });

        it("Should not allow non-admin to blacklist", async function () {
            await expect(
                emergencyManager.connect(user1).blacklist(user2.address)
            ).to.be.revertedWith("Only admin");
        });
    });

    describe("View Functions", function () {
        it("Should return correct blacklist status", async function () {
            expect(await emergencyManager.isBlacklisted(user1.address)).to.equal(false);
            
            await emergencyManager.blacklist(user1.address);
            expect(await emergencyManager.isBlacklisted(user1.address)).to.equal(true);
        });

        it("Should return correct pause status", async function () {
            expect(await emergencyManager.isPaused()).to.equal(false);
            
            await emergencyManager.pause();
            expect(await emergencyManager.isPaused()).to.equal(true);
        });
    });
});