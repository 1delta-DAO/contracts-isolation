// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable no-inline-assembly */
/* solhint-disable max-line-length */

import {IERC20Permit} from "../../external-protocols/openzeppelin/token/ERC20/extensions/IERC20Permit.sol";
import {SafeCast} from "../../dex-tools/uniswap/libraries/SafeCast.sol";
import {WithVixStorage} from "./VixStorage.sol";
import {IERC20} from "../../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import {ICompoundTypeCEther, ICompoundTypeCERC20, IDataProvider} from "./data-provider/IDataProvider.sol";
import {TokenTransfer} from "../../utils/TokenTransfer.sol";

contract VixDirect is WithVixStorage, TokenTransfer {
    using SafeCast for uint256;

    error Slippage();
    error AlreadyInitialized();

    address private immutable DATA_PROVIDER;
    address private immutable NATIVE_WRAPPER;

    constructor(address _dataProvider, address _weth) {
        DATA_PROVIDER = _dataProvider;
        NATIVE_WRAPPER = _weth;
    }

    /**
     * Allows users to repay some debt of the position.
     * Can also be done by any other party to the benefit of the user.
     */
    function repay(uint256 amount) external payable {
        address debt = gs().debt;
        uint256 _amount = amount;
        if (debt == NATIVE_WRAPPER) {
            _amount = msg.value;
            ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).repayBorrow{value: _amount}();
        } else {
            address _cToken = IDataProvider(DATA_PROVIDER).cToken(debt);
            // approve
            _transferERC20TokensFrom(debt, msg.sender, address(this), _amount);
            IERC20(debt).approve(_cToken, _amount);
            // repay
            ICompoundTypeCERC20(_cToken).repayBorrow(_amount);
        }
    }

    /**
     * Allows users to withdraw directly from the position. Only the owner can withdraw.
     */
    function withdraw(uint256 amount, bool useCTokens) external payable {
        // efficient OnlyOwner() check
        address owner = ads().owner;
        require(msg.sender == owner, "OnlyOwner()");

        address collateral = gs().collateral;
        uint256 _amount = amount;
        if (collateral == NATIVE_WRAPPER) {
            if (useCTokens) {
                ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).redeem(_amount);
                _amount = address(this).balance;

                // transfer all ether in this contract
                payable(owner).transfer(_amount);
            } else {
                ICompoundTypeCEther(IDataProvider(DATA_PROVIDER).cEther()).redeemUnderlying(_amount);

                // transfer selected amount
                payable(owner).transfer(_amount);
            }
        } else {
            address _cToken = IDataProvider(DATA_PROVIDER).cToken(collateral);

            if (useCTokens) {
                ICompoundTypeCERC20(_cToken).redeem(_amount);
                _amount = IERC20(collateral).balanceOf(address(this));

                IERC20(collateral).transfer(owner, _amount);
            } else {
                ICompoundTypeCERC20(_cToken).redeemUnderlying(_amount);

                // transfer the user selected amount
                IERC20(collateral).transfer(owner, _amount);
            }
        }
    }

    // allows the owner to batch contract calls
    function multicall(address[] memory targets, bytes[] calldata data) public payable returns (bytes[] memory results) {
        require(msg.sender == ads().owner, "OnlyOwner()");
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = targets[i].call(data[i]);

            if (!success) {
                // Next 5 lines from https://ethereum.stackexchange.com/a/83577
                if (result.length < 68) revert();
                assembly {
                    result := add(result, 0x04)
                }
                revert(abi.decode(result, (string)));
            }

            results[i] = result;
        }
    }

    /**
     * Transfer a token from the position to the owner - can only be called by owner
     */
    function sweepTokens(address asset) external payable {
        // efficient OnlyOwner() check
        address owner = ads().owner;
        require(msg.sender == owner, "OnlyOwner()");
        address _asset = asset;
        if (_asset == address(0)) {
            uint256 balance = address(this).balance;
            if (balance > 0) _transferEth(payable(owner), balance);
        } else {
            uint256 balance = IERC20(_asset).balanceOf(address(this));
            if (balance > 0) _transferERC20Tokens(_asset, owner, balance);
        }
    }
}
