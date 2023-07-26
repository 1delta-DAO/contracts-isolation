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

    // the used address is the algebra pool deployer
    bytes32 private immutable ALG_FF_FACTORY_ADDRESS;
    // bytes32((uint256(0xff) << 248) | (uint256(uint160(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270)) << 88));
    bytes32 private constant POOL_CODE_HASH = 0x15b69bf972c5c2df89dd7772b62e872d4048b3741a214df60be904ec5620d9df;

    constructor(address _algebraFactory) {
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_algebraFactory)) << 88));
    }

    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(21, path.length - 21);
    }

    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, 41);
    }

    // Compute the pool address given two tokens and a fee.
    function _toPool(address inputToken, address outputToken) internal view returns (IUniswapV3Pool pool) {
        // address(keccak256(abi.encodePacked(
        //     hex"ff",
        //     UNI_FACTORY_ADDRESS,
        //     keccak256(abi.encode(inputToken, outputToken, fee)),
        //     UNI_POOL_INIT_CODE_HASH
        // )))
        (address token0, address token1) = inputToken < outputToken ? (inputToken, outputToken) : (outputToken, inputToken);
        bytes32 byteHash = ALG_FF_FACTORY_ADDRESS;
        assembly {
            let s := mload(0x40)
            let p := s
            mstore(p, byteHash)
            p := add(p, 21)
            // Compute the inner hash in-place
            mstore(p, token0)
            mstore(add(p, 32), token1)
            mstore(p, keccak256(p, 64))
            p := add(p, 32)
            mstore(p, POOL_CODE_HASH) // pool code hash zkEvm
            pool := and(ADDRESS_MASK, keccak256(s, 85))
        }
    }

    function exactInputToSelf(uint256 amountIn, bytes memory data) internal returns (uint256 amountOut) {
        while (true) {
            bytes memory exactInputData = getFirstPool(data);
            address tokenIn;
            bool multiPool = data.length > 42;
            address tokenOut;
            assembly {
                tokenIn := div(mload(add(add(exactInputData, 0x20), 0)), 0x1000000000000000000000000)
                tokenOut := div(mload(add(add(exactInputData, 0x20), 21)), 0x1000000000000000000000000)
            }
            bool zeroForOne = tokenIn < tokenOut;
            (int256 amount0, int256 amount1) = _toPool(tokenIn, tokenOut).swap(
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
