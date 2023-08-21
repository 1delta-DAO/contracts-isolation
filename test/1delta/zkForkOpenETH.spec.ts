import { waffle } from "hardhat";
import { deltaIsolationAddresses } from "../../scripts/zk-vix/addresses";
import { VixLens__factory, VixSlotFactory__factory } from "../../types";
import { encodeAddress, encodeAggregtorPathEthers } from "../uniswap-v3/periphery/shared/path";
const { ethers } = require("hardhat");

it("Test create slot", async function () {
    const [signer, partner] = await ethers.getSigners();
    console.log('Get factory')
    const factory = await new VixSlotFactory__factory(signer).attach(deltaIsolationAddresses.factoryProxy)
    await factory.deployed()
    const provider = waffle.provider
    const pathData = {
        "pathIn": "0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9",
        "pathMargin": [
            ["0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035", "0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9"],
            [3000],
            [0],
            [0],
            0
        ]
    }

    const pathIn = encodeAddress(pathData.pathIn)
    const pathMargin = encodeAggregtorPathEthers(
        ["0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035", "0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9"],
        [3000],
        [0],
        [0],
        0
    )

    // const params = {
    //     amountDeposited: "5034471781188815",
    //     minimumAmountDeposited: "0",
    //     borrowAmount: "1000000",
    //     minimumMarginReceived: "0",
    //     swapPath: pathIn,
    //     marginPath: pathMargin,
    //     partner: partner.address,
    //     fee: 200
    // }

    const params = {
        amountDeposited: '1000000000000000',
        minimumAmountDeposited: '1670791',
        borrowAmount: '1201145470868017',
        minimumMarginReceived: '2006863',
        swapPath: '0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9000bb80003a8ce8aee21bc2a48a5ef670afcc9274c7bbbc03500',
        marginPath: '0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9000bb80000a8ce8aee21bc2a48a5ef670afcc9274c7bbbc03500',
        partner: partner.address,
        fee: '50',
    }

    await factory.connect(signer).createSlot(params, { value: params.amountDeposited })

    const lens = await new VixLens__factory(signer).attach(deltaIsolationAddresses.lens)

    const slots = await lens.callStatic.getUserSlots(signer.address, deltaIsolationAddresses.factoryProxy)

    console.log(slots)

    const partnerFeeCollected = await provider.getBalance(partner.address)

    console.log("Fee collected", partnerFeeCollected.toString())

})