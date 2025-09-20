// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AgriTraceLib.sol";
import "./EmergencyManager.sol";
import "./TemperatureOracle.sol";
import "./AgriTraceBatch.sol";
import "./AgriTraceQuality.sol";

contract AgriTraceCore {
    using AgriTraceLib for *;
    
    TemperatureOracle public temperatureOracle;
    AgriTraceBatch public batchContract;
    AgriTraceQuality public qualityContract;
    EmergencyManager public emergency;
    
    mapping(address => AgriTraceLib.Role) public roles;
    address public admin;

    mapping(uint256 => AgriTraceLib.Product) public products;
    uint256 public nextProductId;

    uint256 public nextTxId;
    mapping(uint256 => AgriTraceLib.Transaction) public transactions;
    mapping(address => uint256[]) public distributorTxIds;
    mapping(address => uint256[]) public retailerTxIds;

    mapping(AgriTraceLib.Role => mapping(address => uint256)) public reputationScores;
    mapping(address => uint256[]) public farmerSoldProducts;

    // User details IPFS hash (profile, license, etc.)
    mapping(address => string) public userDataHash;

    uint256 public constant MIN_TEMP = 5;

    event ProductCreated(uint256 indexed id, address indexed farmer);
    event ProductPurchased(uint256 indexed id, address indexed buyer, address indexed seller);
    event ProductStateChanged(uint256 indexed productId, AgriTraceLib.ProductState newState);
    event DataStored(uint256 indexed id, string ipfsHash, AgriTraceLib.Stage stage);
    event ProductRejected(uint256 indexed productId, string reason);
    event ProductBuyed(uint256 indexed productId, address indexed consumer, uint256 quantity);

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

    function setBatchContract(address _batchContract) external onlyAdmin {
        batchContract = AgriTraceBatch(_batchContract);
    }

    function setQualityContract(address _qualityContract) external onlyAdmin {
        qualityContract = AgriTraceQuality(_qualityContract);
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
    function purchaseFromFarmer(uint256 productId, uint256 priceDist) external systemActive {
        require(roles[msg.sender] == AgriTraceLib.Role.DISTRIBUTOR, "Only distributor can buy");
        require(products[productId].currentStage == AgriTraceLib.Stage.FARM, "Must be FARM stage");
        require(products[productId].currentState == AgriTraceLib.ProductState.PENDING_PICKUP, "Not available for purchase");
        require(products[productId].isActive, "Inactive product");
        require(priceDist > 0, "Invalid price");
        
        address farmer = products[productId].farmData.farmer;
        
        products[productId].currentStage = AgriTraceLib.Stage.DISTRIBUTION;
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
    function updateReputation(uint256 productId, AgriTraceLib.Grade grade, AgriTraceLib.Stage stage) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        _updateReputation(productId, grade, stage);
    }

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

    function updateProductState(uint256 productId, AgriTraceLib.ProductState newState) external {
        require(
            msg.sender == address(batchContract) || 
            msg.sender == address(qualityContract),
            "Only batch or quality contract"
        );
        products[productId].currentState = newState;
        emit ProductStateChanged(productId, newState);
    }

    function updateProductStage(uint256 productId, AgriTraceLib.Stage newStage) external {
        require(msg.sender == address(batchContract), "Only batch contract");
        products[productId].currentStage = newStage;
    }

    function updateProductRetailData(
        uint256 productId, 
        address retailer, 
        uint256 priceRetail, 
        uint256 receivedAt
    ) external {
        require(msg.sender == address(batchContract), "Only batch contract");
        products[productId].retailData.retailer = retailer;
        products[productId].retailData.priceRetail = priceRetail;
        products[productId].retailData.receivedAt = receivedAt;
    }

    function addRetailerTxId(address retailer, uint256 txId) external {
        require(msg.sender == address(batchContract), "Only batch contract");
        retailerTxIds[retailer].push(txId);
    }

    function updateProductOverallGrade(uint256 productId, AgriTraceLib.Grade grade) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        products[productId].overallGrade = grade;
    }

    function updateProductDistributionDataHash(uint256 productId, string calldata ipfsHash) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        products[productId].distributionDataHash = ipfsHash;
    }

    function updateProductRetailDataHash(uint256 productId, string calldata ipfsHash) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        products[productId].retailDataHash = ipfsHash;
    }

    function updateProductDistributionVerified(uint256 productId, uint256 verifiedAt) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        products[productId].distributionData.verifiedAt = verifiedAt;
    }

    function updateProductRetailVerified(uint256 productId, uint256 verifiedAt) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        products[productId].retailData.verifiedAt = verifiedAt;
    }

    function deactivateProduct(uint256 productId) external {
        require(msg.sender == address(qualityContract), "Only quality contract");
        products[productId].isActive = false;
    }

    function createTransaction(
        address from,
        address to,
        uint256 productId,
        uint256 batchId,
        uint256 price
    ) external returns (uint256) {
        require(msg.sender == address(batchContract), "Only batch contract");
        
        nextTxId++;
        transactions[nextTxId].txId = nextTxId;
        transactions[nextTxId].from = from;
        transactions[nextTxId].to = to;
        transactions[nextTxId].productId = productId;
        transactions[nextTxId].batchId = batchId;
        transactions[nextTxId].price = price;
        transactions[nextTxId].timestamp = block.timestamp;
        
        return nextTxId;
    }

    function updateProductDistributorToRetailerTx(uint256 productId, uint256 txId) external {
        require(msg.sender == address(batchContract), "Only batch contract");
        products[productId].distributorToRetailerTxId = txId;
    }

    // === VIEW FUNCTIONS ===
    function getProduct(uint256 productId) external view returns (AgriTraceLib.Product memory) {
        return products[productId];
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
}