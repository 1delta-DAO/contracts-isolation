import { expect } from "chai";
import { constants } from "ethers";
import { deltaIsolationAddresses } from "../../scripts/zk-vix/addresses";
import { TokenWrapped, VixSlotFactory__factory } from "../../types";
import { findBalanceSlot, getSlot } from "./forkUtils";
const { ethers } = require("hardhat");


const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"


it("Test create slot", async function () {
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

    console.log('Deploy factory')
    const factory = await new VixSlotFactory__factory(signer).attach(deltaIsolationAddresses.factoryProxy)
    await factory.deployed()

    const addr = await factory.getNextAddress(signer.address)
    console.log(addr)
    await usdcContract.connect(signer).approve(addr, ethers.constants.MaxUint256)
    const params = {
        amountDeposited: "100000",
        minimumAmountDeposited: "0",
        borrowAmount: "121866",
        minimumMarginReceived: "0",
        swapPath: "0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035031e4a5963abfd975d8c9021ce480b42188849d41d034f9a0e7fd2bf6067db6994cf12e4495df938e6e900",
        marginPath: "0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035001e4a5963abfd975d8c9021ce480b42188849d41d034f9a0e7fd2bf6067db6994cf12e4495df938e6e900",
        partner: constants.AddressZero,
        fee: 0
    }

    await factory.connect(signer).createSlot(params)

})