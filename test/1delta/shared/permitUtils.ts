import { splitSignature } from "ethers/lib/utils"
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20, ERC20MockWithPermit, SignatureValidator } from "../../../types"
import { BigNumber } from "ethers";
import { ethers } from "ethers";

const EIP712_DOMAIN_TYPE = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
]

const EIP2612_TYPE = [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
]

const permitVersion = '1'

/**
 * Produces signature for ERC20Permit using the signer object
 * @param provider ethers signer to sign message
 * @param spender speder permit params
 * @param token token to sign
 * @param amount amount to sign for
 * @returns 
 */
export const produceSig = async (
    provider: SignerWithAddress,
    spender: string,
    token: ERC20MockWithPermit,
    amount: string
) => {
    const account = provider.address
    const nonce = await token.nonces(account)
    const message = {
        owner: account,
        spender,
        value: amount,
        nonce,
        deadline: ethers.constants.MaxUint256,
    }
    const chainId = await provider.getChainId()
    const name = await token.name()
    const domain = {
        name,
        verifyingContract: token.address,
        chainId,
        version: permitVersion
    }


    const rawData = {
        types: {
            EIP712Domain: EIP712_DOMAIN_TYPE,
            Permit: EIP2612_TYPE,
        },
        domain,
        primaryType: 'Permit',
        message,
    }


    const signature = await provider._signTypedData(domain, { Permit: rawData.types.Permit }, rawData.message)

    const split = splitSignature(signature)
    return { signature, split }
}


const EIP2612_CLOSE_TYPE = [
    { name: 'owner', type: 'address' },
    { name: 'slot', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
]

/**
 * Produces signature for ERC20Permit using the signer object
 * @param provider ethers signer to sign message
 * @param spender speder permit params
 * @param token token to sign
 * @param amount amount to sign for
 * @returns 
 */
export const produceCloseSig = async (
    signer: SignerWithAddress,
    slot: any
) => {
    const account = signer.address
    const nonce = await slot.nonces(account)

    const message = {
        owner: account,
        slot: slot.address,
        nonce,
        deadline: ethers.constants.MaxUint256,
    }
    const chainId = await signer.getChainId()
    const name = '1deltaSignatureValidator'
    const domain = {
        name,
        verifyingContract: slot.address,
        chainId,
        version: '1'
    }


    const rawData = {
        types: {
            EIP712Domain: EIP712_DOMAIN_TYPE,
            OneDeltaTrade: EIP2612_CLOSE_TYPE,
        },
        domain,
        primaryType: 'OneDeltaTrade',
        message,
    }


    const signature = await signer._signTypedData(domain, { OneDeltaTrade: rawData.types.OneDeltaTrade }, rawData.message)

    const split = splitSignature(signature)
    return { signature, split }
}

