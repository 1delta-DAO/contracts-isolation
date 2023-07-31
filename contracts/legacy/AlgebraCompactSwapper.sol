// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import "hardhat/console.sol";

import {IUniswapV3Pool} from "../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import {BytesLib} from "../dex-tools/uniswap/libraries/BytesLib.sol";
import {CallbackValidation} from "../dex-tools/uniswap/libraries/CallbackValidation.sol";
import {AlgebraCallbackValidation} from "../dex-tools/algebra/libraries/CallbackValidation.sol";
import {SafeCast} from "../dex-tools/uniswap/libraries/SafeCast.sol";
import {TransferHelper} from "../dex-tools/uniswap/libraries/TransferHelper.sol";
import {PoolAddressCalculator} from "../dex-tools/uniswap/libraries/PoolAddressCalculator.sol";
import {AlgebraPoolAddressCalculator} from "../dex-tools/algebra/libraries/PoolAddressCalculator.sol";
import {DexData} from "./misc/utils/base/DexData.sol";
import {INativeWrapper} from "../interfaces/INativeWrapper.sol";
import "./CTokenHolder.sol";
import {IERC20} from "../external-protocols/openzeppelin/token/ERC20/IERC20.sol";

// solhint-disable max-line-length

/**
 * @title MarginTrader contract
 * @notice Allows users to build large margins positions with one contract interaction
 * @author Achthar
 */
abstract contract AlgebraCompactSwapper is CTokenHolder {
    error Callback();

    using BytesLib for bytes;
    using SafeCast for uint256;

    uint128 internal AMOUNT_CACHED = type(uint128).max;
    uint128 internal constant DEFAULT_AMOUNT_CACHED = type(uint128).max;

    /// @dev MIN_SQRT_RATIO + 1 from Uniswap's TickMath
    uint160 internal immutable MIN_SQRT_RATIO = 4295128740;
    /// @dev MAX_SQRT_RATIO - 1 from Uniswap's TickMath
    uint160 internal immutable MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341;

    /// @dev Mask of lower 20 bytes.
    uint256 private constant ADDRESS_MASK = 0x00ffffffffffffffffffffffffffffffffffffffff;

    // pair config
    address public COLLATERAL;
    address public BORROW;
    address immutable NATIVE_WRAPPER;

    bytes32 private immutable ALG_FF_FACTORY_ADDRESS;

    // owner
    address public OWNER;

    constructor(address _nativeWrapper, address _poolDeployer) {
        NATIVE_WRAPPER = _nativeWrapper;
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_poolDeployer)) << 88));
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
        // Algebra Pool
        bytes32 ffFactoryAddress = ALG_FF_FACTORY_ADDRESS;
        bytes32 poolInitCodeHash = AlgebraPoolAddressCalculator.POOL_INIT_CODE_HASH;
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

    function algebraSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        // create datacopy to memory
        bytes memory data = _data;
        uint8 tradeType;
        address tokenIn;
        address tokenOut;

        // fetches tokens and trade typefrom path
        assembly {
            tokenIn := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
            tradeType := mload(add(add(data, 0x1), 20))
            tokenOut := div(mload(add(add(data, 0x20), 21)), 0x1000000000000000000000000)
        }
        // validates that callback came from pool
        {
            if (msg.sender != address(_toPool(tokenIn, tokenOut))) revert Callback();
        }
        // SWAP EXACT IN
        if (tradeType == 3) {
            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
            IERC20(tokenIn).transfer(msg.sender, amountToPay);
        }
        // OPEN EXACT IN
        else if (tradeType == 0) {
            (uint256 amountToBorrow, uint256 amountToSupply) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));
            if (data.length > 42) {
                // we need to swap to the token that we want to supply
                // the router returns the amount that we can finally supply to the protocol
                data = skipToken(data);
                amountToSupply = exactInputToSelf(amountToSupply, data);
            }
            // cache amount
            AMOUNT_CACHED = uint128(amountToSupply);
            BORROW = tokenIn;
            tokenOut = COLLATERAL; // lock out to collateral
            address native = NATIVE_WRAPPER;
            // debt is ETH
            if (native == tokenIn) {
                address cTokenOut = cToken(tokenOut);
                IERC20(tokenOut).approve(cTokenOut, amountToSupply);
                // deposit regular ERC20
                ICompoundTypeCERC20(cTokenOut).mint(amountToSupply);
                // borrow ETH
                ICompoundTypeCEther(cEther()).borrow(amountToBorrow);
                // deposit ETH for wETH
                INativeWrapper(tokenIn).deposit{value: amountToBorrow}();
                // transfer WETH
                IERC20(tokenIn).transfer(msg.sender, amountToBorrow);
            } else {
                // collateral in ETH
                if (native == tokenOut) {
                    // withdraw WETH
                    INativeWrapper(tokenOut).withdraw(amountToSupply); // unwrap
                    // deposit ETH
                    ICompoundTypeCEther(cEther()).mint{value: amountToSupply}();
                    // reqassign to save gas
                    tokenOut = cToken(tokenIn);
                    // borrow regular ERC20
                    ICompoundTypeCERC20(tokenOut).borrow(amountToBorrow);
                    // transfer ERC20
                    IERC20(tokenIn).transfer(msg.sender, amountToBorrow);
                } else {
                    // only ERC20
                    address _cToken = cToken(tokenOut);
                    IERC20(tokenOut).approve(_cToken, amountToSupply);
                    // deposit regular ERC20
                    ICompoundTypeCERC20(_cToken).mint(amountToSupply);

                    _cToken = cToken(tokenIn);
                    // borrow regular ERC20
                    ICompoundTypeCERC20(_cToken).borrow(amountToBorrow);
                    // transfer ERC20
                    IERC20(tokenIn).transfer(msg.sender, amountToBorrow);
                }
            }
        }
        // CLOSE - EXACT OUT SWAP
        else if (tradeType == 1) {
            (uint256 amountToWithdraw, uint256 amountToRepay) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));
            // repay currency is ETH
            if (tokenIn == NATIVE_WRAPPER) {
                // withdraw WETH
                INativeWrapper(tokenIn).withdraw(amountToRepay); // unwrap
                // repay ETH
                ICompoundTypeCEther(cEther()).repayBorrow{value: amountToRepay}();
            }
            // repay ERC20
            else {
                address cTokenIn = cToken(tokenIn);
                IERC20(tokenIn).approve(cTokenIn, amountToRepay);
                // repay  regular ERC20
                ICompoundTypeCERC20(cToken(tokenIn)).repayBorrow(amountToRepay);
            }
            // multi pool means that we have to nest swaps and then withdraw and
            // repay the swap pool
            if (data.length > 42) {
                // we then swap exact In where the first amount is
                // withdrawn from the lending protocol pool and paid back to the pool
                data = skipToken(data);

                assembly {
                    tokenOut := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
                    tokenIn := div(mload(add(add(data, 0x20), 21)), 0x1000000000000000000000000)
                }
                bool zeroForOne = tokenIn < tokenOut;
                _toPool(tokenIn, tokenOut).swap(
                    msg.sender,
                    zeroForOne,
                    -amountToWithdraw.toInt256(),
                    zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                    data
                );
            }
            // if it's a single swap, we just withdraw and repay the swap pool
            else {
                AMOUNT_CACHED = uint128(amountToWithdraw);
                // tradeType now indicates whethr it is partial repay or full
                assembly {
                    tradeType := mload(add(add(data, 0x1), 42)) // will only be used in last hop
                }

                if (tokenOut == NATIVE_WRAPPER) {
                    ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                    if (tradeType != 0) {
                        cEtherContract.redeemUnderlying(amountToWithdraw);
                    } else {
                        // withdraw ETH from cETH
                        cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                    }
                    // withdraw WETH
                    INativeWrapper(tokenOut).deposit{value: amountToWithdraw}(); // unwrap
                    // transfer WETH
                    IERC20(tokenOut).transfer(msg.sender, amountToWithdraw);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenOut));
                    if (tradeType != 0) {
                        cTokenContract.redeemUnderlying(amountToWithdraw);
                    } else {
                        // deposit regular ERC20
                        cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                    }
                    // repay ERC20
                    IERC20(tokenOut).transfer(msg.sender, amountToWithdraw);
                }
            }
        }
        // EXACT OUT SWAP - WITHDRAW
        else if (tradeType == 2) {
            // multi swap exact out
            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
            // if more pools are provided, we continue the swap
            if (data.length > 42) {
                data = skipToken(data);
                // decode first pool, out first, then in
                assembly {
                    tokenOut := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
                    tokenIn := div(mload(add(add(data, 0x20), 21)), 0x1000000000000000000000000)
                }

                bool zeroForOne = tokenIn < tokenOut;

                _toPool(tokenIn, tokenOut).swap(msg.sender, zeroForOne, -amountToPay.toInt256(), zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO, data);
            } else {
                // tradeType now indicates whethr it is partial repay or full
                assembly {
                    tradeType := mload(add(add(data, 0x1), 42)) // will only be used in last hop
                }
                // withraw and send funds to the pool
                if (tokenOut == NATIVE_WRAPPER) {
                    // withdraw ETH from cETH
                    if (tradeType != 0) {
                        ICompoundTypeCEther(cEther()).redeemUnderlying(amountToPay);
                    } else {
                        ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                        // withdraw ETH from cETH
                        cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                    }

                    INativeWrapper(tokenOut).deposit{value: amountToPay}(); // wrap
                    // transfer WETH
                    IERC20(tokenOut).transfer(msg.sender, amountToPay);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenOut));
                    // withdraw regular ERC20
                    if (tradeType != 0) {
                        cTokenContract.redeemUnderlying(amountToPay);
                    } else {
                        cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                    }
                    // repay ERC20
                    IERC20(tokenOut).transfer(msg.sender, amountToPay);
                }
            }
            // cache amount
            AMOUNT_CACHED = uint128(amountToPay);
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

    function _openPosition(uint128 amountIn, bytes memory path) internal returns (uint128 amountOut) {
        address tokenIn;
        address tokenOut;

        assembly {
            tokenIn := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            tokenOut := div(mload(add(add(path, 0x20), 21)), 0x1000000000000000000000000)
        }

        bool zeroForOne = tokenIn < tokenOut;
        _toPool(tokenIn, tokenOut).swap(address(this), zeroForOne, uint256(amountIn).toInt256(), zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO, path);

        amountOut = AMOUNT_CACHED;
        AMOUNT_CACHED = DEFAULT_AMOUNT_CACHED;
    }
}
