// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "./AgriTraceLib.sol";

contract QualityOracle {
    using AgriTraceLib for *;

    address public core;

    mapping(uint256 => AgriTraceLib.Quality[]) public qualityHistory;

    event QualityAssessed(uint256 indexed productId, uint256 score, AgriTraceLib.Grade grade, address assessor, string ipfsHash, uint256 temperature);

    modifier onlyCore() { require(msg.sender == core, "Only core"); _; }
    constructor() { core = msg.sender; }

    function assessQuality(
        uint256 productId,
        uint256 score,
        string calldata damageLevel,
        string calldata ipfsHash,
        uint256 temperature
    ) external {
        AgriTraceLib.Grade grade = _scoreToGrade(score);
        AgriTraceLib.Quality memory q = AgriTraceLib.Quality({
            score: score,
            grade: grade,
            damageLevel: damageLevel,
            temperature: temperature,
            timestamp: block.timestamp,
            assessor: tx.origin
        });
        qualityHistory[productId].push(q);
        emit QualityAssessed(productId, score, grade, q.assessor, ipfsHash, temperature);
    }

    function _scoreToGrade(uint256 score) internal pure returns (AgriTraceLib.Grade) {
        if (score >= AgriTraceLib.GRADE_A) return AgriTraceLib.Grade.A;
        if (score >= AgriTraceLib.GRADE_B) return AgriTraceLib.Grade.B;
        if (score >= AgriTraceLib.GRADE_C) return AgriTraceLib.Grade.C;
        return AgriTraceLib.Grade.REJECTED;
    }

    function getQualityHistory(uint256 productId) external view returns (AgriTraceLib.Quality[] memory) {
        return qualityHistory[productId];
    }
}