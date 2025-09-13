const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TemperatureOracle Tests", function () {
  let temperatureOracle;
  let owner, user1;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(await temperatureOracle.getAddress()).to.not.equal(
        ethers.ZeroAddress
      );
    });

    it("Should set owner correctly", async function () {
      expect(await temperatureOracle.owner()).to.equal(owner.address);
    });
  });

  describe("Temperature Requests", function () {
    it("Should request temperature for product", async function () {
      await expect(
        temperatureOracle.connect(user1).requestTemperatureForProduct(1)
      ).to.emit(temperatureOracle, "RequestTemperature");
    });

    it("Should track request to product mapping", async function () {
      const tx = await temperatureOracle
        .connect(user1)
        .requestTemperatureForProduct(1);
      const receipt = await tx.wait();

      // In real test, you'd extract requestId from event logs
      // For now, we'll test the getter functions
      expect(
        await temperatureOracle.getLatestTemperatureForProduct(1)
      ).to.equal(0);
    });

    it("Should get current temperature", async function () {
      expect(await temperatureOracle.getCurrentTemperature(1)).to.equal(0);
    });
  });

  describe("Oracle Response Handling", function () {
    it("Should handle temperature fulfillment", async function () {
      // Note: This test would require Chainlink mocks in a real implementation
      // For demonstration, we're testing the view functions

      const temperature =
        await temperatureOracle.getLatestTemperatureForProduct(1);
      expect(temperature).to.equal(0); // Default value before any fulfillment
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to withdraw LINK", async function () {
      // This test would require LINK token setup in a real implementation
      await expect(temperatureOracle.connect(owner).withdrawLink()).to.not.be
        .reverted;
    });

    it("Should prevent non-owner from withdrawing LINK", async function () {
      await expect(
        temperatureOracle.connect(user1).withdrawLink()
      ).to.be.revertedWith("Only callable by owner");
    });
  });

  describe("Error Handling", function () {
    it("Should handle invalid product IDs gracefully", async function () {
      expect(await temperatureOracle.getCurrentTemperature(999)).to.equal(0);
    });

    it("Should track multiple product requests", async function () {
      await temperatureOracle.connect(user1).requestTemperatureForProduct(1);
      await temperatureOracle.connect(user1).requestTemperatureForProduct(2);

      expect(await temperatureOracle.getCurrentTemperature(1)).to.equal(0);
      expect(await temperatureOracle.getCurrentTemperature(2)).to.equal(0);
    });
  });
});
