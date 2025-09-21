const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgriTrace Role Management", function () {
  let agriTraceCore;
  let admin, farmer, distributor, retailer, user1, user2;

  beforeEach(async function () {
    [admin, farmer, distributor, retailer, user1, user2] =
      await ethers.getSigners();

    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();
  });

  describe("Role Assignment", function () {
    it("Should assign roles correctly", async function () {
      await agriTraceCore.assignRole(farmer.address, 1); // FARMER
      await agriTraceCore.assignRole(distributor.address, 2); // DISTRIBUTOR
      await agriTraceCore.assignRole(retailer.address, 3); // RETAILER

      expect(await agriTraceCore.getRole(farmer.address)).to.equal(1);
      expect(await agriTraceCore.getRole(distributor.address)).to.equal(2);
      expect(await agriTraceCore.getRole(retailer.address)).to.equal(3);
    });

    it("Should initialize reputation scores on role assignment", async function () {
      await agriTraceCore.assignRole(farmer.address, 1);

      expect(await agriTraceCore.getReputation(1, farmer.address)).to.equal(50);
      expect(await agriTraceCore.getReputation(2, farmer.address)).to.equal(50);
      expect(await agriTraceCore.getReputation(3, farmer.address)).to.equal(50);
    });

    it("Should only allow admin to assign roles", async function () {
      await expect(
        agriTraceCore.connect(user1).assignRole(farmer.address, 1)
      ).to.be.revertedWith("Only admin");
    });

    it("Should allow self-registration", async function () {
      await agriTraceCore.connect(user1).registerUser(1, "QmUserDetails123");

      expect(await agriTraceCore.getRole(user1.address)).to.equal(1);
      expect(await agriTraceCore.userDataHash(user1.address)).to.equal(
        "QmUserDetails123"
      );
    });

    it("Should prevent duplicate registration", async function () {
      await agriTraceCore.connect(user1).registerUser(1, "QmUserDetails123");

      await expect(
        agriTraceCore.connect(user1).registerUser(2, "QmNewDetails456")
      ).to.be.revertedWith("Already registered");
    });

    it("Should prevent self-registration as admin", async function () {
      await expect(
        agriTraceCore.connect(user1).registerUser(4, "QmAdminDetails")
      ).to.be.revertedWith("Cannot self-register as admin");
    });

    it("Should require details hash for registration", async function () {
      await expect(
        agriTraceCore.connect(user1).registerUser(1, "")
      ).to.be.revertedWith("Details hash required");
    });
  });

  describe("User Details", function () {
    it("Should return complete user details", async function () {
      // Use a fresh user to avoid registration conflicts
      await agriTraceCore.connect(user2).registerUser(1, "QmFarmerDetails789");

      const details = await agriTraceCore.getUserDetails(user2.address);
      expect(details.role).to.equal(1);
      expect(details.farmerReputation).to.equal(50);
      expect(details.distributorReputation).to.equal(50);
      expect(details.retailerReputation).to.equal(50);
      expect(details.detailsHash).to.equal("QmFarmerDetails789");
    });

    it("Should return default values for unregistered users", async function () {
      const details = await agriTraceCore.getUserDetails(user1.address);
      expect(details.role).to.equal(0); // NONE
      expect(details.farmerReputation).to.equal(0);
      expect(details.distributorReputation).to.equal(0);
      expect(details.retailerReputation).to.equal(0);
      expect(details.detailsHash).to.equal("");
    });
  });

  describe("Admin Functions", function () {
    it("Should have correct admin setup", async function () {
      expect(await agriTraceCore.admin()).to.equal(admin.address);
      expect(await agriTraceCore.getRole(admin.address)).to.equal(4); // ADMIN
    });

    it("Should allow admin to assign multiple roles", async function () {
      const users = [user1, user2];
      const roles = [1, 2]; // FARMER, DISTRIBUTOR

      for (let i = 0; i < users.length; i++) {
        await agriTraceCore.assignRole(users[i].address, roles[i]);
        expect(await agriTraceCore.getRole(users[i].address)).to.equal(
          roles[i]
        );
      }
    });
  });
});
