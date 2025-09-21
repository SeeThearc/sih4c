const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting AgriTrace System Deployment...");
  console.log(`📍 Network: ${network.name}`);
  console.log(`⏰ Date: ${new Date().toISOString()}`);
  console.log("=" * 60);

  const [deployer] = await ethers.getSigners();
  console.log(`👤 Deployer account: ${deployer.address}`);
  console.log(
    `💰 Account balance: ${ethers.formatEther(
      await ethers.provider.getBalance(deployer.address)
    )} ETH`
  );

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

    console.log("\n🔗 Setting up contract connections...");

    // Set batch contract in core
    console.log("   → Setting batch contract in core...");
    const setBatchTx = await agriTraceCore.setBatchContract(
      deploymentResults.agriTraceBatch
    );
    await setBatchTx.wait();

    // Set quality contract in core
    console.log("   → Setting quality contract in core...");
    const setQualityTx = await agriTraceCore.setQualityContract(
      deploymentResults.agriTraceQuality
    );
    await setQualityTx.wait();

    // Set temperature oracle in core
    console.log("   → Setting temperature oracle in core...");
    const setTempOracleTx = await agriTraceCore.setTemperatureOracle(
      deploymentResults.temperatureOracle
    );
    await setTempOracleTx.wait();

    // Set temperature oracle in quality contract
    console.log("   → Setting temperature oracle in quality contract...");
    const setTempOracleQualityTx = await agriTraceQuality.setTemperatureOracle(
      deploymentResults.temperatureOracle
    );
    await setTempOracleQualityTx.wait();

    // Set damage detection oracle in quality contract
    console.log("   → Setting damage detection oracle in quality contract...");
    const setDamageOracleTx = await agriTraceQuality.setDamageDetectionOracle(
      deploymentResults.damageDetectionOracle
    );
    await setDamageOracleTx.wait();

    console.log("✅ All contract connections established!");

    // Verify deployment
    console.log("\n🔍 Verifying deployment...");

    const batchAddress = await agriTraceCore.batchContract();
    const qualityAddress = await agriTraceCore.qualityContract();
    const tempOracleAddress = await agriTraceCore.temperatureOracle();

    console.log(`   ✅ Batch contract in core: ${batchAddress}`);
    console.log(`   ✅ Quality contract in core: ${qualityAddress}`);
    console.log(`   ✅ Temperature oracle in core: ${tempOracleAddress}`);

    // Verify admin role
    const adminRole = await agriTraceCore.getRole(deployer.address);
    console.log(
      `   ✅ Admin role assigned: ${adminRole === 4n ? "YES" : "NO"}`
    );

    // Setup initial roles (optional demo users)
    if (network.name === "localhost" || network.name === "hardhat") {
      console.log("\n👥 Setting up demo roles for local network...");
      const signers = await ethers.getSigners();

      if (signers.length >= 4) {
        await agriTraceCore.assignRole(signers[1].address, 1); // FARMER
        await agriTraceCore.assignRole(signers[2].address, 2); // DISTRIBUTOR
        await agriTraceCore.assignRole(signers[3].address, 3); // RETAILER

        console.log(`   ✅ Demo Farmer: ${signers[1].address}`);
        console.log(`   ✅ Demo Distributor: ${signers[2].address}`);
        console.log(`   ✅ Demo Retailer: ${signers[3].address}`);
      }
    }

    const deploymentTime = (Date.now() - startTime) / 1000;
    console.log(
      `\n🎉 Deployment completed successfully in ${deploymentTime}s!`
    );

    // Save deployment info
    await saveDeploymentInfo(deploymentResults, network.name, deployer.address);

    // Generate frontend config
    await generateFrontendConfig(deploymentResults, network.name);

    // Display summary
    displayDeploymentSummary(deploymentResults, network.name, deploymentTime);

    return deploymentResults;
  } catch (error) {
    console.error("❌ Deployment failed:", error);
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
    network: networkName,
    timestamp: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: deploymentResults,
    gasUsed: "N/A", // Could be tracked if needed
    status: "success",
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${networkName}-${timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));

  // Also save as latest
  const latestPath = path.join(deploymentsDir, `${networkName}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));

  console.log(`💾 Deployment info saved to: deployments/${filename}`);
}

async function generateFrontendConfig(deploymentResults, networkName) {
  const configDir = path.join(__dirname, "..", "frontend-config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const frontendConfig = {
    networkName: networkName,
    chainId: network.config.chainId || 31337,
    deploymentDate: new Date().toISOString(),
    contracts: {
      AgriTraceCore: {
        address: deploymentResults.agriTraceCore,
        abi: "./artifacts/contracts/AgriTraceCore.sol/AgriTraceCore.json",
      },
      AgriTraceBatch: {
        address: deploymentResults.agriTraceBatch,
        abi: "./artifacts/contracts/AgriTraceBatch.sol/AgriTraceBatch.json",
      },
      AgriTraceQuality: {
        address: deploymentResults.agriTraceQuality,
        abi: "./artifacts/contracts/AgriTraceQuality.sol/AgriTraceQuality.json",
      },
      TemperatureOracle: {
        address: deploymentResults.temperatureOracle,
        abi: "./artifacts/contracts/TemperatureOracle.sol/TemperatureOracle.json",
      },
      DamageDetectionConsumer: {
        address: deploymentResults.damageDetectionOracle,
        abi: "./artifacts/contracts/DamageDetectionConsumer.sol/DamageDetectionConsumer.json",
      },
      EmergencyManager: {
        address: deploymentResults.emergencyManager,
        abi: "./artifacts/contracts/EmergencyManager.sol/EmergencyManager.json",
      },
      AgriTraceLib: {
        address: deploymentResults.agriTraceLib,
        abi: "./artifacts/contracts/AgriTraceLib.sol/AgriTraceLib.json",
      },
    },
  };

  const configPath = path.join(configDir, `contracts-${networkName}.json`);
  fs.writeFileSync(configPath, JSON.stringify(frontendConfig, null, 2));

  // Also create a JavaScript module for easy import
  const jsConfigPath = path.join(configDir, `contracts-${networkName}.js`);
  const jsContent = `// AgriTrace Contract Configuration for ${networkName}
// Generated on: ${new Date().toISOString()}

export const NETWORK_NAME = "${networkName}";
export const CHAIN_ID = ${network.config.chainId || 31337};

export const CONTRACTS = ${JSON.stringify(frontendConfig.contracts, null, 2)};

export default {
    networkName: NETWORK_NAME,
    chainId: CHAIN_ID,
    contracts: CONTRACTS
};
`;
  fs.writeFileSync(jsConfigPath, jsContent);

  console.log(
    `🔧 Frontend config saved to: frontend-config/contracts-${networkName}.json`
  );
  console.log(
    `🔧 JavaScript config saved to: frontend-config/contracts-${networkName}.js`
  );
}

function displayDeploymentSummary(
  deploymentResults,
  networkName,
  deploymentTime
) {
  console.log("\n" + "=" * 60);
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("=" * 60);
  console.log(`🌐 Network: ${networkName}`);
  console.log(`⏱️  Deployment Time: ${deploymentTime}s`);
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log("\n📝 Deployed Contracts:");

  const contractNames = {
    emergencyManager: "Emergency Manager",
    agriTraceLib: "AgriTrace Library",
    agriTraceCore: "AgriTrace Core",
    temperatureOracle: "Temperature Oracle",
    damageDetectionOracle: "Damage Detection Oracle",
    agriTraceBatch: "AgriTrace Batch",
    agriTraceQuality: "AgriTrace Quality",
  };

  Object.entries(deploymentResults).forEach(([key, address]) => {
    console.log(`   ✅ ${contractNames[key] || key}: ${address}`);
  });

  console.log("\n🔗 Integration URLs:");
  if (networkName === "sepolia") {
    Object.entries(deploymentResults).forEach(([key, address]) => {
      console.log(
        `   🔍 ${contractNames[key]}: https://sepolia.etherscan.io/address/${address}`
      );
    });
  } else if (networkName === "polygon") {
    Object.entries(deploymentResults).forEach(([key, address]) => {
      console.log(
        `   🔍 ${contractNames[key]}: https://polygonscan.com/address/${address}`
      );
    });
  } else if (networkName === "mainnet") {
    Object.entries(deploymentResults).forEach(([key, address]) => {
      console.log(
        `   🔍 ${contractNames[key]}: https://etherscan.io/address/${address}`
      );
    });
  }

  console.log("\n📁 Generated Files:");
  console.log(`   📄 deployments/${networkName}-latest.json`);
  console.log(`   📄 frontend-config/contracts-${networkName}.json`);
  console.log(`   📄 frontend-config/contracts-${networkName}.js`);

  console.log("\n🚀 Next Steps:");
  console.log("   1. Update your frontend with the new contract addresses");
  console.log("   2. Configure your oracles with the deployed addresses");
  console.log("   3. Set up monitoring and alerts");
  console.log("   4. Test the deployed contracts");

  if (networkName !== "mainnet") {
    console.log("   5. Verify contracts on block explorer");
  }

  console.log("=" * 60);
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("💥 Deployment failed with error:");
      console.error(error);
      process.exit(1);
    });
}

module.exports = { main };
