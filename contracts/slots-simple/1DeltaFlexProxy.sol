// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IImplementationProvider {
    function getImplementation() external view returns (address);
}

contract OneDeltaFlexProxy {
    address private immutable LOGIC_PROVIDER;

    constructor(address _logicProvider) {
        LOGIC_PROVIDER = _logicProvider;
    }

    function _delegate(address implementation) internal virtual {
        assembly {
            // Copy msg.data. We take full control of memory in this inline assembly
            // block because it will not return to Solidity code. We overwrite the
            // Solidity scratch pad at memory position 0.
            calldatacopy(0, 0, calldatasize())

            // Call the implementation.
            // out and outsize are 0 because we don't know the size yet.
            let result := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)

            // Copy the returned data.
            returndatacopy(0, 0, returndatasize())

            switch result
            // delegatecall returns 0 on error.
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    function _fallback() internal virtual {
        _delegate(IImplementationProvider(LOGIC_PROVIDER).getImplementation());
    }

    fallback() external payable virtual {
        _fallback();
    }

    receive() external payable virtual {
        _fallback();
    }
}
