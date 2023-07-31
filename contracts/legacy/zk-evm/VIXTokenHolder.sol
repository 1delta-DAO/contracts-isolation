// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

import {ICompoundTypeCERC20, ICompoundTypeCEther, IComptroller} from "./CompoundTypeInterfaces.sol";

/**
 * Contract that holds immutable compound V2 stye token data
 */
abstract contract VIXTokenHolder {
    address private immutable USDC = 0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035;
    address private immutable USDT = 0x1E4a5963aBFD975d8c9021ce480b42188849D41d;
    address private immutable MATIC = 0xa2036f0538221a77A3937F1379699f44945018d0;

    address private immutable oUSDC = 0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B;
    address private immutable oUSDT = 0xad41C77d99E282267C1492cdEFe528D7d5044253;
    address private immutable oMATIC = 0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76;

    address private immutable oETH = 0xee1727f5074E747716637e1776B7F7C7133f16b1;

    address private immutable COMPTROLLER = 0x6EA32f626e3A5c41547235ebBdf861526e11f482;

    function cToken(address _underlying) internal view returns (address) {
        // USDC
        if (_underlying == USDC) return oUSDC;
        // MATIC
        else if (_underlying == MATIC) return oMATIC;
        // USDT
        else if (_underlying == USDT) return oUSDT;
        else revert("IU");
    }

    function getComptroller() internal view returns (IComptroller) {
        return IComptroller(COMPTROLLER);
    }

    function cEther() internal view returns (address) {
        return oETH;
    }
}
