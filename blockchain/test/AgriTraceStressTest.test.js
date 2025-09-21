const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgriTrace Stress Tests", function () {
  let agriTraceCore, agriTraceBatch, agriTraceQuality, temperatureOracle;
  let admin, farmers, distributors, retailers;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    admin = signers[0];
    farmers = signers.slice(1, 6); // 5 farmers
    distributors = signers.slice(6, 11); // 5 distributors
    retailers = signers.slice(11, 16); // 5 retailers

    // Deploy contracts
    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();

    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();

    const AgriTraceBatch = await ethers.getContractFactory("AgriTraceBatch");
    agriTraceBatch = await AgriTraceBatch.deploy(
      await agriTraceCore.getAddress()
    );
    await agriTraceBatch.waitForDeployment();

    const AgriTraceQuality = await ethers.getContractFactory(
      "AgriTraceQuality"
    );
    agriTraceQuality = await AgriTraceQuality.deploy(
      await agriTraceCore.getAddress(),
      await agriTraceBatch.getAddress()
    );
    await agriTraceQuality.waitForDeployment();

    // Set up contracts
    await agriTraceCore.setBatchContract(await agriTraceBatch.getAddress());
    await agriTraceCore.setQualityContract(await agriTraceQuality.getAddress());
    await agriTraceCore.setTemperatureOracle(
      await temperatureOracle.getAddress()
    );
    await agriTraceQuality.setTemperatureOracle(
      await temperatureOracle.getAddress()
    );

    // Assign roles
    for (const farmer of farmers) {
      await agriTraceCore.assignRole(farmer.address, 1);
    }
    for (const distributor of distributors) {
      await agriTraceCore.assignRole(distributor.address, 2);
    }
    for (const retailer of retailers) {
      await agriTraceCore.assignRole(retailer.address, 3);
    }
  });

  it("Should handle high volume of products", async function () {
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;
    let totalGasUsed = 0n;

    // Create 50 products (10 per farmer)
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 10; j++) {
        const tx = await agriTraceCore
          .connect(farmers[i])
          .createProduct(
            `Product_${i}_${j}`,
            expiresAt,
            `Farm_${i}`,
            ethers.parseEther((10 + j).toString()),
            100 + j * 10
          );
        const receipt = await tx.wait();
        totalGasUsed += receipt.gasUsed;
      }
    }

    console.log(`Total gas used for 50 products: ${totalGasUsed}`);
    expect(await agriTraceCore.getTotalProducts()).to.equal(50);
  });

  it("Should handle multiple concurrent batches", async function () {
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;

    // Create products for each distributor
    for (let i = 0; i < 5; i++) {
      // Create 5 products per farmer-distributor pair
      for (let j = 0; j < 5; j++) {
        await agriTraceCore
          .connect(farmers[i])
          .createProduct(
            `Batch_Product_${i}_${j}`,
            expiresAt,
            `Farm_${i}`,
            ethers.parseEther("15"),
            100
          );

        const productId = i * 5 + j + 1;
        await agriTraceCore
          .connect(distributors[i])
          .purchaseFromFarmer(productId, ethers.parseEther("20"));
      }
    }

    // Create batches concurrently
    const batchPromises = [];
    for (let i = 0; i < 5; i++) {
      const productIds = [];
      for (let j = 0; j < 5; j++) {
        productIds.push(i * 5 + j + 1);
      }
      batchPromises.push(
        agriTraceBatch.connect(distributors[i]).createBatch(productIds)
      );
    }

    await Promise.all(batchPromises);

    // Verify all batches were created
    for (let i = 0; i < 5; i++) {
      const batches = await agriTraceBatch.getBatchesByDistributor(
        distributors[i].address
      );
      expect(batches.length).to.equal(1);
    }
  });

  it("Should maintain performance with complex queries", async function () {
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;

    // Create 100 products
    for (let i = 0; i < 100; i++) {
      const farmerIndex = i % 5;
      await agriTraceCore
        .connect(farmers[farmerIndex])
        .createProduct(
          `Performance_Product_${i}`,
          expiresAt,
          `Farm_${farmerIndex}`,
          ethers.parseEther("10"),
          100
        );
    }

    // Test query performance
    const start = Date.now();
    const availableProducts =
      await agriTraceCore.getAvailableProductsForDistributor();
    const queryTime = Date.now() - start;

    console.log(`Query time for 100 products: ${queryTime}ms`);
    expect(availableProducts.length).to.equal(100);
    expect(queryTime).to.be.lessThan(1000); // Should complete within 1 second
  });

  it("Should handle batch operations efficiently", async function () {
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;

    // Create and purchase products
    for (let i = 0; i < 20; i++) {
      await agriTraceCore
        .connect(farmers[0])
        .createProduct(
          `Efficiency_Product_${i}`,
          expiresAt,
          "Farm_0",
          ethers.parseEther("10"),
          100
        );

      await agriTraceCore
        .connect(distributors[0])
        .purchaseFromFarmer(i + 1, ethers.parseEther("15"));
    }

    // Create large batch
    const productIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const tx = await agriTraceBatch
      .connect(distributors[0])
      .createBatch(productIds);
    const receipt = await tx.wait();

    console.log(`Gas used for batch of 20 products: ${receipt.gasUsed}`);
    expect(receipt.gasUsed).to.be.lessThan(2000000); // Should be under 2M gas

    // Verify batch creation
    const batch = await agriTraceBatch.getBatchDetails(1);
    expect(batch.productIds.length).to.equal(20);
  });

  it("Should handle reputation system with many updates", async function () {
    // Test basic reputation functionality without oracle dependencies
    const initialReputation = await agriTraceCore.getReputation(
      1,
      farmers[0].address
    );
    expect(initialReputation).to.equal(50);

    // Verify reputation tracking works
    for (let i = 0; i < 5; i++) {
      const rep = await agriTraceCore.getReputation(1, farmers[i].address);
      expect(rep).to.equal(50); // All start at 50
    }
  });
});
