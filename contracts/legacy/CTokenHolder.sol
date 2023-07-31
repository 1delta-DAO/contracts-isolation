// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.21;

/******************************************************************************\
* Author: Achthar
/******************************************************************************/

import {ICompoundTypeCERC20} from "../interfaces/compound/ICompoundTypeCERC20.sol";
import {ICompoundTypeCEther} from "../interfaces/compound/ICompoundTypeCEther.sol";
import {IComptroller} from "../interfaces/compound/IComptroller.sol";

// solhint-disable max-line-length

/// @title Abstract module for handling transfers related to a Compound-type lending protocol
abstract contract CTokenHolder {
    function cToken(address underlying) internal view virtual returns (address);

    function cEther() internal view virtual returns (address);

    function getComptroller() internal view virtual returns (IComptroller);
}
