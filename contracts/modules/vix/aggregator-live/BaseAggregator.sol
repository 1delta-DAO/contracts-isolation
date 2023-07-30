// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {IUniswapV3Pool} from "../../../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import {BytesLib} from "../../../dex-tools/uniswap/libraries/BytesLib.sol";
import {SafeCast} from "../../../dex-tools/uniswap/libraries/SafeCast.sol";

/**
 * @title BaseAggregator
 * @notice Contains exact input to self function that efficinetly exchagnes tokens withpout additional external calls/approvals
 */
abstract contract BaseAggregatorZK {
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
    bytes32 private constant ALG_FF_FACTORY_ADDRESS = 0xff0d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000;
    bytes32 private constant ALG_POOL_CODE_HASH = 0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4;

    bytes32 private constant DOV_FF_FACTORY_ADDRESS = 0xffde474db1fa59898bc91314328d29507acd0d593c0000000000000000000000;
    bytes32 private constant DOV_POOL_INIT_CODE_HASH = 0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a;

    constructor() {}

    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(25, path.length - 25);
    }

    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, 45);
    }

    // Compute the pool address given two tokens, a poolId and a fee.
    function _toPool(
        address inputToken,
        uint24 fee,
        uint8 pId,
        address outputToken
    ) internal pure returns (IUniswapV3Pool pool) {
        assembly {
            let pairOrder := lt(inputToken, outputToken)
            let s := mload(0x40)
            let p := s
            switch pId
            // ALGEBRA
            case 0 {
                mstore(p, ALG_FF_FACTORY_ADDRESS)
                p := add(p, 21)
                // Compute the inner hash in-place
                switch pairOrder
                case 0 {
                    mstore(p, outputToken)
                    mstore(add(p, 32), inputToken)
                }
                default {
                    mstore(p, inputToken)
                    mstore(add(p, 32), outputToken)
                }
                mstore(p, keccak256(p, 64))
                p := add(p, 32)
                mstore(p, ALG_POOL_CODE_HASH)
                pool := and(ADDRESS_MASK, keccak256(s, 85))
            }
            // DOVE
            default {
                mstore(p, DOV_FF_FACTORY_ADDRESS)
                p := add(p, 21)
                // Compute the inner hash in-place
                switch pairOrder
                case 0 {
                    mstore(p, outputToken)
                    mstore(add(p, 32), inputToken)
                }
                default {
                    mstore(p, inputToken)
                    mstore(add(p, 32), outputToken)
                }
                mstore(add(p, 64), and(UINT24_MASK, fee))
                mstore(p, keccak256(p, 96))
                p := add(p, 32)
                mstore(p, DOV_POOL_INIT_CODE_HASH)
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
            assembly {
                tokenIn := div(mload(add(add(exactInputData, 0x20), 0)), 0x1000000000000000000000000)
                fee := mload(add(add(exactInputData, 0x3), 20))
                pId := mload(add(add(exactInputData, 0x1), 23))
                tokenOut := div(mload(add(add(exactInputData, 0x20), 25)), 0x1000000000000000000000000)
            }

            bool zeroForOne = tokenIn < tokenOut;
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
