// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;
pragma abicoder v2;

struct ExactInputMultiParams {
    bytes path;
    uint256 amountIn;
    uint256 amountOutMinimum;
}

struct ExactOutputMultiParams {
    bytes path;
    uint256 amountOut;
    uint256 amountInMaximum;
}

struct MinimalExactInputMultiParams {
    bytes path;
    uint256 amountIn;
}

struct MinimalExactOutputMultiParams {
    bytes path;
    uint256 amountOut;
}

struct SwapCallbackData {
    bytes path;
    address payer;
}

struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 amountIn;
}

struct ExactInputParams {
    bytes path;
    address recipient;
    uint256 amountIn;
}

struct ExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 amountOut;
}

struct ExactOutputParams {
    bytes path;
    address recipient;
    uint256 amountOut;
}
