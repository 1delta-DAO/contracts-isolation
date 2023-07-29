// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable no-inline-assembly */
/* solhint-disable max-line-length */

import {IERC20Permit} from "../../../external-protocols/openzeppelin/token/ERC20/extensions/IERC20Permit.sol";
import {IERC20} from "../../../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import {BaseAggregator} from "./BaseAggregator.sol";
import {ICompoundTypeCEther, ICompoundTypeCERC20, IDataProvider} from "../data-provider/IDataProvider.sol";
import {INativeWrapper} from "../../../interfaces/INativeWrapper.sol";
import {WithVixStorage, VixDetailsStorage} from "../VixStorage.sol";
import {SafeCast} from "../../../dex-tools/uniswap/libraries/SafeCast.sol";
import {FeeTransfer} from "../fees/FeeTransfer.sol";
import {InitParams, PermitParams, InitParamsWithPermit} from "../interfaces/ISlot.sol";

/**
 * @title VixInitializeAggregator
 * @notice Initialization functions for slot - ideally called by a factory contract
 */
contract VixInitializeAggregator is WithVixStorage, BaseAggregator, FeeTransfer {
    using SafeCast for uint256;

    error Slippage();
    error AlreadyInitialized();

    address private immutable FACTORY;
    address private immutable NATIVE_WRAPPER;
    address private immutable DATA_PROVIDER;
    uint256 private constant DEFAULT_AMOUNT_CACHED = type(uint256).max;

    constructor(
        address _algebraDeployer,
        address _doveFactory,
        address _dataProvider,
        address _weth,
        address _feeCollector
    ) BaseAggregator(_algebraDeployer, _doveFactory) FeeTransfer(_feeCollector) {
        FACTORY = msg.sender;
        DATA_PROVIDER = _dataProvider;
        NATIVE_WRAPPER = _weth;
    }

    /**
     * @dev Initializes with ERC20 deposit - can swap to WETH
     */
    function initialize(address owner, InitParams calldata params) external payable virtual {
        VixDetailsStorage memory details = ds();
        address dataProvider = DATA_PROVIDER;
        if (details.initialized != 0) revert AlreadyInitialized();
        details.initialized = 1;
        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        details.creationTime = uint32(block.timestamp % 2**32);
        // fetch token and flag for more data
        assembly {
            _tokenCollateral := div(mload(add(add(_bytes, 0x20), 0)), 0x1000000000000000000000000)
        }

        uint256 _deposited = params.amountDeposited;
        address cTokenCollateral;

        _transferERC20TokensFrom(_tokenCollateral, owner, address(this), _deposited);
        _deposited = applyFeeAndTransfer(_tokenCollateral, _deposited, params.partner, params.fee);
        uint256 bytesLength = _bytes.length;
        // swap if full calldata is provided
        if (bytesLength > 22) {
            _deposited = exactInputToSelf(_deposited, _bytes);
            // fetches the last token
            assembly {
                _tokenCollateral := div(mload(add(add(_bytes, 0x20), sub(bytesLength, 21))), 0x1000000000000000000000000)
            }
            if (_deposited < params.minimumAmountDeposited) revert Slippage();

            // in case we swapped to wrapped native
            if (_tokenCollateral == NATIVE_WRAPPER) {
                cTokenCollateral = IDataProvider(dataProvider).oEther();
                INativeWrapper(_tokenCollateral).withdraw(_deposited);
                ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
            }
            // in case we swap to any other erc20
            else {
                cTokenCollateral = IDataProvider(dataProvider).oToken(_tokenCollateral);
                // approve collateral token
                IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);
                // deposit collateral
                ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
            }
        }
        // deposit cannot be Ether - handled by other function
        else {
            cTokenCollateral = IDataProvider(dataProvider).oToken(_tokenCollateral);
            // approve deposit token (can also be the collateral token)
            IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);

            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }
        gs().collateral = _tokenCollateral;
        // configure collateral
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        IDataProvider(dataProvider).getComptroller().enterMarkets(collateralArray);
        // set owner
        ads().owner = owner;
        uint128 borrowAmount = params.borrowAmount;
        details.debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        details.collateralSwapped = uint112(_received);
        if (_received < params.minimumMarginReceived) revert Slippage();
    }

    /**
     * @dev initialize with ETH deposit
     */
    function initializeETH(address owner, InitParams calldata params) external payable virtual {
        VixDetailsStorage memory details = ds();
        address dataProvider = DATA_PROVIDER;
        if (details.initialized != 0) revert AlreadyInitialized();
        details.initialized = 1;

        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        details.creationTime = uint32(block.timestamp % 2**32);

        // fetch token and flag for more data
        assembly {
            _tokenCollateral := div(mload(add(add(_bytes, 0x20), 0)), 0x1000000000000000000000000)
        }

        uint256 _deposited = applyFeeAndTransferEther(msg.value, params.partner, params.fee);
        address cTokenCollateral;
        uint256 bytesLength = _bytes.length;
        // if a route is provided, wrap ether and swap
        // the deposit is then ERC20 and not ether
        if (bytesLength > 22) {
            INativeWrapper(_tokenCollateral).deposit{value: _deposited}();
            _deposited = exactInputToSelf(_deposited, _bytes);
            assembly {
                _tokenCollateral := div(mload(add(add(_bytes, 0x20), sub(bytesLength, 21))), 0x1000000000000000000000000)
            }
            if (_deposited < params.minimumAmountDeposited) revert Slippage();
            cTokenCollateral = IDataProvider(dataProvider).oToken(_tokenCollateral);
            // approve deposit token (can also be the collateral token)
            IERC20(_tokenCollateral).approve(cTokenCollateral, type(uint256).max);
            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }
        // direct deposit - directly supply of Ether
        else {
            cTokenCollateral = IDataProvider(dataProvider).oEther();
            ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
        }

        // set collateral
        gs().collateral = _tokenCollateral;

        // configure collateral
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        IDataProvider(dataProvider).getComptroller().enterMarkets(collateralArray);

        // set owner
        ads().owner = owner;
        uint128 borrowAmount = params.borrowAmount;
        details.debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        details.collateralSwapped = uint112(_received);
        if (_received < params.minimumMarginReceived) revert Slippage();
    }

    /**
     * @dev Allows creation of position with permit (e.g. DAI, USDC etc.)
     */
    function initializeWithPermit(InitParamsWithPermit calldata params) external payable virtual {
        VixDetailsStorage memory details = ds();
        address dataProvider = DATA_PROVIDER;
        if (details.initialized != 0) revert AlreadyInitialized();
        details.initialized = 1;

        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        details.creationTime = uint32(block.timestamp % 2**32);

        // fetch token and flag for more data
        assembly {
            _tokenCollateral := div(mload(add(add(_bytes, 0x20), 0)), 0x1000000000000000000000000)
        }

        address owner = params.permit.owner;
        uint256 _deposited = params.permit.value;

        IERC20Permit(_tokenCollateral).permit(
            owner,
            params.permit.spender,
            _deposited,
            params.permit.deadline,
            params.permit.v,
            params.permit.r,
            params.permit.s
        );

        // transfer collateral from user and deposit to aave
        _transferERC20TokensFrom(_tokenCollateral, owner, address(this), _deposited);
        _deposited = applyFeeAndTransfer(_tokenCollateral, _deposited, params.partner, params.fee);
        address cTokenCollateral;

        // swap if full calldata is provided
        if (_bytes.length > 22) {
            _deposited = exactInputToSelf(_deposited, _bytes);
            uint256 index = _bytes.length;
            assembly {
                _tokenCollateral := div(mload(add(add(_bytes, 0x20), sub(index, 21))), 0x1000000000000000000000000)
            }
            if (_deposited < params.minimumAmountDeposited) revert Slippage();

            // in case we swapped to wrapped native
            if (_tokenCollateral == NATIVE_WRAPPER) {
                cTokenCollateral = IDataProvider(dataProvider).oEther();
                INativeWrapper(_tokenCollateral).withdraw(_deposited);
                ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
            }
            // in case we swap to any other erc20
            else {
                cTokenCollateral = IDataProvider(dataProvider).oToken(_tokenCollateral);
                // approve collateral token
                IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);
                // deposit collateral
                ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
            }
        }
        // in direct case deposit cannot be ETH
        else {
            // get erc20 cToken
            cTokenCollateral = IDataProvider(dataProvider).oToken(_tokenCollateral);
            // capprove deposit token
            IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);
            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }

        // assign collateral
        gs().collateral = _tokenCollateral;

        // configure collateral - has to be an array
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        IDataProvider(dataProvider).getComptroller().enterMarkets(collateralArray);

        // set owner
        ads().owner = owner;
        uint128 borrowAmount = params.borrowAmount;
        details.debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        details.collateralSwapped = uint112(_received);
        if (_received < params.minimumMarginReceived) revert Slippage();
    }

    /**
     * @dev Close the position with exact output swap. If amountToRepay = 0, the eintire debt is repaid.
     *  Input token can either be the collateral token or the deposit token
     */
    function close(
        uint128 amountToRepay,
        uint128 amountInMaximum,
        address partner,
        uint32 fee,
        bytes memory path
    ) public payable virtual returns (uint256 amountIn) {
        // efficient OnlyOwner() check
        address owner = ads().owner;
        require(msg.sender == owner, "OnlyOwner()");

        address tokenIn; // the token that shares a pool with borrow
        address tokenOut; // token out MUST be borrow token
        uint24 poolFee;
        address native = NATIVE_WRAPPER;
        assembly {
            tokenOut := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            poolFee := mload(add(add(path, 0x3), 20))
            tokenIn := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
        }
        // if repay amount is set to 0, the full borrow balance will be repaid
        bool partFlag = amountToRepay != 0;
        // avoid stack too deep
        {
            uint256 amountOut = partFlag
                ? amountToRepay
                : ICompoundTypeCERC20(tokenOut == native ? IDataProvider(DATA_PROVIDER).oEther() : IDataProvider(DATA_PROVIDER).oToken(tokenOut))
                    .borrowBalanceCurrent(address(this));

            bool zeroForOne = tokenIn < tokenOut;
            _toPool(tokenIn, poolFee, tokenOut).swap(
                address(this),
                zeroForOne,
                -amountOut.toInt256(),
                zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
                path
            );
        }

        // fetch amount in and clean cache
        amountIn = cs().amount;
        cs().amount = DEFAULT_AMOUNT_CACHED;
        if (amountInMaximum < amountIn) revert Slippage();

        // when everything is repaid, the amount is withdrawn to the owner
        if (!partFlag) {
            address collateral = gs().collateral;
            ds().closeTime = uint32(block.timestamp % 2**32);
            if (collateral == native) {
                uint256 withdrawAmount = applyFeeAndTransferEther(address(this).balance, partner, fee);
                _transferEth(payable(owner), withdrawAmount);
            } else {
                uint256 withdrawAmount = applyFeeAndTransfer(collateral, IERC20(collateral).balanceOf(address(this)), partner, fee);
                _transferERC20Tokens(collateral, owner, withdrawAmount);
            }
        }
    }

    /**
     * @dev Liquidate debt with exact input swap. If amountIn = 0, the whole collateral will be used.
     *  Input token can either be the collateral token or the deposit token
     */
    function liquidatePosition(
        uint128 amountIn,
        uint128 amountOutMinimum,
        bytes memory path
    ) public virtual returns (uint128 amountOut) {
        require(msg.sender == ads().owner, "OnlyOwner()");

        address tokenIn;
        address tokenOut;
        uint24 fee;
        assembly {
            tokenIn := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(path, 0x3), 20))
            tokenOut := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
        }

        bool zeroForOne = tokenIn < tokenOut;
        bool partFlag = amountIn != 0;
        _toPool(tokenIn, fee, tokenOut).swap(
            address(this),
            zeroForOne,
            partFlag ? uint256(amountIn).toInt256() : balanceOfUnderlying(tokenIn).toInt256(),
            zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
            path
        );

        amountOut = uint128(cs().amount);
        cs().amount = DEFAULT_AMOUNT_CACHED;
        require(amountOut >= amountOutMinimum, "Received too little");
    }

    function _openPosition(uint128 amountIn, bytes memory path) internal returns (uint128 amountOut) {
        address tokenIn;
        address tokenOut;
        uint24 fee;

        assembly {
            tokenIn := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(path, 0x3), 20))
            tokenOut := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
        }

        bool zeroForOne = tokenIn < tokenOut;
        _toPool(tokenIn, fee, tokenOut).swap(
            address(this),
            zeroForOne,
            uint256(amountIn).toInt256(),
            zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
            path
        );

        amountOut = uint128(cs().amount);
        cs().amount = DEFAULT_AMOUNT_CACHED;
    }

    function getOTokens() external view returns (address cTokenCollateral, address cTokenBorrow) {
        address wrapper = NATIVE_WRAPPER;
        address dataProvider = DATA_PROVIDER;

        address debt = gs().debt;
        address collateral = gs().collateral;
        if (debt == wrapper) return (IDataProvider(dataProvider).oToken(collateral), IDataProvider(dataProvider).oEther());

        if (collateral == wrapper) return (IDataProvider(dataProvider).oEther(), IDataProvider(dataProvider).oToken(debt));

        return (IDataProvider(dataProvider).oToken(collateral), IDataProvider(dataProvider).oToken(debt));
    }

    function getOpenAmounts() external view returns (uint256, uint256) {
        return (ds().collateralSwapped, ds().debtSwapped);
    }

    function getDetails() external pure returns (VixDetailsStorage memory details) {
        return ds();
    }

    function balanceOfUnderlying(address underlying) internal virtual returns (uint256) {
        return ICompoundTypeCERC20(IDataProvider(DATA_PROVIDER).oToken(underlying)).balanceOfUnderlying(address(this));
    }
}
