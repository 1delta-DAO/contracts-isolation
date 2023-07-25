// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

// import "hardhat/console.sol";

import {IUniswapV3Pool} from "../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import "../external-protocols/uniswapV3/periphery/interfaces/ISwapRouter.sol";
import "../external-protocols/uniswapV3/core/interfaces/callback/IUniswapV3SwapCallback.sol";
import "../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import {Path} from "../dex-tools/uniswap/libraries/Path.sol";
import {CallbackValidation} from "../dex-tools/uniswap/libraries/CallbackValidation.sol";
import "../dex-tools/uniswap/libraries/SafeCast.sol";
import {TransferHelper} from "../dex-tools/uniswap/libraries/TransferHelper.sol";
import {PoolAddressCalculator} from "../dex-tools/uniswap/libraries/PoolAddressCalculator.sol";
import {UniswapDataHolder} from "./base/UniswapDataHolder.sol";
import {INativeWrapper} from "../interfaces/INativeWrapper.sol";
import "./base/CTokenHolder.sol";
import {IERC20} from "../external-protocols/openzeppelin/token/ERC20/IERC20.sol";

// solhint-disable max-line-length

// margin swap input
struct MarginCallbackData {
    bytes path;
    uint8 tradeType;
    bool partFlag;
}

/**
 * @title MarginTrader contract
 * @notice Allows users to build large margins positions with one contract interaction
 * @author Achthar
 */
abstract contract UniV3Swapper is UniswapDataHolder, CTokenHolder {
    using Path for bytes;
    using SafeCast for uint256;

    uint128 internal AMOUNT_CACHED = type(uint128).max;
    uint128 internal constant DEFAULT_AMOUNT_CACHED = type(uint128).max;

    /// @dev MIN_SQRT_RATIO + 1 from Uniswap's TickMath
    uint160 internal immutable MIN_SQRT_RATIO = 4295128740;
    /// @dev MAX_SQRT_RATIO - 1 from Uniswap's TickMath
    uint160 internal immutable MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341;

    // pair config - packed
    address public COLLATERAL;
    address public BORROW;
    address public DEPOSIT;
    address immutable NATIVE_WRAPPER;

    constructor(address _factory, address _nativeWrapper) UniswapDataHolder(_factory) {
        NATIVE_WRAPPER = _nativeWrapper;
    }

    /// @dev Returns the pool for the given token pair and fee. The pool contract may or may not exist.
    function getUniswapV3Pool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) internal view returns (IUniswapV3Pool) {
        return IUniswapV3Pool(PoolAddressCalculator.computeAddress(v3Factory, tokenA, tokenB, fee));
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        MarginCallbackData memory data = abi.decode(_data, (MarginCallbackData));
        uint256 tradeType = data.tradeType;

        (address tokenIn, address tokenOut, uint24 fee, bool multiPool) = data.path.decodeFirstPoolAndValidateLength();
        CallbackValidation.verifyCallback(v3Factory, tokenIn, tokenOut, fee);

        // regular exact input
        if (tradeType == 3) {
            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
            IERC20(tokenIn).transfer(msg.sender, amountToPay);
        }
        // margin swap open - exact in swap;
        else if (tradeType == 0) {
            (uint256 amountToBorrow, uint256 amountToSupply) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));

            if (multiPool) {
                data.tradeType = 2;
                data.path = data.path.skipToken();
                // we need to swap to the token that we want to supply
                // the router returns the amount that we can finally supply to the protocol
                amountToSupply = exactInputToSelf(amountToSupply, data);

                // cache amount
                AMOUNT_CACHED = uint128(amountToSupply);
                tokenOut = data.path.getLastToken();
            }
            BORROW = tokenIn;
            COLLATERAL = tokenOut;
            if (NATIVE_WRAPPER == tokenIn) {
                // withdraw WETH
                INativeWrapper(tokenOut).withdraw(amountToSupply); // unwrap
                // deposit ETH
                ICompoundTypeCEther(cEther()).mint{value: amountToSupply}();
                // borrow regular ERC20
                ICompoundTypeCERC20(cToken(tokenIn)).borrow(amountToBorrow);
                // transfer ERC20
                TransferHelper.safeTransfer(tokenIn, msg.sender, amountToBorrow);
            } else {
                address cTokenOut = cToken(tokenOut);
                IERC20(tokenOut).approve(cTokenOut, type(uint256).max);
                // deposit regular ERC20
                ICompoundTypeCERC20(cTokenOut).mint(amountToSupply);

                if (NATIVE_WRAPPER == tokenOut) {
                    // borrow ETH
                    ICompoundTypeCEther(cEther()).borrow(amountToBorrow);
                    // deposit ETH for wETH
                    INativeWrapper(tokenIn).deposit{value: amountToBorrow}();
                    // transfer WETH
                    TransferHelper.safeTransfer(tokenIn, msg.sender, amountToBorrow);
                } else {
                    // borrow regular ERC20
                    ICompoundTypeCERC20(cToken(tokenIn)).borrow(amountToBorrow);
                    // transfer ERC20
                    TransferHelper.safeTransfer(tokenIn, msg.sender, amountToBorrow);
                }
            }

            return;
        }
        // margin swap liquidate - exact in swap from collateral to debt;
        else if (tradeType == 4) {
            (uint256 amountToWithdraw, uint256 amountToSwap) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));

            if (multiPool) {
                // we need to swap to the token that we want to supply
                // the router returns the amount that we can finally supply to the protocol
                data.tradeType = 2;
                data.path = data.path.skipToken();
                amountToSwap = exactInputToSelf(amountToSwap, data);

                // cache amount
                AMOUNT_CACHED = uint128(amountToSwap);
                tokenOut = data.path.getLastToken();
                // console.log("A", AMOUNT_CACHED, tokenOut);
            }
            address wrapper = NATIVE_WRAPPER;
            address cOut = cToken(tokenOut);
            // redeem
            if (tokenIn == wrapper) {
                IERC20(tokenOut).approve(cOut, amountToSwap);
                // repay  regular ERC20
                ICompoundTypeCERC20(cOut).repayBorrow(amountToSwap);

                ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                if (data.partFlag) {
                    cEtherContract.redeemUnderlying(amountToWithdraw);
                } else {
                    // withdraw ETH from cETH
                    cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                }
                // withdraw WETH
                INativeWrapper(tokenIn).deposit{value: amountToWithdraw}(); // unwrap
                // transfer WETH
                TransferHelper.safeTransfer(tokenIn, msg.sender, amountToWithdraw);
            } else {
                if (tokenOut == wrapper) {
                    // repay Ether
                    INativeWrapper(tokenOut).withdraw(amountToSwap);
                    ICompoundTypeCEther(cEther()).repayBorrow{value: amountToSwap}();
                } else {
                    IERC20(tokenOut).approve(cOut, amountToSwap);
                    // repay  regular ERC20
                    ICompoundTypeCERC20(cOut).repayBorrow(amountToSwap);
                }
                ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenIn));
                // withdraw regular ERC20
                if (data.partFlag) {
                    cTokenContract.redeemUnderlying(amountToWithdraw);
                } else {
                    cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                }
                // repay ERC20
                TransferHelper.safeTransfer(tokenIn, msg.sender, amountToWithdraw);
            }

            return;
        }
        // margin swap decrease - exact out trade;
        else if (tradeType == 1) {
            (uint256 amountToWithdraw, uint256 amountToRepay) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));

            // repay borrow
            if (tokenOut == NATIVE_WRAPPER) {
                // withdraw WETH
                INativeWrapper(tokenOut).withdraw(amountToRepay); // unwrap
                // repay ETH
                ICompoundTypeCEther(cEther()).repayBorrow{value: amountToRepay}();
            } else {
                // repay  regular ERC20
                ICompoundTypeCERC20(cToken(tokenOut)).repayBorrow(amountToRepay);
            }

            // multi pool means that we have to nest swaps and then withdraw and
            // repay the swap pool
            if (multiPool) {
                // we then swap exact out where the first amount is
                // withdrawn from the lending protocol pool and paid back to the pool
                data.path = data.path.skipToken();
                (tokenOut, tokenIn, fee) = data.path.decodeFirstPool();
                data.tradeType = 2;
                bool zeroForOne = tokenIn < tokenOut;

                getUniswapV3Pool(tokenIn, tokenOut, fee).swap(
                    msg.sender,
                    zeroForOne,
                    -amountToWithdraw.toInt256(),
                    zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                    abi.encode(data)
                );
            }
            // if it's a single swap, we just withdraw and repay the swap pool
            else {
                if (tokenIn == NATIVE_WRAPPER) {
                    ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                    if (data.partFlag) {
                        cEtherContract.redeemUnderlying(amountToWithdraw);
                    } else {
                        // withdraw ETH from cETH
                        cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                    }
                    // withdraw WETH
                    INativeWrapper(tokenIn).deposit{value: amountToWithdraw}(); // unwrap
                    // transfer WETH
                    TransferHelper.safeTransfer(tokenIn, msg.sender, amountToWithdraw);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenIn));
                    if (data.partFlag) {
                        cTokenContract.redeemUnderlying(amountToWithdraw);
                    } else {
                        // deposit regular ERC20
                        cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                    }
                    // repay ERC20
                    TransferHelper.safeTransfer(tokenIn, msg.sender, amountToWithdraw);
                }
            }

            return;
        }
        // swaps exact out where the first amount is withdrawn from lending protocol pool
        else if (tradeType == 2) {
            // multi swap exact out
            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
            // either initiate the next swap or pay
            if (multiPool) {
                data.path = data.path.skipToken();
                (tokenOut, tokenIn, fee) = data.path.decodeFirstPool();

                bool zeroForOne = tokenIn < tokenOut;

                getUniswapV3Pool(tokenIn, tokenOut, fee).swap(
                    msg.sender,
                    zeroForOne,
                    -amountToPay.toInt256(),
                    zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                    abi.encode(data)
                );
            } else {
                // withraw and send funds to the pool
                if (tokenOut == NATIVE_WRAPPER) {
                    ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                    // withdraw ETH from cETH
                    cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                    // withdraw WETH
                    INativeWrapper(tokenIn).deposit{value: amountToPay}(); // unwrap
                    // transfer WETH
                    TransferHelper.safeTransfer(tokenOut, msg.sender, amountToPay);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenOut));
                    // deposit regular ERC20
                    cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                    // repay ERC20
                    TransferHelper.safeTransfer(tokenOut, msg.sender, amountToPay);
                }
                // cache amount
                AMOUNT_CACHED = uint128(amountToPay);
            }
            return;
        }
    }

    function exactInputToSelf(uint256 amountIn, MarginCallbackData memory data) internal returns (uint256 amountOut) {
        while (true) {
            bool hasMultiplePools = data.path.hasMultiplePools();

            MarginCallbackData memory exactInputData;
            exactInputData.path = data.path.getFirstPool();
            exactInputData.tradeType = 3;

            (address tokenIn, address tokenOut, uint24 fee) = exactInputData.path.decodeFirstPool();

            bool zeroForOne = tokenIn < tokenOut;

            (int256 amount0, int256 amount1) = getUniswapV3Pool(tokenIn, tokenOut, fee).swap(
                address(this),
                zeroForOne,
                amountIn.toInt256(),
                zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                abi.encode(exactInputData)
            );

            amountIn = uint256(-(zeroForOne ? amount1 : amount0));

            // decide whether to continue or terminate
            if (hasMultiplePools) {
                data.path = data.path.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }
    }

    /// @dev Performs a single exact input swap
    function exactInputInternal(uint256 amountIn, MarginCallbackData memory data) private returns (uint256 amountOut) {
        (address tokenIn, address tokenOut, uint24 fee) = data.path.decodeFirstPool();

        bool zeroForOne = tokenIn < tokenOut;

        (int256 amount0, int256 amount1) = getUniswapV3Pool(tokenIn, tokenOut, fee).swap(
            address(this),
            zeroForOne,
            amountIn.toInt256(),
            zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
            abi.encode(data)
        );

        return uint256(-(zeroForOne ? amount1 : amount0));
    }
}
