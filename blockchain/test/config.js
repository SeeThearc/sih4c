// blockchain/test/config.js
const path = require("path");

const TEST_CONFIG = {
  // Your ML server path (assuming it runs on localhost:5000)
  ML_SERVER_URL: "http://127.0.0.1:5000",

  // Path to your ML server file (for reference)
  ML_SERVER_PATH: path.join(__dirname, "../../model/ml_api_server.py"),

  // Test images for ML prediction
  TEST_IMAGES: {
    FRESH_APPLE:
      "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=500&q=80",
    FRESH_ORANGE:
      "https://images.unsplash.com/photo-1580052614034-c55d20bfee3b?w=500&q=80",
    FRESH_BANANA:
      "https://images.unsplash.com/photo-1603833665858-e61d17a86224?w=500&q=80",
    MIXED_FRUITS:
      "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=500&q=80",
  },

  // Contract deployment settings
  CONTRACTS: {
    SEPOLIA_LINK_TOKEN: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    SEPOLIA_ORACLE: "0x6090149792dAAeE9D1D568c9f9a6F6B46AA29eFD",
    ML_JOB_ID: "ca98366cc7314957b8c012c72f05aeeb",
  },
};

module.exports = TEST_CONFIG;
