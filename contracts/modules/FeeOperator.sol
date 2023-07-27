// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import "../external-protocols/openzeppelin/access/Ownable.sol";
import {TokenTransfer, IERC20} from "../utils/TokenTransfer.sol";

contract FeeOperator is Ownable, TokenTransfer {
    error feeTooHigh();
    uint256 public protocolShare;

    constructor() Ownable() {}

    // calculate fee split
    // checks only that fee is not higher than 2.5%
    // does not check for overflows - a check should occur when applying the fees to the amount
    function getFeeSplit(uint256 amount, uint32 fee) external view returns (uint128 partnerFee, uint128 protocolFee) {
        assembly {
            if gt(fee, 250) {
                // maximum is 250bp or 2.5%
                mstore(0, 0x927dd1a7)
                revert(0, 4) // revert with feeTooHigh()
            }
            let totalFee := mul(fee, amount)
            let share := sload(protocolShare.slot)
            partnerFee := div(
                mul(sub(10000, share), totalFee),
                100000000
            )
            protocolFee := div(
                mul(share, totalFee),
                100000000
            )
        }
    }

    function setProtocolShare(uint256 share) external onlyOwner {
        require(share < 8000, "Share too high"); // 80% is the limit
        protocolShare = share;
    }

    function withdraw(address asset, address payable recipient) external onlyOwner {
        address _asset = asset;
        if (asset == address(0)) {
            payable(recipient).transfer(address(this).balance);
        } else {
            _transferERC20Tokens(_asset, recipient, IERC20(_asset).balanceOf(address(this)));
        }
    }

    receive() external payable {}
}
