// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract EmergencyManager {
    address public admin;
    bool public paused;
    mapping(address => bool) public blacklisted;

    event Paused(address indexed admin);
    event Unpaused(address indexed admin);
    event Blacklisted(address indexed user);
    event Unblacklisted(address indexed user);
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor(address _admin) {
        admin = _admin;
        paused = false;
    }

    function pause() external onlyAdmin { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyAdmin { paused = false; emit Unpaused(msg.sender); }
    function blacklist(address user) external onlyAdmin { blacklisted[user] = true; emit Blacklisted(user); }
    function unblacklist(address user) external onlyAdmin { blacklisted[user] = false; emit Unblacklisted(user); }
    function isBlacklisted(address user) external view returns (bool) { return blacklisted[user]; }
    function isPaused() external view returns (bool) { return paused; }
}