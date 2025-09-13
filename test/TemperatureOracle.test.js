const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TemperatureOracle", function () {
    let temperatureOracle;
    let agriTraceCore;
    let mockLinkToken;
    let mockOracle;
    let owner, user1, user2;

    const SAMPLE_PRODUCT_ID = 1;
    const SAMPLE_TEMPERATURE = 2500; // 25.00 degrees (multiplied by 100)

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy AgriTraceCore first
        const AgriTraceCore = await ethers.getContractFactory("AgriTraceCore");
        agriTraceCore = await AgriTraceCore.deploy();
        await agriTraceCore.waitForDeployment();

        // Deploy Mock LINK Token
        const MockLinkToken = await ethers.getContractFactory("MockLinkToken");
        mockLinkToken = await MockLinkToken.deploy();
        await mockLinkToken.waitForDeployment();

        // Deploy Mock Oracle
        const MockOracle = await ethers.getContractFactory("MockChainlinkOracle");
        mockOracle = await MockOracle.deploy(await mockLinkToken.getAddress());
        await mockOracle.waitForDeployment();

        // For testing purposes, we'll create a simplified TemperatureOracle mock
        const SimplifiedTemperatureOracle = await ethers.getContractFactory("SimplifiedTemperatureOracle");
        temperatureOracle = await SimplifiedTemperatureOracle.deploy(await agriTraceCore.getAddress());
        await temperatureOracle.waitForDeployment();

        // Fund the oracle with LINK tokens
        await mockLinkToken.transfer(await temperatureOracle.getAddress(), ethers.parseEther("10"));
    });

    describe("Deployment", function () {
        it("Should set agriTraceCore address correctly", async function () {
            expect(await temperatureOracle.agriTraceCore()).to.equal(await agriTraceCore.getAddress());
        });

        it("Should set owner correctly", async function () {
            expect(await temperatureOracle.owner()).to.equal(owner.address);
        });

        it("Should have zero request mappings initially", async function () {
            const mockRequestId = ethers.encodeBytes32String("test");
            expect(await temperatureOracle.requestToProductId(mockRequestId)).to.equal(0);
            expect(await temperatureOracle.requestToRequester(mockRequestId)).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Temperature Request", function () {
        it("Should create temperature request for product", async function () {
            await expect(
                temperatureOracle.connect(user1).requestTemperatureForProduct(SAMPLE_PRODUCT_ID)
            ).to.emit(temperatureOracle, "RequestTemperature");
        });

        it("Should store request mapping correctly", async function () {
            const tx = await temperatureOracle.connect(user1).requestTemperatureForProduct(SAMPLE_PRODUCT_ID);
            const receipt = await tx.wait();
            
            // Find the RequestTemperature event
            const event = receipt.logs.find(log => {
                try {
                    const parsed = temperatureOracle.interface.parseLog(log);
                    return parsed.name === "RequestTemperature";
                } catch (e) {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            
            const parsed = temperatureOracle.interface.parseLog(event);
            const requestId = parsed.args.requestId;
            const productId = parsed.args.productId;

            expect(productId).to.equal(SAMPLE_PRODUCT_ID);
            expect(await temperatureOracle.requestToProductId(requestId)).to.equal(SAMPLE_PRODUCT_ID);
            expect(await temperatureOracle.requestToRequester(requestId)).to.equal(user1.address);
        });
    });

    describe("Temperature Fulfillment", function () {
        let requestId;

        beforeEach(async function () {
            // Create a request first
            const tx = await temperatureOracle.connect(user1).requestTemperatureForProduct(SAMPLE_PRODUCT_ID);
            const receipt = await tx.wait();
            
            const event = receipt.logs.find(log => {
                try {
                    const parsed = temperatureOracle.interface.parseLog(log);
                    return parsed.name === "RequestTemperature";
                } catch (e) {
                    return false;
                }
            });

            const parsed = temperatureOracle.interface.parseLog(event);
            requestId = parsed.args.requestId;
        });

        it("Should fulfill temperature request correctly", async function () {
            await expect(
                temperatureOracle.connect(owner).fulfill(requestId, SAMPLE_TEMPERATURE)
            ).to.emit(temperatureOracle, "TemperatureReceived")
             .withArgs(requestId, SAMPLE_TEMPERATURE / 100, SAMPLE_PRODUCT_ID);
        });

        it("Should clean up request mappings after fulfillment", async function () {
            // Verify mappings exist before fulfillment
            expect(await temperatureOracle.requestToProductId(requestId)).to.equal(SAMPLE_PRODUCT_ID);
            expect(await temperatureOracle.requestToRequester(requestId)).to.equal(user1.address);

            // Fulfill the request
            await temperatureOracle.connect(owner).fulfill(requestId, SAMPLE_TEMPERATURE);

            // Verify mappings are cleaned up
            expect(await temperatureOracle.requestToProductId(requestId)).to.equal(0);
            expect(await temperatureOracle.requestToRequester(requestId)).to.equal(ethers.ZeroAddress);
        });
    });

    describe("LINK Token Management", function () {
        it("Should allow owner to withdraw LINK tokens", async function () {
            const initialBalance = await mockLinkToken.balanceOf(await temperatureOracle.getAddress());
            expect(initialBalance).to.be.above(0);

            const ownerInitialBalance = await mockLinkToken.balanceOf(owner.address);

            await temperatureOracle.connect(owner).withdrawLink();

            const finalBalance = await mockLinkToken.balanceOf(await temperatureOracle.getAddress());
            const ownerFinalBalance = await mockLinkToken.balanceOf(owner.address);

            expect(finalBalance).to.equal(0);
            expect(ownerFinalBalance).to.equal(ownerInitialBalance + initialBalance);
        });

        it("Should not allow non-owner to withdraw LINK tokens", async function () {
            await expect(
                temperatureOracle.connect(user1).withdrawLink()
            ).to.be.revertedWith("Only callable by owner");
        });
    });
});