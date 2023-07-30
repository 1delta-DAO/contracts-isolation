import { constants } from "buffer";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { formatEther } from "ethers/lib/utils";
// import { ethers, waffle } from "hardhat";
import { AggregatorCallbackZK__factory, DataProvider__factory, DeltaModuleProvider__factory, DeltaSlot__factory, FeeOperator__factory, FlexSlotFactory__factory, ImplementationProvider__factory, SlotFactoryProxy__factory, TokenWrapped, TokenWrapped__factory, VixDirect__factory, VixInitializeAggregatorZK__factory, VixSlotFactory__factory } from "../../types";
import { findBalanceSlot, getSlot } from "./forkUtils";
import { getSelectors, ModuleConfigAction } from "./helpers/diamond";
// const { expect } = require("chai");
const { ethers } = require("hardhat");

const zeroAddr = '0x0000000000000000000000000000000000000000'
const WNATIVE_ADDRESS = '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'
const VIX_COMPTROLLER = '0x6EA32f626e3A5c41547235ebBdf861526e11f482'
const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"

const TEN = BigNumber.from(10)
const toNumber = (n: BigNumber, decs = 18) => {
    return Number(formatEther(n.mul(TEN.pow(18 - decs))))
}

const O_NATIVE = '0xee1727f5074E747716637e1776B7F7C7133f16b1'
const O_USDT = '0xad41C77d99E282267C1492cdEFe528D7d5044253'
const O_MATIC = '0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76'
const O_USDC = '0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B'
const O_WBTC = '0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B'


// const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
// const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"
// const wbtcAddress = '0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1'
// const maticAddress = '0xa2036f0538221a77A3937F1379699f44945018d0'


const underlyings = [
    "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
    "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035",
    "0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1",
    "0xa2036f0538221a77A3937F1379699f44945018d0",]

const cS = [
    O_USDT,
    O_USDC,
    O_WBTC,
    O_MATIC
]

const ALG_FF_FACTORY_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
const ALG_POOL_CODE_HASH = '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4';

const DOV_FF_FACTORY_ADDRESS = '0xdE474Db1Fa59898BC91314328D29507AcD0D593c';
const DOV_POOL_INIT_CODE_HASH = '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a';

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

    const dataProvider = await new DataProvider__factory(signer).deploy()


    for (let i = 0; i < underlyings.length; i++) {
        const asset = underlyings[i]
        await dataProvider.setOToken(asset, cS[i])
    }

    await dataProvider.setComptroller(VIX_COMPTROLLER)
    await dataProvider.setOEther(O_NATIVE)

    const factoryImplementation = await new VixSlotFactory__factory(signer).deploy()
    const factoryProxy = await new SlotFactoryProxy__factory(signer).deploy()

    await factoryProxy._setPendingImplementation(factoryImplementation.address)
    await factoryImplementation._become(factoryProxy.address)

    const factory = await new VixSlotFactory__factory(signer).attach(factoryProxy.address)


    const moduleProvider = await new DeltaModuleProvider__factory(signer).deploy()

    await factory.initialize(
        moduleProvider.address,
        dataProvider.address
    )

    const feeOperator = await new FeeOperator__factory(signer).deploy(10)


    const callback = await new AggregatorCallbackZK__factory(signer).deploy(
        dataProvider.address,
        WNATIVE_ADDRESS
    )
    const initializer = await new VixInitializeAggregatorZK__factory(signer).deploy(
        dataProvider.address,
        WNATIVE_ADDRESS,
        feeOperator.address
    )
    const direct = await new VixDirect__factory(signer).deploy(
        dataProvider.address,
        WNATIVE_ADDRESS,
        factory.address

    )

    await moduleProvider.configureModules(
        [
            {
                moduleAddress: callback.address,
                action: ModuleConfigAction.Add,
                functionSelectors: getSelectors(callback)
            },
            {
                moduleAddress: initializer.address,
                action: ModuleConfigAction.Add,
                functionSelectors: getSelectors(initializer)
            },
            {
                moduleAddress: direct.address,
                action: ModuleConfigAction.Add,
                functionSelectors: getSelectors(direct)
            },
        ]
    )


    const addr = await factory.getNextAddress(signer.address)
    console.log(addr)
    await usdcContract.connect(signer).approve(addr, ethers.constants.MaxUint256)

    //    const
    //     ['0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035', '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'] [3000] [3] [1] 0

    const tBal = await usdcContract.balanceOf('0xfa08b8866cbb9b25375d0f9c6562066ec361c8de')

    console.log("usdc ", tBal.toString())
    const params = {
        amountDeposited: "100000",
        minimumAmountDeposited: "0",
        borrowAmount: "121866",
        minimumMarginReceived: "0",
        swapPath: "0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9000bb80103a8ce8aee21bc2a48a5ef670afcc9274c7bbbc03500",
        marginPath: "0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9000bb801001e4a5963abfd975d8c9021ce480b42188849d41d0000640103a8ce8aee21bc2a48a5ef670afcc9274c7bbbc03500",
        partner: zeroAddr,
        fee: 0
    }
    console.log("Try prepare slot")
    await factory.connect(signer).createSlot(params)

})