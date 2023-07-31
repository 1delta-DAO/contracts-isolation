// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable no-inline-assembly */
/* solhint-disable max-line-length */

import "./AlgebraCompactSwapper.sol";
import "./zk-evm/CompoundV2Tokens.sol";
import "../interfaces/ICompoundSlotFactory.sol";
import "../interfaces/compound/ICompoundTypeCERC20.sol";
import {IERC20Permit} from "../external-protocols/openzeppelin/token/ERC20/extensions/IERC20Permit.sol";

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

/**
 *  Slot contract that holds Compound V2 style balances on behalf of users.
 */
contract Slot is CompoundV2TokenHolder, AlgebraCompactSwapper {
    using SafeCast for uint256;

    error Slippage();
    error AlreadyInitialized();

    address private immutable FACTORY;

    // one slot
    uint112 private collateralSwapped;
    uint112 private debtSwapped;
    uint32 private closeTime;

    // one slot
    uint32 private creationTime;
    uint24 private constant FEE_DENOMINATOR = 0; // = no fees
    uint8 private _initialized;


    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(
        address _nativeWrapper,
        address _algebraPoolDeployer,
        address[] memory _tokens,
        address[] memory _cTokens,
        address _cEther,
        IComptroller _comptroller,
        uint256 numTokens
    ) AlgebraCompactSwapper(_nativeWrapper, _algebraPoolDeployer) CompoundV2TokenHolder(_tokens, _cTokens, _cEther, _comptroller, numTokens) {
        FACTORY = msg.sender;
    }

    /**
     * @dev Initializes with ERC20 deposit - can swap to WETH
     */
    function initialize(address owner, InitParams calldata params) external payable virtual {
        if (_initialized != 0) revert AlreadyInitialized();
        _initialized = 1;
        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        creationTime = uint32(block.timestamp % 2**32);
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
                cTokenCollateral = cEther();
                INativeWrapper(_tokenCollateral).withdraw(_deposited);
                ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
            }
            // in case we swap to any other erc20
            else {
                cTokenCollateral = cToken(_tokenCollateral);
                // approve collateral token
                IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);
                // deposit collateral
                ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
            }
        }
        // deposit cannot be Ether - hndled by other function
        else {
            cTokenCollateral = cToken(_tokenCollateral);
            // approve deposit token (can also be the collateral token)
            IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);

            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }
        COLLATERAL = _tokenCollateral;

        // configure collateral
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        getComptroller().enterMarkets(collateralArray);
        // set owner
        OWNER = owner;
        uint128 borrowAmount = params.borrowAmount;
        debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        collateralSwapped = uint112(_received);
        if (_received < params.minimumMarginReceived) revert Slippage();
    }

    /**
     * @dev initialize with ETH deposit
     */
    function initializeETH(address owner, InitParams calldata params) external payable virtual {
        if (_initialized != 0) revert AlreadyInitialized();
        _initialized = 1;

        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        creationTime = uint32(block.timestamp % 2**32);

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
            cTokenCollateral = cToken(_tokenCollateral);
            // approve deposit token (can also be the collateral token)
            IERC20(_tokenCollateral).approve(cTokenCollateral, type(uint256).max);
            // deposit collateral
            ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);
        }
        // direct deposit - directly supply of Ether
        else {
            cTokenCollateral = cEther();
            ICompoundTypeCEther(cTokenCollateral).mint{value: _deposited}();
        }

        // set collateral
        COLLATERAL = _tokenCollateral;

        // configure collateral
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        getComptroller().enterMarkets(collateralArray);

        // set owner
        OWNER = owner;
        uint128 borrowAmount = params.borrowAmount;
        debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        collateralSwapped = uint112(_received);
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
        address owner = OWNER;
        require(msg.sender == owner, "OnlyOwner()");

        address tokenIn; // the token that shares a pool with borrow
        address tokenOut = BORROW; // token out MUST be borrow token
        address native = NATIVE_WRAPPER;
        assembly {
            tokenIn := div(mload(add(add(path, 0x20), 21)), 0x1000000000000000000000000)
        }
        // if repay amount is set to 0, the full borrow balance will be repaid
        bool partFlag = amountToRepay != 0;
        uint256 amountOut = partFlag
            ? amountToRepay
            : ICompoundTypeCERC20(tokenOut == native ? cEther() : cToken(tokenOut)).borrowBalanceCurrent(address(this));
        bool zeroForOne = tokenIn < tokenOut;
        _toPool(tokenIn, tokenOut).swap(address(this), zeroForOne, -amountOut.toInt256(), zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO, path);

        // fetch amount in and clean cache
        amountIn = AMOUNT_CACHED;
        AMOUNT_CACHED = DEFAULT_AMOUNT_CACHED;
        if (amountInMaximum < amountIn) revert Slippage();

        // when everything is repaid, the amount is withdrawn to the owner
        if (!partFlag) {
            uint256 withdrawAmount;
            uint256 fee = FEE_DENOMINATOR;
            address collateral = COLLATERAL;
            closeTime = uint32(block.timestamp % 2**32);
            if (collateral == native) {
                withdrawAmount = address(this).balance;
                if (fee != 0) {
                    fee = withdrawAmount / fee;
                    withdrawAmount -= fee;
                    payable(owner).transfer(withdrawAmount);
                    payable(FACTORY).transfer(fee);
                } else {
                    payable(owner).transfer(withdrawAmount);
                }
            } else {
                IERC20 tokenCollateral = IERC20(collateral);
                withdrawAmount = tokenCollateral.balanceOf(address(this));
                if (fee != 0) {
                    fee = withdrawAmount / fee;
                    withdrawAmount -= fee;
                    tokenCollateral.transfer(owner, withdrawAmount);
                    tokenCollateral.transfer(FACTORY, fee);
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
        if (_initialized != 0) revert AlreadyInitialized();
        _initialized = 1;

        bytes memory _bytes = params.swapPath;
        address _tokenCollateral;
        creationTime = uint32(block.timestamp % 2**32);

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
        COLLATERAL = _tokenCollateral;
        address cTokenCollateral = cToken(_tokenCollateral);
        // capprove deposit token (can also be the collateral token)
        IERC20(_tokenCollateral).approve(cTokenCollateral, _deposited);

        // configure collateral - has to be an array
        address[] memory collateralArray = new address[](1);
        collateralArray[0] = cTokenCollateral;
        getComptroller().enterMarkets(collateralArray);

        // deposit collateral
        ICompoundTypeCERC20(cTokenCollateral).mint(_deposited);

        // set owner
        OWNER = owner;
        uint128 borrowAmount = params.borrowAmount;
        debtSwapped = uint112(borrowAmount);
        // margin swap
        uint128 _received = _openPosition(borrowAmount, params.marginPath);
        collateralSwapped = uint112(_received);
        if (_received < params.minimumMarginReceived) revert Slippage();
    }

    /**
     * Allows users to repay some debt of the position.
     * Can also be done by any other party to the benefit of the user.
     */
    function repay(uint256 amount) external payable {
        address debt = BORROW;
        uint256 _amount = amount;
        if (debt == NATIVE_WRAPPER) {
            _amount = msg.value;
            ICompoundTypeCEther(cEther()).repayBorrow{value: _amount}();
        } else {
            address _cToken = cToken(debt);
            // approve
            IERC20(debt).transferFrom(msg.sender, address(this), _amount);
            IERC20(debt).approve(_cToken, _amount);
            // repay
            ICompoundTypeCERC20(_cToken).repayBorrow(_amount);
        }
    }

    /**
     * Allows users to withdraw directly from the position. Only the user cna withdraw.
     * Fees have to be paid to the factory.
     */
    function withdraw(uint256 amount, bool useCTokens) external payable {
        // efficient OnlyOwner() check
        address owner = OWNER;
        require(msg.sender == owner, "OnlyOwner()");

        address collateral = COLLATERAL;
        uint256 _amount = amount;
        uint256 fee = FEE_DENOMINATOR;
        if (collateral == NATIVE_WRAPPER) {
            if (useCTokens) {
                ICompoundTypeCEther(cEther()).redeem(_amount);
                _amount = address(this).balance;
                if (fee != 0) {
                    fee = _amount / fee;
                    _amount -= fee;
                    // transfer all ether in this contract
                    payable(owner).transfer(_amount);
                    payable(FACTORY).transfer(fee);
                } else {
                    // transfer all ether in this contract
                    payable(owner).transfer(_amount);
                }
            } else {
                ICompoundTypeCEther(cEther()).redeemUnderlying(_amount);
                if (fee != 0) {
                    fee = _amount / fee;
                    _amount -= fee;
                    // transfer selected amount
                    payable(owner).transfer(_amount);
                    payable(FACTORY).transfer(fee);
                } else {
                    // transfer selected amount
                    payable(owner).transfer(_amount);
                }
            }
        } else {
            address _cToken = cToken(collateral);

            if (useCTokens) {
                ICompoundTypeCERC20(_cToken).redeem(_amount);
                _amount = IERC20(collateral).balanceOf(address(this));
                if (fee != 0) {
                    fee = _amount / fee;
                    _amount -= fee;
                    // here we transfer the full balance
                    IERC20(collateral).transfer(owner, _amount);
                    IERC20(collateral).transfer(FACTORY, fee);
                } else {
                    IERC20(collateral).transfer(owner, _amount);
                }
            } else {
                ICompoundTypeCERC20(_cToken).redeemUnderlying(_amount);
                if (fee != 0) {
                    fee = _amount / fee;
                    _amount -= fee;
                    // transfer the user selected amount
                    IERC20(collateral).transfer(owner, _amount);
                    IERC20(collateral).transfer(FACTORY, fee);
                } else {
                    // transfer the user selected amount
                    IERC20(collateral).transfer(owner, _amount);
                }
            }
        }
    }

    function cToken(address underlying) internal view override returns (address) {
        return _cToken(underlying);
    }

    function cEther() internal view override returns (address) {
        return _cEther;
    }

    function getComptroller() internal view override returns (IComptroller) {
        return _getComptroller();
    }

    function getCTokens() external view returns (address cTokenCollateral, address cTokenBorrow) {
        address wrapper = NATIVE_WRAPPER;
        address debt = BORROW;
        address collateral = COLLATERAL;
        if (debt == wrapper) return (_cToken(collateral), _cEther);

        if (collateral == wrapper) return (_cEther, _cToken(debt));

        return (_cToken(collateral), _cToken(debt));
    }

    function getOpenAmounts() external view returns (uint256, uint256) {
        return (collateralSwapped, debtSwapped);
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
        return (FACTORY, FEE_DENOMINATOR, creationTime, closeTime);
    }
}
