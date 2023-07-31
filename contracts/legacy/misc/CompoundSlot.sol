// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */
/* solhint-disable max-line-length */

// account security
import "../../external-protocols/openzeppelin/utils/cryptography/ECDSA.sol";
import "../../external-protocols/openzeppelin/proxy/utils/Initializable.sol";
import "../../external-protocols/openzeppelin/proxy/utils/UUPSUpgradeable.sol";
import "./utils/CompoundHandler.sol";
import "./utils/tokens/CompoundV2Tokens.sol";
import "../../interfaces/ICompoundSlotFactory.sol";
import "../../interfaces/compound/ICompoundTypeCERC20.sol";

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
contract CompoundSlot is CompoundV2TokenHolder, UUPSUpgradeable, Initializable, CompoundHandler {
    using ECDSA for bytes32;
    using SafeCast for uint256;
    using Path for bytes;

    address immutable FACTORY;

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(
        address _factory,
        address _nativeWrapper,
        address[] memory _tokens,
        address[] memory _cTokens,
        address _cEther,
        IComptroller _comptroller,
        uint256 numTokens
    ) CompoundHandler(_factory, _nativeWrapper) CompoundV2TokenHolder(_tokens, _cTokens, _cEther, _comptroller, numTokens) {
        FACTORY = msg.sender;
        _disableInitializers();
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the account itself (which gets redirected through execute())
        require(msg.sender == OWNER, "only owner");
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     */
    function initialize(InitParams calldata params) public payable virtual initializer {
        // fetch token and flag for more data
        (address _tokenDeposit, bool _hasMore) = params.swapPath.fetchAddress();
        bool isEther = msg.value > 0;
        uint256 _deposited = params.amountDeposited;
        // fetch assets
        address _tokenCollateral;

        // handle transfer in
        if (_tokenDeposit == NATIVE_WRAPPER && isEther) {
            _deposited = msg.value;
            INativeWrapper(_tokenDeposit).deposit{value: _deposited}();
        } else {
            // transfer collateral from user and deposit to aave
            IERC20(_tokenDeposit).transferFrom(msg.sender, address(this), _deposited);
        }

        // swap if full calldata is provided
        if (_hasMore) {
            MarginCallbackData memory data;
            data.path = params.swapPath;
            data.tradeType = 2;
            _deposited = exactInputToSelf(_deposited, data);
            _tokenDeposit = params.swapPath.getLastToken();
            DEPOSIT = _tokenDeposit;
            require(_deposited >= params.minimumAmountDeposited, "DEPOSIT_TOO_LOW");
        }

        // capprove deposit token (can also be the collateral token)
        address cTokenDeposit = cToken(_tokenDeposit);
        IERC20(_tokenDeposit).approve(cTokenDeposit, type(uint256).max);

        // configure collateral
        address[] memory collaterlArray = new address[](2);
        collaterlArray[0] = cToken(_tokenCollateral);
        collaterlArray[1] = cTokenDeposit;
        getComptroller().enterMarkets(collaterlArray);

        // deposit collateral
        ICompoundTypeCERC20(cTokenDeposit).mint(_deposited);

        // set owner
        OWNER = msg.sender;

        // margin swap
        uint128 _received = _openPosition(OpenPositionParams(params.marginPath, params.borrowAmount));
        require(_received >= params.minimumMarginReceived, "SWAP_TOO_LOW");
    }

    /**
     * @dev Close the position with exact output swap. If amountToRepay = 0, the eintire debt is repaid.
     *  Input token can either be the collateral token or the deposit token
     */
    function close(ClosePositionParams calldata params) public payable virtual onlyOwner returns (uint256 amountIn) {
        address owner = OWNER;
        // close trade (withdraw all, repay borrow)
        (address tokenOut, address tokenIn, uint24 fee) = params.path.decodeFirstPool();

        bool partFlag = params.amountToRepay != 0;
        MarginCallbackData memory data = MarginCallbackData({path: params.path, tradeType: 1, partFlag: partFlag});
        uint256 amountOut = partFlag ? params.amountToRepay : ICompoundTypeCERC20(cToken(tokenOut)).borrowBalanceCurrent(address(this));
        bool zeroForOne = tokenIn < tokenOut;
        (int256 amount0, int256 amount1) = getUniswapV3Pool(tokenIn, tokenOut, fee).swap(
            address(this),
            zeroForOne,
            -amountOut.toInt256(),
            zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
            abi.encode(data)
        );
        uint256 amountOutReceived = zeroForOne ? uint256(-amount1) : uint256(-amount0);
        // it's technically possible to not receive the full output amount,
        // so if no price limit has been specified, require this possibility away
        require(amountOutReceived == amountOut);

        amountIn = AMOUNT_CACHED;
        AMOUNT_CACHED = DEFAULT_AMOUNT_CACHED;
        require(params.amountInMaximum >= amountIn, "Had to withdraw too much");

        if (!partFlag){
             address collateral = params.path.getLastToken();
            if (collateral == NATIVE_WRAPPER) {
                payable(msg.sender).transfer(address(this).balance);
            } else {
                IERC20 tokenCollateral = IERC20(collateral);
                // transfer leftovers to owner
                tokenCollateral.transfer(owner, tokenCollateral.balanceOf(address(this)));
            }}
        ICompoundSlotFactory(FACTORY).removeSlot(owner);
    }

    struct LiquidatePositionParams {
        bytes path;
        uint128 amountIn;
        uint128 amountOutMinimum;
    }

    /**
     * @dev Liquidate debt with exact input swap. If amountIn = 0, the whole collateral will be used.
     *  Input token can either be the collateral token or the deposit token
     */
    function liquidatePosition(LiquidatePositionParams calldata params) public virtual onlyOwner returns (uint128 amountOut) {
        (address tokenIn, address tokenOut, uint24 fee) = params.path.decodeFirstPool();

        bool zeroForOne = tokenIn < tokenOut;
        bool partFlag = params.amountIn != 0;
        getUniswapV3Pool(tokenIn, tokenOut, fee).swap(
            address(this),
            zeroForOne,
            partFlag ? uint256(params.amountIn).toInt256() : balanceOfUnderlying(tokenIn).toInt256(),
            zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO,
            abi.encode(MarginCallbackData({path: params.path, tradeType: 4, partFlag: partFlag}))
        );

        amountOut = AMOUNT_CACHED;
        AMOUNT_CACHED = DEFAULT_AMOUNT_CACHED;
        require(amountOut >= params.amountOutMinimum, "Received too little");
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     */
    function initializeWithPermit(InitParamsWithPermit calldata params) public payable virtual initializer {
        // fetch token and flag for more data
        (address _tokenDeposit, bool _hasMore) = params.swapPath.fetchAddress();
        address owner = params.permit.owner;
        uint256 _deposited = params.permit.value;
        // fetch assets
        address _tokenCollateral;

        IERC20Permit(_tokenDeposit).permit(
            owner,
            params.permit.spender,
            _deposited,
            params.permit.deadline,
            params.permit.v,
            params.permit.r,
            params.permit.s
        );

        // transfer collateral from user and deposit to aave
        IERC20(_tokenDeposit).transferFrom(owner, address(this), _deposited);

        // swap if full calldata is provided
        if (_hasMore) {
            MarginCallbackData memory data;
            data.path = params.swapPath;
            data.tradeType = 2;
            _deposited = exactInputToSelf(_deposited, data);
            _tokenDeposit = params.swapPath.getLastToken();
            require(_deposited >= params.minimumAmountDeposited, "DEPOSIT_TOO_LOW");
        }

        // capprove deposit token (can also be the collateral token)
        address cTokenDeposit = cToken(_tokenDeposit);
        IERC20(_tokenDeposit).approve(cTokenDeposit, type(uint256).max);

        // configure collateral
        address[] memory collaterlArray = new address[](2);
        collaterlArray[0] = cToken(_tokenCollateral);
        collaterlArray[1] = cTokenDeposit;
        getComptroller().enterMarkets(collaterlArray);

        // deposit collateral
        ICompoundTypeCERC20(cTokenDeposit).mint(_deposited);

        // set owner
        OWNER = owner;

        // margin swap
        uint128 _received = _openPosition(OpenPositionParams(params.marginPath, params.borrowAmount));
        require(_received >= params.minimumMarginReceived, "SWAP_TOO_LOW");
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        (newImplementation);
        _onlyOwner();
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

    function balanceOfUnderlying(address underlying) internal virtual override returns (uint256) {
        return ICompoundTypeCERC20(_cToken(underlying)).balanceOfUnderlying(address(this));
    }
}
