// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;


// pool and tokens
import "../../../external-protocols/aave-v3-core/interfaces/IPool.sol";
import "../../../external-protocols/aave-v3-core/interfaces/IAToken.sol";
import "../../../external-protocols/aave-v3-core/interfaces/IVariableDebtToken.sol";
import "../../../external-protocols/aave-v3-core/protocol/libraries/configuration/ReserveConfiguration.sol";

// flash loan interface
import "../../../interfaces/IFlashLoanReceiverAave.sol";

import "../../../external-protocols/openzeppelin/token/ERC20/extensions/IERC20Permit.sol";

/**
 * sets up Aave such that all operations can be conducted
 * - opening a position
 *      - flash loan collateral
 *      - deposit collateral
 *      - borrow required funds (precalculated, approximate)
 *      - swap the borrowed funds to the currenxy borrowed in the flash loan
 *      - repay flash loan
 * - closing a position
 *      - flash loan borrow amount to be repaid
 *      - repay obtained funds
 *      - withdraw precomputed collateral amount
 *      - swap the withdrawn amount to the borrow (& flash loan) currency
 *      - repay flash loan
 */
contract AaveHandler is IFlashLoanSimpleReceiver {
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

    address immutable AAVE_POOL;
    address immutable ONE_INCH;
    address immutable WRAPPED_NATIVE;
    // pair config
    address public COLLATERAL;
    address public BORROW;

    // owner
    address public OWNER;
    uint8 selectedInterestRateMode;

    constructor(
        address _aavePool,
        address _wrappedNative,
        address _1inchRouter
    ) {
        AAVE_POOL = _aavePool;
        WRAPPED_NATIVE = _wrappedNative;
        ONE_INCH = _1inchRouter;
    }

    struct PermitParams {
        address owner;
        address spender;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // Flash loan call to open leveraged position
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // validate initiator
        require(initiator == address(this), "INVALID INITIATOR");
        address pool = AAVE_POOL;
        address collateral = COLLATERAL;
        if (asset == collateral) {
            // decode params
            (bytes memory data, uint128 borrowAmount, uint8 interestRateMode) = abi.decode(params, (bytes, uint128, uint8));
            selectedInterestRateMode = interestRateMode;

            // deposit flashed reserve
            IPool(pool).deposit(collateral, amount, address(this), 0);

            // borrow target funds
            IPool(pool).borrow(BORROW, borrowAmount, interestRateMode, 0, address(this));

            // execute and check swap
            (bool success, bytes memory result) = ONE_INCH.call(data);
            require(success, "SWAP FAILED");

            // decode amount received
            uint256 amountReceived = abi.decode(result, (uint256));
            uint256 amountToReturn = amount + premium;

            // validate that the repayment can be moved forward with
            require(amountReceived >= amountToReturn, "INSUFFICIENT FLASH REPAY BALLANCE");

            // collect dust
            unchecked {
                amountReceived = amountReceived - amountToReturn;
            }

            // deposit dust
            if (amountReceived > 0) IPool(pool).deposit(collateral, amountReceived, address(this), 0);
        } else {
            // decode params - target withdraw has to be sufficient such that the funds can be repaid
            (bytes memory data, uint128 targetWithdraw, ) = abi.decode(params, (bytes, uint128, uint8));

            // repay flashed reserve
            IPool(pool).repay(asset, amount, selectedInterestRateMode, address(this));

            // withdraw funds dust
            IPool(pool).withdraw(collateral, targetWithdraw, address(this));
            // execute and check swap
            (bool success, bytes memory result) = ONE_INCH.call(data);
            require(success, "SWAP FAILED");

            // decode amount received
            uint256 amountReceived = abi.decode(result, (uint256));
            uint256 amountToReturn = amount + premium;

            // validate that the repayment can be moved forward with
            require(amountReceived >= amountToReturn, "INSUFFICIENT FLASH REPAY BALLANCE");

            // collect dust
            unchecked {
                amountReceived = amountReceived - amountToReturn;
            }

            // transfer leftovers to user
            IERC20(asset).transfer(OWNER, amountReceived);

            // return excess collateral if any
            uint256 balance = IERC20(collateral).balanceOf(address(this));
            if (balance > 0) IERC20(collateral).transfer(OWNER, balance);
        }
        return true;
    }

    function validateAndSetEMode(
        address asset0,
        address asset1,
        address pool
    ) public {
        uint8 eMode = getEMode(asset0);
        if (eMode == getEMode(asset1)) {
            IPool(pool).setUserEMode(eMode);
        }
    }

    function getEMode(address asset) public view returns (uint8 eMode) {
        DataTypes.ReserveConfigurationMap memory config = IPool(AAVE_POOL).getConfiguration(asset);
        eMode = uint8(config.getEModeCategory());
    }
}
