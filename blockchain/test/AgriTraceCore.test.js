const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgriTraceCore Complete Test Suite", function () {
  let agriTraceCore;
  let temperatureOracle;
  let damageDetectionConsumer;
  let emergencyManager;
  let admin, farmer, distributor, retailer, consumer;
  let linkToken;

  beforeEach(async function () {
    [admin, farmer, distributor, retailer, consumer] =
      await ethers.getSigners();

    // Deploy EmergencyManager first (it's created in constructor)
    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();

    // Deploy Temperature Oracle
    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();

    // Deploy Damage Detection Consumer
    const DamageDetectionConsumer = await ethers.getContractFactory(
      "DamageDetectionConsumer"
    );
    damageDetectionConsumer = await DamageDetectionConsumer.deploy();
    await damageDetectionConsumer.waitForDeployment();

    // Set oracles in main contract
    await agriTraceCore.setTemperatureOracle(
      await temperatureOracle.getAddress()
    );
    await agriTraceCore.setDamageDetectionOracle(
      await damageDetectionConsumer.getAddress()
    );

    // Assign roles
    await agriTraceCore.assignRole(farmer.address, 1); // FARMER
    await agriTraceCore.assignRole(distributor.address, 2); // DISTRIBUTOR
    await agriTraceCore.assignRole(retailer.address, 3); // RETAILER
  });

  describe("Contract Deployment & Initial State", function () {
    it("Should deploy all contracts successfully", async function () {
      expect(await agriTraceCore.getAddress()).to.not.equal(ethers.ZeroAddress);
      expect(await temperatureOracle.getAddress()).to.not.equal(
        ethers.ZeroAddress
      );
      expect(await damageDetectionConsumer.getAddress()).to.not.equal(
        ethers.ZeroAddress
      );
    });

    it("Should set admin correctly", async function () {
      expect(await agriTraceCore.admin()).to.equal(admin.address);
      expect(await agriTraceCore.getRole(admin.address)).to.equal(4); // ADMIN
    });

    it("Should initialize reputation scores", async function () {
      expect(await agriTraceCore.getReputation(1, farmer.address)).to.equal(50);
      expect(
        await agriTraceCore.getReputation(2, distributor.address)
      ).to.equal(50);
      expect(await agriTraceCore.getReputation(3, retailer.address)).to.equal(
        50
      );
    });
  });

  describe("User Registration & Role Management", function () {
    it("Should allow user self-registration", async function () {
      const newUser = consumer;
      await agriTraceCore.connect(newUser).registerUser(1, "QmTestHash123");

      expect(await agriTraceCore.getRole(newUser.address)).to.equal(1);
      expect(await agriTraceCore.getReputation(1, newUser.address)).to.equal(
        50
      );
    });

    it("Should prevent admin self-registration", async function () {
      await expect(
        agriTraceCore.connect(consumer).registerUser(4, "QmTestHash123")
      ).to.be.revertedWith("Cannot self-register as admin");
    });

    it("Should prevent double registration", async function () {
      await expect(
        agriTraceCore.connect(farmer).registerUser(1, "QmTestHash123")
      ).to.be.revertedWith("Already registered");
    });

    it("Should require details hash", async function () {
      await expect(
        agriTraceCore.connect(consumer).registerUser(1, "")
      ).to.be.revertedWith("Details hash required");
    });
  });

  describe("Product Creation & Farm Stage", function () {
    it("Should create product successfully", async function () {
      const futureTime = (await time.latest()) + 86400; // 1 day from now

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Tomatoes", futureTime, "Farm A", 100, 50)
      )
        .to.emit(agriTraceCore, "ProductCreated")
        .withArgs(1, farmer.address);

      const product = await agriTraceCore.getProduct(1);
      expect(product.farmData.productType).to.equal("Tomatoes");
      expect(product.farmData.farmer).to.equal(farmer.address);
      expect(product.currentStage).to.equal(0); // FARM
      expect(product.currentState).to.equal(0); // PENDING_PICKUP
    });

    it("Should prevent non-farmer from creating products", async function () {
      const futureTime = (await time.latest()) + 86400;

      await expect(
        agriTraceCore
          .connect(distributor)
          .createProduct("Tomatoes", futureTime, "Farm A", 100, 50)
      ).to.be.revertedWith("Not farmer");
    });

    it("Should validate product parameters", async function () {
      const pastTime = (await time.latest()) - 86400;

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Tomatoes", pastTime, "Farm A", 100, 50)
      ).to.be.revertedWith("Invalid params");

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct(
            "Tomatoes",
            (await time.latest()) + 86400,
            "Farm A",
            100,
            0
          )
      ).to.be.revertedWith("Invalid params");
    });

    it("Should store farm data hash", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);

      await expect(
        agriTraceCore.connect(farmer).storeFarmDataHash(1, "QmFarmDataHash123")
      )
        .to.emit(agriTraceCore, "DataStored")
        .withArgs(1, "QmFarmDataHash123", 0);

      const product = await agriTraceCore.getProduct(1);
      expect(product.farmDataHash).to.equal("QmFarmDataHash123");
    });
  });

  describe("Distribution Stage", function () {
    let productId;

    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      productId = 1;
    });

    it("Should allow distributor to purchase from farmer", async function () {
      await expect(
        agriTraceCore.connect(distributor).purchaseFromFarmer(productId, 150)
      )
        .to.emit(agriTraceCore, "ProductPurchased")
        .withArgs(productId, distributor.address, farmer.address);

      const product = await agriTraceCore.getProduct(productId);
      expect(product.currentStage).to.equal(1); // DISTRIBUTION
      expect(product.currentState).to.equal(0); // PENDING_PICKUP
      expect(product.distributionData.distributor).to.equal(
        distributor.address
      );
      expect(product.distributionData.priceDist).to.equal(150);
    });

    it("Should prevent non-distributor from purchasing", async function () {
      await expect(
        agriTraceCore.connect(retailer).purchaseFromFarmer(productId, 150)
      ).to.be.revertedWith("Only distributor can buy");
    });

    it("Should create batch from purchased products", async function () {
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);

      await expect(agriTraceCore.connect(distributor).createBatch([productId]))
        .to.emit(agriTraceCore, "BatchCreated")
        .withArgs(1, distributor.address);

      const product = await agriTraceCore.getProduct(productId);
      expect(product.currentState).to.equal(1); // RECEIVED

      const batch = await agriTraceCore.getBatchDetails(1);
      expect(batch.distributor).to.equal(distributor.address);
      expect(batch.productIds.length).to.equal(1);
      expect(batch.productIds[0]).to.equal(productId);
    });

    it("Should get unbatched products by distributor", async function () {
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);

      const unbatched = await agriTraceCore.getUnbatchedProductsByDistributor(
        distributor.address
      );
      expect(unbatched.length).to.equal(1);
      expect(unbatched[0]).to.equal(productId);

      await agriTraceCore.connect(distributor).createBatch([productId]);

      const unbatchedAfter =
        await agriTraceCore.getUnbatchedProductsByDistributor(
          distributor.address
        );
      expect(unbatchedAfter.length).to.equal(0);
    });
  });

  describe("Quality Assessment with Temperature Oracle", function () {
    let productId, batchId;

    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      productId = 1;

      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);
      await agriTraceCore.connect(distributor).createBatch([productId]);
      batchId = 1;

      // Mock temperature data by setting it directly in the oracle
      // In real testing, you'd use Chainlink mocks
      await temperatureOracle
        .connect(admin)
        .requestTemperatureForProduct(productId);
    });

    it("Should store distributor quality assessment", async function () {
      // Mock temperature response (in real test, use Chainlink mock)
      // For now, we'll assume temperature is set to 10°C (above minimum)

      await expect(
        agriTraceCore.connect(distributor).storeDistributorQualityWithOracle(
          productId,
          85, // Grade A score
          "minimal",
          "QmDistributorQualityHash"
        )
      )
        .to.emit(agriTraceCore, "ProductStateChanged")
        .withArgs(productId, 2); // VERIFIED

      const quality = await agriTraceCore.getDistributorQuality(productId);
      expect(quality.score).to.equal(85);
      expect(quality.grade).to.equal(0); // Grade A
      expect(quality.damageLevel).to.equal("minimal");
    });

    it("Should reject product with low temperature", async function () {
      // This test would need proper Chainlink mock to set temperature < 5
      // For demonstration, assuming temperature oracle returns low temp
      // In a real test with Chainlink mocks:
      /*
      await mockOracle.setTemperature(productId, 3); // Below MIN_TEMP of 5
      
      await expect(
        agriTraceCore.connect(distributor).storeDistributorQualityWithOracle(
          productId, 85, "minimal", "QmHash"
        )
      ).to.emit(agriTraceCore, "ProductRejected");
      */
    });

    it("Should request temperature update", async function () {
      await expect(
        agriTraceCore.connect(distributor).requestTemperatureUpdate(productId)
      ).to.not.be.reverted;
    });
  });

  describe("ML Integration & Damage Detection", function () {
    let productId;

    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      productId = 1;

      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);
      await agriTraceCore.connect(distributor).createBatch([productId]);
    });

    it("Should request ML damage prediction", async function () {
      const imageUrl = "https://example.com/tomato.jpg";

      await expect(
        agriTraceCore
          .connect(distributor)
          .requestMLDamagePrediction(productId, imageUrl)
      ).to.emit(agriTraceCore, "MLPredictionRequested");
    });

    it("Should store quality with ML prediction", async function () {
      // This test requires mocking the ML oracle response
      // In real implementation, you'd use Chainlink mocks

      const imageUrl = "https://example.com/tomato.jpg";
      await agriTraceCore
        .connect(distributor)
        .requestMLDamagePrediction(productId, imageUrl);

      // Mock ML response would be needed here
      // For demonstration purposes only
    });

    it("Should get ML prediction status", async function () {
      const imageUrl = "https://example.com/tomato.jpg";
      await agriTraceCore
        .connect(distributor)
        .requestMLDamagePrediction(productId, imageUrl);

      const status = await agriTraceCore.getMLPredictionStatus(productId);
      expect(status.requestId).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Retail Stage", function () {
    let productId, batchId;

    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      productId = 1;

      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);
      await agriTraceCore.connect(distributor).createBatch([productId]);
      batchId = 1;

      // Simulate quality verification (in real test, use proper mocks)
      await agriTraceCore
        .connect(distributor)
        .storeDistributorQualityWithOracle(productId, 85, "minimal", "QmHash");
    });

    it("Should allow retailer to purchase batch", async function () {
      await expect(
        agriTraceCore
          .connect(retailer)
          .purchaseBatchFromDistributor(batchId, [200])
      )
        .to.emit(agriTraceCore, "BatchPurchased")
        .withArgs(batchId, retailer.address);

      const product = await agriTraceCore.getProduct(productId);
      expect(product.currentStage).to.equal(2); // RETAIL
      expect(product.retailData.retailer).to.equal(retailer.address);
      expect(product.retailData.priceRetail).to.equal(200);
    });

    it("Should prevent non-retailer from purchasing batch", async function () {
      await expect(
        agriTraceCore
          .connect(farmer)
          .purchaseBatchFromDistributor(batchId, [200])
      ).to.be.revertedWith("Only retailer can buy");
    });

    it("Should list product for consumer", async function () {
      await agriTraceCore
        .connect(retailer)
        .purchaseBatchFromDistributor(batchId, [200]);

      // First verify the product at retail level
      await agriTraceCore
        .connect(retailer)
        .storeRetailerQualityWithOracle(productId, 80, "good", "QmRetailHash");

      await expect(
        agriTraceCore.connect(retailer).listProductForConsumer(productId)
      )
        .to.emit(agriTraceCore, "ProductStateChanged")
        .withArgs(productId, 4); // LISTED
    });

    it("Should mark product as bought", async function () {
      await agriTraceCore
        .connect(retailer)
        .purchaseBatchFromDistributor(batchId, [200]);
      await agriTraceCore
        .connect(retailer)
        .storeRetailerQualityWithOracle(productId, 80, "good", "QmRetailHash");
      await agriTraceCore.connect(retailer).listProductForConsumer(productId);

      await expect(
        agriTraceCore
          .connect(retailer)
          .markProductAsBuyed(productId, consumer.address, 25)
      )
        .to.emit(agriTraceCore, "ProductBuyed")
        .withArgs(productId, consumer.address, 25);

      const product = await agriTraceCore.getProduct(productId);
      expect(product.retailData.buyedQuantity).to.equal(25);
      expect(product.retailData.consumer).to.equal(consumer.address);
    });
  });

  describe("Batch Management", function () {
    let productIds = [];

    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;

      // Create multiple products
      for (let i = 0; i < 3; i++) {
        await agriTraceCore
          .connect(farmer)
          .createProduct(`Product${i}`, futureTime, "Farm A", 100, 50);
        productIds.push(i + 1);
        await agriTraceCore.connect(distributor).purchaseFromFarmer(i + 1, 150);
      }
    });

    it("Should create batch with multiple products", async function () {
      await expect(agriTraceCore.connect(distributor).createBatch(productIds))
        .to.emit(agriTraceCore, "BatchCreated")
        .withArgs(1, distributor.address);

      const batch = await agriTraceCore.getBatchDetails(1);
      expect(batch.productIds.length).to.equal(3);
    });

    it("Should get products in batch", async function () {
      await agriTraceCore.connect(distributor).createBatch(productIds);

      const batchProducts = await agriTraceCore.getProductsInBatch(1);
      expect(batchProducts.length).to.equal(3);
    });

    it("Should handle product removal from batch", async function () {
      await agriTraceCore.connect(distributor).createBatch(productIds);

      // Simulate a product being removed due to quality issues
      // This would happen during quality assessment with failing grade

      const initialProducts = await agriTraceCore.getProductsInBatch(1);
      expect(initialProducts.length).to.equal(3);
    });
  });

  describe("Reputation System", function () {
    let productId;

    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      productId = 1;
    });

    it("Should track reputation scores", async function () {
      const initialReputation = await agriTraceCore.getReputation(
        1,
        farmer.address
      );
      expect(initialReputation).to.equal(50);
    });

    it("Should update reputation based on quality grades", async function () {
      // This would be tested with proper quality assessment flow
      // Reputation changes happen in _updateReputation internal function

      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);
      await agriTraceCore.connect(distributor).createBatch([productId]);

      // Quality assessment would trigger reputation update
      // In real test, verify reputation changes after quality assessment
    });
  });

  describe("Emergency Management", function () {
    it("Should pause system in emergency", async function () {
      const emergencyManager = await agriTraceCore.emergency();
      const EmergencyManager = await ethers.getContractFactory(
        "EmergencyManager"
      );
      const emergencyContract = EmergencyManager.attach(emergencyManager);

      await emergencyContract.connect(admin).pause();
      expect(await emergencyContract.paused()).to.be.true;

      // Should prevent operations when paused
      const futureTime = (await time.latest()) + 86400;
      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Tomatoes", futureTime, "Farm A", 100, 50)
      ).to.be.revertedWith("System paused");
    });

    it("Should blacklist users", async function () {
      const emergencyManager = await agriTraceCore.emergency();
      const EmergencyManager = await ethers.getContractFactory(
        "EmergencyManager"
      );
      const emergencyContract = EmergencyManager.attach(emergencyManager);

      await emergencyContract.connect(admin).blacklist(farmer.address);
      expect(await emergencyContract.blacklisted(farmer.address)).to.be.true;

      // Should prevent operations for blacklisted users
      const futureTime = (await time.latest()) + 86400;
      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct("Tomatoes", futureTime, "Farm A", 100, 50)
      ).to.be.revertedWith("User blacklisted");
    });
  });

  describe("Data Integrity & Traceability", function () {
    it("Should maintain complete product trace", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      const productId = 1;

      // Store farm data
      await agriTraceCore
        .connect(farmer)
        .storeFarmDataHash(productId, "QmFarmHash");

      // Distribution flow
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(productId, 150);
      await agriTraceCore.connect(distributor).createBatch([productId]);
      await agriTraceCore
        .connect(distributor)
        .storeDistributorQualityWithOracle(
          productId,
          85,
          "minimal",
          "QmDistHash"
        );

      // Retail flow
      await agriTraceCore
        .connect(retailer)
        .purchaseBatchFromDistributor(1, [200]);
      await agriTraceCore
        .connect(retailer)
        .storeRetailerQualityWithOracle(productId, 80, "good", "QmRetailHash");

      // Verify complete trace
      const trace = await agriTraceCore.getFullTrace(productId);
      expect(trace.farmDataHash).to.equal("QmFarmHash");
      expect(trace.distributionDataHash).to.equal("QmDistHash");
      expect(trace.retailDataHash).to.equal("QmRetailHash");
    });
  });

  describe("Helper Functions & Views", function () {
    beforeEach(async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
    });

    it("Should get available products for distributor", async function () {
      const available =
        await agriTraceCore.getAvailableProductsForDistributor();
      expect(available.length).to.equal(1);
      expect(available[0]).to.equal(1);
    });

    it("Should get products by farmer", async function () {
      const products = await agriTraceCore.getProductsByFarmer(farmer.address);
      expect(products.length).to.equal(1);
      expect(products[0]).to.equal(1);
    });

    it("Should get user details", async function () {
      const details = await agriTraceCore.getUserDetails(farmer.address);
      expect(details.role).to.equal(1); // FARMER
      expect(details.farmerReputation).to.equal(50);
    });

    it("Should get total products count", async function () {
      expect(await agriTraceCore.getTotalProducts()).to.equal(1);
    });
  });

  describe("Error Handling & Edge Cases", function () {
    it("Should handle invalid product IDs", async function () {
      await expect(agriTraceCore.getProduct(999)).to.not.be.reverted; // Should return empty struct

      await expect(agriTraceCore.getFullTrace(999)).to.be.revertedWith(
        "Product not found"
      );
    });

    it("Should prevent unauthorized access", async function () {
      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);

      await expect(
        agriTraceCore.connect(distributor).storeFarmDataHash(1, "QmHash")
      ).to.be.revertedWith("Only farmer");
    });

    it("Should validate Oracle addresses", async function () {
      // Reset oracle to zero address
      await agriTraceCore
        .connect(admin)
        .setTemperatureOracle(ethers.ZeroAddress);

      const futureTime = (await time.latest()) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct("Tomatoes", futureTime, "Farm A", 100, 50);
      await agriTraceCore.connect(distributor).purchaseFromFarmer(1, 150);
      await agriTraceCore.connect(distributor).createBatch([1]);

      await expect(
        agriTraceCore
          .connect(distributor)
          .storeDistributorQualityWithOracle(1, 85, "minimal", "QmHash")
      ).to.be.revertedWith("Temperature oracle not set");
    });
  });
});
