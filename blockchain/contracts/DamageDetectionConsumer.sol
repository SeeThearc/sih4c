// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/operatorforwarder/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

contract DamageDetectionConsumer is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    // Chainlink configuration
    bytes32 private jobId;
    uint256 private fee;
    
    // Your ML API endpoint
    string public apiEndpoint = "http://127.0.0.1:5000/predict";
    
    // Prediction results
    struct PredictionResult {
        uint256 damageScore;    // 0-100 scale
        string prediction;      // "fresh" or "rotten"
        uint256 confidence;     // 0-100 scale
        uint256 timestamp;
        bool fulfilled;
    }
    
    mapping(bytes32 => PredictionResult) public predictions;
    mapping(bytes32 => address) public requesters;
    
    // Events
    event PredictionRequested(bytes32 indexed requestId, string imageUrl);
    event PredictionReceived(
        bytes32 indexed requestId, 
        uint256 damageScore, 
        string prediction,
        uint256 confidence
    );

    constructor() ConfirmedOwner(msg.sender) {
        _setChainlinkToken(0x779877A7B0D9E8603169DdbD7836e478b4624789); // Sepolia LINK
        _setChainlinkOracle(0x6090149792dAAeE9D1D568c9f9a6F6B46AA29eFD); // Sepolia Oracle
        
        // Job ID for GET request - updated for new Chainlink
        jobId = "ca98366cc7314957b8c012c72f05aeeb"; // Updated GET > uint256 job
        fee = (1 * LINK_DIVISIBILITY) / 10; // 0.1 LINK
    }
    
    function requestDamagePrediction(string memory imageUrl) 
        public 
        returns (bytes32 requestId) 
    {
        Chainlink.Request memory req = _buildChainlinkRequest(
            jobId,
            address(this),
            this.fulfill.selector
        );
        
        // Set the URL with image parameter
        string memory fullUrl = string(abi.encodePacked(
            apiEndpoint,
            "?image_url=",
            imageUrl
        ));
        
        // NEW SYNTAX: Use _add instead of add
        req._add("get", fullUrl);
        req._add("path", "damage_score"); // Extract damage_score from JSON response
        
        // Optional: Add headers if your API requires them
        // req._add("headers", "Content-Type: application/json");
        
        // Send the request
        requestId = _sendChainlinkRequest(req, fee);
        
        // Store requester
        requesters[requestId] = msg.sender;
        
        emit PredictionRequested(requestId, imageUrl);
        return requestId;
    }
    
    function fulfill(bytes32 _requestId, uint256 _damageScore)
        public
        recordChainlinkFulfillment(_requestId)
    {
        // Store result
        predictions[_requestId] = PredictionResult({
            damageScore: _damageScore,
            prediction: _damageScore > 50 ? "rotten" : "fresh",
            confidence: 0, // Will be updated if needed
            timestamp: block.timestamp,
            fulfilled: true
        });
        
        emit PredictionReceived(
            _requestId, 
            _damageScore, 
            predictions[_requestId].prediction,
            0
        );
    }
    
    function getPrediction(bytes32 requestId) 
        public 
        view 
        returns (
            uint256 damageScore,
            string memory prediction,
            uint256 timestamp,
            bool fulfilled
        ) 
    {
        PredictionResult memory result = predictions[requestId];
        return (
            result.damageScore,
            result.prediction,
            result.timestamp,
            result.fulfilled
        );
    }
    
    function withdrawLink() public onlyOwner {
        LinkTokenInterface link = LinkTokenInterface(_chainlinkTokenAddress());
        require(
            link.transfer(msg.sender, link.balanceOf(address(this))),
            "Unable to transfer"
        );
    }
    
    function updateApiEndpoint(string memory newEndpoint) public onlyOwner {
        apiEndpoint = newEndpoint;
    }
    
    // Additional utility functions for better integration
    function getRequestStatus(bytes32 requestId) 
        public 
        view 
        returns (bool exists, bool fulfilled) 
    {
        return (
            requesters[requestId] != address(0),
            predictions[requestId].fulfilled
        );
    }
    
    function getRequester(bytes32 requestId) 
        public 
        view 
        returns (address) 
    {
        return requesters[requestId];
    }
}