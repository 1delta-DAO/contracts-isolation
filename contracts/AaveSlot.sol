// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */
/* solhint-disable max-line-length */

// account security
import "./external-protocols/openzeppelin/utils/cryptography/ECDSA.sol";
import "./external-protocols/openzeppelin/proxy/utils/Initializable.sol";
import "./external-protocols/openzeppelin/proxy/utils/UUPSUpgradeable.sol";
import "./abstract-account/BaseAccount.sol";
import "./utils/AaveHandler.sol";
import "./utils/tokens/AaveTokens.sol";
import "./utils/SignatureValidator.sol";
import {INativeWrapper} from "./interfaces/INativeWrapper.sol";

/**
 * minimal account.
 *  this is sample minimal account.
 *  has execute, eth handling methods
 *  has a single signer that can send requests through the entryPoint.
 */
contract AaveSlot is BaseAccount, UUPSUpgradeable, Initializable, AaveHandler, AaveTokenHolder, SignatureValidator {
    using ECDSA for bytes32;

    IEntryPoint private immutable _entryPoint;

    event SimpleAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(
        IEntryPoint anEntryPoint,
        address[] memory _tokens,
        address[] memory _aTokens,
        address[] memory _vTokens,
        address[] memory _sTokens,
        address _aavePool,
        address _wrappedNative,
        address _1inchRouter,
        uint256 _numTokens
    )
        SignatureValidator()
        AaveHandler(_aavePool, _wrappedNative, _1inchRouter)
        AaveTokenHolder(_tokens, _aTokens, _vTokens, _sTokens, _aavePool, _numTokens)
    {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the account itself (which gets redirected through execute())
        require(msg.sender == OWNER || msg.sender == address(this), "only owner");
    }


    struct OpenParams {
        address owner;
        uint128 amountCollateral;
        uint8 interestRateMode;
        address payToken;
        address tokenCollateral;
        address tokenBorrow;
        uint128 targetCollateralAmount;
        uint128 borrowAmount;
        bytes swapParamsIn;
        bytes marginSwapParams;
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     */
    function initialize(OpenParams calldata params) external payable virtual initializer {
        address assetCollateral = params.tokenCollateral;
        address assetBorrow = params.tokenBorrow;
        address payToken = params.payToken;
        address pool = aavePool; // save gas
        address oneInch = ONE_INCH; // save gas
        address owner = params.owner;

        COLLATERAL = assetCollateral;
        BORROW = assetBorrow;

        // approve for deposit and repayment
        IERC20(assetCollateral).approve(pool, type(uint256).max);
        IERC20(assetBorrow).approve(pool, type(uint256).max);
        IERC20(assetCollateral).approve(oneInch, type(uint256).max);
        IERC20(assetBorrow).approve(oneInch, type(uint256).max);
        uint256 _depoisted = params.amountCollateral;

        // handle transfer in
        if (msg.value > 0) {
            _depoisted = msg.value;
            INativeWrapper(payToken).deposit{value: _depoisted}();
        } else {
            // transfer collateral from user and deposit to aave
            IERC20(payToken).transferFrom(owner, address(this), _depoisted);
        }

        if (assetCollateral != payToken) {
            IERC20(payToken).approve(oneInch, type(uint256).max);
            // execute and check swap
            (bool success, bytes memory result) = oneInch.call(params.swapParamsIn);
            require(success, "SWAP FAILED");

            _depoisted = abi.decode(result, (uint256));
        }

        IPool(pool).deposit(assetCollateral, _depoisted, address(this), 0);

        // configure collateral
        IPool(pool).setUserUseReserveAsCollateral(assetCollateral, true);
        validateAndSetEMode(assetCollateral, assetBorrow, pool);

        // set owner
        OWNER = owner;
        // flash loan and swap
        bytes memory callData = abi.encode(params.marginSwapParams, params.borrowAmount, params.interestRateMode);
        IPool(pool).flashLoanSimple(address(this), assetCollateral, params.targetCollateralAmount, callData, 0);
    }

    struct OpenWithPermitParams {
        address payToken;
        address tokenCollateral;
        uint8 interestRateMode;
        address tokenBorrow;
        uint128 targetCollateralAmount;
        uint128 borrowAmount;
        PermitParams permit;
        bytes swapParamsIn;
        bytes marginSwapParams;
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     */
    function initializeWithPermit(OpenWithPermitParams calldata params) public virtual initializer {
        // fetch tokens
        address inToken = params.payToken;
        address assetBorrow = params.tokenBorrow;

        address owner = params.permit.owner;
        address pool = aavePool; // save gas
        address oneInch = ONE_INCH; // save gas

        uint256 depositValue = params.permit.value;
        IERC20Permit(inToken).permit(
            owner,
            params.permit.spender,
            depositValue,
            params.permit.deadline,
            params.permit.v,
            params.permit.r,
            params.permit.s
        );

        // transfer collateral (or pay token) from user
        IERC20(inToken).transferFrom(owner, address(this), depositValue);

        if (params.tokenCollateral != inToken) {
            IERC20(inToken).approve(oneInch, type(uint256).max);
            // execute and check swap
            (bool success, bytes memory result) = oneInch.call(params.swapParamsIn);
            require(success, "SWAP FAILED");
            inToken = params.tokenCollateral;
            // in token is now collateral token
            IERC20(inToken).approve(oneInch, type(uint256).max);
            // update the deposit value
            depositValue = abi.decode(result, (uint256));
        } else {
            IERC20(inToken).approve(oneInch, type(uint256).max);
        }

        COLLATERAL = inToken;
        BORROW = assetBorrow;

        // approve for deposit and repayment
        IERC20(inToken).approve(pool, type(uint256).max);
        IERC20(assetBorrow).approve(pool, type(uint256).max);
        IERC20(assetBorrow).approve(oneInch, type(uint256).max);

        // deposit to aave
        IPool(pool).deposit(inToken, depositValue, address(this), 0);

        // configure collateral
        IPool(pool).setUserUseReserveAsCollateral(inToken, true);
        validateAndSetEMode(inToken, assetBorrow, pool);

        // set owner
        OWNER = owner;
        // flash loan and swap
        IPool(pool).flashLoanSimple(
            address(this),
            inToken,
            params.targetCollateralAmount,
            abi.encode(params.marginSwapParams, params.borrowAmount, params.interestRateMode),
            0
        );
    }

    struct CloseParams {
        uint128 targetRepayAmount;
        uint128 targetWithdrawAmount;
        bytes swapParams;
    }

    /**
     * @dev closes the position according to the selected swap
     */
    function close(CloseParams calldata params) public virtual onlyOwner {
        bytes memory callData = abi.encode(params.swapParams, params.targetWithdrawAmount);
        IPool(AAVE_POOL).flashLoanSimple(address(this), BORROW, params.targetRepayAmount, callData, 0);
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     */
    function closeFullPosition(bytes calldata swapParams) public virtual onlyOwner {
        address addressThis = address(this);
        address borrowToken = BORROW;
        bytes memory callData = abi.encode(swapParams, IAToken(_aToken(COLLATERAL)).balanceOf(addressThis));
        IPool(AAVE_POOL).flashLoanSimple(
            addressThis,
            borrowToken,
            IERC20(selectedInterestRateMode == 2 ? _vToken(borrowToken) : _sToken(borrowToken)).balanceOf(addressThis),
            callData,
            0
        );
    }

    struct CloseSig {
        address owner;
        address slot;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct CloseFullWithSigParams {
        bytes swapParams;
        CloseSig signature;
    }

    /**
     * @dev Anyone can consume the signature of a user to close the psotion - will always transfer funds to OWNER
     */
    function closeFullPositionWithSig(CloseFullWithSigParams calldata params) public virtual {
        address addressThis = address(this);
        address borrowToken = BORROW;

        validateSignature(
            params.signature.owner,
            params.signature.slot,
            params.signature.deadline,
            params.signature.v,
            params.signature.r,
            params.signature.s
        );

        bytes memory callData = abi.encode(params.swapParams, IAToken(_aToken(COLLATERAL)).balanceOf(addressThis), 0);
        IPool(AAVE_POOL).flashLoanSimple(
            addressThis,
            borrowToken,
            IERC20(selectedInterestRateMode == 2 ? _vToken(borrowToken) : _sToken(borrowToken)).balanceOf(addressThis),
            callData,
            0
        );
    }

    // Require the function call went through EntryPoint or owner
    function _requireFromEntryPointOrOwner() internal view {
        require(msg.sender == address(entryPoint()) || msg.sender == OWNER, "account: not Owner or EntryPoint");
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash) internal virtual override returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        if (OWNER != hash.recover(userOp.signature)) return SIG_VALIDATION_FAILED;
        return 0;
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        (newImplementation);
        _onlyOwner();
    }
}
