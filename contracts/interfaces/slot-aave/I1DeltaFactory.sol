// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IOneDeltaSlotFactory {
    function getSlots(address _user) external view returns (address[] memory slots);
}
