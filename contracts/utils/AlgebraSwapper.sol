// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {IUniswapV3Pool} from "../external-protocols/uniswapV3/core/interfaces/IUniswapV3Pool.sol";
import "../external-protocols/algebra/core/interfaces/IAlgebraFactory.sol";
import "../external-protocols/uniswapV3/core/interfaces/callback/IUniswapV3SwapCallback.sol";
import "../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import {Path} from "../dex-tools/uniswap/libraries/Path.sol";
import {CallbackValidation} from "../dex-tools/uniswap/libraries/CallbackValidation.sol";
import {AlgebraCallbackValidation} from "../dex-tools/algebra/libraries/CallbackValidation.sol";
import "../dex-tools/uniswap/libraries/SafeCast.sol";
import {TransferHelper} from "../dex-tools/uniswap/libraries/TransferHelper.sol";
import {PoolAddressCalculator} from "../dex-tools/uniswap/libraries/PoolAddressCalculator.sol";
import {AlgebraPoolAddressCalculator} from "../dex-tools/algebra/libraries/PoolAddressCalculator.sol";
import {DexData} from "./base/DexData.sol";
import {INativeWrapper} from "../interfaces/INativeWrapper.sol";
import "./base/CTokenHolder.sol";
import {IERC20} from "../external-protocols/openzeppelin/token/ERC20/IERC20.sol";

// solhint-disable max-line-length

/**
 * @title MarginTrader contract
 * @notice Allows users to build large margins positions with one contract interaction
 * @author Achthar
 */
abstract contract AlgebraSwapper is CTokenHolder {
    using Path for bytes;
    using SafeCast for uint256;

    uint128 internal AMOUNT_CACHED = type(uint128).max;
    uint128 internal constant DEFAULT_AMOUNT_CACHED = type(uint128).max;

    /// @dev MIN_SQRT_RATIO + 1 from Uniswap's TickMath
    uint160 internal immutable MIN_SQRT_RATIO = 4295128740;
    /// @dev MAX_SQRT_RATIO - 1 from Uniswap's TickMath
    uint160 internal immutable MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341;

    /// @dev Mask of lower 20 bytes.
    uint256 private constant ADDRESS_MASK = 0x00ffffffffffffffffffffffffffffffffffffffff;
    /// @dev Mask of lower 3 bytes.
    uint256 private constant UINT24_MASK = 0xffffff;

    // pair config - packed
    address public COLLATERAL;
    address public BORROW;
    address public DEPOSIT;
    address immutable NATIVE_WRAPPER;

    bytes32 private immutable UNI_FF_FACTORY_ADDRESS;
    bytes32 private immutable ALG_FF_FACTORY_ADDRESS;

    constructor(
        address _factory,
        address _nativeWrapper,
        address _poolDeployer
    ) {
        NATIVE_WRAPPER = _nativeWrapper;
        UNI_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_factory)) << 88));
        ALG_FF_FACTORY_ADDRESS = bytes32((uint256(0xff) << 248) | (uint256(uint160(_poolDeployer)) << 88));
    }

    // Compute the pool address given two tokens and a fee.
    function _toPool(
        address inputToken,
        uint24 fee,
        address outputToken
    ) internal view returns (IUniswapV3Pool pool) {
        // address(keccak256(abi.encodePacked(
        //     hex"ff",
        //     UNI_FACTORY_ADDRESS,
        //     keccak256(abi.encode(inputToken, outputToken, fee)),
        //     UNI_POOL_INIT_CODE_HASH
        // )))
        if (fee != 0) {
            // Uniswap V3
            bytes32 ffFactoryAddress = UNI_FF_FACTORY_ADDRESS;
            bytes32 poolInitCodeHash = PoolAddressCalculator.POOL_INIT_CODE_HASH;
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
    }

    function algebraSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        _swapCallback(amount0Delta, amount1Delta, _data);
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        _swapCallback(amount0Delta, amount1Delta, _data);
    }

    function _swapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) private {
        // create datacopy to memory
        bytes memory data = _data;
        uint8 tradeType;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        assembly {
            tokenIn := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(data, 0x3), 20))
            tradeType := mload(add(add(data, 0x1), 23))
            tokenOut := div(mload(add(add(data, 0x20), 24)), 0x1000000000000000000000000)
        }
        {
            require(msg.sender == address(_toPool(tokenIn, fee, tokenOut)), "Inavlid Callback");
        }
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
            if (data.length > 68) {
                // we need to swap to the token that we want to supply
                // the router returns the amount that we can finally supply to the protocol
                data = data.skipToken();
                amountToSupply = exactInputToSelf(amountToSupply, data);

                // cache amount
                AMOUNT_CACHED = uint128(amountToSupply);
                tokenOut = data.getLastToken();
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
                IERC20(tokenIn).transfer(msg.sender, amountToBorrow);
            } else {
                address cTokenOut = cToken(tokenOut);
                IERC20(tokenOut).approve(cTokenOut, amountToSupply);
                // deposit regular ERC20
                ICompoundTypeCERC20(cTokenOut).mint(amountToSupply);

                if (NATIVE_WRAPPER == tokenOut) {
                    // borrow ETH
                    ICompoundTypeCEther(cEther()).borrow(amountToBorrow);
                    // deposit ETH for wETH
                    INativeWrapper(tokenIn).deposit{value: amountToBorrow}();
                    // transfer WETH
                    IERC20(tokenIn).transfer(msg.sender, amountToBorrow);
                } else {
                    // borrow regular ERC20
                    ICompoundTypeCERC20(cToken(tokenIn)).borrow(amountToBorrow);
                    // transfer ERC20
                    IERC20(tokenIn).transfer(msg.sender, amountToBorrow);
                }
            }
        }
        // margin swap liquidate - exact in swap from collateral to debt;
        else if (tradeType == 4) {
            (uint256 amountToWithdraw, uint256 amountToSwap) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));
            if (data.length > 68) {
                // we need to swap to the token that we want to supply
                // the router returns the amount that we can finally supply to the protocol
                data = data.skipToken();
                amountToSwap = exactInputToSelf(amountToSwap, data);

                // cache amount
                AMOUNT_CACHED = uint128(amountToSwap);
                tokenOut = data.getLastToken();
            }

            address wrapper = NATIVE_WRAPPER;
            address cOut = cToken(tokenOut);

            // tradeType now indicates whether to use all collateral for repayment or just a part
            assembly {
                tradeType := mload(add(add(data, 0x1), 68)) // will only be used in last hop
            }

            // redeem
            if (tokenIn == wrapper) {
                IERC20(tokenOut).approve(cOut, amountToSwap);
                // repay  regular ERC20
                ICompoundTypeCERC20(cOut).repayBorrow(amountToSwap);

                ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                if (tradeType != 0) {
                    cEtherContract.redeemUnderlying(amountToWithdraw);
                } else {
                    // withdraw ETH from cETH
                    cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                }
                // withdraw WETH
                INativeWrapper(tokenIn).deposit{value: amountToWithdraw}(); // unwrap
                // transfer WETH
                IERC20(tokenIn).transfer(msg.sender, amountToWithdraw);
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
                if (tradeType != 0) {
                    cTokenContract.redeemUnderlying(amountToWithdraw);
                } else {
                    cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                }
                // repay ERC20
                IERC20(tokenIn).transfer(msg.sender, amountToWithdraw);
            }
        }
        // margin swap decrease - exact out trade;
        else if (tradeType == 1) {
            (uint256 amountToWithdraw, uint256 amountToRepay) = amount0Delta > 0
                ? (uint256(amount0Delta), uint256(-amount1Delta))
                : (uint256(amount1Delta), uint256(-amount0Delta));
            // repay borrow
            if (tokenIn == NATIVE_WRAPPER) {
                // withdraw WETH
                INativeWrapper(tokenIn).withdraw(amountToRepay); // unwrap
                // repay ETH
                ICompoundTypeCEther(cEther()).repayBorrow{value: amountToRepay}();
            } else {
                address cTokenIn = cToken(tokenIn);
                IERC20(tokenIn).approve(cTokenIn, amountToRepay);
                // repay  regular ERC20
                ICompoundTypeCERC20(cToken(tokenIn)).repayBorrow(amountToRepay);
            }
            // multi pool means that we have to nest swaps and then withdraw and
            // repay the swap pool
            if (data.length > 68) {
                // we then swap exact In where the first amount is
                // withdrawn from the lending protocol pool and paid back to the pool
                data = data.skipToken();
                (tokenOut, tokenIn, fee) = data.decodeFirstPool();
                bool zeroForOne = tokenIn < tokenOut;
                _toPool(tokenIn, fee, tokenOut).swap(
                    msg.sender,
                    zeroForOne,
                    -amountToWithdraw.toInt256(),
                    zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                    data
                );
            }
            // if it's a single swap, we just withdraw and repay the swap pool
            else {
                // tradeType now indicates whethr it is partial repay or full
                assembly {
                    tradeType := mload(add(add(data, 0x1), 68)) // will only be used in last hop
                }

                if (tokenIn == NATIVE_WRAPPER) {
                    ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
                    if (tradeType != 0) {
                        cEtherContract.redeemUnderlying(amountToWithdraw);
                    } else {
                        // withdraw ETH from cETH
                        cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                    }
                    // withdraw WETH
                    INativeWrapper(tokenIn).deposit{value: amountToWithdraw}(); // unwrap
                    // transfer WETH
                    IERC20(tokenIn).transfer(msg.sender, amountToWithdraw);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenIn));
                    if (tradeType != 0) {
                        cTokenContract.redeemUnderlying(amountToWithdraw);
                    } else {
                        // deposit regular ERC20
                        cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                    }
                    // repay ERC20
                    IERC20(tokenIn).transfer(msg.sender, amountToWithdraw);
                }
            }
        }
        // swaps exact out where the first amount is withdrawn from lending protocol pool
        else if (tradeType == 2) {
            // multi swap exact out
            uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
            // either initiate the next swap or pay
            if (data.length > 68) {
                data = data.skipToken();
                // decode first pool, out first, then in
                assembly {
                    tokenOut := div(mload(add(add(data, 0x20), 0)), 0x1000000000000000000000000)
                    fee := mload(add(add(data, 0x3), 20))
                    tokenIn := div(mload(add(add(data, 0x20), 24)), 0x1000000000000000000000000)
                }

                bool zeroForOne = tokenIn < tokenOut;

                _toPool(tokenIn, fee, tokenOut).swap(
                    msg.sender,
                    zeroForOne,
                    -amountToPay.toInt256(),
                    zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                    data
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
                    IERC20(tokenOut).transfer(msg.sender, amountToPay);
                } else {
                    ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(tokenOut));
                    // deposit regular ERC20
                    cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                    // repay ERC20
                    IERC20(tokenOut).transfer(msg.sender, amountToPay);
                }
                // cache amount
                AMOUNT_CACHED = uint128(amountToPay);
            }
        }
    }

    function exactInputToSelf(uint256 amountIn, bytes memory data) internal returns (uint256 amountOut) {
        while (true) {
            bool hasMultiplePools = data.hasMultiplePools();

            bytes memory exactInputData = data.getFirstPool();
            address tokenIn;
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
            if (hasMultiplePools) {
                data = data.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }
    }

    function repaySame(address poolToken, uint24 fee) external {
        address borrow = BORROW;
        require(DEPOSIT == borrow, "invalid token");
        uint256 borrowAmount = ICompoundTypeCERC20(cToken(borrow)).borrowBalanceCurrent(address(this));
        uint256 collateral = ICompoundTypeCERC20(cToken(borrow)).balanceOfUnderlying(address(this));
        bool isBorrow = borrowAmount > collateral;
        uint256 amount0;
        uint256 amount1;
        (amount0, amount1) = borrow < poolToken ? (isBorrow ? borrowAmount : collateral, 0) : (uint256(0), isBorrow ? borrowAmount : collateral);
        _toPool(borrow, fee, poolToken).flash(address(this), amount0, amount1, abi.encodePacked(poolToken, fee, uint8(isBorrow ? 0 : 1)));
    }

    function algebraFlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external {
        bytes memory calldataCopy = data;
        address poolToken;
        address token1;
        uint24 fee;
        uint8 isBorrow;
        address borrowToken = BORROW;
        assembly {
            poolToken := div(mload(add(add(calldataCopy, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(calldataCopy, 0x3), 20))
            isBorrow := mload(add(add(calldataCopy, 0x1), 23))
        }
        {
            require(msg.sender == address(_toPool(poolToken, fee, borrowToken)), "Inavlid Callback");
        }
        require(fee0 == 0 || fee1 == 0, "Do not flash both");
        (uint128 flashed, uint128 flashFee) = (uint128(IERC20(borrowToken).balanceOf(address(this))), uint128(fee0));
        // case Ether
        if (borrowToken == NATIVE_WRAPPER) {
            ICompoundTypeCEther cEtherContract = ICompoundTypeCEther(cEther());
            // case of repaying all debt
            if (isBorrow == 0) {
                // repay flashed, withdraw flashed+fee
                INativeWrapper(borrowToken).withdraw(flashed); // unwrap
                cEtherContract.repayBorrow{value: flashed}();
                uint256 amount = flashed + flashFee;
                cEtherContract.redeemUnderlying(amount);
                // withdraw WETH
                INativeWrapper(borrowToken).deposit{value: amount}(); // unwrap
                // transfer WETH
                IERC20(borrowToken).transfer(msg.sender, amount);
            }
            // caseof withdrawing full collateral
            else {
                uint256 amount = flashed + flashFee;
                INativeWrapper(borrowToken).withdraw(amount); // unwrap
                cEtherContract.repayBorrow{value: amount}();
                cEtherContract.redeem(cEtherContract.balanceOf(address(this)));
                amount = payable(address(this)).balance;
                // withdraw WETH
                INativeWrapper(borrowToken).deposit{value: amount}(); // unwrap
                // transfer WETH
                IERC20(borrowToken).transfer(msg.sender, amount);
            }
        } else {
            // case ERC20
            ICompoundTypeCERC20 cTokenContract = ICompoundTypeCERC20(cToken(borrowToken));
            if (isBorrow == 0) {
                uint256 amount = flashed + flashFee;
                cTokenContract.redeemUnderlying(amount);
                // transfer ERC20
                IERC20(borrowToken).transfer(msg.sender, amount);
            } else {
                cTokenContract.redeem(cTokenContract.balanceOf(address(this)));
                uint256 amount = payable(address(this)).balance;
                // transfer ERC20
                IERC20(borrowToken).transfer(msg.sender, amount);
            }
            address ctoken = cToken(borrowToken);
            IERC20(borrowToken).approve(ctoken, flashed);
            // repay  regular ERC20
            ICompoundTypeCERC20(cToken(borrowToken)).repayBorrow(flashed);
        }

        require(borrowToken == COLLATERAL || borrowToken == DEPOSIT, "invalid token2");

        if (poolToken == borrowToken) {
            require(token1 == DEPOSIT || token1 == COLLATERAL);
        } else {
            require(token1 == borrowToken);
        }
    }
}
