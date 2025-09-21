require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

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
