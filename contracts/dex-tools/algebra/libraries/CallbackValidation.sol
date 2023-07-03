// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "../core/IAlgebraPool.sol";
import "./PoolAddressCalculator.sol";

/// @notice Provides validation for callbacks from Algebra Pools
/// @dev Credit to Uniswap Labs under GPL-2.0-or-later license:
/// https://github.com/Uniswap/v3-periphery
library AlgebraCallbackValidation {
    /// @notice Returns the address of a valid Algebra Pool
    /// @param poolDeployer The contract address of the Algebra pool deployer
    /// @param tokenA The contract address of either token0 or token1
    /// @param tokenB The contract address of the other token
    /// @return pool The Algebra pool contract address
    function verifyCallback(
        address poolDeployer,
        address tokenA,
        address tokenB
    ) internal view returns (IAlgebraPool pool) {
        pool = IAlgebraPool(AlgebraPoolAddressCalculator.computeAlgebraAddress(poolDeployer, tokenA, tokenB));
        require(msg.sender == address(pool));
    }
}
