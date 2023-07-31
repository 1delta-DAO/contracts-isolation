// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../../../external-protocols/openzeppelin/utils/cryptography/ECDSA.sol";
import "../../../external-protocols/openzeppelin/utils/cryptography/EIP712.sol";
import "../../../external-protocols/openzeppelin/utils/Counters.sol";

abstract contract SignatureValidator is EIP712 {
    using Counters for Counters.Counter;

    mapping(address => Counters.Counter) private _nonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private constant _TRADE_TYPEHASH = keccak256(
        "OneDeltaTrade(address owner,address slot,uint256 nonce,uint256 deadline)"
        );

    constructor() EIP712("1deltaSignatureValidator", "1") {}

    function validateSignature(
        address owner,
        address slot,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal virtual  {
        require(block.timestamp <= deadline, "SignatureValidator: expired deadline");

        bytes32 structHash = keccak256(abi.encode(
            _TRADE_TYPEHASH, owner, slot, _useNonce(owner), deadline
            ));

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner, "SignatureValidator: invalid signature");
    }

    /**
     * @dev See {ISignatureValidator-nonces}.
     */
    function nonces(address owner) external view virtual  returns (uint256) {
        return _nonces[owner].current();
    }

    /**
     * @dev See {ISignatureValidator-DOMAIN_SEPARATOR}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view  returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev "Consume a nonce": return the current value and increment.
     *
     * _Available since v4.1._
     */
    function _useNonce(address owner) internal virtual returns (uint256 current) {
        Counters.Counter storage nonce = _nonces[owner];
        current = nonce.current();
        nonce.increment();
    }
}
