// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

import "../../external-protocols/openzeppelin/utils/structs/EnumerableSet.sol";

contract SlotFactoryBaseStorage {
    /**
     * @notice Administrator for this contract
     */
    address public admin;

    /**
     * @notice Pending administrator for this contract
     */
    address public pendingAdmin;

    /**
     * @notice Active logic of SlotFactory
     */
    address public implementation;

    /**
     * @notice Pending logic of SlotFactory
     */
    address public pendingImplementation;
}

contract SlotFactoryStorage is SlotFactoryBaseStorage {
    bool public initialized;

    // address that provides the logic for each slot proxy deployed from this contract
    address public moduleProvider;

    // address that provides the data regards to protocols and pools to the slot
    address public dataProvider;

    // maps user address to slot set
    mapping(address => EnumerableSet.AddressSet) internal userSlots;

    // maps slot to slotId
    mapping(address => uint256) internal slotIds;

    // maps slot address to user who created the slot
    mapping(address => address) public slotOwners;
}
