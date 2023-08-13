// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.21;

import {BytesLib} from "../../../dex-tools/uniswap/libraries/BytesLib.sol";
import {IUniswapV3Pool} from "../../../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import {TokenTransfer} from "../../../utils/TokenTransfer.sol";
import {INativeWrapper} from "../../../interfaces/INativeWrapper.sol";

/// @title Uniswap V3 Swap Router
/// @notice Router for stateless execution of swaps against Uniswap V3
contract AggregationRouter is TokenTransfer {
    using BytesLib for bytes;

    /// @dev Used as the placeholder value for amountInCached, because the computed amount in for an exact output swap
    /// can never actually be this value
    uint256 private constant DEFAULT_AMOUNT_IN_CACHED = type(uint256).max;

    /// @dev Transient storage variable used for returning the computed amount in for an exact output swap.
    uint256 private amountInCached = DEFAULT_AMOUNT_IN_CACHED;

    /// @dev Mask of lower 20 bytes.
    uint256 private constant ADDRESS_MASK = 0x00ffffffffffffffffffffffffffffffffffffffff;
    /// @dev Mask of lower 3 bytes.
    uint256 private constant UINT24_MASK = 0xffffff;

    // the used address is the algebra pool deployer
    bytes32 private immutable ALG_FF_FACTORY_ADDRESS;
    bytes32 private immutable ALG_POOL_CODE_HASH;

    bytes32 private immutable DOV_FF_FACTORY_ADDRESS;
    bytes32 private immutable DOV_POOL_INIT_CODE_HASH;

    address private immutable WETH;

    /// @dev MIN_SQRT_RATIO + 1 from Uniswap's TickMath
    uint160 internal immutable MIN_SQRT_RATIO = 4295128740;
    /// @dev MAX_SQRT_RATIO - 1 from Uniswap's TickMath
    uint160 internal immutable MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341;

    constructor(
        address _weth,
        address _algebraDeployer,
        address _doveFactory,
        bytes32 algebraHash,
        bytes32 doveHash
    ) {
        WETH = _weth;
        DOV_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_doveFactory)) << 88));
        ALG_POOL_CODE_HASH = algebraHash;
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_algebraDeployer)) << 88));
        DOV_POOL_INIT_CODE_HASH = doveHash;
    }

    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(25, path.length - 25);
    }

    function getFirstPool(bytes memory path) internal pure returns (bytes memory) {
        return path.slice(0, 44);
    }

    function exactInput(
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        bytes memory path
    ) external payable returns (uint256 amountOut) {
        address payer = msg.sender; // msg.sender pays for the first hop

        while (true) {
            address tokenIn;
            address tokenOut;
            uint24 fee;
            uint8 pId;
            bool zeroForOne;
            assembly {
                tokenIn := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
                fee := mload(add(add(path, 0x3), 20))
                pId := mload(add(add(path, 0x1), 23))
                tokenOut := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
                zeroForOne := lt(tokenIn, tokenOut)
            }

            (int256 amount0, int256 amount1) = _toPool(tokenIn, fee, pId, tokenOut).swap(
                recipient,
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                abi.encode(
                    SwapCallbackData({
                        path: getFirstPool(path), // only the first pool in the path is necessary
                        payer: payer
                    })
                )
            );

            amountIn = uint256(-(zeroForOne ? amount1 : amount0));

            // decide whether to continue or terminate
            if (path.length > 44) {
                payer = address(this); // at this point, the caller has paid
                path = skipToken(path);
            } else {
                amountOut = amountIn;
                break;
            }
        }

        require(amountOut >= amountOutMinimum, "Too little received");
    }

    function exactOutput(
        uint256 amountOut,
        uint256 amountInMaximum,
        address recipient,
        bytes memory path
    ) external payable returns (uint256 amountIn) {
        if (recipient == address(0)) recipient = address(this);

        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint8 pId;
        bool zeroForOne;
        assembly {
            tokenOut := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(path, 0x3), 20))
            pId := mload(add(add(path, 0x1), 23))
            tokenIn := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
            zeroForOne := lt(tokenIn, tokenOut)
        }

        _toPool(tokenIn, fee, pId, tokenOut).swap(
            recipient,
            zeroForOne,
            -int256(amountOut),
            zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
            abi.encode(SwapCallbackData({path: path, payer: msg.sender}))
        );
        amountIn = amountInCached;
        require(amountIn <= amountInMaximum, "Too much requested");
        amountInCached = DEFAULT_AMOUNT_IN_CACHED;
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

    struct SwapCallbackData {
        bytes path;
        address payer;
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        require(amount0Delta > 0 || amount1Delta > 0); // swaps entirely within 0-liquidity regions are not supported
        SwapCallbackData memory data = abi.decode(_data, (SwapCallbackData));
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint8 pId;
        assembly {
            tokenIn := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(data, 0x3), 20))
            pId := mload(add(add(data, 0x1), 23))
            tokenOut := div(mload(add(add(data, 0x20), 24)), 0x1000000000000000000000000)
        }

        {
            require(msg.sender == address(_toPool(tokenIn, fee, pId, tokenOut)), "Inavlid Callback");
        }

        (bool isExactInput, uint256 amountToPay) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta));
        if (isExactInput) {
            pay(tokenIn, data.payer, msg.sender, amountToPay);
        } else {
            // either initiate the next swap or pay
            if (data.path.length > 44) {
                data.path = skipToken(data.path);
                bool zeroForOne;
                assembly {
                    tokenOut := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
                    fee := mload(add(add(data, 0x3), 20))
                    pId := mload(add(add(data, 0x1), 23))
                    tokenIn := div(mload(add(add(data, 0x20), 24)), 0x1000000000000000000000000)
                    zeroForOne := lt(tokenIn, tokenOut)
                }

                _toPool(tokenIn, fee, pId, tokenOut).swap(
                    msg.sender,
                    zeroForOne,
                    -int256(amountToPay),
                    zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                    abi.encode(data)
                );
            } else {
                amountInCached = amountToPay;
                tokenIn = tokenOut; // swap in/out because exact output swaps are reversed
                pay(tokenIn, data.payer, msg.sender, amountToPay);
            }
        }
    }

    /// @param token The token to pay
    /// @param payer The entity that must pay
    /// @param recipient The entity that will receive payment
    /// @param value The amount to pay
    function pay(
        address token,
        address payer,
        address recipient,
        uint256 value
    ) internal {
        if (token == WETH && address(this).balance >= value) {
            // pay with WETH
            INativeWrapper(WETH).deposit{value: value}(); // wrap only what is needed to pay
            INativeWrapper(WETH).transfer(recipient, value);
        } else if (payer == address(this)) {
            // pay with tokens already in the contract (for the exact input multihop case)
            _transferERC20Tokens(token, recipient, value);
        } else {
            // pull payment
            _transferERC20TokensFrom(token, payer, recipient, value);
        }
    }
}
