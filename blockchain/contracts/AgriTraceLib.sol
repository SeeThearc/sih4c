// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

library AgriTraceLib {
    enum Role { NONE, FARMER, DISTRIBUTOR, RETAILER, ADMIN }
    enum Stage { FARM, DISTRIBUTION, RETAIL }
    enum Grade { A, B, C, REJECTED }
    enum ProductState { PENDING_PICKUP, RECEIVED, VERIFIED, REJECTED, LISTED, BUYED }

    struct Quality {
        uint256 score;
        Grade grade;
        string damageLevel;
        uint256 temperature;
        uint256 timestamp;
        address assessor;
    }

    struct FarmData {
        string productType;
        address farmer;
        uint256 createdAt;
        uint256 expiresAt;
        string origin;
        uint256 priceFarm;
        uint256 quantity;
    }

    struct DistributionData {
        address distributor;
        uint256 priceDist;
        uint256 receivedAt;
        uint256 verifiedAt;
    }

    struct RetailData {
        address retailer;
        uint256 priceRetail;
        uint256 receivedAt;
        uint256 verifiedAt;
        address consumer;
        uint256 buyedQuantity;
    }

    struct Product {
        uint256 id;
        Stage currentStage;
        ProductState currentState;
        Grade overallGrade;
        bool isActive;
        
        FarmData farmData;
        DistributionData distributionData;
        RetailData retailData;
        
        string farmDataHash;
        string distributionDataHash;
        string retailDataHash;
        
        uint256 farmerToDistributorTxId;
        uint256 distributorToRetailerTxId;
    }

    struct Transaction {
        uint256 txId;
        address from;
        address to;
        uint256 productId;
        uint256 batchId;
        uint256 price;
        uint256 timestamp;
    }

    struct Batch {
        uint256 batchId;
        address distributor;
        address retailer;
        uint256[] productIds;
        uint256 createdAt;
        bool isDistributedToRetailer;
    }

    uint256 constant GRADE_A = 85;
    uint256 constant GRADE_B = 70;
    uint256 constant GRADE_C = 55;
    uint256 constant MAX_SCORE = 100;
}