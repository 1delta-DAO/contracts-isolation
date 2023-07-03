import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { expandTo18Decimals } from "../../uniswap-v3/core/shared/utilities";
import { CompoundFixture } from "./compoundFixture";

export const ONE_18 = BigNumber.from(10).pow(18)


export async function feedCompound(
    signer: SignerWithAddress,
    compound: CompoundFixture
) {
    for (let i = 0; i < compound.underlyings.length; i++) {
        const tok = compound.underlyings[i]
        const cTok = compound.cTokens[i]
        await compound.comptroller.connect(signer).enterMarkets([cTok.address])
        await tok.connect(signer).approve(cTok.address, ethers.constants.MaxUint256)
        await cTok.connect(signer).mint(expandTo18Decimals(1_000_000))
    }

    await compound.cEther.connect(signer).mint({ value: expandTo18Decimals(100) })
}

export async function feedCompoundETH(
    signer: SignerWithAddress,
    compound: CompoundFixture) {
    await compound.cEther.connect(signer).mint({ value: expandTo18Decimals(1_000) })
}