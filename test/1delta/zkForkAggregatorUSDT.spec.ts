import { expect } from "chai";
import { BigNumber, constants } from "ethers";
import { formatEther } from "ethers/lib/utils";
import { deltaIsolationAddresses } from "../../scripts/zk-vix/addresses";
// import { ethers, waffle } from "hardhat";
import {
    AggregatorCallback__factory, DataProvider__factory,
    DeltaModuleProvider__factory,
    FeeOperator__factory,
    SlotFactoryProxy__factory,
    TokenWrapped,
    VixDirect__factory,
    VixInitializeAggregator__factory,
    VixSlotFactory,
    VixSlotFactory__factory
} from "../../types";
import { encodeAddress, encodeAggregtorPathEthers } from "../uniswap-v3/periphery/shared/path";
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

const SLOT_FACTORY = deltaIsolationAddresses.factoryProxy

// determinses whether to re-deploy or to use the existing deployment
const DEPLOY_NEW = false

it(`Test with ${DEPLOY_NEW ? 're-dployment' : 'existing deployment'}`, async function () {
    let factory: VixSlotFactory
    const [signer, partner] = await ethers.getSigners();
    let usdc: any = await ethers.getContractAt("TokenWrapped", usdcAddress);
    let usdt: any = await ethers.getContractAt("TokenWrapped", usdtAddress);
    const signerAddress = await signer.getAddress();
    console.log("signer", signer.address)
    const testPartner = partner.address

    // GET USDC
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
    expect(await usdc.balanceOf(signerAddress)).to.be.eq(value, "Invalid USDC Balance")

    // GET USDT
    // automatically find mapping slot
    const mappingSlotUSDT = await findBalanceSlot(usdt)
    console.log("Found USDC.balanceOf slot: ", mappingSlotUSDT)

    // calculate balanceOf[signerAddress] slot
    const signerBalanceSlotUSDT = getSlot(signerAddress, mappingSlotUSDT)
    // console.log("SLot", signerBalanceSlotUSDT)
    // set it to the value
    const valueUSDT: any = 123456789
    await ethers.provider.send(
        "hardhat_setStorageAt",
        [
            usdt.address,
            signerBalanceSlotUSDT,
            ethers.utils.hexlify(ethers.utils.zeroPad(valueUSDT, 32))
        ]
    )

    // check that the user balance is equal to the expected value
    expect(await usdt.balanceOf(signerAddress)).to.be.eq(valueUSDT, "Invalid USDT Balance")

    const usdcContract = usdc as TokenWrapped
    const usdtContract = usdt as TokenWrapped
    if (DEPLOY_NEW) {
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

        factory = await new VixSlotFactory__factory(signer).attach(factoryProxy.address)


        const moduleProvider = await new DeltaModuleProvider__factory(signer).deploy()

        await factory.initialize(
            moduleProvider.address,
            dataProvider.address
        )

        const feeOperator = await new FeeOperator__factory(signer).attach(deltaIsolationAddresses.feeOperator)
        console.log("fee fetch")
        const dat = await feeOperator.getProtocolShare()
        console.log("fee", dat.toString())
        const callback = await new AggregatorCallback__factory(signer).deploy(
            ALG_FF_FACTORY_ADDRESS,
            DOV_FF_FACTORY_ADDRESS,
            ALG_POOL_CODE_HASH,
            DOV_POOL_INIT_CODE_HASH,
            dataProvider.address,
            WNATIVE_ADDRESS
        )
        const initializer = await new VixInitializeAggregator__factory(signer).deploy(
            ALG_FF_FACTORY_ADDRESS,
            DOV_FF_FACTORY_ADDRESS,
            ALG_POOL_CODE_HASH,
            DOV_POOL_INIT_CODE_HASH,
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
    } else {
        factory = await new VixSlotFactory__factory(signer).attach(SLOT_FACTORY)
    }

    console.log("feth upcong slot address")
    const addrSlotWithUDST = await factory.getNextAddress(signer.address)

    await usdtContract.connect(signer).approve(addrSlotWithUDST, constants.MaxUint256)

    const paramsSwapInUSDT = {
        amountDeposited: '1000000',
        minimumAmountDeposited: '569518324875433',
        borrowAmount: '1193313',
        minimumMarginReceived: '680359516165615',
        swapPath: '0x1e4a5963abfd975d8c9021ce480b42188849d41d000bb80003a8ce8aee21bc2a48a5ef670afcc9274c7bbbc035000bb800034f9a0e7fd2bf6067db6994cf12e4495df938e6e900',
        marginPath: '0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035000bb800004f9a0e7fd2bf6067db6994cf12e4495df938e6e900',
        partner: '0x7A10033Fb8F474F28C66caB7578F4aF9e6dAd37D',
        fee: '50',
    }
    console.log("Try create slot USDT")
    await factory.connect(signer).createSlot(paramsSwapInUSDT)
    console.log("Created with USDT")

})