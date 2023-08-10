import { expect } from "chai";
import { constants } from "ethers";
import { deltaIsolationAddresses } from "../../scripts/zk-vix/addresses";
import { VixLens__factory, VixSlotFactory__factory } from "../../types";
import { encodeAddress, encodeAggregtorPathEthers } from "../uniswap-v3/periphery/shared/path";
const { ethers } = require("hardhat");

it("Test create slot", async function () {
    const [signer] = await ethers.getSigners();
    console.log('Get factory')
    const factory = await new VixSlotFactory__factory(signer).attach(deltaIsolationAddresses.factoryProxy)
    await factory.deployed()

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

    const params = {
        amountDeposited: "5034471781188815",
        minimumAmountDeposited: "0",
        borrowAmount: "1000000",
        minimumMarginReceived: "0",
        swapPath: pathIn,
        marginPath: pathMargin,
        partner: constants.AddressZero,
        fee: 0
    }

    await factory.connect(signer).createSlot(params, { value: params.amountDeposited })

    const lens = await new VixLens__factory(signer).attach(deltaIsolationAddresses.lens)

    const slots = await lens.callStatic.getUserSlots(signer.address, deltaIsolationAddresses.factoryProxy)

    console.log(slots)

})