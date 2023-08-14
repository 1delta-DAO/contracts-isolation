// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {IUniswapV3Pool} from "../../../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import {BytesLib} from "../../../dex-tools/uniswap/libraries/BytesLib.sol";
import {SafeCast} from "../../../dex-tools/uniswap/libraries/SafeCast.sol";

/**
 * @title BaseAggregator
 * @notice Contains exact input to self function that efficinetly exchagnes tokens withpout additional external calls/approvals
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
    bytes32 private immutable ALG_POOL_CODE_HASH;

    bytes32 private immutable DOV_FF_FACTORY_ADDRESS;
    bytes32 private immutable DOV_POOL_INIT_CODE_HASH;

    constructor(
        address _algebraDeployer,
        address _doveFactory,
        bytes32 algHash,
        bytes32 doveHash
    ) {
        DOV_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_doveFactory)) << 88));
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_algebraDeployer)) << 88));
        ALG_POOL_CODE_HASH = algHash;
        DOV_POOL_INIT_CODE_HASH = doveHash;
    }

    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(25, path.length - 25);
    }

    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, 45);
    }

    // Compute the pool address given two tokens and a fee.
    function _toPool(
        address inputToken,
        uint24 fee,
        uint8 pId,
        address outputToken
    ) internal view returns (IUniswapV3Pool pool) {
        if (pId != 0) {
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
            address tokenOut;
            uint24 fee;
            uint8 pId;
            bool zeroForOne;
            assembly {
                tokenIn := div(mload(add(add(exactInputData, 0x20), 0)), 0x1000000000000000000000000)
                fee := mload(add(add(exactInputData, 0x3), 20))
                pId := mload(add(add(exactInputData, 0x1), 23))
                tokenOut := div(mload(add(add(exactInputData, 0x20), 25)), 0x1000000000000000000000000)
                zeroForOne := lt(tokenIn, tokenOut)
            }

            (int256 amount0, int256 amount1) = _toPool(tokenIn, fee, pId, tokenOut).swap(
                address(this),
                zeroForOne,
                amountIn.toInt256(),
                zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                exactInputData
            );

            amountIn = uint256(-(zeroForOne ? amount1 : amount0));
            zeroForOne = data.length > 68;
            // decide whether to continue or terminate
            if (zeroForOne) {
                data = skipToken(data);
            } else {
                amountOut = amountIn;
                break;
            }
        }
    }
}
