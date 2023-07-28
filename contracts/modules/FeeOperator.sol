// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import "../external-protocols/openzeppelin/access/Ownable.sol";
import {TokenTransfer, IERC20} from "../utils/TokenTransfer.sol";

contract FeeOperator is Ownable, TokenTransfer {
    event ProtocolShareChanged(uint256 initialShare, uint256 futureShare, uint256 timestamp);

    error feeTooHigh();

    // protocol fee share parameters
    uint256 private _protocolShare;
    uint256 _lastChangeTime;

    uint256 internal constant MIN_RAMP_TIME = 1 days; // the time the operator has to wait until a new change
    uint256 internal constant MAX_SHARE = 8000; // maximum fee percentage 10000 = 100%
    uint256 internal constant MAX_SHARE_CHANGE = 100; // maximum change that can be applied in an interval of MIN_RAMP_TIME

    constructor(uint256 share) Ownable() {
        if (share > MAX_SHARE) revert feeTooHigh(); // 80% is the limit
        _protocolShare = share;
        _lastChangeTime = block.timestamp;
    }

    function getProtocolShare() external view returns (uint256) {
        return _protocolShare;
    }

    /**
     * @notice Start ramping up or down share parameter towards given futureShare_ and futureTime_
     * Checks if the change is too rapid, and commits the new share value only when it falls under
     * the limit range.
     * @param _newShare the new A to ramp towards
     */
    function changeShare(uint256 _newShare) external {
        uint256 newShare = _newShare;
        require(block.timestamp >= _lastChangeTime + MIN_RAMP_TIME, "Ramp period");
        require(0 < newShare && newShare < MAX_SHARE, "Share too high");

        uint256 _initiaShare = _protocolShare;

        if (newShare < _initiaShare) {
            require(newShare > _initiaShare + MAX_SHARE_CHANGE, "Change too high");
        } else {
            require(newShare + MAX_SHARE_CHANGE < _initiaShare, "Change too high");
        }

        _protocolShare = newShare;
        _lastChangeTime = block.timestamp;

        emit ProtocolShareChanged(_initiaShare, newShare, block.timestamp);
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
