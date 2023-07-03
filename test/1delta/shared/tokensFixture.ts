import { constants } from 'ethers'
import {
    IWETH9,
    FiatWithPermit,
    FiatWithPermit__factory,
    WETH9__factory
} from '../../../types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export interface TokenFixture {
    wnative: IWETH9
    tokens: FiatWithPermit[]
}

export const tokenFixture: (signer: SignerWithAddress, tokenCount: number) => Promise<TokenFixture> = async (signer: SignerWithAddress, tokenCount: number) => {
    console.log("Deploying token contracts")
    const wnative = await new WETH9__factory(signer).deploy()
    let tokens: FiatWithPermit[] = []
    for (let i = 0; i < tokenCount; i++) {
        const token = await new FiatWithPermit__factory(signer).deploy("Token Nr" + i, "T" + i, 18)
        await token.mint(signer.address, constants.MaxUint256.div(2))
        tokens.push(token)
    }


    tokens.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
    console.log("Tokens deployed")
    return {
        wnative,
        tokens
    }
}
