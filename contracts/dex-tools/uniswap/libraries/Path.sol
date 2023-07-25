// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.21;

import "./BytesLib.sol";

/// @title Functions for manipulating path data for multihop swaps
library Path {
    using BytesLib for bytes;

    /// @notice Returns true iff the path contains two or more pools
    /// @param path The encoded swap path
    /// @return True if path contains two or more pools, otherwise false
    function hasMultiplePools(bytes memory path) internal pure returns (bool) {
        return path.length >= 68;
    }

    function moreThanAnAddress(bytes memory path) internal pure returns (bool) {
        return path.length >= 20;
    }

    function fetchAddress(bytes memory path) internal pure returns (address _address, bool _hasMore) {
        
        assembly {
            _address := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
        }

        _hasMore = path.length >= 23;
    }

    /// @notice Returns the number of pools in the path
    /// @param path The encoded swap path
    /// @return The number of pools in the path
    function numPools(bytes memory path) internal pure returns (uint256) {
        // Ignore the first token address. From then on every fee and token offset indicates a pool.
        return ((path.length - 20) / 23);
    }

    /// @notice Decodes the first pool in path
    /// @param path The bytes encoded swap path
    /// @return tokenA The first token of the given pool
    /// @return tokenB The second token of the given pool
    /// @return fee The fee level of the pool
    function decodeFirstPool(bytes memory path)
        internal
        pure
        returns (
            address tokenA,
            address tokenB,
            uint24 fee
        )
    {
        assembly {
            tokenA := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(path, 0x3), 20))
            tokenB := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
        }
    }

    /// @notice Decodes the first pool in path
    /// @param path The bytes encoded swap path
    /// @return tokenA The first token of the given pool
    /// @return tokenB The second token of the given pool
    /// @return fee The fee level of the pool
    function decodeFirstPoolAndValidateLength(bytes memory path)
        internal
        pure
        returns (
            address tokenA,
            address tokenB,
            uint24 fee,
            bool multiPool
        )
    {
        assembly {
            tokenA := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(path, 0x3), 20))
            tokenB := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
        }
        multiPool = path.length >= 68;
    }

    /// @notice Gets the segment corresponding to the first pool in the path
    /// @param path The bytes encoded swap path
    /// @return The segment containing all data necessary to target the first pool in the path
    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, 44);
    }

    /// @notice Skips a token + fee element from the buffer and returns the remainder
    /// @param path The swap path
    /// @return The remaining token + fee elements in the path
    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(24, path.length - 24);
    }

    function getLastToken(bytes memory path) internal pure returns (address) {
        return path.toAddress(path.length - 21);
    }

    function getTradeType(bytes memory path) internal pure returns (uint24) {
        return path.toUint24(path.length - 3);
    }

    function getFirstToken(bytes memory path) internal pure returns (address) {
        return path.toAddress(0);
    }
}
