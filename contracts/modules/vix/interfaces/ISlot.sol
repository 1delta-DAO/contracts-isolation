// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

import {VixDetailsStorage, GeneralStorage} from "../VixStorage.sol";

struct InitParams {
    // deposit amounts
    uint128 amountDeposited;
    uint128 minimumAmountDeposited;
    // margin swap params
    uint128 borrowAmount;
    uint128 minimumMarginReceived;
    // contains only the address if pay ccy = collateral
    bytes swapPath;
    // path for margin trade
    bytes marginPath;
    // fee parameters
    address partner;
    uint32 fee;
}

// permit
struct PermitParams {
    address owner;
    address spender;
    uint256 value;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

struct InitParamsWithPermit {
    // deposit amounts
    uint128 minimumAmountDeposited;
    // margin swap params
    uint128 borrowAmount;
    uint128 minimumMarginReceived;
    // contains only the address if pay ccy = collateral
    bytes swapPath;
    // path for margin trade
    bytes marginPath;
    PermitParams permit;
    // fee parameters
    address partner;
    uint32 fee;
}

/**
 *  Slot contract that holds Compound V2 style balances on behalf of users.
 */
interface ISlot {
    function initialize(address owner, InitParams calldata params) external payable;

    function initializeETH(address owner, InitParams calldata params) external payable;

    function close(
        uint128 amountToRepay,
        uint128 amountInMaximum,
        bytes memory path
    ) external payable returns (uint256 amountIn);

    function initializeWithPermit(InitParamsWithPermit calldata params) external payable;

    function repay(uint256 amount) external payable;

    function withdraw(uint256 amount, bool useCollateralTokens) external payable;

    function getOwner() external view returns (address);

    function getDetails() external pure returns (VixDetailsStorage memory details);

    function getGeneral() external pure returns (GeneralStorage memory details);

    function getOTokens() external view returns (address collateralToken, address collateralTokenBorrow);
}
