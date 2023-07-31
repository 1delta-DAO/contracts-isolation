// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import "../../external-protocols/openzeppelin/access/Ownable.sol";
import {ICompoundTypeCERC20, ICompoundTypeCEther, IComptroller} from "../zk-evm/CompoundTypeInterfaces.sol";

contract CompoundDataProvider is Ownable {
    // events
    event OTokenSet(address underlying, address oToken);
    event OEtherSet(address oEther);
    event ComptrollerSet(address comptroller);

    // error
    error InvalidUnderlying();

    mapping(address => address) private _cTokens;
    address private _comptroller;
    address private _cEther;

    constructor() Ownable() {}

    function cToken(address _underlying) external view returns (address token) {
        token = _cTokens[_underlying];
        if (token == address(0)) revert InvalidUnderlying();
    }

    function getComptroller() external view returns (IComptroller) {
        return IComptroller(_comptroller);
    }

    function cEther() external view returns (address) {
        return _cEther;
    }

    /** Setters - Only Owner can interact */

    function setOToken(address underlying, address _newOToken) external onlyOwner {
        _cTokens[underlying] = _newOToken;
        emit OTokenSet(underlying, _newOToken);
    }

    function setOEther(address _newOEther) external onlyOwner {
        _cEther = _newOEther;
        emit OEtherSet(_newOEther);
    }

    function setComptroller(address _newComptroller) external onlyOwner {
        _comptroller = _newComptroller;
        emit ComptrollerSet(_newComptroller);
    }
}
