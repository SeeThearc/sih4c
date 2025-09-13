// blockchain/scripts/quick-test.js
const axios = require("axios");
const { ML_SERVER_URL } = require("../test/config");

async function quickTest() {
  console.log("🚀 Quick ML Integration Test");
  console.log("============================");

  try {
    // Check ML server
    console.log("1. Checking your ML server...");
    const health = await axios.get(`${ML_SERVER_URL}/health`);
    console.log("✅ ML Server:", health.data);

    // Quick prediction test
    console.log("\n2. Quick prediction test...");
    const testUrl =
      "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=500&q=80";
    const prediction = await axios.get(
      `${ML_SERVER_URL}/predict?image_url=${testUrl}`
    );

    console.log("🤖 Your ML Model Response:");
    console.log(`   Prediction: ${prediction.data.prediction}`);
    console.log(`   Damage Score: ${prediction.data.damage_score}/100`);
    console.log(`   Confidence: ${prediction.data.confidence}%`);

    console.log("\n✅ Your setup is working correctly!");
    console.log("💡 Run full tests with: npm test");
  } catch (error) {
    console.log("❌ Test failed:", error.message);
    console.log("\n🛠️  Troubleshooting:");
    console.log("1. Start ML server: cd ../model && python ml_api_server.py");
    console.log("2. Check if model file exists: quick_model_FINAL.h5");
    console.log("3. Ensure all dependencies are installed");
  }
}

quickTest();
