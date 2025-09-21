const { ethers, network, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // 🎯 Pre-deployment Checks
  console.log("🌾 AgriTrace Deployment Starting...");
  console.log("=" * 60);
  console.log(`📍 Network: ${network.name}`);
  console.log(`🔗 Chain ID: ${network.config.chainId}`);
  console.log(`⏰ Date: ${new Date().toISOString()}`);
  console.log(`👤 Project: SIH-BlockChain-2025 by PratTandon`);

  // Check environment variables
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\n🔍 Checking environment configuration...");

    const requiredEnvVars = {
      PRIVATE_KEY: "Deployment private key",
      [`${network.name.toUpperCase()}_RPC_URL`]: `${network.name} RPC URL`,
    };

    for (const [envVar, description] of Object.entries(requiredEnvVars)) {
      if (!process.env[envVar]) {
        console.error(`❌ Missing ${description}: ${envVar}`);
        console.error(`   Please add this to your .env file`);
        process.exit(1);
      } else {
        console.log(`   ✅ ${description}: Set`);
      }
    }
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\n👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

  // Check minimum balance for deployment
  const minBalance = ethers.parseEther("0.1"); // Minimum 0.1 ETH
  if (
    balance < minBalance &&
    network.name !== "hardhat" &&
    network.name !== "localhost"
  ) {
    console.error(
      `❌ Insufficient balance. Need at least 0.1 ETH for deployment.`
    );
    process.exit(1);
  }

  const deploymentResults = {};
  const gasUsed = {};
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

    const emergencyReceipt = await ethers.provider.getTransactionReceipt(
      emergencyManager.deploymentTransaction().hash
    );
    gasUsed.emergencyManager = emergencyReceipt.gasUsed;

    console.log(`✅ Emergency Manager: ${deploymentResults.emergencyManager}`);
    console.log(`⛽ Gas used: ${gasUsed.emergencyManager.toLocaleString()}`);

    // 2. Deploy AgriTrace Library
    console.log("\n📋 2/7 Deploying AgriTrace Library...");
    const AgriTraceLib = await ethers.getContractFactory("AgriTraceLib");
    const agriTraceLib = await AgriTraceLib.deploy();
    await agriTraceLib.waitForDeployment();
    deploymentResults.agriTraceLib = await agriTraceLib.getAddress();

    const libReceipt = await ethers.provider.getTransactionReceipt(
      agriTraceLib.deploymentTransaction().hash
    );
    gasUsed.agriTraceLib = libReceipt.gasUsed;

    console.log(`✅ AgriTrace Library: ${deploymentResults.agriTraceLib}`);
    console.log(`⛽ Gas used: ${gasUsed.agriTraceLib.toLocaleString()}`);

    // 3. Deploy Core Contract
    console.log("\n📋 3/7 Deploying AgriTrace Core...");
    const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
    const agriTraceCore = await AgriTraceCore.deploy();
    await agriTraceCore.waitForDeployment();
    deploymentResults.agriTraceCore = await agriTraceCore.getAddress();

    const coreReceipt = await ethers.provider.getTransactionReceipt(
      agriTraceCore.deploymentTransaction().hash
    );
    gasUsed.agriTraceCore = coreReceipt.gasUsed;

    console.log(`✅ AgriTrace Core: ${deploymentResults.agriTraceCore}`);
    console.log(`⛽ Gas used: ${gasUsed.agriTraceCore.toLocaleString()}`);

    // 4. Deploy Temperature Oracle
    console.log("\n📋 4/7 Deploying Temperature Oracle...");
    const TemperatureOracle = await ethers.getContractFactory(
      "TemperatureOracle"
    );
    const temperatureOracle = await TemperatureOracle.deploy();
    await temperatureOracle.waitForDeployment();
    deploymentResults.temperatureOracle = await temperatureOracle.getAddress();

    const tempReceipt = await ethers.provider.getTransactionReceipt(
      temperatureOracle.deploymentTransaction().hash
    );
    gasUsed.temperatureOracle = tempReceipt.gasUsed;

    console.log(
      `✅ Temperature Oracle: ${deploymentResults.temperatureOracle}`
    );
    console.log(`⛽ Gas used: ${gasUsed.temperatureOracle.toLocaleString()}`);

    // 5. Deploy Damage Detection Oracle
    console.log("\n📋 5/7 Deploying Damage Detection Oracle...");
    const DamageDetectionConsumer = await ethers.getContractFactory(
      "DamageDetectionConsumer"
    );
    const damageDetectionOracle = await DamageDetectionConsumer.deploy();
    await damageDetectionOracle.waitForDeployment();
    deploymentResults.damageDetectionOracle =
      await damageDetectionOracle.getAddress();

    const damageReceipt = await ethers.provider.getTransactionReceipt(
      damageDetectionOracle.deploymentTransaction().hash
    );
    gasUsed.damageDetectionOracle = damageReceipt.gasUsed;

    console.log(
      `✅ Damage Detection Oracle: ${deploymentResults.damageDetectionOracle}`
    );
    console.log(
      `⛽ Gas used: ${gasUsed.damageDetectionOracle.toLocaleString()}`
    );

    // 6. Deploy Batch Contract
    console.log("\n📋 6/7 Deploying AgriTrace Batch...");
    const AgriTraceBatch = await ethers.getContractFactory("AgriTraceBatch");
    const agriTraceBatch = await AgriTraceBatch.deploy(
      deploymentResults.agriTraceCore
    );
    await agriTraceBatch.waitForDeployment();
    deploymentResults.agriTraceBatch = await agriTraceBatch.getAddress();

    const batchReceipt = await ethers.provider.getTransactionReceipt(
      agriTraceBatch.deploymentTransaction().hash
    );
    gasUsed.agriTraceBatch = batchReceipt.gasUsed;

    console.log(`✅ AgriTrace Batch: ${deploymentResults.agriTraceBatch}`);
    console.log(`⛽ Gas used: ${gasUsed.agriTraceBatch.toLocaleString()}`);

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

    const qualityReceipt = await ethers.provider.getTransactionReceipt(
      agriTraceQuality.deploymentTransaction().hash
    );
    gasUsed.agriTraceQuality = qualityReceipt.gasUsed;

    console.log(`✅ AgriTrace Quality: ${deploymentResults.agriTraceQuality}`);
    console.log(`⛽ Gas used: ${gasUsed.agriTraceQuality.toLocaleString()}`);

    // Calculate total gas used
    const totalGasUsed = Object.values(gasUsed).reduce(
      (sum, gas) => sum + gas,
      0n
    );
    console.log(`\n⛽ Total Gas Used: ${totalGasUsed.toLocaleString()}`);

    // Setup contract connections
    console.log("\n🔗 Setting up contract connections...");

    const setupTxs = [];

    setupTxs.push(
      await agriTraceCore.setBatchContract(deploymentResults.agriTraceBatch)
    );
    setupTxs.push(
      await agriTraceCore.setQualityContract(deploymentResults.agriTraceQuality)
    );
    setupTxs.push(
      await agriTraceCore.setTemperatureOracle(
        deploymentResults.temperatureOracle
      )
    );
    setupTxs.push(
      await agriTraceQuality.setTemperatureOracle(
        deploymentResults.temperatureOracle
      )
    );
    setupTxs.push(
      await agriTraceQuality.setDamageDetectionOracle(
        deploymentResults.damageDetectionOracle
      )
    );

    // Wait for all setup transactions
    await Promise.all(setupTxs.map((tx) => tx.wait()));
    console.log(`✅ All ${setupTxs.length} setup transactions completed`);

    // Verification
    console.log("\n🔍 Verifying deployment...");
    const adminRole = await agriTraceCore.getRole(deployer.address);
    console.log(`✅ Admin role verified: ${adminRole === 4n ? "YES" : "NO"}`);

    const deploymentTime = (Date.now() - startTime) / 1000;
    console.log(`\n🎉 Deployment completed in ${deploymentTime}s!`);

    // Save deployment info
    await saveDeploymentInfo(
      deploymentResults,
      gasUsed,
      network.name,
      deployer.address,
      deploymentTime
    );

    // Generate configs
    await generateConfigs(deploymentResults, network.name);

    // Auto-verify on testnets/mainnet
    if (
      network.name !== "hardhat" &&
      network.name !== "localhost" &&
      process.env.ETHERSCAN_API_KEY
    ) {
      console.log("\n🔍 Starting contract verification...");
      await verifyContracts(deploymentResults, deployer.address);
    }

    displaySummary(deploymentResults, gasUsed, network.name, deploymentTime);

    return deploymentResults;
  } catch (error) {
    console.error("\n💥 Deployment failed:");
    console.error(error);
    throw error;
  }
}

async function verifyContracts(deploymentResults, deployerAddress) {
  const verifyPromises = [];

  try {
    // Verify Emergency Manager
    verifyPromises.push(
      run("verify:verify", {
        address: deploymentResults.emergencyManager,
        constructorArguments: [deployerAddress],
      }).catch((e) =>
        console.log(`⚠️  Emergency Manager verification: ${e.message}`)
      )
    );

    // Verify other contracts (no constructor args)
    const noArgContracts = [
      "agriTraceLib",
      "agriTraceCore",
      "temperatureOracle",
      "damageDetectionOracle",
    ];
    noArgContracts.forEach((contract) => {
      verifyPromises.push(
        run("verify:verify", {
          address: deploymentResults[contract],
          constructorArguments: [],
        }).catch((e) =>
          console.log(`⚠️  ${contract} verification: ${e.message}`)
        )
      );
    });

    // Verify contracts with constructor args
    verifyPromises.push(
      run("verify:verify", {
        address: deploymentResults.agriTraceBatch,
        constructorArguments: [deploymentResults.agriTraceCore],
      }).catch((e) => console.log(`⚠️  Batch verification: ${e.message}`))
    );

    verifyPromises.push(
      run("verify:verify", {
        address: deploymentResults.agriTraceQuality,
        constructorArguments: [
          deploymentResults.agriTraceCore,
          deploymentResults.agriTraceBatch,
        ],
      }).catch((e) => console.log(`⚠️  Quality verification: ${e.message}`))
    );

    await Promise.all(verifyPromises);
    console.log("✅ Contract verification completed");
  } catch (error) {
    console.log(
      `⚠️  Some contracts may not have been verified: ${error.message}`
    );
  }
}

async function saveDeploymentInfo(
  deploymentResults,
  gasUsed,
  networkName,
  deployerAddress,
  deploymentTime
) {
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentInfo = {
    project: "SIH-BlockChain-2025",
    author: "PratTandon",
    network: networkName,
    chainId: network.config.chainId,
    timestamp: new Date().toISOString(),
    deploymentTime: deploymentTime,
    deployer: deployerAddress,
    contracts: deploymentResults,
    gasUsage: Object.fromEntries(
      Object.entries(gasUsed).map(([key, value]) => [key, value.toString()])
    ),
    totalGasUsed: Object.values(gasUsed)
      .reduce((sum, gas) => sum + gas, 0n)
      .toString(),
    status: "success",
  };

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .split("T")[0];
  const filename = `${networkName}-${timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));

  const latestPath = path.join(deploymentsDir, `${networkName}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));

  console.log(`💾 Deployment saved: deployments/${filename}`);
}

async function generateConfigs(deploymentResults, networkName) {
  const configDir = path.join(__dirname, "..", "frontend-config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Frontend configuration
  const frontendConfig = {
    project: "SIH-BlockChain-2025",
    network: networkName,
    chainId: network.config.chainId,
    deploymentDate: new Date().toISOString(),
    contracts: deploymentResults,
    rpcUrl: network.config.url,
    explorerUrl: getExplorerUrl(networkName),
  };

  fs.writeFileSync(
    path.join(configDir, `${networkName}-config.json`),
    JSON.stringify(frontendConfig, null, 2)
  );

  // JavaScript/TypeScript module
  const jsConfig = `// AgriTrace Configuration for ${networkName}
// Generated: ${new Date().toISOString()}
// Project: SIH-BlockChain-2025

export const NETWORK = "${networkName}";
export const CHAIN_ID = ${network.config.chainId};

export const CONTRACTS = ${JSON.stringify(deploymentResults, null, 2)};

export const RPC_URL = "${network.config.url}";
export const EXPLORER_URL = "${getExplorerUrl(networkName)}";

export default {
    network: NETWORK,
    chainId: CHAIN_ID,
    contracts: CONTRACTS,
    rpcUrl: RPC_URL,
    explorerUrl: EXPLORER_URL
};
`;

  fs.writeFileSync(path.join(configDir, `${networkName}-config.js`), jsConfig);
  console.log(
    `🔧 Frontend config generated: frontend-config/${networkName}-config.json`
  );
}

function getExplorerUrl(networkName) {
  const explorers = {
    mainnet: "https://etherscan.io",
    sepolia: "https://sepolia.etherscan.io",
    polygon: "https://polygonscan.com",
    localhost: "http://localhost:8545",
    hardhat: "http://localhost:8545",
  };
  return explorers[networkName] || "";
}

function displaySummary(
  deploymentResults,
  gasUsed,
  networkName,
  deploymentTime
) {
  console.log("\n" + "=".repeat(80));
  console.log("🎉 AGRITRACE DEPLOYMENT COMPLETE - SIH-BlockChain-2025");
  console.log("=".repeat(80));
  console.log(`🌐 Network: ${networkName}`);
  console.log(`⏱️  Time: ${deploymentTime}s`);
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log(`👤 Author: PratTandon`);

  console.log("\n📋 Contract Addresses:");
  Object.entries(deploymentResults).forEach(([name, address]) => {
    console.log(`   ${name.padEnd(25)}: ${address}`);
  });

  const totalGas = Object.values(gasUsed).reduce((sum, gas) => sum + gas, 0n);
  console.log(`\n⛽ Total Gas Used: ${totalGas.toLocaleString()}`);

  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log(`\n🔍 Block Explorer:`);
    Object.entries(deploymentResults).forEach(([name, address]) => {
      console.log(
        `   ${name}: ${getExplorerUrl(networkName)}/address/${address}`
      );
    });
  }

  console.log("\n🚀 Ready for integration!");
  console.log("=".repeat(80));
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
