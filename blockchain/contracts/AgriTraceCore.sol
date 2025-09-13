// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AgriTraceLib.sol";
import "./EmergencyManager.sol";
import "./TemperatureOracle.sol";
import "./DamageDetectionConsumer.sol";

contract AgriTraceCore {
    using AgriTraceLib for *;
    TemperatureOracle public temperatureOracle;

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

    // Track which products are in which batch
    mapping(uint256 => uint256) public productToBatch; // productId => batchId
    mapping(uint256 => bool) public productRemovedFromBatch; // productId => removed status

    //users
    // User details IPFS hash (profile, license, etc.)
    mapping(address => string) public userDataHash;

    uint256 public constant MIN_TEMP = 5;

    event ProductCreated(uint256 indexed id, address indexed farmer);
    event ProductPurchased(uint256 indexed id, address indexed buyer, address indexed seller);
    event ProductStateChanged(uint256 indexed productId, AgriTraceLib.ProductState newState);
    event DataStored(uint256 indexed id, string ipfsHash, AgriTraceLib.Stage stage);
    event ProductRejected(uint256 indexed productId, string reason);
    event ProductRemovedFromBatch(uint256 indexed productId, uint256 indexed batchId, string reason);
    event ProductBuyed(uint256 indexed productId, address indexed consumer, uint256 quantity);
    event BatchCreated(uint256 batchId, address distributor);
    event BatchPurchased(uint256 batchId, address retailer);

    constructor() {
        admin = msg.sender;
        emergency = new EmergencyManager(msg.sender);
        roles[msg.sender] = AgriTraceLib.Role.ADMIN;
        reputationScores[AgriTraceLib.Role.FARMER][msg.sender] = 50;
        reputationScores[AgriTraceLib.Role.DISTRIBUTOR][msg.sender] = 50;
        reputationScores[AgriTraceLib.Role.RETAILER][msg.sender] = 50;
    }

    function setTemperatureOracle(address _temperatureOracle) external onlyAdmin {
        temperatureOracle = TemperatureOracle(_temperatureOracle);
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

    function registerUser(AgriTraceLib.Role role, string calldata detailsHash) public {
        require(roles[msg.sender] == AgriTraceLib.Role.NONE, "Already registered");
        require(role != AgriTraceLib.Role.ADMIN, "Cannot self-register as admin");
        require(bytes(detailsHash).length > 0, "Details hash required");

        roles[msg.sender] = role;
        reputationScores[role][msg.sender] = 50;
        userDataHash[msg.sender] = detailsHash;
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

    // === DISTRIBUTION STAGE - BUYER-INITIATED ===
    // MODIFIED: Product state remains PENDING_PICKUP after purchase
    function purchaseFromFarmer(uint256 productId, uint256 priceDist) external systemActive {
        require(roles[msg.sender] == AgriTraceLib.Role.DISTRIBUTOR, "Only distributor can buy");
        require(products[productId].currentStage == AgriTraceLib.Stage.FARM, "Must be FARM stage");
        require(products[productId].currentState == AgriTraceLib.ProductState.PENDING_PICKUP, "Not available for purchase");
        require(products[productId].isActive, "Inactive product");
        require(priceDist > 0, "Invalid price");
        
        address farmer = products[productId].farmData.farmer;
        
        products[productId].currentStage = AgriTraceLib.Stage.DISTRIBUTION;
        // CHANGED: Keep state as PENDING_PICKUP until batch is created
        products[productId].currentState = AgriTraceLib.ProductState.PENDING_PICKUP;
        products[productId].distributionData.distributor = msg.sender;
        products[productId].distributionData.priceDist = priceDist;
        products[productId].distributionData.receivedAt = block.timestamp;

        nextTxId++;
        products[productId].farmerToDistributorTxId = nextTxId;
        
        transactions[nextTxId].txId = nextTxId;
        transactions[nextTxId].from = farmer;
        transactions[nextTxId].to = msg.sender;
        transactions[nextTxId].productId = productId;
        transactions[nextTxId].price = priceDist;
        transactions[nextTxId].timestamp = block.timestamp;
        
        distributorTxIds[msg.sender].push(nextTxId);
        farmerSoldProducts[farmer].push(productId);

        emit ProductPurchased(productId, msg.sender, farmer);
        emit ProductStateChanged(productId, AgriTraceLib.ProductState.PENDING_PICKUP);
    }

    // MODIFIED: Get unbatched products bought by distributor (PENDING_PICKUP state)
    function getUnbatchedProductsByDistributor(address distributor) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].distributionData.distributor == distributor && 
                products[i].currentStage == AgriTraceLib.Stage.DISTRIBUTION &&
                products[i].currentState == AgriTraceLib.ProductState.PENDING_PICKUP &&
                productToBatch[i] == 0 && // Not in any batch
                products[i].isActive) {
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].distributionData.distributor == distributor && 
                products[i].currentStage == AgriTraceLib.Stage.DISTRIBUTION &&
                products[i].currentState == AgriTraceLib.ProductState.PENDING_PICKUP &&
                productToBatch[i] == 0 && // Not in any batch
                products[i].isActive) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    // MODIFIED: Create batch and change product states from PENDING_PICKUP to RECEIVED
    function createBatch(uint256[] calldata productIds) external systemActive returns (uint256) {
        require(roles[msg.sender] == AgriTraceLib.Role.DISTRIBUTOR, "Only distributor");
        require(productIds.length > 0, "Empty batch");
        
        for (uint256 i = 0; i < productIds.length; i++) {
            require(products[productIds[i]].distributionData.distributor == msg.sender, "Not your product");
            require(products[productIds[i]].currentState == AgriTraceLib.ProductState.PENDING_PICKUP, "Not pending pickup");
            require(productToBatch[productIds[i]] == 0, "Already in batch");
        }
        
        nextBatchId++;
        
        batches[nextBatchId].batchId = nextBatchId;
        batches[nextBatchId].distributor = msg.sender;
        batches[nextBatchId].productIds = productIds;
        batches[nextBatchId].createdAt = block.timestamp;
        batches[nextBatchId].isDistributedToRetailer = false;
        
        distributorBatches[msg.sender].push(nextBatchId);
        
        // Assign products to batch and change state to RECEIVED
        for (uint256 i = 0; i < productIds.length; i++) {
            productToBatch[productIds[i]] = nextBatchId;
            // CHANGED: Now change state to RECEIVED when batch is created
            products[productIds[i]].currentState = AgriTraceLib.ProductState.RECEIVED;
            emit ProductStateChanged(productIds[i], AgriTraceLib.ProductState.RECEIVED);
        }
        
        emit BatchCreated(nextBatchId, msg.sender);
        
        return nextBatchId;
    }

    // Quality assessment for distributor with ability to remove products from batch
    function storeDistributorQualityWithOracle(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        string calldata ipfsHash
    ) external systemActive {
        require(products[productId].distributionData.distributor == msg.sender, "Only distributor");
        require(products[productId].currentStage == AgriTraceLib.Stage.DISTRIBUTION, "Must be DISTRIBUTION stage");
        require(score <= AgriTraceLib.MAX_SCORE, "Invalid score");
        require(address(temperatureOracle) != address(0), "Temperature oracle not set");
        require(productToBatch[productId] > 0, "Product not in batch");
        require(!productRemovedFromBatch[productId], "Product already removed from batch");
        require(products[productId].currentState == AgriTraceLib.ProductState.RECEIVED, "Must be received state");
        
        uint256 temperature = temperatureOracle.getCurrentTemperature(productId);
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
            // Remove product from batch instead of making entire product inactive
            productRemovedFromBatch[productId] = true;
            products[productId].currentState = AgriTraceLib.ProductState.REJECTED;
            emit ProductRemovedFromBatch(productId, productToBatch[productId], "Quality failed");
            emit ProductRejected(productId, "Quality failed");
        } else {
            products[productId].currentState = AgriTraceLib.ProductState.VERIFIED;
        }

        emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.DISTRIBUTION);
        emit ProductStateChanged(productId, products[productId].currentState);
        
        _updateReputation(productId, grade, AgriTraceLib.Stage.DISTRIBUTION);
    }

    // Get products in a batch (excluding removed ones)
    function getProductsInBatch(uint256 batchId) external view returns (uint256[] memory) {
        require(batchId > 0 && batchId <= nextBatchId, "Invalid batch ID");
        
        uint256[] memory allProducts = batches[batchId].productIds;
        uint256 validCount;
        
        // Count valid products (not removed)
        for (uint256 i = 0; i < allProducts.length; i++) {
            if (!productRemovedFromBatch[allProducts[i]]) {
                validCount++;
            }
        }
        
        // Create result array with valid products only
        uint256[] memory result = new uint256[](validCount);
        uint256 idx;
        for (uint256 i = 0; i < allProducts.length; i++) {
            if (!productRemovedFromBatch[allProducts[i]]) {
                result[idx] = allProducts[i];
                idx++;
            }
        }
        
        return result;
    }

    // Get batches by distributor
    function getBatchesByDistributor(address distributor) external view returns (uint256[] memory) {
        return distributorBatches[distributor];
    }

    // Get batches by retailer
    function getBatchesByRetailer(address retailer) external view returns (uint256[] memory) {
        return retailerBatches[retailer];
    }

    // === RETAIL STAGE - BUYER-INITIATED ===
    function purchaseBatchFromDistributor(uint256 batchId, uint256[] calldata prices) external systemActive {
        require(roles[msg.sender] == AgriTraceLib.Role.RETAILER, "Only retailer can buy");
        require(!batches[batchId].isDistributedToRetailer, "Already purchased");
        
        address distributor = batches[batchId].distributor;
        uint256[] memory validProducts = this.getProductsInBatch(batchId);
        
        require(validProducts.length == prices.length, "Price mismatch with valid products");
        require(validProducts.length > 0, "No valid products in batch");
        
        // Verify all valid products in batch are verified and available
        for (uint256 i = 0; i < validProducts.length; i++) {
            uint256 pid = validProducts[i];
            require(products[pid].currentState == AgriTraceLib.ProductState.VERIFIED, "Product not verified");
            require(products[pid].distributionData.distributor == distributor, "Invalid distributor");
        }
        
        batches[batchId].retailer = msg.sender;
        batches[batchId].isDistributedToRetailer = true;
        retailerBatches[msg.sender].push(batchId);
        
        emit BatchPurchased(batchId, msg.sender);
        
        for (uint256 i = 0; i < validProducts.length; i++) {
            uint256 pid = validProducts[i];
            
            products[pid].currentStage = AgriTraceLib.Stage.RETAIL;
            products[pid].currentState = AgriTraceLib.ProductState.RECEIVED;
            products[pid].retailData.retailer = msg.sender;
            products[pid].retailData.priceRetail = prices[i];
            products[pid].retailData.receivedAt = block.timestamp;

            nextTxId++;
            products[pid].distributorToRetailerTxId = nextTxId;
            
            transactions[nextTxId].txId = nextTxId;
            transactions[nextTxId].from = distributor;
            transactions[nextTxId].to = msg.sender;
            transactions[nextTxId].productId = pid;
            transactions[nextTxId].batchId = batchId;
            transactions[nextTxId].price = prices[i];
            transactions[nextTxId].timestamp = block.timestamp;
            
            retailerTxIds[msg.sender].push(nextTxId);
            
            emit ProductPurchased(pid, msg.sender, distributor);
            emit ProductStateChanged(pid, AgriTraceLib.ProductState.RECEIVED);
        }
    }

    // Retailer quality assessment with ability to remove products
    function storeRetailerQualityWithOracle(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        string calldata ipfsHash
    ) external systemActive {
        require(products[productId].retailData.retailer == msg.sender, "Only retailer");
        require(products[productId].currentStage == AgriTraceLib.Stage.RETAIL, "Must be RETAIL stage");
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

    function requestTemperatureUpdate(uint256 productId) external systemActive returns (bytes32) {
        require(address(temperatureOracle) != address(0), "Temperature oracle not set");
        require(products[productId].isActive, "Product not active");
        
        require(
            products[productId].distributionData.distributor == msg.sender || 
            products[productId].retailData.retailer == msg.sender,
            "Not authorized"
        );
        
        return temperatureOracle.requestTemperatureForProduct(productId);
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

    // === HELPER FUNCTIONS FOR BUYERS ===
    function getAvailableProductsForDistributor() external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].currentStage == AgriTraceLib.Stage.FARM && 
                products[i].currentState == AgriTraceLib.ProductState.PENDING_PICKUP && 
                products[i].isActive) {
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].currentStage == AgriTraceLib.Stage.FARM && 
                products[i].currentState == AgriTraceLib.ProductState.PENDING_PICKUP && 
                products[i].isActive) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    function getAvailableBatchesForRetailer() external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextBatchId; i++) {
            if (!batches[i].isDistributedToRetailer) {
                uint256[] memory validProducts = this.getProductsInBatch(i);
                if (validProducts.length > 0) {
                    // Check if all valid products are verified
                    bool allVerified = true;
                    for (uint256 j = 0; j < validProducts.length; j++) {
                        if (products[validProducts[j]].currentState != AgriTraceLib.ProductState.VERIFIED) {
                            allVerified = false;
                            break;
                        }
                    }
                    if (allVerified) count++;
                }
            }
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= nextBatchId; i++) {
            if (!batches[i].isDistributedToRetailer) {
                uint256[] memory validProducts = this.getProductsInBatch(i);
                if (validProducts.length > 0) {
                    bool allVerified = true;
                    for (uint256 j = 0; j < validProducts.length; j++) {
                        if (products[validProducts[j]].currentState != AgriTraceLib.ProductState.VERIFIED) {
                            allVerified = false;
                            break;
                        }
                    }
                    if (allVerified) {
                        result[idx] = i;
                        idx++;
                    }
                }
            }
        }
        return result;
    }

    function getProductsByDistributor(address distributor) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].distributionData.distributor == distributor && products[i].isActive) count++;
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].distributionData.distributor == distributor && products[i].isActive) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    function getProductsByRetailer(address retailer) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].retailData.retailer == retailer && products[i].isActive) count++;
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= nextProductId; i++) {
            if (products[i].retailData.retailer == retailer && products[i].isActive) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
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

    function getUserDetails(address user) external view returns (
        AgriTraceLib.Role role,
        uint256 farmerReputation,
        uint256 distributorReputation,
        uint256 retailerReputation,
        string memory detailsHash
    ) {
        return (
            roles[user],
            reputationScores[AgriTraceLib.Role.FARMER][user],
            reputationScores[AgriTraceLib.Role.DISTRIBUTOR][user],
            reputationScores[AgriTraceLib.Role.RETAILER][user],
            userDataHash[user]
        );
    }

    function getFullTrace(uint256 productId) external view returns (
        uint256 id,
        AgriTraceLib.Grade overallGrade,
        string memory farmDataHash,
        string memory distributionDataHash,
        string memory retailDataHash,
        uint256 buyedQuantity
    ) {
        require(productId > 0 && productId <= nextProductId, "Product not found");
        
        AgriTraceLib.Product memory p = products[productId];
        
        return (
            p.id,
            p.overallGrade,
            p.farmDataHash,
            p.distributionDataHash,
            p.retailDataHash,
            p.retailData.buyedQuantity
        );
    }

    //ML INTEGRATION

        // Add ML Oracle reference
        DamageDetectionConsumer public damageDetectionOracle;
        
        // Track ML prediction requests
        mapping(uint256 => bytes32) public productMLRequests; // productId => requestId
        mapping(bytes32 => uint256) public mlRequestToProduct; // requestId => productId
        
        // Events for ML integration
        event MLPredictionRequested(uint256 indexed productId, bytes32 indexed requestId, string imageUrl);
        event MLPredictionReceived(uint256 indexed productId, uint256 damageScore, string prediction);
        
        // Set ML Oracle (admin only)
        function setDamageDetectionOracle(address _damageOracle) external onlyAdmin {
            damageDetectionOracle = DamageDetectionConsumer(_damageOracle);
        }
        
        // Request ML prediction for a product
        function requestMLDamagePrediction(uint256 productId, string calldata imageUrl) 
            external 
            systemActive 
            returns (bytes32) 
        {
            require(products[productId].isActive, "Product not active");
            require(
                products[productId].distributionData.distributor == msg.sender || 
                products[productId].retailData.retailer == msg.sender,
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
        ) external systemActive {
            require(products[productId].distributionData.distributor == msg.sender, "Only distributor");
            require(products[productId].currentStage == AgriTraceLib.Stage.DISTRIBUTION, "Must be DISTRIBUTION stage");
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
            
            products[productId].distributionData.verifiedAt = block.timestamp;
            products[productId].distributionDataHash = ipfsHash;
            products[productId].overallGrade = grade;

            // Handle rejection based on ML prediction
            if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED || damageScore > 75) {
                productRemovedFromBatch[productId] = true;
                products[productId].currentState = AgriTraceLib.ProductState.REJECTED;
                emit ProductRemovedFromBatch(productId, productToBatch[productId], "ML detected high damage");
                emit ProductRejected(productId, string(abi.encodePacked("ML damage score: ", _uint2str(damageScore))));
            } else {
                products[productId].currentState = AgriTraceLib.ProductState.VERIFIED;
            }

            emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.DISTRIBUTION);
            emit ProductStateChanged(productId, products[productId].currentState);
            emit MLPredictionReceived(productId, damageScore, prediction);
            
            _updateReputation(productId, grade, AgriTraceLib.Stage.DISTRIBUTION);
        }
        
        // Similar function for retailer
        function storeRetailerQualityWithML(
            uint256 productId,
            bytes32 mlRequestId,
            string calldata damageLevel,
            string calldata ipfsHash
        ) external systemActive {
            require(products[productId].retailData.retailer == msg.sender, "Only retailer");
            require(products[productId].currentStage == AgriTraceLib.Stage.RETAIL, "Must be RETAIL stage");
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
            
            products[productId].retailData.verifiedAt = block.timestamp;
            products[productId].retailDataHash = ipfsHash;
            products[productId].overallGrade = grade;

            if (temperature < MIN_TEMP || grade == AgriTraceLib.Grade.REJECTED || damageScore > 75) {
                products[productId].isActive = false;
                products[productId].currentState = AgriTraceLib.ProductState.REJECTED;
                emit ProductRejected(productId, string(abi.encodePacked("ML damage score: ", _uint2str(damageScore))));
            } else {
                products[productId].currentState = AgriTraceLib.ProductState.VERIFIED;
            }

            emit DataStored(productId, ipfsHash, AgriTraceLib.Stage.RETAIL);
            emit ProductStateChanged(productId, products[productId].currentState);
            emit MLPredictionReceived(productId, damageScore, prediction);
            
            _updateReputation(productId, grade, AgriTraceLib.Stage.RETAIL);
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
    }
