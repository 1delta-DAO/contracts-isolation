// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

import "../external-protocols/openzeppelin/access/Ownable.sol";

contract ImplementationProvider is Ownable {
    address private currentImplementation;

    constructor() Ownable() {}

    function setImplementation(address _newImplementation) external onlyOwner {
        currentImplementation = _newImplementation;
    }

    function getImplementation() external view returns (address) {
        return currentImplementation;
    }
}
