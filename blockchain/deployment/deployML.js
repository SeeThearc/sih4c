const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying Damage Detection Consumer...");

  // Deploy contract
  const DamageDetectionConsumer = await ethers.getContractFactory(
    "DamageDetectionConsumer"
  );
  const consumer = await DamageDetectionConsumer.deploy();

  await consumer.deployed();

  console.log("✅ Contract deployed to:", consumer.address);
  console.log("🔗 Remember to:");
  console.log("   1. Fund contract with LINK tokens");
  console.log("   2. Update API endpoint if needed");
  console.log("   3. Test with sample image URL");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
