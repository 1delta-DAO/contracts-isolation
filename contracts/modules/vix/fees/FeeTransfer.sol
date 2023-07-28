// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {TokenTransfer} from "../../../utils/TokenTransfer.sol";

// this is the interface we call through assembly
interface IProtocolFeeCollector {
    function getProtocolShare() external view returns (uint256);
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
        uint128 partnerFee; 
        uint128 protocolFee;
        assembly {
            if gt(fee, 250) {
                // maximum is 250bp or 2.5%
                mstore(0, 0x927dd1a7)
                revert(0, 4) // revert with feeTooHigh()
            }

            let params := mload(0x40)

            // We store 0x24 bytes, so we increment the free memory pointer
            mstore(0x40, add(params, 0x24))

            // Store fnSig (=bytes4(abi.encodeWithSignature("getProtocolShare()"))) at params
            // - here we store 32 bytes : 4 bytes of fnSig and 28 bytes of RIGHT padding
            mstore(params, 0x7161854700000000000000000000000000000000000000000000000000000000)

            // call to feeOperator
            let success := staticcall(4000, collector, params, 0x24, params, 0x20)

            if iszero(success) {
                revert(params, 0x40)
            }

            // load the retrieved protocol share
            let share := mload(params)
            let totalFee := mul(fee, amount)

            partnerFee := div(
                mul(sub(10000, share), totalFee),
                100000000
            )
            protocolFee := div(
                mul(share, totalFee),
                100000000
            )
        }

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
        uint128 partnerFee; 
        uint128 protocolFee;
        assembly {
            if gt(fee, 250) {
                // maximum is 250bp or 2.5%
                mstore(0, 0x927dd1a7)
                revert(0, 4) // revert with feeTooHigh()
            }

            let params := mload(0x40)

            // We store 0x24 bytes, so we increment the free memory pointer
            mstore(0x40, add(params, 0x24))

            // Store fnSig (=bytes4(abi.encodeWithSignature("getProtocolShare()"))) at params
            // - here we store 32 bytes : 4 bytes of fnSig and 28 bytes of RIGHT padding
            mstore(params, 0x7161854700000000000000000000000000000000000000000000000000000000)

            // call to feeOperator
            let success := staticcall(4000, collector, params, 0x24, params, 0x20)

            if iszero(success) {
                revert(params, 0x40)
            }

            // load the retrieved protocol share
            let share := mload(params)
            let totalFee := mul(fee, amount)

            partnerFee := div(
                mul(sub(10000, share), totalFee),
                100000000
            )
            protocolFee := div(
                mul(share, totalFee),
                100000000
            )
        }
        _transferEth(payable(recipient), partnerFee);
        _transferEth(payable(collector), protocolFee);
        return amount - partnerFee - protocolFee;
    }
}
