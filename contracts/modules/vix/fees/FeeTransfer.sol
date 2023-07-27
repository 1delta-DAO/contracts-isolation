// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {TokenTransfer} from "../../../utils/TokenTransfer.sol";

interface IProtocolFeeCollector {
    function getFeeSplit(uint256 amount, uint32 fee) external view returns (uint128 partnerFee, uint128 protocolFee);
}

contract FeeTransfer is TokenTransfer {
    address immutable PROTOCOL_FEE_COLLECTOR;

    constructor(address _protocolFeeCollector) {
        PROTOCOL_FEE_COLLECTOR = _protocolFeeCollector;
    }

    function applyFeeAndTransfer(
        address asset,
        uint256 amount,
        address recipient,
        uint32 fee
    ) internal returns (uint256) {
        // if recipient not provided or fee is zero, no fee is applied
        if (recipient == address(0) || fee == 0) {
            return amount;
        }
        // otherwise, fee split is determined and distributed
        address collector = PROTOCOL_FEE_COLLECTOR;
        (uint128 partnerFee, uint128 protocolFee) = IProtocolFeeCollector(collector).getFeeSplit(amount, fee);
        
        _transferERC20Tokens(asset, recipient, partnerFee);
        _transferERC20Tokens(asset, collector, protocolFee);
        return amount - partnerFee - protocolFee;
    }

    function applyFeeAndTransferEther(
        uint256 amount,
        address recipient,
        uint32 fee
    ) internal returns (uint256) {
        // if recipient not provided or fee is zero, no fee is applied
        if (recipient == address(0) || fee == 0) {
            return amount;
        }
        // otherwise, fee split is determined and distributed
        address collector = PROTOCOL_FEE_COLLECTOR;
        (uint128 partnerFee, uint128 protocolFee) = IProtocolFeeCollector(collector).getFeeSplit(amount, fee);
        _transferEth(payable(recipient), partnerFee);
        _transferEth(payable(collector), protocolFee);
        return amount - partnerFee - protocolFee;
    }
}
