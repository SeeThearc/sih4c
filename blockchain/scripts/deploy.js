const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🌾 AgriTrace Deployment - SIH-BlockChain-2025");
  console.log("=" * 50);
  console.log(`📍 Network: ${network.name}`);
  console.log(`⏰ Date: ${new Date().toISOString()}`);

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

  const deploymentResults = {};
  const startTime = Date.now();

  try {
    // 1. Deploy Emergency Manager
    console.log("\n📋 1/7 Deploying Emergency Manager...");
    const EmergencyManager = await ethers.getContractFactory(
      "EmergencyManager"
    );
    const emergencyManager = await EmergencyManager.deploy(deployer.address);
    await emergencyManager.waitForDeployment();
    deploymentResults.emergencyManager = await emergencyManager.getAddress();
    console.log(`✅ Emergency Manager: ${deploymentResults.emergencyManager}`);

    // 2. Deploy AgriTrace Library
    console.log("\n📋 2/7 Deploying AgriTrace Library...");
    const AgriTraceLib = await ethers.getContractFactory("AgriTraceLib");
    const agriTraceLib = await AgriTraceLib.deploy();
    await agriTraceLib.waitForDeployment();
    deploymentResults.agriTraceLib = await agriTraceLib.getAddress();
    console.log(`✅ AgriTrace Library: ${deploymentResults.agriTraceLib}`);

    // 3. Deploy Core Contract
    console.log("\n📋 3/7 Deploying AgriTrace Core...");
    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    const agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();
    deploymentResults.agriTraceCore = await agriTraceCore.getAddress();
    console.log(`✅ AgriTrace Core: ${deploymentResults.agriTraceCore}`);

    // 4. Deploy Temperature Oracle
    console.log("\n📋 4/7 Deploying Temperature Oracle...");
    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    const temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();
    deploymentResults.temperatureOracle = await temperatureOracle.getAddress();
    console.log(
      `✅ Temperature Oracle: ${deploymentResults.temperatureOracle}`
    );

    // 5. Deploy Damage Detection Oracle
    console.log("\n📋 5/7 Deploying Damage Detection Oracle...");
    const DamageDetectionConsumer = await ethers.getContractFactory(
      "DamageDetectionConsumer"
    );
    const damageDetectionOracle = await DamageDetectionConsumer.deploy();
    await damageDetectionOracle.waitForDeployment();
    deploymentResults.damageDetectionOracle =
      await damageDetectionOracle.getAddress();
    console.log(
      `✅ Damage Detection Oracle: ${deploymentResults.damageDetectionOracle}`
    );

    // 6. Deploy Batch Contract
    console.log("\n📋 6/7 Deploying AgriTrace Batch...");
    const AgriTraceBatch = await ethers.getContractFactory("AgriTraceBatch");
    const agriTraceBatch = await AgriTraceBatch.deploy(
      deploymentResults.agriTraceCore
    );
    await agriTraceBatch.waitForDeployment();
    deploymentResults.agriTraceBatch = await agriTraceBatch.getAddress();
    console.log(`✅ AgriTrace Batch: ${deploymentResults.agriTraceBatch}`);

    // 7. Deploy Quality Contract
    console.log("\n📋 7/7 Deploying AgriTrace Quality...");
    const AgriTraceQuality = await ethers.getContractFactory(
      "AgriTraceQuality"
    );
    const agriTraceQuality = await AgriTraceQuality.deploy(
      deploymentResults.agriTraceCore,
      deploymentResults.agriTraceBatch
    );
    await agriTraceQuality.waitForDeployment();
    deploymentResults.agriTraceQuality = await agriTraceQuality.getAddress();
    console.log(`✅ AgriTrace Quality: ${deploymentResults.agriTraceQuality}`);

    // Setup contract connections
    console.log("\n🔗 Setting up contract connections...");
    await agriTraceCore.setBatchContract(deploymentResults.agriTraceBatch);
    await agriTraceCore.setQualityContract(deploymentResults.agriTraceQuality);
    await agriTraceCore.setTemperatureOracle(
      deploymentResults.temperatureOracle
    );
    await agriTraceQuality.setTemperatureOracle(
      deploymentResults.temperatureOracle
    );
    await agriTraceQuality.setDamageDetectionOracle(
      deploymentResults.damageDetectionOracle
    );
    console.log("✅ Contract connections established!");

    // Verify admin role
    const adminRole = await agriTraceCore.getRole(deployer.address);
    console.log(`✅ Admin role verified: ${adminRole === 4n ? "YES" : "NO"}`);

    const deploymentTime = (Date.now() - startTime) / 1000;
    console.log(`\n🎉 Deployment completed in ${deploymentTime}s!`);

    // Save deployment info
    await saveDeploymentInfo(deploymentResults, network.name, deployer.address);

    // Display summary
    displaySummary(deploymentResults, network.name);

    return deploymentResults;
  } catch (error) {
    console.error("\n💥 Deployment failed:");
    console.error(error);
    throw error;
  }
}

async function saveDeploymentInfo(
  deploymentResults,
  networkName,
  deployerAddress
) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentInfo = {
    project: "SIH-BlockChain-2025",
    author: "PratTandon",
    network: networkName,
    timestamp: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: deploymentResults,
  };

  const filename = `${networkName}-latest.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`💾 Deployment saved: deployments/${filename}`);
}

function displaySummary(deploymentResults, networkName) {
  console.log("\n" + "=".repeat(60));
  console.log("🎉 AGRITRACE DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`🌐 Network: ${networkName}`);

  console.log("\n📋 Contract Addresses:");
  Object.entries(deploymentResults).forEach(([name, address]) => {
    console.log(`   ${name.padEnd(25)}: ${address}`);
  });

  if (networkName === "sepolia") {
    console.log(`\n🔍 Sepolia Explorer:`);
    Object.entries(deploymentResults).forEach(([name, address]) => {
      console.log(
        `   ${name}: https://sepolia.etherscan.io/address/${address}`
      );
    });
  }

  console.log("\n🚀 Ready for frontend integration!");
  console.log("=".repeat(60));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { main };
