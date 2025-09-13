const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgriTrace System Integration Tests", function () {
  let agriTraceCore, temperatureOracle, damageDetectionConsumer;
  let admin, farmer, distributor, retailer, consumer;

  beforeEach(async function () {
    [admin, farmer, distributor, retailer, consumer] =
      await ethers.getSigners();

    // Deploy all contracts
    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();

    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();

    const DamageDetectionConsumer = await ethers.getContractFactory(
      "DamageDetectionConsumer"
    );
    damageDetectionConsumer = await DamageDetectionConsumer.deploy();
    await damageDetectionConsumer.waitForDeployment();

    // Setup
    await agriTraceCore.setTemperatureOracle(
      await temperatureOracle.getAddress()
    );
    await agriTraceCore.setDamageDetectionOracle(
      await damageDetectionConsumer.getAddress()
    );
    await agriTraceCore.assignRole(farmer.address, 1);
    await agriTraceCore.assignRole(distributor.address, 2);
    await agriTraceCore.assignRole(retailer.address, 3);
  });

  describe("Complete Product Lifecycle", function () {
    it("Should handle full product journey from farm to consumer", async function () {
      const futureTime = (await time.latest()) + 86400;

      // 1. Farmer creates product
      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct(
            "Organic Tomatoes",
            futureTime,
            "Green Valley Farm",
            100,
            50
          )
      ).to.emit(agriTraceCore, "ProductCreated");

      const productId = 1;

      // 2. Store farm data
      await agriTraceCore
        .connect(farmer)
        .storeFarmDataHash(productId, "QmFarmHash123");

      // 3. Distributor purchases
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);

      // 4. Create batch
      await agriTraceCore.connect(distributor).createBatch([productId]);
      const batchId = 1;

      // 5. Request temperature check
      await agriTraceCore
        .connect(distributor)
        .requestTemperatureUpdate(productId);

      // 6. Quality assessment
      await agriTraceCore
        .connect(distributor)
        .storeDistributorQualityWithOracle(
          productId,
          85,
          "minimal damage",
          "QmDistHash123"
        );

      // 7. Retailer purchases batch
      await agriTraceCore
        .connect(retailer)
        .purchaseBatchFromDistributor(batchId, [200]);

      // 8. Retailer quality assessment
      await agriTraceCore
        .connect(retailer)
        .storeRetailerQualityWithOracle(
          productId,
          80,
          "good condition",
          "QmRetailHash123"
        );

      // 9. List for consumer
      await agriTraceCore.connect(retailer).listProductForConsumer(productId);

      // 10. Consumer purchase
      await agriTraceCore
        .connect(retailer)
        .markProductAsBuyed(productId, consumer.address, 25);

      // Verify final state
      const product = await agriTraceCore.getProduct(productId);
      expect(product.currentStage).to.equal(2); // RETAIL
      expect(product.retailData.consumer).to.equal(consumer.address);
      expect(product.retailData.buyedQuantity).to.equal(25);

      // Verify traceability
      const trace = await agriTraceCore.getFullTrace(productId);
      expect(trace.farmDataHash).to.equal("QmFarmHash123");
      expect(trace.distributionDataHash).to.equal("QmDistHash123");
      expect(trace.retailDataHash).to.equal("QmRetailHash123");
    });

    it("Should handle product rejection during quality assessment", async function () {
      const futureTime = (await time.latest()) + 86400;

      // Setup product
      await agriTraceCore
        .connect(farmer)
        .createProduct("Apples", futureTime, "Farm B", 100, 30);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 120);
      await agriTraceCore.connect(distributor).createBatch([1]);

      // Simulate poor quality (low score = Grade REJECTED)
      await expect(
        agriTraceCore
          .connect(distributor)
          .storeDistributorQualityWithOracle(
            1,
            30,
            "severe damage",
            "QmPoorQuality"
          )
      ).to.emit(agriTraceCore, "ProductRejected");

      const product = await agriTraceCore.getProduct(1);
      expect(product.currentState).to.equal(3); // REJECTED
    });

    it("Should handle batch with mixed quality products", async function () {
      const futureTime = (await time.latest()) + 86400;

      // Create multiple products
      await agriTraceCore
        .connect(farmer)
        .createProduct("Product1", futureTime, "Farm", 100, 10);
      await agriTraceCore
        .connect(farmer)
        .createProduct("Product2", futureTime, "Farm", 100, 10);
      await agriTraceCore
        .connect(farmer)
        .createProduct("Product3", futureTime, "Farm", 100, 10);

      // Distributor purchases all
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(2, 150);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(3, 150);

      // Create batch
      await agriTraceCore.connect(distributor).createBatch([1, 2, 3]);

      // Quality assessment - mixed results
      await agriTraceCore
        .connect(distributor)
        .storeDistributorQualityWithOracle(1, 85, "good", "QmGood1"); // Pass

      await agriTraceCore
        .connect(distributor)
        .storeDistributorQualityWithOracle(2, 30, "poor", "QmPoor2"); // Fail - should be removed from batch

      await agriTraceCore
        .connect(distributor)
        .storeDistributorQualityWithOracle(3, 75, "acceptable", "QmOk3"); // Pass

      // Check batch contents - should only have 2 valid products
      const validProducts = await agriTraceCore.getProductsInBatch(1);
      expect(validProducts.length).to.equal(2);

      // Verify retailer can purchase batch with valid products
      await agriTraceCore
        .connect(retailer)
        .purchaseBatchFromDistributor(1, [200, 200]);
    });
  });

  describe("ML Integration Workflow", function () {
    it("Should handle ML prediction request flow", async function () {
      const futureTime = (await time.latest()) + 86400;

      // Setup
      await agriTraceCore
        .connect(farmer)
        .createProduct("ML Test Product", futureTime, "Farm", 100, 20);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150);
      await agriTraceCore.connect(distributor).createBatch([1]);

      // Request ML prediction
      const imageUrl = "https://example.com/test-tomato.jpg";
      await expect(
        agriTraceCore
          .connect(distributor)
          .requestMLDamagePrediction(1, imageUrl)
      ).to.emit(agriTraceCore, "MLPredictionRequested");

      // Check prediction status
      const status = await agriTraceCore.getMLPredictionStatus(1);
      expect(status.requestId).to.not.equal(ethers.ZeroHash);
      expect(status.fulfilled).to.be.false;

      // Note: In real test, you'd mock the Chainlink response here
      // For now, we verify the request was made
    });

    it("Should prevent unauthorized ML requests", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Test", futureTime, "Farm", 100, 20);

      await expect(
        agriTraceCore
          .connect(retailer)
          .requestMLDamagePrediction(1, "https://example.com/image.jpg")
      ).to.be.revertedWith("Not authorized for this product");
    });
  });

  describe("Oracle Integration", function () {
    it("Should handle temperature oracle requests", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Temperature Test", futureTime, "Farm", 100, 15);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150);

      await expect(
        agriTraceCore.connect(distributor).requestTemperatureUpdate(1)
      ).to.not.be.reverted;
    });

    it("Should validate oracle settings", async function () {
      // Reset oracle
      await agriTraceCore
        .connect(admin)
        .setTemperatureOracle(ethers.ZeroAddress);

      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("No Oracle Test", futureTime, "Farm", 100, 15);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150);
      await agriTraceCore.connect(distributor).createBatch([1]);

      await expect(
        agriTraceCore
          .connect(distributor)
          .storeDistributorQualityWithOracle(1, 85, "good", "QmHash")
      ).to.be.revertedWith("Temperature oracle not set");
    });
  });

  describe("Emergency Scenarios", function () {
    it("Should handle system pause during operations", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Emergency Test", futureTime, "Farm", 100, 15);

      // Get emergency manager and pause system
      const emergencyManager = await agriTraceCore.emergency();
      const EmergencyManager = await ethers.getContractFactory(
        "EmergencyManager"
      );
      const emergencyContract = EmergencyManager.attach(emergencyManager);

      await emergencyContract.connect(admin).pause();

      // Should prevent new operations
      await expect(
        agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150)
      ).to.be.revertedWith("System paused");

      // Resume and continue
      await emergencyContract.connect(admin).unpause();

      await expect(
        agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150)
      ).to.not.be.reverted;
    });

    it("Should handle user blacklisting", async function () {
      const emergencyManager = await agriTraceCore.emergency();
      const EmergencyManager = await ethers.getContractFactory(
        "EmergencyManager"
      );
      const emergencyContract = EmergencyManager.attach(emergencyManager);

      await emergencyContract.connect(admin).blacklist(farmer.address);

      const futureTime = (await time.latest()) + 86400;
      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Blacklisted Test", futureTime, "Farm", 100, 15)
      ).to.be.revertedWith("User blacklisted");
    });
  });

  describe("Data Consistency & Edge Cases", function () {
    it("Should maintain data consistency across stages", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Consistency Test", futureTime, "Farm", 100, 25);

      // Verify initial state
      let product = await agriTraceCore.getProduct(1);
      expect(product.farmData.quantity).to.equal(25);
      expect(product.isActive).to.be.true;

      // Move through stages and verify consistency
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150);
      product = await agriTraceCore.getProduct(1);
      expect(product.currentStage).to.equal(1); // DISTRIBUTION
      expect(product.distributionData.distributor).to.equal(
        distributor.address
      );

      await agriTraceCore.connect(distributor).createBatch([1]);
      product = await agriTraceCore.getProduct(1);
      expect(product.currentState).to.equal(1); // RECEIVED

      // Verify transaction records
      const tx = await agriTraceCore.getTransaction(
        product.farmerToDistributorTxId
      );
      expect(tx.from).to.equal(farmer.address);
      expect(tx.to).to.equal(distributor.address);
      expect(tx.productId).to.equal(1);
    });

    it("Should handle zero quantities correctly", async function () {
      const futureTime = (await time.latest()) + 86400;

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Zero Quantity", futureTime, "Farm", 100, 0)
      ).to.be.revertedWith("Invalid params");
    });

    it("Should handle expired products", async function () {
      const pastTime = (await time.latest()) - 86400;

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Expired", pastTime, "Farm", 100, 10)
      ).to.be.revertedWith("Invalid params");
    });
  });

  describe("Performance & Gas Optimization", function () {
    it("Should handle large batches efficiently", async function () {
      const futureTime = (await time.latest()) + 86400;
      const productIds = [];

      // Create 10 products
      for (let i = 0; i < 10; i++) {
        await agriTraceCore
          .connect(farmer)
          .createProduct(`Product${i}`, futureTime, "Farm", 100, 10);
        productIds.push(i + 1);
        await agriTraceCore.connect(distributor).purchaseFromFarmer(i + 1, 150);
      }

      // Create large batch
      const tx = await agriTraceCore
        .connect(distributor)
        .createBatch(productIds);
      const receipt = await tx.wait();

      // Verify gas usage is reasonable (adjust limit as needed)
      expect(receipt.gasUsed).to.be.below(5000000);

      // Verify batch creation
      const batch = await agriTraceCore.getBatchDetails(1);
      expect(batch.productIds.length).to.equal(10);
    });
  });
});
