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

struct InitParams {
    // deposit amounts
    uint128 amountDeposited;
    uint128 minimumAmountDeposited;
    // margin swap params
    uint128 borrowAmount;
    uint128 minimumMarginReceived;
    // contains only the address if pay ccy = collateral
    bytes swapPath;
    // path for margin trade
    bytes marginPath;
}

// permit
struct PermitParams {
    address owner;
    address spender;
    uint256 value;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

struct InitParamsWithPermit {
    // deposit amounts
    uint128 minimumAmountDeposited;
    // margin swap params
    uint128 borrowAmount;
    uint128 minimumMarginReceived;
    // contains only the address if pay ccy = collateral
    bytes swapPath;
    // path for margin trade
    bytes marginPath;
    PermitParams permit;
}

contract VixInitialize is WithVixStorage, BaseAggregator {
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
        address _weth
    ) BaseAggregator(_algebraDeployer, _doveFactory) {
        FACTORY = msg.sender;
        DATA_PROVIDER = _dataProvider;
        NATIVE_WRAPPER = _weth;
    }

    /**
     * @dev Initializes with ERC20 deposit - can swap to WETH
     */
    function initialize(address owner, InitParams calldata params) external payable virtual {
        VixDetailsStorage memory details = ds();
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

        IERC20(_tokenCollateral).transferFrom(owner, address(this), _deposited);
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
                cTokenCollateral = IDataProvider(DATA_PROVIDER).cEther();
                INativeWrapper(_tokenCollateral).withdraw(_deposited);
                ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
            }
            // in case we swap to any other erc20
            else {
                cTokenCollateral = IDataProvider(DATA_PROVIDER).cToken(_tokenCollateral);
                // approve collateral token
                IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);
                // deposit collateral
                ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
            }
        }
        // deposit cannot be Ether - hndled by other function
        else {
            cTokenCollateral = IDataProvider(DATA_PROVIDER).cToken(_tokenCollateral);
            // approve deposit token (can also be the collateral token)
            IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);

            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }
        gs().collateral = _tokenCollateral;
        // configure collateral
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        IDataProvider(DATA_PROVIDER).getComptroller().enterMarkets(collateralArray);
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
        if (details.initialized != 0) revert AlreadyInitialized();
        details.initialized = 1;

        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        details.creationTime = uint32(block.timestamp % 2**32);

        // fetch token and flag for more data
        assembly {
            _tokenCollateral := div(mload(add(add(_bytes, 0x20), 0)), 0x1000000000000000000000000)
        }

        uint256 _deposited = msg.value;
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
            cTokenCollateral = IDataProvider(DATA_PROVIDER).cToken(_tokenCollateral);
            // approve deposit token (can also be the collateral token)
            IERC20(_tokenCollateral).approve(cTokenCollateral, type(uint256).max);
            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }
        // direct deposit - directly supply of Ether
        else {
            cTokenCollateral = IDataProvider(DATA_PROVIDER).cEther();
            ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
        }

        // set collateral
        gs().collateral = _tokenCollateral;

        // configure collateral
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        IDataProvider(DATA_PROVIDER).getComptroller().enterMarkets(collateralArray);

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
        bytes memory path
    ) public payable virtual returns (uint256 amountIn) {
        // efficient OnlyOwner() check
        address owner = ads().owner;
        require(msg.sender == owner, "OnlyOwner()");

        address tokenIn; // the token that shares a pool with borrow
        address tokenOut; // token out MUST be borrow token
        uint24 fee;
        address native = NATIVE_WRAPPER;
        assembly {
            tokenOut := div(mload(add(add(path, 0x20), 0)), 0x1000000000000000000000000)
            fee := mload(add(add(path, 0x3), 20))
            tokenIn := div(mload(add(add(path, 0x20), 24)), 0x1000000000000000000000000)
        }
        // if repay amount is set to 0, the full borrow balance will be repaid
        bool partFlag = amountToRepay != 0;
        uint256 amountOut = partFlag
            ? amountToRepay
            : ICompoundTypeCERC20(tokenOut == native ? IDataProvider(DATA_PROVIDER).cEther() : IDataProvider(DATA_PROVIDER).cToken(tokenOut))
                .borrowBalanceCurrent(address(this));
        bool zeroForOne = tokenIn < tokenOut;
        _toPool(tokenIn, fee, tokenOut).swap(address(this), zeroForOne, -amountOut.toInt256(), zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO, path);

        // fetch amount in and clean cache
        amountIn = cs().amount;
        cs().amount = DEFAULT_AMOUNT_CACHED;
        if (amountInMaximum < amountIn) revert Slippage();

        // when everything is repaid, the amount is withdrawn to the owner
        if (!partFlag) {
            uint256 withdrawAmount;
            uint256 deltaFee = 0;
            address collateral = gs().collateral;
            ds().closeTime = uint32(block.timestamp % 2**32);
            if (collateral == native) {
                withdrawAmount = address(this).balance;
                if (deltaFee != 0) {
                    deltaFee = withdrawAmount / deltaFee;
                    withdrawAmount -= deltaFee;
                    payable(owner).transfer(withdrawAmount);
                    payable(FACTORY).transfer(deltaFee);
                } else {
                    payable(owner).transfer(withdrawAmount);
                }
            } else {
                IERC20 tokenCollateral = IERC20(collateral);
                withdrawAmount = tokenCollateral.balanceOf(address(this));
                if (deltaFee != 0) {
                    deltaFee = withdrawAmount / deltaFee;
                    withdrawAmount -= deltaFee;
                    tokenCollateral.transfer(owner, withdrawAmount);
                    tokenCollateral.transfer(FACTORY, deltaFee);
                } else {
                    tokenCollateral.transfer(owner, withdrawAmount);
                }
            }
        }
    }

    /**
     * @dev Allows creation of position with permit (e.g. DAI, USDC etc.)
     */
    function initializeWithPermit(InitParamsWithPermit calldata params) external payable virtual {
        VixDetailsStorage memory details = ds();
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
        IERC20(_tokenCollateral).transferFrom(owner, address(this), _deposited);

        // swap if full calldata is provided
        if (_bytes.length > 22) {
            _deposited = exactInputToSelf(_deposited, _bytes);
            uint256 index = _bytes.length;
            assembly {
                _tokenCollateral := div(mload(add(add(_bytes, 0x20), sub(index, 21))), 0x1000000000000000000000000)
            }
            if (_deposited < params.minimumAmountDeposited) revert Slippage();
        }
        // assign collateral
        gs().collateral = _tokenCollateral;
        address cTokenCollateral = IDataProvider(DATA_PROVIDER).cToken(_tokenCollateral);
        // capprove deposit token (can also be the collateral token)
        IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);

        // configure collateral - has to be an array
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        IDataProvider(DATA_PROVIDER).getComptroller().enterMarkets(collateralArray);

        // deposit collateral
        ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);

        // set owner
        ads().owner = owner;
        uint128 borrowAmount = params.borrowAmount;
        details.debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        details.collateralSwapped = uint112(_received);
        if (_received < params.minimumMarginReceived) revert Slippage();
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

    function getCTokens() external view returns (address cTokenCollateral, address cTokenBorrow) {
        address wrapper = NATIVE_WRAPPER;
        address debt = gs().debt;
        address collateral = gs().collateral;
        if (debt == wrapper) return (IDataProvider(DATA_PROVIDER).cToken(collateral), IDataProvider(DATA_PROVIDER).cEther());

        if (collateral == wrapper) return (IDataProvider(DATA_PROVIDER).cEther(), IDataProvider(DATA_PROVIDER).cToken(debt));

        return (IDataProvider(DATA_PROVIDER).cToken(collateral), IDataProvider(DATA_PROVIDER).cToken(debt));
    }

    function getOpenAmounts() external view returns (uint256, uint256) {
        return (ds().collateralSwapped, ds().debtSwapped);
    }

    function getFactoryData()
        external
        view
        returns (
            address,
            uint24,
            uint64,
            uint64
        )
    {
        return (FACTORY, 0, ds().creationTime, ds().closeTime);
    }
}
