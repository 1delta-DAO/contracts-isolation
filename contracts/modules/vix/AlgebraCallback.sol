// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {IUniswapV3Pool} from "../../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import {BytesLib} from "../../dex-tools/uniswap/libraries/BytesLib.sol";
import {SafeCast} from "../../dex-tools/uniswap/libraries/SafeCast.sol";
import {TransferHelper} from "../../dex-tools/uniswap/libraries/TransferHelper.sol";
import {PoolAddressCalculator} from "../../dex-tools/uniswap/libraries/PoolAddressCalculator.sol";
import {DexData} from "../../utils/base/DexData.sol";
import {INativeWrapper} from "../../interfaces/INativeWrapper.sol";
import {IERC20} from "../../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import {ICompoundTypeCEther, ICompoundTypeCERC20, IDataProvider} from "./data-provider/IDataProvider.sol";
import {TokenTransfer} from "../../utils/TokenTransfer.sol";
import {WithVixStorage} from "./VixStorage.sol";
import {BaseSwapper} from "./BaseSwapper.sol";

// solhint-disable max-line-length

/**
 * @title MarginTrader contract
 * @notice Allows users to build large margins positions with one contract interaction
 * @author Achthar
 */
contract AlgebraCallback is BaseSwapper, TokenTransfer, WithVixStorage {
    error Callback();

    using BytesLib for bytes;
    using SafeCast for uint256;

    uint256 internal constant DEFAULT_AMOUNT_CACHED = type(uint256).max;

    address public immutable DATA_PROVIDER;

    address internal immutable NATIVE_WRAPPER;

    constructor(
        address _factory,
        address _dataProvider,
        address _weth
    ) BaseSwapper(_factory) {
        DATA_PROVIDER = _dataProvider;
        NATIVE_WRAPPER = _weth;
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
            _transferERC20Tokens(tokenIn, msg.sender, amountToPay);
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
            cs().amount = uint128(amountToSupply);
            gs().debt = tokenIn;
            tokenOut = gs().collateral; // lock out to collateral
            address native = NATIVE_WRAPPER;
            // debt is ETH
            if (native == tokenIn) {
                address cTokenOut = IDataProvider(DATA_PROVIDER).cToken(tokenOut);
                IERC20(tokenOut).approve(cTokenOut, amountToSupply);
                // deposit regular ERC20
                ICompoundTypeCERC20(cTokenOut).mint(amountToSupply);
                // borrow ETH
                ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).borrow(amountToBorrow);
                // deposit ETH for wETH
                INativeWrapper(tokenIn).deposit{value: amountToBorrow}();
                // transfer WETH
                _transferERC20Tokens(tokenIn, msg.sender, amountToBorrow);
            } else {
                // collateral in ETH
                if (native == tokenOut) {
                    // withdraw WETH
                    INativeWrapper(tokenOut).withdraw(amountToSupply); // unwrap
                    // deposit ETH
                    ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).mint{value: amountToSupply}();
                    // reqassign to save gas
                    tokenOut = IDataProvider(DATA_PROVIDER).cToken(tokenIn);
                    // borrow regular ERC20
                    ICompoundTypeCERC20(tokenOut).borrow(amountToBorrow);
                    // transfer ERC20
                    _transferERC20Tokens(tokenIn, msg.sender, amountToBorrow);
                } else {
                    // only ERC20
                    address _cToken = IDataProvider(DATA_PROVIDER).cToken(tokenOut);
                    IERC20(tokenOut).approve(_cToken, amountToSupply);
                    // deposit regular ERC20
                    ICompoundTypeCERC20(_cToken).mint(amountToSupply);

                    _cToken = IDataProvider(DATA_PROVIDER).cToken(tokenIn);
                    // borrow regular ERC20
                    ICompoundTypeCERC20(_cToken).borrow(amountToBorrow);
                    // transfer ERC20
                    _transferERC20Tokens(tokenIn, msg.sender, amountToBorrow);
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
                ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).repayBorrow{value: amountToRepay}();
            }
            // repay ERC20
            else {
                address cTokenIn = IDataProvider(DATA_PROVIDER).cToken(tokenIn);
                IERC20(tokenIn).approve(cTokenIn, amountToRepay);
                // repay  regular ERC20
                ICompoundTypeCERC20(cTokenIn).repayBorrow(amountToRepay);
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
                cs().amount = uint128(amountToWithdraw);
                // tradeType now indicates whethr it is partial repay or full
                assembly {
                    tradeType := mload(add(add(data, 0x1), 42)) // will only be used in last hop
                }

                if (tokenOut == NATIVE_WRAPPER) {
                    ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther());
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
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(IDataProvider(DATA_PROVIDER).cToken(tokenOut));
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
                        ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).redeemUnderlying(amountToPay);
                    } else {
                        ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther());
                        // withdraw ETH from cETH
                        cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                    }

                    INativeWrapper(tokenOut).deposit{value: amountToPay}(); // wrap
                    // transfer WETH
                    IERC20(tokenOut).transfer(msg.sender, amountToPay);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(IDataProvider(DATA_PROVIDER).cToken(tokenOut));
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
            cs().amount = uint128(amountToPay);
        }
    }
}
