// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import "../../../external-protocols/openzeppelin/access/Ownable.sol";
import {ICompoundTypeCERC20, ICompoundTypeCEther, IComptroller, IDataProvider} from "./IDataProvider.sol";

contract DataProvider is Ownable, IDataProvider {
    // events
    event OTokenSet(address underlying, address oToken);
    event OEtherSet(address oEther);
    event ComptrollerSet(address comptroller);

    // error
    error InvalidUnderlying();

    mapping(address => address) private _oTokens;
    address private _comptroller;
    address private _oEther;

    constructor() Ownable() {}

    function oToken(address _underlying) external view returns (address token) {
        token = _oTokens[_underlying];
        if (token == address(0)) revert InvalidUnderlying();
    }

    function getComptroller() external view returns (IComptroller) {
        return IComptroller(_comptroller);
    }

    function oEther() external view returns (address) {
        return _oEther;
    }

    /** Setters - Only Owner can interact */

    function setOToken(address underlying, address _newOToken) external onlyOwner {
        _oTokens[underlying] = _newOToken;
        emit OTokenSet(underlying, _newOToken);
    }

    function setOEther(address _newOEther) external onlyOwner {
        _oEther = _newOEther;
        emit OEtherSet(_newOEther);
    }

    function setComptroller(address _newComptroller) external onlyOwner {
        _comptroller = _newComptroller;
        emit ComptrollerSet(_newComptroller);
    }

    function oTokens(address _underlying, address _otherUnderlying) external view returns (address _oToken, address oTokenOther) {
        _oToken = _oTokens[_underlying];
        oTokenOther = _oTokens[_otherUnderlying];
        if (_oToken == address(0) || oTokenOther == address(0)) revert InvalidUnderlying();
    }

    function oTokenAndOEther(address _underlying) external view returns (address _oToken, address _oEth) {
        _oToken = _oTokens[_underlying];
        if (_oToken == address(0)) revert InvalidUnderlying();
        _oEth = _oEther;
    }
}
