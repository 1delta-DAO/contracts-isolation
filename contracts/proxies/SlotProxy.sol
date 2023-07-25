// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/******************************************************************************\
* Author: Achthar - 1delta.io
* Proxy for diamond-like slots
/******************************************************************************/

contract SlotProxy {
    // provider is immutable and therefore stored in the bytecode
    address private immutable MODULE_PROVIDER;

    // the constructor only initializes the module provider
    // the modules are provided by views in this module provider contract
    constructor(address provider) {
        // assign immutable
        MODULE_PROVIDER = provider;
    }

    // Find module for function that is called and execute the
    // function if a module is found and return any value.
    fallback() external payable {
        bytes4 callSignature = msg.sig;
        address moduleSlot = MODULE_PROVIDER;
        assembly {
            // 0) RECEIVE ETH
            // we implement receive() in the fallback
            let cdlen := calldatasize()
            // equivalent of receive() external payable {}
            if iszero(cdlen) {
                return(0, 0)
            }

            // 1) FETCH MODULE
            // Get the free memory address with the free memory pointer
            let params := mload(0x40)

            // We store 0x24 bytes, so we increment the free memory pointer
            // by that exact amount to keep things in order
            mstore(0x40, add(params, 0x24))

            // Store fnSig (=bytes4(abi.encodeWithSignature("selectorToModule(bytes4)"))) at params
            // - here we store 32 bytes : 4 bytes of fnSig and 28 bytes of RIGHT padding
            mstore(params, 0xd88f725a00000000000000000000000000000000000000000000000000000000)

            // Store callSignature at params + 0x4 : overwriting the 28 bytes of RIGHT padding included before
            mstore(add(params, 0x4), callSignature)

            // gas : 5000 for module fetch
            // address : moduleSlot -> moduleProvider
            // argsOffset : encoded : msg.sig
            // argsSize : 0x24
            // retOffset : params
            // retSize : address size
            let success := staticcall(5000, moduleSlot, params, 0x24, params, 0x20)

            if iszero(success) {
                revert(params, 0x40)
            }

            // overwrite the moduleSlot parameter with the fetched module address (if valid)
            moduleSlot := mload(params)

            // revert if module address is zero
            if iszero(moduleSlot) {
                revert(0, 0)
            }

            // 2) EXECUTE DELEGATECALL ON FETCHED MODULE
            // copy function selector and any arguments
            calldatacopy(0, 0, cdlen)
            // execute function call using the module
            success := delegatecall(gas(), moduleSlot, 0, cdlen, 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch success
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
