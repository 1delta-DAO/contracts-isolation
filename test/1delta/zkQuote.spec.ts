import { expect } from "chai";
import { BigNumber } from "ethers";
import { formatEther } from "ethers/lib/utils";
// import { ethers, waffle } from "hardhat";
import { AggregationQuoterLive__factory, AggregationQuoter__factory, DeltaSlot__factory, FlexSlotFactory__factory, ImplementationProvider__factory, TokenWrapped, TokenWrapped__factory } from "../../types";
import { expandTo18Decimals, expandToDecimals } from "../uniswap-v3/core/shared/utilities";
import { FeeAmount } from "../uniswap-v3/periphery/shared/constants";
import { encodePath } from "../uniswap-v3/periphery/shared/path";
import { findBalanceSlot, getSlot } from "./forkUtils";
// const { expect } = require("chai");
const { ethers } = require("hardhat");


const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"
const daiAddress = '0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4'
const wethAddress = '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'
const wbtcAddress = '0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1'

const TEN = BigNumber.from(10)
const toNumber = (n: BigNumber, decs = 18) => {
    return Number(formatEther(n.mul(TEN.pow(18 - decs))))
}

it("Mint USDC", async function () {
    const [signer] = await ethers.getSigners();
    let usdc: any = await ethers.getContractAt("TokenWrapped", usdcAddress);
    const signerAddress = await signer.getAddress();
    console.log("signer", signer.address)

    // automatically find mapping slot
    const mappingSlot = await findBalanceSlot(usdc)
    console.log("Found USDC.balanceOf slot: ", mappingSlot)

    // calculate balanceOf[signerAddress] slot
    const signerBalanceSlot = getSlot(signerAddress, mappingSlot)
    // console.log("SLot", signerBalanceSlot)
    // set it to the value
    const value: any = 123456789
    await ethers.provider.send(
        "hardhat_setStorageAt",
        [
            usdc.address,
            signerBalanceSlot,
            ethers.utils.hexlify(ethers.utils.zeroPad(value, 32))
        ]
    )

    // check that the user balance is equal to the expected value
    expect(await usdc.balanceOf(signerAddress)).to.be.eq(value)


    console.log("Quote")
    const quoter = await new AggregationQuoterLive__factory(signer).deploy()

    const path = encodePath(
        [usdcAddress, wbtcAddress, wethAddress],
        [FeeAmount.MEDIUM, FeeAmount.ALGEBRA]

    )
    const swapAmount = 1000000

    const ALG_FF_FACTORY_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
    const ALG_POOL_CODE_HASH = '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4';

    const DOV_FF_FACTORY_ADDRESS = '0xdE474Db1Fa59898BC91314328D29507AcD0D593c';
    const DOV_POOL_INIT_CODE_HASH = '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a';

    const quoter2 = await new AggregationQuoter__factory(signer).deploy(
        ALG_FF_FACTORY_ADDRESS,
        DOV_FF_FACTORY_ADDRESS,
        ALG_POOL_CODE_HASH,
        DOV_POOL_INIT_CODE_HASH

    )

    const quote = await quoter2.callStatic.quoteExactOutput(path, swapAmount)
    console.log("Quote received", quote.toString())
})