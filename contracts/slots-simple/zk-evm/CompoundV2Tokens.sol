// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {ICompoundTypeCEther} from "../../interfaces/compound/ICompoundTypeCEther.sol";
import {IComptroller} from "../../interfaces/compound/IComptroller.sol";

/**
 * Contract that holds immutable compound V2 stye token data
 */
abstract contract CompoundV2TokenHolder {
    address internal immutable token0;
    address internal immutable token1;
    address internal immutable token2;
    address internal immutable token3;
    address internal immutable token4;
    address internal immutable token5;

    address internal immutable cToken0;
    address internal immutable cToken1;
    address internal immutable cToken2;
    address internal immutable cToken3;
    address internal immutable cToken4;
    address internal immutable cToken5;

    address internal immutable _cEther;

    IComptroller internal immutable comptroller;

    constructor(
        address[] memory _tokens,
        address[] memory _cTokens,
        address _cNative,
        IComptroller _comptroller,
        uint256 numTokens
    ) {
        token0 = _tokens[0];
        token1 = _tokens[1];
        token2 = numTokens > 2 ? _tokens[2] : address(0);
        token3 = numTokens > 3 ? _tokens[3] : address(0);
        token4 = numTokens > 4 ? _tokens[4] : address(0);
        token5 = numTokens > 5 ? _tokens[5] : address(0);

        cToken0 = _cTokens[0];
        cToken1 = _cTokens[1];
        cToken2 = numTokens > 2 ? _cTokens[2] : address(0);
        cToken3 = numTokens > 3 ? _cTokens[3] : address(0);
        cToken4 = numTokens > 4 ? _cTokens[4] : address(0);
        cToken5 = numTokens > 5 ? _cTokens[5] : address(0);

        _cEther = _cNative;
        comptroller = _comptroller;
    }

    function _cToken(address _underlying) internal view returns (address) {
        if (_underlying == token0) return cToken0;
        else if (_underlying == token1) return cToken1;
        else if (_underlying == token2) return cToken2;
        else if (_underlying == token3) return cToken3;
        else if (_underlying == token4) return cToken4;
        else if (_underlying == token4) return cToken4;
        else if (_underlying == token5) return cToken5;
        else revert("IU");
    }

    function _getComptroller() internal view returns (IComptroller) {
        return IComptroller(comptroller);
    }
}
