require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Validate required environment variables
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }
  return value;
}

// Get private key (remove 0x prefix if present)
function getPrivateKey() {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    console.warn("⚠️  PRIVATE_KEY not set, using hardhat default account");
    return null;
  }
  return key.startsWith("0x") ? key.slice(2) : key;
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },

  networks: {
    // 🏠 Local Development
    hardhat: {
      gas: 12000000,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
      chainId: 31337,
    },

    localhost: {
      url: "http://127.0.0.1:8545",
      gas: 12000000,
      gasPrice: parseInt(process.env.GAS_PRICE) || 20000000000,
      chainId: 31337,
    },

    // 🧪 Sepolia Testnet
    sepolia: {
      url:
        process.env.SEPOLIA_RPC_URL ||
        "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
      accounts: getPrivateKey() ? [getPrivateKey()] : [],
      gas: parseInt(process.env.GAS_LIMIT) || 6000000,
      gasPrice: parseInt(process.env.GAS_PRICE) || 20000000000,
      chainId: 11155111,
      confirmations: parseInt(process.env.CONFIRMATION_BLOCKS) || 2,
    },

    // 🟣 Polygon Mainnet
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: getPrivateKey() ? [getPrivateKey()] : [],
      gas: parseInt(process.env.GAS_LIMIT) || 6000000,
      gasPrice: parseInt(process.env.GAS_PRICE) || 30000000000, // 30 gwei for Polygon
      chainId: 137,
      confirmations: parseInt(process.env.CONFIRMATION_BLOCKS) || 2,
    },

    // 🔵 Ethereum Mainnet
    mainnet: {
      url:
        process.env.MAINNET_RPC_URL ||
        "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
      accounts: getPrivateKey() ? [getPrivateKey()] : [],
      gas: parseInt(process.env.GAS_LIMIT) || 6000000,
      gasPrice: parseInt(process.env.GAS_PRICE) || 20000000000,
      chainId: 1,
      confirmations: parseInt(process.env.CONFIRMATION_BLOCKS) || 6, // More confirmations for mainnet
    },
  },

  // 🔍 Etherscan Configuration
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
      polygon: process.env.POLYGONSCAN_API_KEY,
      mainnet: process.env.ETHERSCAN_API_KEY,
    },
  },

  // ⛽ Gas Reporter
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    gasPrice: 21,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },

  // 🧪 Test Configuration
  mocha: {
    timeout: 60000,
  },

  // 📁 Paths Configuration
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
