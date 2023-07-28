// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

interface IFactory {
    function registerChange(address owner, address newOwner) external;
}
