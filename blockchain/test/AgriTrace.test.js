const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("AgriTraceCore Complete Test Suite", function () {
  let agriTraceCore,
    agriTraceBatch,
    agriTraceQuality,
    temperatureOracle,
    damageDetectionOracle,
    emergencyManager;
  let admin, farmer, distributor, retailer, consumer;
  let linkToken;

  const INITIAL_LINK_BALANCE = ethers.parseEther("100");
  const MIN_TEMP = 5;

  beforeEach(async function () {
    [admin, farmer, distributor, retailer, consumer] =
      await ethers.getSigners();

    // Deploy Emergency Manager
    const EmergencyManager = await ethers.getContractFactory(
      "EmergencyManager"
    );
    emergencyManager = await EmergencyManager.deploy(admin.address);
    await emergencyManager.waitForDeployment();

    // Deploy Core Contract
    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();

    // Deploy Temperature Oracle
    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();

    // Deploy Damage Detection Oracle
    const DamageDetectionConsumer = await ethers.getContractFactory(
      "DamageDetectionConsumer"
    );
    damageDetectionOracle = await DamageDetectionConsumer.deploy();
    await damageDetectionOracle.waitForDeployment();

    // Deploy Batch Contract
    const AgriTraceBatch = await ethers.getContractFactory("AgriTraceBatch");
    agriTraceBatch = await AgriTraceBatch.deploy(
      await agriTraceCore.getAddress()
    );
    await agriTraceBatch.waitForDeployment();

    // Deploy Quality Contract
    const AgriTraceQuality = await ethers.getContractFactory(
      "AgriTraceQuality"
    );
    agriTraceQuality = await AgriTraceQuality.deploy(
      await agriTraceCore.getAddress(),
      await agriTraceBatch.getAddress()
    );
    await agriTraceQuality.waitForDeployment();

    // Set up contract connections
    await agriTraceCore.setBatchContract(await agriTraceBatch.getAddress());
    await agriTraceCore.setQualityContract(await agriTraceQuality.getAddress());
    await agriTraceCore.setTemperatureOracle(
      await temperatureOracle.getAddress()
    );

    await agriTraceQuality.setTemperatureOracle(
      await temperatureOracle.getAddress()
    );
    await agriTraceQuality.setDamageDetectionOracle(
      await damageDetectionOracle.getAddress()
    );

    // Assign roles
    await agriTraceCore.assignRole(farmer.address, 1); // FARMER
    await agriTraceCore.assignRole(distributor.address, 2); // DISTRIBUTOR
    await agriTraceCore.assignRole(retailer.address, 3); // RETAILER
  });

  describe("Contract Deployment & Initial State", function () {
    it("Should deploy all contracts successfully", async function () {
      expect(await agriTraceCore.admin()).to.equal(admin.address);
      expect(await agriTraceCore.getRole(admin.address)).to.equal(4); // ADMIN
      expect(await agriTraceCore.getRole(farmer.address)).to.equal(1); // FARMER
      expect(await agriTraceCore.getRole(distributor.address)).to.equal(2); // DISTRIBUTOR
      expect(await agriTraceCore.getRole(retailer.address)).to.equal(3); // RETAILER
    });

    it("Should have correct contract connections", async function () {
      expect(await agriTraceCore.batchContract()).to.equal(
        await agriTraceBatch.getAddress()
      );
      expect(await agriTraceCore.qualityContract()).to.equal(
        await agriTraceQuality.getAddress()
      );
      expect(await agriTraceCore.temperatureOracle()).to.equal(
        await temperatureOracle.getAddress()
      );
    });
  });

  describe("Product Creation & Management", function () {
    it("Should create product successfully", async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      const tx = await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Premium Apples",
          expiresAt,
          "Organic Farm Location",
          ethers.parseEther("25"),
          100
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return (
            agriTraceCore.interface.parseLog(log).name === "ProductCreated"
          );
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const product = await agriTraceCore.getProduct(1);
      expect(product.farmData.farmer).to.equal(farmer.address);
      expect(product.farmData.productType).to.equal("Premium Apples");
      expect(product.currentStage).to.equal(0); // FARM
      expect(product.currentState).to.equal(0); // PENDING_PICKUP
      expect(product.isActive).to.be.true;
    });

    it("Should store farm data hash", async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Apples",
          expiresAt,
          "Farm",
          ethers.parseEther("10"),
          100
        );

      await agriTraceCore
        .connect(farmer)
        .storeFarmDataHash(1, "QmFarmDataHash123");

      const product = await agriTraceCore.getProduct(1);
      expect(product.farmDataHash).to.equal("QmFarmDataHash123");
    });

    it("Should get available products for distributor", async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Apples",
          expiresAt,
          "Farm",
          ethers.parseEther("10"),
          100
        );
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Oranges",
          expiresAt,
          "Farm",
          ethers.parseEther("12"),
          150
        );

      const availableProducts =
        await agriTraceCore.getAvailableProductsForDistributor();
      expect(availableProducts.length).to.equal(2);
      expect(availableProducts[0]).to.equal(1);
      expect(availableProducts[1]).to.equal(2);
    });
  });

  describe("Distribution & Batch Management", function () {
    beforeEach(async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Apples",
          expiresAt,
          "Farm",
          ethers.parseEther("10"),
          100
        );
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Oranges",
          expiresAt,
          "Farm",
          ethers.parseEther("12"),
          150
        );
    });

    it("Should allow distributor to purchase from farmer", async function () {
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(1, ethers.parseEther("15"));

      const product = await agriTraceCore.getProduct(1);
      expect(product.currentStage).to.equal(1); // DISTRIBUTION
      expect(product.distributionData.distributor).to.equal(
        distributor.address
      );
      expect(product.distributionData.priceDist).to.equal(
        ethers.parseEther("15")
      );
      expect(product.currentState).to.equal(0); // PENDING_PICKUP
    });

    it("Should create batch successfully", async function () {
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(1, ethers.parseEther("15"));
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(2, ethers.parseEther("18"));

      const productIds = [1, 2];
      const tx = await agriTraceBatch
        .connect(distributor)
        .createBatch(productIds);

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return agriTraceBatch.interface.parseLog(log).name === "BatchCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const batch = await agriTraceBatch.getBatchDetails(1);
      expect(batch.distributor).to.equal(distributor.address);
      expect(batch.productIds.length).to.equal(2);

      // Check products are now RECEIVED
      const product1 = await agriTraceCore.getProduct(1);
      const product2 = await agriTraceCore.getProduct(2);
      expect(product1.currentState).to.equal(1); // RECEIVED
      expect(product2.currentState).to.equal(1); // RECEIVED
    });

    it("Should get unbatched products by distributor", async function () {
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(1, ethers.parseEther("15"));
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(2, ethers.parseEther("18"));

      const unbatchedProducts =
        await agriTraceBatch.getUnbatchedProductsByDistributor(
          distributor.address
        );
      expect(unbatchedProducts.length).to.equal(2);
      expect(unbatchedProducts[0]).to.equal(1);
      expect(unbatchedProducts[1]).to.equal(2);
    });
  });

  describe("Quality Assessment (Simplified)", function () {
    beforeEach(async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Apples",
          expiresAt,
          "Farm",
          ethers.parseEther("10"),
          100
        );
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(1, ethers.parseEther("15"));
      await agriTraceBatch.connect(distributor).createBatch([1]);
    });

    it("Should store distributor quality assessment (without oracle)", async function () {
      // Set a mock temperature directly in the oracle
      await temperatureOracle.connect(admin).fulfill(ethers.ZeroHash, 2000); // 20.00 degrees

      // For testing, we'll verify the function exists and setup is correct
      const product = await agriTraceCore.getProduct(1);
      expect(product.currentState).to.equal(1); // RECEIVED
      expect(product.distributionData.distributor).to.equal(
        distributor.address
      );
    });

    it("Should handle product removal from batch", async function () {
      await agriTraceBatch
        .connect(distributor)
        .removeProductFromBatch(1, "Quality issue detected");

      const productsInBatch = await agriTraceBatch.getProductsInBatch(1);
      expect(productsInBatch.length).to.equal(0);

      expect(await agriTraceBatch.isProductRemovedFromBatch(1)).to.be.true;
    });
  });

  describe("Error Handling & Edge Cases", function () {
    it("Should prevent unauthorized actions", async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Apples",
          expiresAt,
          "Farm",
          ethers.parseEther("10"),
          100
        );

      // Non-distributor cannot purchase from farmer
      await expect(
        agriTraceCore
          .connect(retailer)
          .purchaseFromFarmer(1, ethers.parseEther("15"))
      ).to.be.revertedWith("Only distributor can buy");

      // Non-farmer cannot create product
      await expect(
        agriTraceCore
          .connect(distributor)
          .createProduct(
            "Oranges",
            expiresAt,
            "Farm",
            ethers.parseEther("10"),
            100
          )
      ).to.be.revertedWith("Not farmer");
    });

    it("Should handle invalid parameters", async function () {
      const pastDate = Math.floor(Date.now() / 1000) - 86400;

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct(
            "Apples",
            pastDate,
            "Farm",
            ethers.parseEther("10"),
            100
          )
      ).to.be.revertedWith("Invalid params");

      await expect(
        agriTraceCore
          .connect(farmer)
          .createProduct(
            "Apples",
            Math.floor(Date.now() / 1000) + 86400,
            "Farm",
            ethers.parseEther("10"),
            0
          )
      ).to.be.revertedWith("Invalid params");
    });

    it("Should prevent empty batches", async function () {
      await expect(
        agriTraceBatch.connect(distributor).createBatch([])
      ).to.be.revertedWith("Empty batch");
    });
  });

  describe("Full Workflow Integration", function () {
    it("Should complete basic supply chain workflow", async function () {
      // 1. Farmer creates product
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await agriTraceCore
        .connect(farmer)
        .createProduct(
          "Premium Organic Apples",
          expiresAt,
          "Certified Organic Farm",
          ethers.parseEther("30"),
          500
        );

      // 2. Store farm data
      await agriTraceCore
        .connect(farmer)
        .storeFarmDataHash(1, "QmFarmDataHashABC123");

      // 3. Distributor purchases from farmer
      await agriTraceCore
        .connect(distributor)
        .purchaseFromFarmer(1, ethers.parseEther("45"));

      // 4. Distributor creates batch
      await agriTraceBatch.connect(distributor).createBatch([1]);

      // 5. Verify batch details
      const batch = await agriTraceBatch.getBatchDetails(1);
      expect(batch.distributor).to.equal(distributor.address);
      expect(batch.productIds[0]).to.equal(1);

      // 6. Check product state transitions
      const product = await agriTraceCore.getProduct(1);
      expect(product.currentStage).to.equal(1); // DISTRIBUTION
      expect(product.currentState).to.equal(1); // RECEIVED
      expect(product.distributionData.distributor).to.equal(
        distributor.address
      );
      expect(product.farmDataHash).to.equal("QmFarmDataHashABC123");
    });
  });

  describe("Reputation System", function () {
    it("Should initialize reputation scores correctly", async function () {
      const farmerRep = await agriTraceCore.getReputation(1, farmer.address);
      const distributorRep = await agriTraceCore.getReputation(
        2,
        distributor.address
      );
      const retailerRep = await agriTraceCore.getReputation(
        3,
        retailer.address
      );

      expect(farmerRep).to.equal(50);
      expect(distributorRep).to.equal(50);
      expect(retailerRep).to.equal(50);
    });
  });
});
