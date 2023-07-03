// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.20;

/******************************************************************************\
* Author: Achthar
/******************************************************************************/

// solhint-disable max-line-length

/// @title Module holding uniswapV3 data
abstract contract DexData {
    address internal immutable uniswapV3Factory;
    address internal immutable algebraPoolDeployer;

    constructor(address _factory, address _deployer) {
        uniswapV3Factory = _factory;
        algebraPoolDeployer = _deployer;
    }
}
