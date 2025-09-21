// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/operatorforwarder/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

contract TemperatureOracle is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    uint256 private constant ORACLE_PAYMENT = 1 * LINK_DIVISIBILITY; // 1 * 10**18
    bytes32 private jobId;
    uint256 private fee;

    // Events
    event RequestTemperature(bytes32 indexed requestId, uint256 productId);
    event TemperatureReceived(bytes32 indexed requestId, uint256 temperature, uint256 productId);
    event CriticalTemperatureDetected(uint256 indexed productId, uint256 temperature);
    
    // Mapping to track which product ID is associated with each request
    mapping(bytes32 => uint256) public requestToProductId;
    mapping(bytes32 => address) public requestToRequester;
    mapping(uint256 => uint256) public latestTemperatureByProduct;

    constructor() ConfirmedOwner(msg.sender) {
        _setChainlinkToken(0x779877A7B0D9E8603169DdbD7836e478b4624789); // Sepolia LINK token
        _setChainlinkOracle(0x6090149792dAAeE9D1D568c9f9a6F6B46AA29eFD); // Sepolia Oracle
        jobId = "ca98366cc7314957b8c012c72f05aeeb"; // HTTP GET job ID for Sepolia
        fee = 0.1 * 10 ** 18; // 0.1 LINK
    }

    /**
     * Request temperature data for a specific product
     */
    function requestTemperatureForProduct(uint256 productId) public returns (bytes32 requestId) {
        Chainlink.Request memory request = _buildChainlinkRequest(jobId, address(this), this.fulfill.selector);
        
        // Set the URL to your Flask API
        request._add("get", "http://127.0.0.1:5001/sensor");
        
        // Set the path to find the temperature value in the response
        request._add("path", "temperature");
        
        // Multiply the result by 100 to preserve 2 decimal places (since Solidity doesn't handle decimals)
        request._addInt("times", 100);
        
        // Send the request
        requestId = _sendChainlinkRequest(request, fee);
        
        // Store the product ID and requester for this request
        requestToProductId[requestId] = productId;
        requestToRequester[requestId] = msg.sender;
        
        emit RequestTemperature(requestId, productId);
        return requestId;
    }

    /**
     * Receive the response in the form of uint256
     */
    function fulfill(bytes32 _requestId, uint256 _temperature) public recordChainlinkFulfillment(_requestId) {
        uint256 productId = requestToProductId[_requestId];
        address requester = requestToRequester[_requestId];
        
        // Convert back to actual temperature (divide by 100)
        uint256 actualTemp = _temperature / 100;
        
        // Store latest temperature for this product
        latestTemperatureByProduct[productId] = actualTemp;
        
        // Clean up mappings
        delete requestToProductId[_requestId];
        delete requestToRequester[_requestId];
    }

    /**
     * Get the latest temperature for a specific product
     */
    function getLatestTemperatureForProduct(uint256 productId) public view returns (uint256) {
        return latestTemperatureByProduct[productId];
    }

    /**
     * Helper function for quality assessment - gets current temperature for a product
     */
    function getCurrentTemperature(uint256 productId) external view returns (uint256) {
        return latestTemperatureByProduct[productId];
    }

    /**
     * Withdraw LINK tokens
     */
    function withdrawLink() public onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(_chainlinkTokenAddress());
        require(link.transfer(msg.sender, link.balanceOf(address(this))), "Unable to transfer");
    }
}