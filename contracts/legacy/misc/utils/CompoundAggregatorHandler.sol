// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import "./AlgebraSwapper.sol";

import "../../../external-protocols/openzeppelin/token/ERC20/extensions/IERC20Permit.sol";

abstract contract CompoundAggregatorHandler is AlgebraSwapper {
    using Path for bytes;
    using SafeCast for uint256;

    // owner
    address public OWNER;

    constructor(
        address _factory,
        address _nativeWrapper,
        address _algebraPoolDeployer
    ) AlgebraSwapper(_factory, _nativeWrapper, _algebraPoolDeployer) {}

    /**
     * Initializes slot
     * Deposits initial collateral, sets tokens
     */
    function _initialDeposit(
        address _depositor,
        uint256 _amountDeposited,
        bytes calldata _swapPath
    ) internal returns (uint128) {
        // fetch token and flag for more data
        (address _tokenIn, bool _hasMore) = _swapPath.fetchAddress();
        bool isEther = msg.value > 0;
        uint256 _deposited = _amountDeposited;
        // fetch assets
        address _tokenCollateral;
        // handle transfer in
        if (_tokenIn == NATIVE_WRAPPER && isEther) {
            _deposited = msg.value;
            INativeWrapper(_tokenIn).deposit{value: _deposited}();
        } else {
            // transfer collateral from user and deposit to aave
            TransferHelper.safeTransferFrom(_tokenIn, _depositor, address(this), _deposited);
        }

        // swap if full calldata is provided
        if (_hasMore) {
            _deposited = exactInputToSelf(_deposited, _swapPath);
            _tokenCollateral = _swapPath.getLastToken();
        } else {
            _tokenCollateral = _tokenIn;
        }
        // cast to array as comptroller requires
        address[] memory collaterlArray = new address[](1);
        collaterlArray[0] = cToken(_tokenCollateral);
        // // configure collateral
        getComptroller().enterMarkets(collaterlArray);
        // set owner
        OWNER = _depositor;
        return uint128(_deposited);
    }

    struct OpenPositionParams {
        bytes path;
        uint128 amountIn;
    }

    function _openPosition(uint128 amountIn, bytes memory path) internal returns (uint128 amountOut) {
        address tokenIn; address tokenOut;uint24 fee;

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

        amountOut = AMOUNT_CACHED;
        AMOUNT_CACHED = DEFAULT_AMOUNT_CACHED;
    }

    struct ClosePositionParams {
        bytes path;
        uint128 amountToRepay;
        uint128 amountInMaximum;
    }

    function borrowBalanceCurrent(address underlying) internal virtual override returns (uint256) {
        return ICompoundTypeCERC20(cToken(underlying)).borrowBalanceCurrent(address(this));
    }
}
