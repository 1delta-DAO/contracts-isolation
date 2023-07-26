// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.21;

import "./libraries/SafeCast.sol";
import "./libraries/TickMath.sol";
import "./libraries/FullMath.sol";
import "../../../external-protocols/algebra/core/interfaces/callback/IAlgebraSwapCallback.sol";
import {BytesLib} from "../../../dex-tools/uniswap/libraries/BytesLib.sol";
import {Path} from "../../../dex-tools/uniswap/libraries/QuotePath.sol";

interface ISwapPool {
    function swap(
        address recipient,
        bool zeroToOne,
        int256 amountRequired,
        uint160 limitSqrtPrice,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

contract AggregationQuoter {
    using BytesLib for bytes;
    using Path for bytes;
    using SafeCast for uint256;
    error tickOutOfRange();
    /// @dev Transient storage variable used to check a safety condition in exact output swaps.
    uint256 private amountOutCached;

    /// @dev Mask of lower 20 bytes.
    uint256 private constant ADDRESS_MASK = 0x00ffffffffffffffffffffffffffffffffffffffff;
    /// @dev Mask of lower 3 bytes.
    uint256 private constant UINT24_MASK = 0xffffff;

    // the used address is the algebra pool deployer
    bytes32 private immutable ALG_FF_FACTORY_ADDRESS;
    bytes32 private constant ALG_POOL_CODE_HASH = 0x15b69bf972c5c2df89dd7772b62e872d4048b3741a214df60be904ec5620d9df;

    bytes32 private immutable DOV_FF_FACTORY_ADDRESS;
    bytes32 private immutable DOV_POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

    constructor(address _algebraDeployer, address _doveFactory) {
        DOV_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_doveFactory)) << 88));
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_algebraDeployer)) << 88));
    }

    // Compute the pool address given two tokens and a fee.
    function _toPool(
        address inputToken,
        uint24 fee,
        address outputToken
    ) internal view returns (ISwapPool pool) {
        if (fee != 0) {
            // Uniswap V3
            bytes32 ffFactoryAddress = DOV_FF_FACTORY_ADDRESS;
            bytes32 poolInitCodeHash = DOV_POOL_INIT_CODE_HASH;
            (address token0, address token1) = inputToken < outputToken ? (inputToken, outputToken) : (outputToken, inputToken);
            assembly {
                let s := mload(0x40)
                let p := s
                mstore(p, ffFactoryAddress)
                p := add(p, 21)
                // Compute the inner hash in-place
                mstore(p, token0)
                mstore(add(p, 32), token1)
                mstore(add(p, 64), and(UINT24_MASK, fee))
                mstore(p, keccak256(p, 96))
                p := add(p, 32)
                mstore(p, poolInitCodeHash)
                pool := and(ADDRESS_MASK, keccak256(s, 85))
            }
        } else {
            // Algebra Pool
            bytes32 ffFactoryAddress = ALG_FF_FACTORY_ADDRESS;
            bytes32 poolInitCodeHash = ALG_POOL_CODE_HASH;
            (address token0, address token1) = inputToken < outputToken ? (inputToken, outputToken) : (outputToken, inputToken);
            assembly {
                let s := mload(0x40)
                let p := s
                mstore(p, ffFactoryAddress)
                p := add(p, 21)
                // Compute the inner hash in-place
                mstore(p, token0)
                mstore(add(p, 32), token1)
                mstore(p, keccak256(p, 64))
                p := add(p, 32)
                mstore(p, poolInitCodeHash)
                pool := and(ADDRESS_MASK, keccak256(s, 85))
            }
        }
    }

    function algebraSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes memory path
    ) external view {
        require(amount0Delta > 0 || amount1Delta > 0); // swaps entirely within 0-liquidity regions are not supported
        (address tokenIn, address tokenOut, ) = path.decodeFirstPool();
        (bool isExactInput, uint256 amountToPay, uint256 amountReceived) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta), uint256(-amount1Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta), uint256(-amount0Delta));

        if (isExactInput) {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountReceived)
                revert(ptr, 32)
            }
        } else {
            // if the cache has been populated, ensure that the full output amount has been received
            if (amountOutCached != 0) require(amountReceived == amountOutCached);
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountToPay)
                revert(ptr, 32)
            }
        }
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes memory path
    ) external view {
        require(amount0Delta > 0 || amount1Delta > 0); // swaps entirely within 0-liquidity regions are not supported
        (address tokenIn, address tokenOut, ) = path.decodeFirstPool();
        (bool isExactInput, uint256 amountToPay, uint256 amountReceived) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta), uint256(-amount1Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta), uint256(-amount0Delta));
        if (isExactInput) {
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountReceived)
                revert(ptr, 32)
            }
        } else {
            // if the cache has been populated, ensure that the full output amount has been received
            if (amountOutCached != 0) require(amountReceived == amountOutCached);
            assembly {
                let ptr := mload(0x40)
                mstore(ptr, amountToPay)
                revert(ptr, 32)
            }
        }
    }

    /// @dev Parses a revert reason that should contain the numeric quote
    function parseRevertReason(bytes memory reason) private pure returns (uint256) {
        if (reason.length != 32) {
            if (reason.length < 68) revert("Unexpected error");
            assembly {
                reason := add(reason, 0x04)
            }
            revert(abi.decode(reason, (string)));
        }
        return abi.decode(reason, (uint256));
    }

    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) public returns (uint256 amountOut) {
        bool zeroForOne = tokenIn < tokenOut;
        try
            _toPool(tokenIn, fee, tokenOut).swap(
                address(this), // address(0) might cause issues with some tokens
                zeroForOne,
                amountIn.toInt256(),
                sqrtPriceLimitX96 == 0 ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1) : sqrtPriceLimitX96,
                abi.encodePacked(tokenIn, fee, tokenOut)
            )
        {} catch (bytes memory reason) {
            return parseRevertReason(reason);
        }
    }

    function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut) {
        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();

            (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();
            // the outputs of prior swaps become the inputs to subsequent ones
            amountIn = quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
            // decide whether to continue or terminate
            if (hasMultiplePools) {
                path = path.skipToken();
            } else {
                return amountIn;
            }
        }
    }

    function quoteExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint160 sqrtPriceLimitX96
    ) public returns (uint256 amountIn) {
        bool zeroForOne = tokenIn < tokenOut;

        // if no price limit has been specified, cache the output amount for comparison in the swap callback
        if (sqrtPriceLimitX96 == 0) amountOutCached = amountOut;
        try
            _toPool(tokenIn, fee, tokenOut).swap(
                address(this), // address(0) might cause issues with some tokens
                zeroForOne,
                -amountOut.toInt256(),
                sqrtPriceLimitX96 == 0 ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1) : sqrtPriceLimitX96,
                abi.encodePacked(tokenOut, fee, tokenIn)
            )
        {} catch (bytes memory reason) {
            if (sqrtPriceLimitX96 == 0) delete amountOutCached; // clear cache
            return parseRevertReason(reason);
        }
    }

    function quoteExactOutput(bytes memory path, uint256 amountOut) external returns (uint256 amountIn) {
        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();

            (address tokenOut, address tokenIn, uint24 fee) = path.decodeFirstPool();
            // the inputs of prior swaps become the outputs of subsequent ones
            amountOut = quoteExactOutputSingle(tokenIn, tokenOut, fee, amountOut, 0);

            // decide whether to continue or terminate
            if (hasMultiplePools) {
                path = path.skipToken();
            } else {
                return amountOut;
            }
        }
    }
}
