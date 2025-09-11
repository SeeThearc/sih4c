// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AgriTraceLib.sol";
import "./EmergencyManager.sol";

contract AgriTraceCore {
    using AgriTraceLib for *;

    EmergencyManager public emergency;
    mapping(address => AgriTraceLib.Role) public roles;
    address public admin;

    mapping(uint256 => AgriTraceLib.Product) public products;
    uint256 public nextProductId;

    mapping(uint256 => AgriTraceLib.Batch) public batches;
    mapping(address => uint256[]) public distributorBatches;
    mapping(address => uint256[]) public retailerBatches;
    uint256 public nextBatchId;

    uint256 public nextTxId;
    mapping(uint256 => AgriTraceLib.Transaction) public transactions;
    mapping(address => uint256[]) public distributorTxIds;
    mapping(address => uint256[]) public retailerTxIds;

    mapping(AgriTraceLib.Role => mapping(address => uint256)) public reputationScores;
    mapping(address => uint256[]) public farmerSoldProducts;

    // Quality data stored separately to avoid struct complexity
    mapping(uint256 => AgriTraceLib.Quality) public distributorQuality;
    mapping(uint256 => AgriTraceLib.Quality) public retailerQuality;

    uint256 public constant MIN_TEMP = 5;

    event ProductCreated(uint256 indexed id, address indexed farmer);
    event ProductTransferred(uint256 indexed id, address indexed from, address indexed to);
    event ProductStateChanged(uint256 indexed productId, AgriTraceLib.ProductState newState);
    event DataStored(uint256 indexed id, string ipfsHash, AgriTraceLib.Stage stage);
    event ProductRejected(uint256 indexed productId, string reason);
    event ProductBuyed(uint256 indexed productId, address indexed consumer, uint256 quantity);
    event BatchCreated(uint256 batchId, address distributor);
    event BatchSentToRetailer(uint256 batchId, address retailer);

    constructor() {
        admin = msg.sender;
        emergency = new EmergencyManager();
        roles[msg.sender] = AgriTraceLib.Role.ADMIN;
        reputationScores[AgriTraceLib.Role.FARMER][msg.sender] = 50;
        reputationScores[AgriTraceLib.Role.DISTRIBUTOR][msg.sender] = 50;
        reputationScores[AgriTraceLib.Role.RETAILER][msg.sender] = 50;
    }

    function assignRole(address user, AgriTraceLib.Role role) external onlyAdmin {
        roles[user] = role;
        if (reputationScores[AgriTraceLib.Role.FARMER][user] == 0) 
            reputationScores[AgriTraceLib.Role.FARMER][user] = 50;
        if (reputationScores[AgriTraceLib.Role.DISTRIBUTOR][user] == 0) 
            reputationScores[AgriTraceLib.Role.DISTRIBUTOR][user] = 50;
        if (reputationScores[AgriTraceLib.Role.RETAILER][user] == 0) 
            reputationScores[AgriTraceLib.Role.RETAILER][user] = 50;
    }

    function getRole(address user) external view returns (AgriTraceLib.Role) {
        return roles[user];
    }

    // === FARM STAGE ===
    function createProduct(
        string calldata productType,
        uint256 expiresAt,
        string calldata origin,
        uint256 priceFarm,
        uint256 quantity
    ) external systemActive returns (uint256) {
        require(roles[msg.sender] == AgriTraceLib.Role.FARMER, "Not farmer");
        require(quantity > 0 && expiresAt > block.timestamp, "Invalid params");
        
        nextProductId++;
        
        products[nextProductId].id = nextProductId;
        products[nextProductId].currentStage = AgriTraceLib.Stage.FARM;
        products[nextProductId].currentState = AgriTraceLib.ProductState.PENDING_PICKUP;
        products[nextProductId].overallGrade = AgriTraceLib.Grade.A;
        products[nextProductId].isActive = true;
        
        products[nextProductId].farmData.productType = productType;
        products[nextProductId].farmData.farmer = msg.sender;
        products[nextProductId].farmData.createdAt = block.timestamp;
        products[nextProductId].farmData.expiresAt = expiresAt;
        products[nextProductId].farmData.origin = origin;
        products[nextProductId].farmData.priceFarm = priceFarm;
        products[nextProductId].farmData.quantity = quantity;

        emit ProductCreated(nextProductId, msg.sender);
        emit ProductStateChanged(nextProductId, AgriTraceLib.ProductState.PENDING_PICKUP);
        
        return nextProductId;
    }

    function storeFarmDataHash(uint256 productId, string calldata ipfsHash) external systemActive {
        require(products[productId].farmData.farmer == msg.sender, "Only farmer");
        require(products[productId].isActive, "Inactive product");
        
        products[productId].farmDataHash = ipfsHash;
        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.FARM);
    }

    // === DISTRIBUTION STAGE ===
    function transferToDistributor(uint256 productId, address distributor, uint256 priceDist) external systemActive {
        require(products[productId].farmData.farmer == msg.sender, "Only farmer");
        require(products[productId].currentStage == AgriTraceLib.Stage.FARM, "Must be FARM stage");
        require(roles[distributor] == AgriTraceLib.Role.DISTRIBUTOR, "Distributor only");
        require(priceDist > 0, "Invalid price");
        
        products[productId].currentStage = AgriTraceLib.Stage.DISTRIBUTION;
        products[productId].currentState = AgriTraceLib.ProductState.RECEIVED;
        products[productId].distributionData.distributor = distributor;
        products[productId].distributionData.priceDist = priceDist;
        products[productId].distributionData.receivedAt = block.timestamp;

        nextTxId++;
        products[productId].farmerToDistributorTxId = nextTxId;
        
        transactions[nextTxId].txId = nextTxId;
        transactions[nextTxId].from = msg.sender;
        transactions[nextTxId].to = distributor;
        transactions[nextTxId].productId = productId;
        transactions[nextTxId].price = priceDist;
        transactions[nextTxId].timestamp = block.timestamp;
        
        distributorTxIds[distributor].push(nextTxId);
        farmerSoldProducts[msg.sender].push(productId);

        emit ProductTransferred(productId, msg.sender, distributor);
        emit ProductStateChanged(productId, AgriTraceLib.ProductState.RECEIVED);
    }

    function storeDistributorQuality(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        uint256 temperature,
        string calldata ipfsHash
    ) external systemActive {
        require(products[productId].distributionData.distributor == msg.sender, "Only distributor");
        require(products[productId].currentStage == AgriTraceLib.Stage.DISTRIBUTION, "Must be DISTRIBUTION stage");
        require(score <= AgriTraceLib.MAX_SCORE, "Invalid score");
        
        AgriTraceLib.Grade grade = _scoreToGrade(score);
        
        distributorQuality[productId].score = score;
        distributorQuality[productId].grade = grade;
        distributorQuality[productId].damageLevel = damageLevel;
        distributorQuality[productId].temperature = temperature;
        distributorQuality[productId].timestamp = block.timestamp;
        distributorQuality[productId].assessor = msg.sender;
        
        products[productId].distributionData.verifiedAt = block.timestamp;
        products[productId].distributionDataHash = ipfsHash;
        products[productId].overallGrade = grade;

        if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED) {
            products[productId].isActive = false;
            products[productId].currentState = AgriTraceLib.ProductState.REJECTED;
            emit ProductRejected(productId, "Quality failed");
        } else {
            products[productId].currentState = AgriTraceLib.ProductState.VERIFIED;
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.DISTRIBUTION);
        emit ProductStateChanged(productId, products[productId].currentState);
        
        _updateReputation(productId, grade, AgriTraceLib.Stage.DISTRIBUTION);
    }

    function createBatch(uint256[] calldata productIds) external systemActive returns (uint256) {
        require(roles[msg.sender] == AgriTraceLib.Role.DISTRIBUTOR, "Only distributor");
        require(productIds.length > 0, "Empty batch");
        
        for (uint256 i = 0; i < productIds.length; i++) {
            require(products[productIds[i]].distributionData.distributor == msg.sender, "Not your product");
            require(products[productIds[i]].currentState == AgriTraceLib.ProductState.VERIFIED, "Not verified");
        }
        
        nextBatchId++;
        
        batches[nextBatchId].batchId = nextBatchId;
        batches[nextBatchId].distributor = msg.sender;
        batches[nextBatchId].productIds = productIds;
        batches[nextBatchId].createdAt = block.timestamp;
        batches[nextBatchId].isDistributedToRetailer = false;
        
        distributorBatches[msg.sender].push(nextBatchId);
        emit BatchCreated(nextBatchId, msg.sender);
        
        return nextBatchId;
    }

    // === RETAIL STAGE ===
    function sendBatchToRetailer(uint256 batchId, address retailer, uint256[] calldata prices) external systemActive {
        require(batches[batchId].distributor == msg.sender, "Not your batch");
        require(!batches[batchId].isDistributedToRetailer, "Already sent");
        require(roles[retailer] == AgriTraceLib.Role.RETAILER, "Retailer only");
        require(batches[batchId].productIds.length == prices.length, "Price mismatch");
        
        batches[batchId].retailer = retailer;
        batches[batchId].isDistributedToRetailer = true;
        retailerBatches[retailer].push(batchId);
        
        emit BatchSentToRetailer(batchId, retailer);
        
        for (uint256 i = 0; i < batches[batchId].productIds.length; i++) {
            uint256 pid = batches[batchId].productIds[i];
            
            products[pid].currentStage = AgriTraceLib.Stage.RETAIL;
            products[pid].currentState = AgriTraceLib.ProductState.RECEIVED;
            products[pid].retailData.retailer = retailer;
            products[pid].retailData.priceRetail = prices[i];
            products[pid].retailData.receivedAt = block.timestamp;

            nextTxId++;
            products[pid].distributorToRetailerTxId = nextTxId;
            
            transactions[nextTxId].txId = nextTxId;
            transactions[nextTxId].from = msg.sender;
            transactions[nextTxId].to = retailer;
            transactions[nextTxId].productId = pid;
            transactions[nextTxId].batchId = batchId;
            transactions[nextTxId].price = prices[i];
            transactions[nextTxId].timestamp = block.timestamp;
            
            retailerTxIds[retailer].push(nextTxId);
            
            emit ProductTransferred(pid, msg.sender, retailer);
            emit ProductStateChanged(pid, AgriTraceLib.ProductState.RECEIVED);
        }
    }

    function storeRetailerQuality(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        uint256 temperature,
        string calldata ipfsHash
    ) external systemActive {
        require(products[productId].retailData.retailer == msg.sender, "Only retailer");
        require(products[productId].currentStage == AgriTraceLib.Stage.RETAIL, "Must be RETAIL stage");
        require(score <= AgriTraceLib.MAX_SCORE, "Invalid score");
        
        AgriTraceLib.Grade grade = _scoreToGrade(score);
        
        retailerQuality[productId].score = score;
        retailerQuality[productId].grade = grade;
        retailerQuality[productId].damageLevel = damageLevel;
        retailerQuality[productId].temperature = temperature;
        retailerQuality[productId].timestamp = block.timestamp;
        retailerQuality[productId].assessor = msg.sender;
        
        products[productId].retailData.verifiedAt = block.timestamp;
        products[productId].retailDataHash = ipfsHash;
        products[productId].overallGrade = grade;

        if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED) {
            products[productId].isActive = false;
            products[productId].currentState = AgriTraceLib.ProductState.REJECTED;
            emit ProductRejected(productId, "Quality failed");
        } else {
            products[productId].currentState = AgriTraceLib.ProductState.VERIFIED;
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.RETAIL);
        emit ProductStateChanged(productId, products[productId].currentState);
        
        _updateReputation(productId, grade, AgriTraceLib.Stage.RETAIL);
    }

    function listProductForConsumer(uint256 productId) external systemActive {
        require(products[productId].retailData.retailer == msg.sender, "Only retailer");
        require(products[productId].currentState == AgriTraceLib.ProductState.VERIFIED, "Must be verified");
        
        products[productId].currentState = AgriTraceLib.ProductState.LISTED;
        emit ProductStateChanged(productId, AgriTraceLib.ProductState.LISTED);
    }

    function markProductAsBuyed(uint256 productId, address consumer, uint256 buyQuantity) external systemActive {
        require(products[productId].currentState == AgriTraceLib.ProductState.LISTED, "Must be listed");
        require(buyQuantity > 0, "Invalid quantity");
        
        uint256 available = products[productId].farmData.quantity - products[productId].retailData.buyedQuantity;
        require(buyQuantity <= available, "Not enough quantity");

        products[productId].retailData.buyedQuantity += buyQuantity;
        products[productId].retailData.consumer = consumer;

        if (products[productId].retailData.buyedQuantity >= products[productId].farmData.quantity) {
            products[productId].currentState = AgriTraceLib.ProductState.BUYED;
        }
        
        emit ProductStateChanged(productId, products[productId].currentState);
        emit ProductBuyed(productId, consumer, buyQuantity);
    }

    // === UTILITY FUNCTIONS ===
    function _updateReputation(uint256 productId, AgriTraceLib.Grade grade, AgriTraceLib.Stage stage) internal {
        address farmer = products[productId].farmData.farmer;
        address distributor = products[productId].distributionData.distributor;
        
        if (grade == AgriTraceLib.Grade.A) {
            _boostReputation(farmer, AgriTraceLib.Role.FARMER);
            _boostReputation(distributor, AgriTraceLib.Role.DISTRIBUTOR);
        } else if (grade == AgriTraceLib.Grade.C || grade == AgriTraceLib.Grade.REJECTED) {
            _reduceReputation(farmer, AgriTraceLib.Role.FARMER);
            _reduceReputation(distributor, AgriTraceLib.Role.DISTRIBUTOR);
        }
        
        if (stage == AgriTraceLib.Stage.RETAIL) {
            address retailer = products[productId].retailData.retailer;
            if (grade == AgriTraceLib.Grade.A) {
                _boostReputation(retailer, AgriTraceLib.Role.RETAILER);
            } else if (grade == AgriTraceLib.Grade.C || grade == AgriTraceLib.Grade.REJECTED) {
                _reduceReputation(retailer, AgriTraceLib.Role.RETAILER);
            }
        }
    }

    function _boostReputation(address user, AgriTraceLib.Role role) internal {
        uint256 current = reputationScores[role][user];
        if (current < 100) reputationScores[role][user] = current + 2;
    }

    function _reduceReputation(address user, AgriTraceLib.Role role) internal {
        uint256 current = reputationScores[role][user];
        if (current > 0) reputationScores[role][user] = current - 2;
    }

    function _scoreToGrade(uint256 score) internal pure returns (AgriTraceLib.Grade) {
        if (score >= AgriTraceLib.GRADE_A) return AgriTraceLib.Grade.A;
        if (score >= AgriTraceLib.GRADE_B) return AgriTraceLib.Grade.B;
        if (score >= AgriTraceLib.GRADE_C) return AgriTraceLib.Grade.C;
        return AgriTraceLib.Grade.REJECTED;
    }

    // === VIEW FUNCTIONS ===
    function getProduct(uint256 productId) external view returns (AgriTraceLib.Product memory) {
        return products[productId];
    }

    function getDistributorQuality(uint256 productId) external view returns (AgriTraceLib.Quality memory) {
        return distributorQuality[productId];
    }

    function getRetailerQuality(uint256 productId) external view returns (AgriTraceLib.Quality memory) {
        return retailerQuality[productId];
    }

    function getProductsByFarmer(address farmer) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].farmData.farmer == farmer && products[i].isActive) count++;
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].farmData.farmer == farmer && products[i].isActive) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    function getBatchDetails(uint256 batchId) external view returns (AgriTraceLib.Batch memory) {
        return batches[batchId];
    }

    function getTransaction(uint256 txId) external view returns (AgriTraceLib.Transaction memory) {
        return transactions[txId];
    }

    function getReputation(AgriTraceLib.Role role, address user) external view returns (uint256) {
        return reputationScores[role][user];
    }

    function getTotalProducts() external view returns (uint256) {
        return nextProductId;
    }

    modifier onlyAdmin() { 
        require(roles[msg.sender] == AgriTraceLib.Role.ADMIN, "Only admin"); 
        _; 
    }
    
    modifier systemActive() { 
        require(!emergency.paused(), "System paused"); 
        require(!emergency.blacklisted(msg.sender), "User blacklisted"); 
        _; 
    }
    /**
 * @dev Get complete product trace with all data including IPFS hashes
 * This is the main function your frontend should call for tracing
 * Returns basic on-chain data + IPFS hashes to fetch complete struct data
 */
function getFullTrace(uint256 productId) external view returns (
    // Basic product info
    uint256 id,
    AgriTraceLib.Grade overallGrade,
    
    // IPFS hashes for complete struct data
    string memory farmDataHash,           // IPFS hash for complete farm struct
    string memory distributionDataHash,   // IPFS hash for complete distribution struct
    string memory retailDataHash,         // IPFS hash for complete retail struct
    
    // Essential info
    uint256 buyedQuantity
) {
    require(productId > 0 && productId <= nextProductId, "Product not found");
    
    AgriTraceLib.Product memory p = products[productId];
    
    return (
        // Basic info
        p.id,
        p.overallGrade,
        
        // IPFS hashes - frontend will fetch complete struct data from these
        p.farmDataHash,                   // Complete farm struct data in IPFS
        p.distributionDataHash,           // Complete distribution struct data in IPFS
        p.retailDataHash,                 // Complete retail struct data in IPFS
        
        // Essential info
        p.retailData.buyedQuantity
    );
}
}