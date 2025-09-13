const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EmergencyManager Tests", function () {
  let emergencyManager;
  let admin, user1, user2;

  beforeEach(async function () {
    [admin, user1, user2] = await ethers.getSigners();

    const EmergencyManager = await ethers.getContractFactory(
      "EmergencyManager"
    );
    emergencyManager = await EmergencyManager.deploy(admin.address);
    await emergencyManager.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(await emergencyManager.getAddress()).to.not.equal(
        ethers.ZeroAddress
      );
    });

    it("Should set admin correctly", async function () {
      expect(await emergencyManager.admin()).to.equal(admin.address);
    });

    it("Should initialize as unpaused", async function () {
      expect(await emergencyManager.paused()).to.be.false;
      expect(await emergencyManager.isPaused()).to.be.false;
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow admin to pause", async function () {
      await expect(emergencyManager.connect(admin).pause())
        .to.emit(emergencyManager, "Paused")
        .withArgs(admin.address);

      expect(await emergencyManager.paused()).to.be.true;
    });

    it("Should allow admin to unpause", async function () {
      await emergencyManager.connect(admin).pause();

      await expect(emergencyManager.connect(admin).unpause())
        .to.emit(emergencyManager, "Unpaused")
        .withArgs(admin.address);

      expect(await emergencyManager.paused()).to.be.false;
    });

    it("Should prevent non-admin from pausing", async function () {
      await expect(emergencyManager.connect(user1).pause()).to.be.revertedWith(
        "Only admin"
      );
    });

    it("Should prevent non-admin from unpausing", async function () {
      await emergencyManager.connect(admin).pause();

      await expect(
        emergencyManager.connect(user1).unpause()
      ).to.be.revertedWith("Only admin");
    });
  });

  describe("Blacklist Functionality", function () {
    it("Should allow admin to blacklist user", async function () {
      await expect(emergencyManager.connect(admin).blacklist(user1.address))
        .to.emit(emergencyManager, "Blacklisted")
        .withArgs(user1.address);

      expect(await emergencyManager.blacklisted(user1.address)).to.be.true;
      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.true;
    });

    it("Should allow admin to unblacklist user", async function () {
      await emergencyManager.connect(admin).blacklist(user1.address);

      await expect(emergencyManager.connect(admin).unblacklist(user1.address))
        .to.emit(emergencyManager, "Unblacklisted")
        .withArgs(user1.address);

      expect(await emergencyManager.blacklisted(user1.address)).to.be.false;
    });

    it("Should prevent non-admin from blacklisting", async function () {
      await expect(
        emergencyManager.connect(user1).blacklist(user2.address)
      ).to.be.revertedWith("Only admin");
    });

    it("Should prevent non-admin from unblacklisting", async function () {
      await emergencyManager.connect(admin).blacklist(user1.address);

      await expect(
        emergencyManager.connect(user2).unblacklist(user1.address)
      ).to.be.revertedWith("Only admin");
    });
  });

  describe("State Queries", function () {
    it("Should return correct pause state", async function () {
      expect(await emergencyManager.isPaused()).to.be.false;

      await emergencyManager.connect(admin).pause();
      expect(await emergencyManager.isPaused()).to.be.true;

      await emergencyManager.connect(admin).unpause();
      expect(await emergencyManager.isPaused()).to.be.false;
    });

    it("Should return correct blacklist state", async function () {
      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.false;

      await emergencyManager.connect(admin).blacklist(user1.address);
      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.true;

      await emergencyManager.connect(admin).unblacklist(user1.address);
      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.false;
    });
  });

  describe("Multiple Users Management", function () {
    it("Should handle multiple blacklisted users", async function () {
      await emergencyManager.connect(admin).blacklist(user1.address);
      await emergencyManager.connect(admin).blacklist(user2.address);

      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.true;
      expect(await emergencyManager.isBlacklisted(user2.address)).to.be.true;

      await emergencyManager.connect(admin).unblacklist(user1.address);

      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.false;
      expect(await emergencyManager.isBlacklisted(user2.address)).to.be.true;
    });

    it("Should handle admin self-blacklisting", async function () {
      await expect(emergencyManager.connect(admin).blacklist(admin.address))
        .to.emit(emergencyManager, "Blacklisted")
        .withArgs(admin.address);

      expect(await emergencyManager.isBlacklisted(admin.address)).to.be.true;

      // Admin should still be able to unblacklist themselves
      await emergencyManager.connect(admin).unblacklist(admin.address);
      expect(await emergencyManager.isBlacklisted(admin.address)).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle double pausing", async function () {
      await emergencyManager.connect(admin).pause();

      await expect(emergencyManager.connect(admin).pause()).to.emit(
        emergencyManager,
        "Paused"
      );

      expect(await emergencyManager.paused()).to.be.true;
    });

    it("Should handle double unpausing", async function () {
      await expect(emergencyManager.connect(admin).unpause()).to.emit(
        emergencyManager,
        "Unpaused"
      );

      expect(await emergencyManager.paused()).to.be.false;
    });

    it("Should handle double blacklisting", async function () {
      await emergencyManager.connect(admin).blacklist(user1.address);

      await expect(
        emergencyManager.connect(admin).blacklist(user1.address)
      ).to.emit(emergencyManager, "Blacklisted");

      expect(await emergencyManager.isBlacklisted(user1.address)).to.be.true;
    });
  });
});
