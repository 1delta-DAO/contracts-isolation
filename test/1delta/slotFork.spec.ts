import { expect } from "chai";
import { BigNumber } from "ethers";
import { formatEther } from "ethers/lib/utils";
import { VixInitializeAggregator__factory, VixSlotFactory__factory } from "../../types";
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


    const fat = await new VixSlotFactory__factory(signer).attach('0xa58d5f9397fE1C65EfE72f5fBC95C1A957418F58')
    const d = await fat.getSlots('0x999999833d965c275A2C102a4Ebf222ca938546f')

    console.log("slots", d)

    console.log("Get Slot")

    const slot = await new VixInitializeAggregator__factory(signer).attach('0x20e3e8ec946124DeD47dbA0622EE5Ef930969fc6')

    const data = await slot.getDetails()
    console.log("data", data.collateralSwapped.toString(), data.debtSwapped.toString())
})