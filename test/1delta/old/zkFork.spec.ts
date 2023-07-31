import { expect } from "chai";
import { BigNumber } from "ethers";
import { formatEther } from "ethers/lib/utils";
// import { ethers, waffle } from "hardhat";
import { DeltaSlot__factory, FlexSlotFactory__factory, ImplementationProvider__factory, TokenWrapped, TokenWrapped__factory } from "../../../types";
import { findBalanceSlot, getSlot } from "../forkUtils";
// const { expect } = require("chai");
const { ethers } = require("hardhat");


const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"

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

    const usdcContract = usdc as TokenWrapped


    console.log("Deploy implementation provider")
    const implementationProvider = await new ImplementationProvider__factory(signer).deploy(signer.address)
    await implementationProvider.deployed()

    console.log('Deploy factory')
    const factory = await new FlexSlotFactory__factory(signer).deploy(implementationProvider.address)
    await factory.deployed()

    console.log("Deploy logic")
    const implementation = await new DeltaSlot__factory(signer).deploy(factory.address)
    await implementation.deployed()

    console.log("Set implementation")
    const tx = await implementationProvider.setImplementation(implementation.address)
    await tx.wait()

    console.log('Addresses')
    console.log('logic:', implementation.address)
    console.log('implementationProvider:', implementationProvider.address)
    console.log('factory:', factory.address)

    const addr = await factory.getNextAddress(signer.address)
    console.log(addr)
    await usdcContract.connect(signer).approve(addr, ethers.constants.MaxUint256)
    const params = {
        "amountDeposited": "100000",
        "minimumAmountDeposited": "0",
        "borrowAmount": "121866",
        "minimumMarginReceived": "0",
        "swapPath": "0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035031e4a5963abfd975d8c9021ce480b42188849d41d034f9a0e7fd2bf6067db6994cf12e4495df938e6e900",
        "marginPath": "0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035001e4a5963abfd975d8c9021ce480b42188849d41d034f9a0e7fd2bf6067db6994cf12e4495df938e6e900"
    }

    await factory.connect(signer).createSlot(params)

})