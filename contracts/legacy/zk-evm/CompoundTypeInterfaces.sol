// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

interface ICompoundTypeCERC20 {
    function mint(uint256 mintAmount) external;

    function redeem(uint256 redeemTokens) external;

    function redeemUnderlying(uint256 redeemAmount) external;

    function borrow(uint256 borrowAmount) external;

    function repayBorrow(uint256 repayAmount) external;

    function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);

    function underlying() external view returns (address);

    function balanceOfUnderlying(address owner) external returns (uint256);

    function borrowBalanceCurrent(address account) external returns (uint256);

    function balanceOf(address owner) external returns (uint256);

    function exchangeRateCurrent() external returns (uint256);
}

interface ICompoundTypeCEther {
    function mint() external payable;

    function redeem(uint256 redeemTokens) external;

    function redeemUnderlying(uint256 redeemAmount) external;

    function borrow(uint256 borrowAmount) external;

    function repayBorrow() external payable;

    function balanceOf(address owner) external returns (uint256);

    function borrowBalanceCurrent(address account) external returns (uint256);
}

interface IComptroller {
    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);
}
