// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./AgriTraceLib.sol";
import "./AgriTraceCore.sol";

contract AgriTraceBatch {
    using AgriTraceLib for *;
    
    AgriTraceCore public coreContract;
    
    mapping(uint256 => AgriTraceLib.Batch) public batches;
    mapping(address => uint256[]) public distributorBatches;
    mapping(address => uint256[]) public retailerBatches;
    uint256 public nextBatchId;

    // Track which products are in which batch
    mapping(uint256 => uint256) public productToBatch; // productId => batchId
    mapping(uint256 => bool) public productRemovedFromBatch; // productId => removed status

    event BatchCreated(uint256 batchId, address distributor);
    event BatchPurchased(uint256 batchId, address retailer);
    event ProductRemovedFromBatch(uint256 indexed productId, uint256 indexed batchId, string reason);

    constructor(address _coreContract) {
        coreContract = AgriTraceCore(_coreContract);
    }

    // Get unbatched products bought by distributor (PENDING_PICKUP state)
    function getUnbatchedProductsByDistributor(address distributor) external view returns (uint256[] memory) {
        uint256 count;
        uint256 totalProducts = coreContract.getTotalProducts();
        
        for (uint256 i = 1; i <= totalProducts; i++) {
            AgriTraceLib.Product memory product = coreContract.getProduct(i);
            if (product.distributionData.distributor == distributor && 
                product.currentStage == AgriTraceLib.Stage.DISTRIBUTION &&
                product.currentState == AgriTraceLib.ProductState.PENDING_PICKUP &&
                productToBatch[i] == 0 && // Not in any batch
                product.isActive) {
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= totalProducts; i++) {
            AgriTraceLib.Product memory product = coreContract.getProduct(i);
            if (product.distributionData.distributor == distributor && 
                product.currentStage == AgriTraceLib.Stage.DISTRIBUTION &&
                product.currentState == AgriTraceLib.ProductState.PENDING_PICKUP &&
                productToBatch[i] == 0 && // Not in any batch
                product.isActive) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    // Create batch and change product states from PENDING_PICKUP to RECEIVED
    function createBatch(uint256[] calldata productIds) external returns (uint256) {
        AgriTraceLib.Role role = coreContract.getRole(msg.sender);
        require(role == AgriTraceLib.Role.DISTRIBUTOR, "Only distributor");
        require(productIds.length > 0, "Empty batch");
        
        for (uint256 i = 0; i < productIds.length; i++) {
            AgriTraceLib.Product memory product = coreContract.getProduct(productIds[i]);
            require(product.distributionData.distributor == msg.sender, "Not your product");
            require(product.currentState == AgriTraceLib.ProductState.PENDING_PICKUP, "Not pending pickup");
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
            coreContract.updateProductState(productIds[i], AgriTraceLib.ProductState.RECEIVED);
        }
        
        emit BatchCreated(nextBatchId, msg.sender);
        
        return nextBatchId;
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

    function getAvailableBatchesForRetailer() external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= nextBatchId; i++) {
            if (!batches[i].isDistributedToRetailer) {
                uint256[] memory validProducts = this.getProductsInBatch(i);
                if (validProducts.length > 0) {
                    // Check if all valid products are verified
                    bool allVerified = true;
                    for (uint256 j = 0; j < validProducts.length; j++) {
                        AgriTraceLib.Product memory product = coreContract.getProduct(validProducts[j]);
                        if (product.currentState != AgriTraceLib.ProductState.VERIFIED) {
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
                        AgriTraceLib.Product memory product = coreContract.getProduct(validProducts[j]);
                        if (product.currentState != AgriTraceLib.ProductState.VERIFIED) {
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

    // Purchase batch from distributor
    function purchaseBatchFromDistributor(uint256 batchId, uint256[] calldata prices) external {
        AgriTraceLib.Role role = coreContract.getRole(msg.sender);
        require(role == AgriTraceLib.Role.RETAILER, "Only retailer can buy");
        require(!batches[batchId].isDistributedToRetailer, "Already purchased");
        
        address distributor = batches[batchId].distributor;
        uint256[] memory validProducts = this.getProductsInBatch(batchId);
        
        require(validProducts.length == prices.length, "Price mismatch with valid products");
        require(validProducts.length > 0, "No valid products in batch");
        
        // Verify all valid products in batch are verified and available
        for (uint256 i = 0; i < validProducts.length; i++) {
            uint256 pid = validProducts[i];
            AgriTraceLib.Product memory product = coreContract.getProduct(pid);
            require(product.currentState == AgriTraceLib.ProductState.VERIFIED, "Product not verified");
            require(product.distributionData.distributor == distributor, "Invalid distributor");
        }
        
        batches[batchId].retailer = msg.sender;
        batches[batchId].isDistributedToRetailer = true;
        retailerBatches[msg.sender].push(batchId);
        
        emit BatchPurchased(batchId, msg.sender);
        
        for (uint256 i = 0; i < validProducts.length; i++) {
            uint256 pid = validProducts[i];
            
            coreContract.updateProductStage(pid, AgriTraceLib.Stage.RETAIL);
            coreContract.updateProductState(pid, AgriTraceLib.ProductState.RECEIVED);
            coreContract.updateProductRetailData(pid, msg.sender, prices[i], block.timestamp);

            uint256 txId = coreContract.createTransaction(distributor, msg.sender, pid, batchId, prices[i]);
            coreContract.updateProductDistributorToRetailerTx(pid, txId);
            coreContract.addRetailerTxId(msg.sender, txId);
        }
    }

    function removeProductFromBatch(uint256 productId, string calldata reason) external {
        require(productToBatch[productId] > 0, "Product not in batch");
        require(!productRemovedFromBatch[productId], "Already removed");
        
        AgriTraceLib.Product memory product = coreContract.getProduct(productId);
        require(
            product.distributionData.distributor == msg.sender || 
            coreContract.getRole(msg.sender) == AgriTraceLib.Role.ADMIN,
            "Not authorized"
        );
        
        productRemovedFromBatch[productId] = true;
        emit ProductRemovedFromBatch(productId, productToBatch[productId], reason);
    }

    function getBatchDetails(uint256 batchId) external view returns (AgriTraceLib.Batch memory) {
        return batches[batchId];
    }

    function getProductBatch(uint256 productId) external view returns (uint256) {
        return productToBatch[productId];
    }

    function isProductRemovedFromBatch(uint256 productId) external view returns (bool) {
        return productRemovedFromBatch[productId];
    }
}