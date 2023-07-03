// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.18;

import "../utils/SignatureValidator.sol";

contract MockSignatureValidator is SignatureValidator {
    constructor() SignatureValidator() {}

    function checkSig(
        address owner,
        address slot,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        validateSignature(owner, slot, deadline, v, r, s);
    }
}
