// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/**
 * Contract that holds immutable aave V3 stye token data
 */
contract AaveTokenHolder {
    address internal immutable token0;
    address internal immutable token1;
    address internal immutable token2;
    address internal immutable token3;
    address internal immutable token4;
    address internal immutable token5;
    address internal immutable token6;
    address internal immutable token7;
    address internal immutable token8;
    address internal immutable token9;
    address internal immutable token10;
    address internal immutable token11;

    address internal immutable aToken0;
    address internal immutable aToken1;
    address internal immutable aToken2;
    address internal immutable aToken3;
    address internal immutable aToken4;
    address internal immutable aToken5;
    address internal immutable aToken6;
    address internal immutable aToken7;
    address internal immutable aToken8;
    address internal immutable aToken9;
    address internal immutable aToken10;
    address internal immutable aToken11;

    address internal immutable vToken0;
    address internal immutable vToken1;
    address internal immutable vToken2;
    address internal immutable vToken3;
    address internal immutable vToken4;
    address internal immutable vToken5;
    address internal immutable vToken6;
    address internal immutable vToken7;
    address internal immutable vToken8;
    address internal immutable vToken9;
    address internal immutable vToken10;
    address internal immutable vToken11;

    address internal immutable sToken0;
    address internal immutable sToken1;
    address internal immutable sToken2;
    address internal immutable sToken3;
    address internal immutable sToken4;
    address internal immutable sToken5;
    address internal immutable sToken6;
    address internal immutable sToken7;
    address internal immutable sToken8;
    address internal immutable sToken9;
    address internal immutable sToken10;
    address internal immutable sToken11;

    address internal immutable aavePool;

    constructor(
        address[] memory _tokens,
        address[] memory _aTokens,
        address[] memory _vTokens,
        address[] memory _sTokens,
        address _pool,
        uint256 numTokens
    ) {
        token0 = _tokens[0];
        token1 = _tokens[1];
        token2 = numTokens > 2 ? _tokens[2] : address(0);
        token3 = numTokens > 3 ? _tokens[3] : address(0);
        token4 = numTokens > 4 ? _tokens[4] : address(0);
        token5 = numTokens > 5 ? _tokens[5] : address(0);
        token6 = numTokens > 6 ? _tokens[6] : address(0);
        token7 = numTokens > 7 ? _tokens[7] : address(0);
        token8 = numTokens > 8 ? _tokens[8] : address(0);
        token9 = numTokens > 9 ? _tokens[9] : address(0);
        token10 = numTokens > 10 ? _tokens[10] : address(0);
        token11 = numTokens > 11 ? _tokens[11] : address(0);

        aToken0 = _aTokens[0];
        aToken1 = _aTokens[1];
        aToken2 = numTokens > 2 ? _aTokens[2] : address(0);
        aToken3 = numTokens > 3 ? _aTokens[3] : address(0);
        aToken4 = numTokens > 4 ? _aTokens[4] : address(0);
        aToken5 = numTokens > 5 ? _aTokens[5] : address(0);
        aToken6 = numTokens > 6 ? _aTokens[6] : address(0);
        aToken7 = numTokens > 7 ? _aTokens[7] : address(0);
        aToken8 = numTokens > 8 ? _aTokens[8] : address(0);
        aToken9 = numTokens > 9 ? _aTokens[9] : address(0);
        aToken10 = numTokens > 10 ? _aTokens[10] : address(0);
        aToken11 = numTokens > 11 ? _aTokens[11] : address(0);

        vToken0 = _vTokens[0];
        vToken1 = _vTokens[1];
        vToken2 = numTokens > 2 ? _vTokens[2] : address(0);
        vToken3 = numTokens > 3 ? _vTokens[3] : address(0);
        vToken4 = numTokens > 4 ? _vTokens[4] : address(0);
        vToken5 = numTokens > 5 ? _vTokens[5] : address(0);
        vToken6 = numTokens > 6 ? _vTokens[6] : address(0);
        vToken7 = numTokens > 7 ? _vTokens[7] : address(0);
        vToken8 = numTokens > 8 ? _vTokens[8] : address(0);
        vToken9 = numTokens > 9 ? _vTokens[9] : address(0);
        vToken10 = numTokens > 10 ? _vTokens[10] : address(0);
        vToken11 = numTokens > 11 ? _vTokens[11] : address(0);

        sToken0 = _sTokens[0];
        sToken1 = _sTokens[1];
        sToken2 = numTokens > 2 ? _sTokens[2] : address(0);
        sToken3 = numTokens > 3 ? _sTokens[3] : address(0);
        sToken4 = numTokens > 4 ? _sTokens[4] : address(0);
        sToken5 = numTokens > 5 ? _sTokens[5] : address(0);
        sToken6 = numTokens > 6 ? _sTokens[6] : address(0);
        sToken7 = numTokens > 7 ? _sTokens[7] : address(0);
        sToken8 = numTokens > 8 ? _sTokens[8] : address(0);
        sToken9 = numTokens > 9 ? _sTokens[9] : address(0);
        sToken10 = numTokens > 10 ? _sTokens[10] : address(0);
        sToken11 = numTokens > 11 ? _sTokens[11] : address(0);

        aavePool = _pool;
    }

    function _aToken(address _underlying) internal view returns (address) {
        if (_underlying == token0) return aToken0;
        else if (_underlying == token1) return aToken1;
        else if (_underlying == token2) return aToken2;
        else if (_underlying == token3) return aToken3;
        else if (_underlying == token4) return aToken4;
        else if (_underlying == token4) return aToken4;
        else if (_underlying == token5) return aToken5;
        else if (_underlying == token6) return aToken6;
        else if (_underlying == token7) return aToken7;
        else if (_underlying == token8) return aToken8;
        else if (_underlying == token9) return aToken9;
        else if (_underlying == token10) return aToken10;
        else if (_underlying == token11) return aToken11;
        else revert("no aToken for this underlying");
    }

    function _vToken(address _underlying) internal view returns (address) {
        if (_underlying == token0) return vToken0;
        else if (_underlying == token1) return vToken1;
        else if (_underlying == token2) return vToken2;
        else if (_underlying == token3) return vToken3;
        else if (_underlying == token4) return vToken4;
        else if (_underlying == token4) return vToken4;
        else if (_underlying == token5) return vToken5;
        else if (_underlying == token6) return vToken6;
        else if (_underlying == token7) return vToken7;
        else if (_underlying == token8) return vToken8;
        else if (_underlying == token9) return vToken9;
        else if (_underlying == token10) return vToken10;
        else if (_underlying == token11) return vToken11;
        else revert("no vToken for this underlying");
    }

    function _sToken(address _underlying) internal view returns (address) {
        if (_underlying == token0) return sToken0;
        else if (_underlying == token1) return sToken1;
        else if (_underlying == token2) return sToken2;
        else if (_underlying == token3) return sToken3;
        else if (_underlying == token4) return sToken4;
        else if (_underlying == token4) return sToken4;
        else if (_underlying == token5) return sToken5;
        else if (_underlying == token6) return sToken6;
        else if (_underlying == token7) return sToken7;
        else if (_underlying == token8) return sToken8;
        else if (_underlying == token9) return sToken9;
        else if (_underlying == token10) return sToken10;
        else if (_underlying == token11) return sToken11;
        else revert("no sToken for this underlying");
    }
}
