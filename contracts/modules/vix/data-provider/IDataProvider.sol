// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

import {ICompoundTypeCERC20, ICompoundTypeCEther, IComptroller} from "./CompoundTypeInterfaces.sol";

interface IDataProvider {
    function cToken(address _underlying) external view returns (address token);

    function getComptroller() external view returns (IComptroller);

    function cEther() external view returns (address);
}
