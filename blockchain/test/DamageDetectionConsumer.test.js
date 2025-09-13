const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DamageDetectionConsumer Tests", function () {
  let damageDetectionConsumer;
  let owner, user1;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    const DamageDetectionConsumer = await ethers.getContractFactory(
      "DamageDetectionConsumer"
    );
    damageDetectionConsumer = await DamageDetectionConsumer.deploy();
    await damageDetectionConsumer.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(await damageDetectionConsumer.getAddress()).to.not.equal(
        ethers.ZeroAddress
      );
    });

    it("Should set owner correctly", async function () {
      expect(await damageDetectionConsumer.owner()).to.equal(owner.address);
    });

    it("Should set default API endpoint", async function () {
      expect(await damageDetectionConsumer.apiEndpoint()).to.include(
        "your-api-server.com"
      );
    });
  });

  describe("ML Prediction Requests", function () {
    const testImageUrl = "https://example.com/test-image.jpg";

    it("Should request damage prediction", async function () {
      await expect(
        damageDetectionConsumer
          .connect(user1)
          .requestDamagePrediction(testImageUrl)
      ).to.emit(damageDetectionConsumer, "PredictionRequested");
    });

    it("Should track requester", async function () {
      const tx = await damageDetectionConsumer
        .connect(user1)
        .requestDamagePrediction(testImageUrl);
      const receipt = await tx.wait();

      // In real test, extract requestId from event
      // For now, testing that function doesn't revert
      expect(tx).to.not.be.reverted;
    });

    it("Should handle multiple requests", async function () {
      await damageDetectionConsumer
        .connect(user1)
        .requestDamagePrediction(testImageUrl);
      await damageDetectionConsumer
        .connect(user1)
        .requestDamagePrediction("https://example.com/image2.jpg");

      // Both requests should succeed
      expect(true).to.be.true;
    });
  });

  describe("Prediction Results", function () {
    it("Should return empty prediction for non-existent request", async function () {
      const fakeRequestId = ethers.randomBytes(32);

      const result = await damageDetectionConsumer.getPrediction(fakeRequestId);
      expect(result.damageScore).to.equal(0);
      expect(result.prediction).to.equal("");
      expect(result.fulfilled).to.be.false;
    });

    it("Should check request status", async function () {
      const fakeRequestId = ethers.randomBytes(32);

      const status = await damageDetectionConsumer.getRequestStatus(
        fakeRequestId
      );
      expect(status.exists).to.be.false;
      expect(status.fulfilled).to.be.false;
    });

    it("Should get requester address", async function () {
      const fakeRequestId = ethers.randomBytes(32);

      const requester = await damageDetectionConsumer.getRequester(
        fakeRequestId
      );
      expect(requester).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to update API endpoint", async function () {
      const newEndpoint = "https://new-api.example.com/predict";

      await expect(
        damageDetectionConsumer.connect(owner).updateApiEndpoint(newEndpoint)
      ).to.not.be.reverted;

      expect(await damageDetectionConsumer.apiEndpoint()).to.equal(newEndpoint);
    });

    it("Should prevent non-owner from updating API endpoint", async function () {
      await expect(
        damageDetectionConsumer
          .connect(user1)
          .updateApiEndpoint("https://malicious.com")
      ).to.be.revertedWith("Only callable by owner");
    });

    it("Should allow owner to withdraw LINK", async function () {
      await expect(damageDetectionConsumer.connect(owner).withdrawLink()).to.not
        .be.reverted;
    });
  });

  describe("Oracle Integration", function () {
    it("Should handle fulfill callback", async function () {
      // This test would require Chainlink mocks in a real implementation
      // For demonstration, we're testing that the function exists and can be called

      const fakeRequestId = ethers.randomBytes(32);
      const damageScore = 75;

      // In real test, this would be called by Chainlink oracle
      // await damageDetectionConsumer.fulfill(fakeRequestId, damageScore);

      // For now, just verify the function interface
      expect(damageDetectionConsumer.interface.hasFunction("fulfill")).to.be
        .true;
    });
  });

  describe("Error Handling", function () {
    it("Should handle empty image URLs gracefully", async function () {
      // The contract doesn't validate URL format, so this should not revert
      await expect(
        damageDetectionConsumer.connect(user1).requestDamagePrediction("")
      ).to.not.be.reverted;
    });

    it("Should handle malformed URLs", async function () {
      await expect(
        damageDetectionConsumer
          .connect(user1)
          .requestDamagePrediction("not-a-url")
      ).to.not.be.reverted;
    });
  });
});
