// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.20;

/******************************************************************************\
* Author: Achthar
/******************************************************************************/

// solhint-disable max-line-length

/// @title Module holding uniswapV3 data
abstract contract UniswapDataHolder {
    address internal immutable v3Factory;

    constructor(address _factory) {
        v3Factory = _factory;
    }
}
