// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.20;

import {ICompoundTypeCERC20, ICompoundTypeCEther, IComptroller} from "./CompoundTypeInterfaces.sol";

// solhint-disable max-line-length

/// @title Abstract module for handling transfers related to a Compound-type lending protocol
abstract contract zkCTokenHolder {
    function cToken(address underlying) internal view virtual returns (address);

    function cEther() internal view virtual returns (address);

    function getComptroller() internal view virtual returns (IComptroller);
}
