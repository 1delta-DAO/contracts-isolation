// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {IUniswapV3Pool} from "../../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import {BytesLib} from "../../dex-tools/uniswap/libraries/BytesLib.sol";
import {SafeCast} from "../../dex-tools/uniswap/libraries/SafeCast.sol";

// solhint-disable max-line-length

/**
 * @title MarginTrader contract
 * @notice Allows users to build large margins positions with one contract interaction
 * @author Achthar
 */
abstract contract BaseAggregator {
    using BytesLib for bytes;
    using SafeCast for uint256;

    /// @dev MIN_SQRT_RATIO + 1 from Uniswap's TickMath
    uint160 internal immutable MIN_SQRT_RATIO = 4295128740;
    /// @dev MAX_SQRT_RATIO - 1 from Uniswap's TickMath
    uint160 internal immutable MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341;

    /// @dev Mask of lower 20 bytes.
    uint256 private constant ADDRESS_MASK = 0x00ffffffffffffffffffffffffffffffffffffffff;
    /// @dev Mask of lower 3 bytes.
    uint256 private constant UINT24_MASK = 0xffffff;

    // the used address is the algebra pool deployer
    bytes32 private immutable ALG_FF_FACTORY_ADDRESS;
    // bytes32((uint256(0xff) << 248) | (uint256(uint160(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270)) << 88));
    bytes32 private constant ALG_POOL_CODE_HASH = 0x15b69bf972c5c2df89dd7772b62e872d4048b3741a214df60be904ec5620d9df;

    bytes32 private immutable DOV_FF_FACTORY_ADDRESS;
    bytes32 private immutable DOV_POOL_INIT_CODE_HASH = 0x15b69bf972c5c2df89dd7772b62e872d4048b3741a214df60be904ec5620d9df;

    constructor(address _algebraDeployer, address _doveFactory) {
        DOV_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_doveFactory)) << 88));
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_algebraDeployer)) << 88));
    }

    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(24, path.length - 24);
    }

    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, 44);
    }

    // Compute the pool address given two tokens and a fee.
    function _toPool(
        address inputToken,
        uint24 fee,
        address outputToken
    ) internal view returns (IUniswapV3Pool pool) {
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

    function exactInputToSelf(uint256 amountIn, bytes memory data) internal returns (uint256 amountOut) {
        while (true) {
            bytes memory exactInputData = getFirstPool(data);
            address tokenIn;
            bool multiPool = data.length > 68;
            address tokenOut;
            uint24 fee;
            assembly {
                tokenIn := div(mload(add(add(exactInputData, 0x20), 0)), 0x1000000000000000000000000)
                fee := mload(add(add(exactInputData, 0x3), 20))
                tokenOut := div(mload(add(add(exactInputData, 0x20), 24)), 0x1000000000000000000000000)
            }

            bool zeroForOne = tokenIn < tokenOut;
            (int256 amount0, int256 amount1) = _toPool(tokenIn, fee, tokenOut).swap(
                address(this),
                zeroForOne,
                amountIn.toInt256(),
                zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                exactInputData
            );

            amountIn = uint256(-(zeroForOne ? amount1 : amount0));

            // decide whether to continue or terminate
            if (multiPool) {
                data = skipToken(data);
            } else {
                amountOut = amountIn;
                break;
            }
        }
    }
}
