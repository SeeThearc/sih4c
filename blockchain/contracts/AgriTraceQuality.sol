// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AgriTraceLib.sol";
import "./AgriTraceCore.sol";
import "./AgriTraceBatch.sol";
import "./TemperatureOracle.sol";
import "./DamageDetectionConsumer.sol";

contract AgriTraceQuality {
    using AgriTraceLib for *;
    
    AgriTraceCore public coreContract;
    AgriTraceBatch public batchContract;
    TemperatureOracle public temperatureOracle;
    DamageDetectionConsumer public damageDetectionOracle;
    
    // Quality data stored separately to avoid struct complexity
    mapping(uint256 => AgriTraceLib.Quality) public distributorQuality;
    mapping(uint256 => AgriTraceLib.Quality) public retailerQuality;
    
    // Track ML prediction requests
    mapping(uint256 => bytes32) public productMLRequests; // productId => requestId
    mapping(bytes32 => uint256) public mlRequestToProduct; // requestId => productId
    
    uint256 public constant MIN_TEMP = 5;
    
    event ProductRejected(uint256 indexed productId, string reason);
    event ProductRemovedFromBatch(uint256 indexed productId, uint256 indexed batchId, string reason);
    event DataStored(uint256 indexed id, string ipfsHash, AgriTraceLib.Stage stage);
    event MLPredictionRequested(uint256 indexed productId, bytes32 indexed requestId, string imageUrl);
    event MLPredictionReceived(uint256 indexed productId, uint256 damageScore, string prediction);

    constructor(address _coreContract, address _batchContract) {
        coreContract = AgriTraceCore(_coreContract);
        batchContract = AgriTraceBatch(_batchContract);
    }

    function setTemperatureOracle(address _temperatureOracle) external onlyAdmin {
        temperatureOracle = TemperatureOracle(_temperatureOracle);
    }

    function setDamageDetectionOracle(address _damageOracle) external onlyAdmin {
        damageDetectionOracle = DamageDetectionConsumer(_damageOracle);
    }

    // Quality assessment for distributor with ability to remove products from batch
    function storeDistributorQualityWithOracle(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        string calldata ipfsHash
    ) external {
        AgriTraceLib.Product memory product = coreContract.getProduct(productId);
        require(product.distributionData.distributor == msg.sender, "Only distributor");
        require(product.currentStage == AgriTraceLib.Stage.DISTRIBUTION, "Must be DISTRIBUTION stage");
        require(score <= AgriTraceLib.MAX_SCORE, "Invalid score");
        require(address(temperatureOracle) != address(0), "Temperature oracle not set");
        require(batchContract.getProductBatch(productId) > 0, "Product not in batch");
        require(!batchContract.isProductRemovedFromBatch(productId), "Product already removed from batch");
        require(product.currentState == AgriTraceLib.ProductState.RECEIVED, "Must be received state");
        
        uint256 temperature = temperatureOracle.getCurrentTemperature(productId);
        AgriTraceLib.Grade grade = _scoreToGrade(score);
        
        distributorQuality[productId].score = score;
        distributorQuality[productId].grade = grade;
        distributorQuality[productId].damageLevel = damageLevel;
        distributorQuality[productId].temperature = temperature;
        distributorQuality[productId].timestamp = block.timestamp;
        distributorQuality[productId].assessor = msg.sender;
        
        coreContract.updateProductDistributionVerified(productId, block.timestamp);
        coreContract.updateProductDistributionDataHash(productId, ipfsHash);
        coreContract.updateProductOverallGrade(productId, grade);

        if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED) {
            // Remove product from batch instead of making entire product inactive
            batchContract.removeProductFromBatch(productId, "Quality failed");
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.REJECTED);
            emit ProductRejected(productId, "Quality failed");
        } else {
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.VERIFIED);
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.DISTRIBUTION);
        
        coreContract.updateReputation(productId, grade, AgriTraceLib.Stage.DISTRIBUTION);
    }

    // Retailer quality assessment with ability to remove products
    function storeRetailerQualityWithOracle(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        string calldata ipfsHash
    ) external {
        AgriTraceLib.Product memory product = coreContract.getProduct(productId);
        require(product.retailData.retailer == msg.sender, "Only retailer");
        require(product.currentStage == AgriTraceLib.Stage.RETAIL, "Must be RETAIL stage");
        require(score <= AgriTraceLib.MAX_SCORE, "Invalid score");
        require(address(temperatureOracle) != address(0), "Temperature oracle not set");
        
        uint256 temperature = temperatureOracle.getCurrentTemperature(productId);
        AgriTraceLib.Grade grade = _scoreToGrade(score);
        
        retailerQuality[productId].score = score;
        retailerQuality[productId].grade = grade;
        retailerQuality[productId].damageLevel = damageLevel;
        retailerQuality[productId].temperature = temperature;
        retailerQuality[productId].timestamp = block.timestamp;
        retailerQuality[productId].assessor = msg.sender;
        
        coreContract.updateProductRetailVerified(productId, block.timestamp);
        coreContract.updateProductRetailDataHash(productId, ipfsHash);
        coreContract.updateProductOverallGrade(productId, grade);

        if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED) {
            coreContract.deactivateProduct(productId);
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.REJECTED);
            emit ProductRejected(productId, "Quality failed");
        } else {
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.VERIFIED);
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.RETAIL);
        
        coreContract.updateReputation(productId, grade, AgriTraceLib.Stage.RETAIL);
    }

    // Request ML prediction for a product
    function requestMLDamagePrediction(uint256 productId, string calldata imageUrl) 
        external 
        returns (bytes32) 
    {
        AgriTraceLib.Product memory product = coreContract.getProduct(productId);
        require(product.isActive, "Product not active");
        require(
            product.distributionData.distributor == msg.sender || 
            product.retailData.retailer == msg.sender,
            "Not authorized for this product"
        );
        require(address(damageDetectionOracle) != address(0), "ML Oracle not set");
        
        // Request prediction from ML oracle
        bytes32 requestId = damageDetectionOracle.requestDamagePrediction(imageUrl);
        
        // Track the request
        productMLRequests[productId] = requestId;
        mlRequestToProduct[requestId] = productId;
        
        emit MLPredictionRequested(productId, requestId, imageUrl);
        return requestId;
    }
    
    // Enhanced quality assessment using ML prediction
    function storeDistributorQualityWithML(
        uint256 productId,
        bytes32 mlRequestId,
        string calldata damageLevel,
        string calldata ipfsHash
    ) external {
        AgriTraceLib.Product memory product = coreContract.getProduct(productId);
        require(product.distributionData.distributor == msg.sender, "Only distributor");
        require(product.currentStage == AgriTraceLib.Stage.DISTRIBUTION, "Must be DISTRIBUTION stage");
        require(productMLRequests[productId] == mlRequestId, "Invalid ML request");
        require(address(damageDetectionOracle) != address(0), "ML Oracle not set");
        
        // Get ML prediction result
        (uint256 damageScore, string memory prediction, uint256 timestamp, bool fulfilled) = 
            damageDetectionOracle.getPrediction(mlRequestId);
        
        require(fulfilled, "ML prediction not fulfilled yet");
        require(timestamp > 0, "Invalid prediction");
        
        // Convert damage score to quality score (inverse relationship)
        uint256 qualityScore = damageScore > 100 ? 0 : 100 - damageScore;
        
        // Get temperature as before
        uint256 temperature = temperatureOracle.getCurrentTemperature(productId);
        AgriTraceLib.Grade grade = _scoreToGrade(qualityScore);
        
        // Store quality data
        distributorQuality[productId].score = qualityScore;
        distributorQuality[productId].grade = grade;
        distributorQuality[productId].damageLevel = damageLevel;
        distributorQuality[productId].temperature = temperature;
        distributorQuality[productId].timestamp = block.timestamp;
        distributorQuality[productId].assessor = msg.sender;
        
        coreContract.updateProductDistributionVerified(productId, block.timestamp);
        coreContract.updateProductDistributionDataHash(productId, ipfsHash);
        coreContract.updateProductOverallGrade(productId, grade);

        // Handle rejection based on ML prediction
        if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED || damageScore > 75) {
            batchContract.removeProductFromBatch(productId, "ML detected high damage");
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.REJECTED);
            emit ProductRejected(productId, string(abi.encodePacked("ML damage score: ", _uint2str(damageScore))));
        } else {
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.VERIFIED);
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.DISTRIBUTION);
        emit MLPredictionReceived(productId, damageScore, prediction);
        
        coreContract.updateReputation(productId, grade, AgriTraceLib.Stage.DISTRIBUTION);
    }
    
    // Similar function for retailer
    function storeRetailerQualityWithML(
        uint256 productId,
        bytes32 mlRequestId,
        string calldata damageLevel,
        string calldata ipfsHash
    ) external {
        AgriTraceLib.Product memory product = coreContract.getProduct(productId);
        require(product.retailData.retailer == msg.sender, "Only retailer");
        require(product.currentStage == AgriTraceLib.Stage.RETAIL, "Must be RETAIL stage");
        require(productMLRequests[productId] == mlRequestId, "Invalid ML request");
        require(address(damageDetectionOracle) != address(0), "ML Oracle not set");
        
        // Get ML prediction result
        (uint256 damageScore, string memory prediction, uint256 timestamp, bool fulfilled) = 
            damageDetectionOracle.getPrediction(mlRequestId);
        
        require(fulfilled, "ML prediction not fulfilled yet");
        require(timestamp > 0, "Invalid prediction");
        
        // Convert damage score to quality score
        uint256 qualityScore = damageScore > 100 ? 0 : 100 - damageScore;
        
        uint256 temperature = temperatureOracle.getCurrentTemperature(productId);
        AgriTraceLib.Grade grade = _scoreToGrade(qualityScore);
        
        retailerQuality[productId].score = qualityScore;
        retailerQuality[productId].grade = grade;
        retailerQuality[productId].damageLevel = damageLevel;
        retailerQuality[productId].temperature = temperature;
        retailerQuality[productId].timestamp = block.timestamp;
        retailerQuality[productId].assessor = msg.sender;
        
        coreContract.updateProductRetailVerified(productId, block.timestamp);
        coreContract.updateProductRetailDataHash(productId, ipfsHash);
        coreContract.updateProductOverallGrade(productId, grade);

        if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED || damageScore > 75) {
            coreContract.deactivateProduct(productId);
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.REJECTED);
            emit ProductRejected(productId, string(abi.encodePacked("ML damage score: ", _uint2str(damageScore))));
        } else {
            coreContract.updateProductState(productId, AgriTraceLib.ProductState.VERIFIED);
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.RETAIL);
        emit MLPredictionReceived(productId, damageScore, prediction);
        
        coreContract.updateReputation(productId, grade, AgriTraceLib.Stage.RETAIL);
    }
    
    // Get ML prediction status for a product
    function getMLPredictionStatus(uint256 productId) 
        external 
        view 
        returns (
            bytes32 requestId,
            uint256 damageScore,
            string memory prediction,
            bool fulfilled
        ) 
    {
        bytes32 reqId = productMLRequests[productId];
        if (reqId == bytes32(0)) {
            return (bytes32(0), 0, "", false);
        }
        
        (uint256 score, string memory pred, uint256 timestamp, bool isFulfilled) = 
            damageDetectionOracle.getPrediction(reqId);
        
        return (reqId, score, pred, isFulfilled);
    }

    function _scoreToGrade(uint256 score) internal pure returns (AgriTraceLib.Grade) {
        if (score >= AgriTraceLib.GRADE_A) return AgriTraceLib.Grade.A;
        if (score >= AgriTraceLib.GRADE_B) return AgriTraceLib.Grade.B;
        if (score >= AgriTraceLib.GRADE_C) return AgriTraceLib.Grade.C;
        return AgriTraceLib.Grade.REJECTED;
    }
    
    // Utility function to convert uint to string
    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) { k = k-1; bstr[k] = bytes1(uint8(48 + _i % 10)); _i /= 10; }
        return string(bstr);
    }

    // === VIEW FUNCTIONS ===
    function getDistributorQuality(uint256 productId) external view returns (AgriTraceLib.Quality memory) {
        return distributorQuality[productId];
    }

    function getRetailerQuality(uint256 productId) external view returns (AgriTraceLib.Quality memory) {
        return retailerQuality[productId];
    }

    modifier onlyAdmin() { 
        require(coreContract.getRole(msg.sender) == AgriTraceLib.Role.ADMIN, "Only admin"); 
        _; 
    }
}