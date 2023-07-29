// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

import {ICompoundTypeCERC20, ICompoundTypeCEther, IComptroller} from "./CompoundTypeInterfaces.sol";

interface IDataProvider {
    function oToken(address _underlying) external view returns (address token);

    function getComptroller() external view returns (IComptroller);

    function oEther() external view returns (address);

    function oTokens(address _underlying, address _otherUnderlying) external view returns (address token, address tokenOther);

    function oTokenAndOEther(address _underlying) external view returns (address oToken, address oEther);
}
