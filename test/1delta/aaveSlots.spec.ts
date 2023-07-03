import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, constants } from 'ethers';
import { formatEther, parseUnits } from 'ethers/lib/utils';
import { ethers } from 'hardhat'
import {
    EntryPoint,
    EntryPoint__factory,
    FiatWithPermit,
    MintableERC20,
    MockRouter,
    MockRouter__factory,
    AaveSlotLens,
    AaveSlotLens__factory,
    AaveSlotFactory,
    AaveSlotFactory__factory,
    AaveSlot__factory,
    WETH9
} from '../../types';
import { initializeMakeSuite, InterestRateMode, AAVEFixture } from './shared/aaveFixture';
import { produceCloseSig, produceSig } from './shared/permitUtils';

const ONE_18 = BigNumber.from(10).pow(18)

// we prepare a setup for compound in hardhat
// this series of tests checks that the features used for the margin swap implementation
// are correctly set up and working
describe('Aave Slot Trading Test', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let aaveTest: AAVEFixture
    let tokens: (MintableERC20 | WETH9 | FiatWithPermit)[];
    let factory: AaveSlotFactory
    let entryPoint: EntryPoint
    let mockRouter: MockRouter
    let lens: AaveSlotLens

    beforeEach('Deploy Aave', async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();
        entryPoint = await new EntryPoint__factory(deployer).deploy()

        mockRouter = await new MockRouter__factory(deployer).deploy(ONE_18)
        aaveTest = await initializeMakeSuite(deployer)

        const tokenKeys = Object.keys(aaveTest.tokens)
        factory = await new AaveSlotFactory__factory(deployer).deploy(
            entryPoint.address,
            tokenKeys.map(t => aaveTest.tokens[t].address),
            tokenKeys.map(t => aaveTest.aTokens[t].address),
            tokenKeys.map(t => aaveTest.vTokens[t].address),
            tokenKeys.map(t => aaveTest.sTokens[t]?.address ?? constants.AddressZero),
            aaveTest.pool.address,
            mockRouter.address,
            mockRouter.address,
            5
        )
        lens = await new AaveSlotLens__factory(deployer).deploy()
        tokens = Object.values(aaveTest.tokens)

        // adds liquidity to the protocol
        let keys = Object.keys(aaveTest.tokens)
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]
            await aaveTest.tokens[key].connect(deployer).approve(aaveTest.pool.address, constants.MaxUint256)
            if (key === "WETH") {
                await (aaveTest.tokens[key] as WETH9).deposit({ value: ONE_18.mul(1000) })
            } else {
                await (aaveTest.tokens[key] as MintableERC20)['mint(address,uint256)'](deployer.address, ONE_18.mul(100_000_000))

                await aaveTest.tokens[key].connect(deployer).transfer(alice.address, ONE_18.mul(1_000_000))
                // add balances to router
                await aaveTest.tokens[key].connect(deployer).transfer(mockRouter.address, ONE_18.mul(1_000_000))
            }
            await aaveTest.pool.connect(deployer).supply(aaveTest.tokens[key].address, ONE_18.mul(1000), deployer.address, 0)

        }

    })

    it('deploys everything', async () => {
        await aaveTest.aDai.symbol()
        const { WETH, DAI } = aaveTest.tokens
        await DAI.connect(alice).approve(aaveTest.pool.address, constants.MaxUint256)

        // supply and borrow
        await aaveTest.pool.connect(alice).supply(DAI.address, ONE_18.mul(100), alice.address, 0)
        await aaveTest.pool.connect(alice).setUserUseReserveAsCollateral(DAI.address, true)
        await aaveTest.pool.connect(alice).borrow(WETH.address, ONE_18, InterestRateMode.VARIABLE, 0, alice.address)
    })

    it('deploys slot', async () => {
        const collatKey = 'DAI'
        const debtKey = 'USDC'
        const collateral = aaveTest.tokens[collatKey]
        const debt = aaveTest.tokens[debtKey]
        const aTokenCollateral = aaveTest.aTokens[collatKey]
        const vTokenBorrow = aaveTest.vTokens[debtKey]
        const amountCollateral = parseUnits('1', 18)
        const targetCollateral = parseUnits('30', 18)
        const amountBorrow = targetCollateral.mul(101).div(99)

        // approve projected address
        const addressToApprove = await factory.getAddress(1)
        console.log("Slot", addressToApprove)
        await collateral.connect(alice).approve(addressToApprove, ethers.constants.MaxUint256)

        // function swap(address inAsset, address outAsset, uint256 inAm)
        const params = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                debt.address,
                collateral.address,
                amountBorrow
            ]
        )

        const openParams = {
            owner: alice.address,
            payToken: collateral.address,
            amountCollateral,
            interestRateMode: InterestRateMode.VARIABLE,
            tokenCollateral: collateral.address,
            tokenBorrow: debt.address,
            targetCollateralAmount: targetCollateral,
            borrowAmount: amountBorrow,
            swapParamsIn: '0x',
            marginSwapParams: params
        }

        await factory.connect(alice).createSlot(
            openParams
        )

        const collateralPostTrade = await aTokenCollateral.balanceOf(addressToApprove)
        const borrowPostTrade = await vTokenBorrow.balanceOf(addressToApprove)
        console.log("Collateral", formatEther(collateralPostTrade))
        console.log("Debt", formatEther(borrowPostTrade))
        // validate collateral
        expect(collateralPostTrade.gt(ONE_18.mul(31))).to.equal(true)
        // validate debt
        expect(borrowPostTrade.toString()).to.equal(amountBorrow.toString())
    })

    it('deploys slot with swap in', async () => {
        const collatKey = 'DAI'
        const debtKey = 'USDC'
        const payKey = 'AAVE'
        const pay = aaveTest.tokens[payKey]
        const collateral = aaveTest.tokens[collatKey]
        const debt = aaveTest.tokens[debtKey]
        const aTokenCollateral = aaveTest.aTokens[collatKey]
        const vTokenBorrow = aaveTest.vTokens[debtKey]
        const amountCollateral = parseUnits('1', 18)
        const targetCollateral = parseUnits('30', 18)
        const amountBorrow = targetCollateral.mul(101).div(99)

        // approve projected address
        const addressToApprove = await factory.getAddress(1)
        console.log("Slot", addressToApprove)
        await pay.connect(alice).approve(addressToApprove, ethers.constants.MaxUint256)

        // function swap(address inAsset, address outAsset, uint256 inAm)
        const params = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                debt.address,
                collateral.address,
                amountBorrow
            ]
        )

        // function swap(address inAsset, address outAsset, uint256 inAm)
        const paramsSwapIn = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                pay.address,
                collateral.address,
                amountCollateral
            ]
        )

        const openParams = {
            owner: alice.address,
            payToken: pay.address,
            amountCollateral,
            interestRateMode: InterestRateMode.VARIABLE,
            tokenCollateral: collateral.address,
            tokenBorrow: debt.address,
            targetCollateralAmount: targetCollateral,
            borrowAmount: amountBorrow,
            swapParamsIn: paramsSwapIn,
            marginSwapParams: params
        }

        await factory.connect(alice).createSlot(
            openParams
        )

        const collateralPostTrade = await aTokenCollateral.balanceOf(addressToApprove)
        const borrowPostTrade = await vTokenBorrow.balanceOf(addressToApprove)
        console.log("Collateral", formatEther(collateralPostTrade))
        console.log("Debt", formatEther(borrowPostTrade))
        // validate collateral
        expect(collateralPostTrade.gt(ONE_18.mul(31))).to.equal(true)
        // validate debt
        expect(borrowPostTrade.toString()).to.equal(amountBorrow.toString())
    })

    it('closes full slot', async () => {
        const collatKey = 'DAI'
        const debtKey = 'USDC'
        const collateral = aaveTest.tokens[collatKey]
        const debt = aaveTest.tokens[debtKey]
        const aTokenCollateral = aaveTest.aTokens[collatKey]
        const vTokenBorrow = aaveTest.vTokens[debtKey]
        const amountCollateral = parseUnits('1', 18)
        const targetCollateral = parseUnits('30', 18)
        // repay more than he balances
        const amountToRepay = targetCollateral.mul(105).div(100)

        // approve projected address
        const slotAddress = await factory.getAddress(1)
        console.log("Slot", slotAddress)

        // function swap(address inAsset, address outAsset, uint256 inAm)
        const params = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                collateral.address,
                debt.address,
                amountToRepay
            ]
        )

        const slot = await new AaveSlot__factory(alice).attach(slotAddress)

        // await slot.close(
        //     amountToRepay,
        //     targetCollateral.add(amountCollateral),
        //     params
        // )

        await slot.closeFullPosition(
            params
        )

        const collateralPostTrade = await aTokenCollateral.balanceOf(slotAddress)
        const borrowPostTrade = await vTokenBorrow.balanceOf(slotAddress)
        console.log("Collateral", formatEther(collateralPostTrade))
        console.log("Debt", formatEther(borrowPostTrade))
        // validate collateral
        expect(collateralPostTrade.toString()).to.equal('0')
        // validate debt
        // expect(borrowPostTrade.toString()).to.equal(amountBorrow.toString())
    })


    it('deploys slot with permit', async () => {
        const collatKey = 'DAI'
        const debtKey = 'USDC'
        const collateral = aaveTest.tokens[collatKey]
        const debt = aaveTest.tokens[debtKey]
        const aTokenCollateral = aaveTest.aTokens[collatKey]
        const vTokenBorrow = aaveTest.vTokens[debtKey]
        const amountCollateral = parseUnits('1', 18)
        const targetCollateral = parseUnits('30', 18)
        const amountBorrow = targetCollateral.mul(101).div(99)

        // approve projected address
        const addressToApprove = await factory.getAddress(1)
        console.log("Slot", addressToApprove)
        // await collateral.connect(alice).approve(addressToApprove, ethers.constants.MaxUint256)

        // function swap(address inAsset, address outAsset, uint256 inAm)
        const params = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                debt.address,
                collateral.address,
                amountBorrow
            ]
        )
        const sigVRS = await produceSig(alice, addressToApprove, collateral as FiatWithPermit, amountCollateral.toString())

        const sig = {
            owner: alice.address,
            spender: addressToApprove,
            value: amountCollateral,
            deadline: ethers.constants.MaxUint256,
            v: sigVRS.split.v,
            r: sigVRS.split.r,
            s: sigVRS.split.s
        }

        const paramsWithPermit = {
            payToken: collateral.address,
            tokenCollateral: collateral.address,
            interestRateMode: InterestRateMode.VARIABLE,
            tokenBorrow: debt.address,
            targetCollateralAmount: targetCollateral,
            borrowAmount: amountBorrow,
            swapParamsIn: '0x',
            marginSwapParams: params,
            permit: sig
        }

        await factory.connect(bob).createSlotWithPermit(
            paramsWithPermit
        )

        const collateralPostTrade = await aTokenCollateral.balanceOf(addressToApprove)
        const borrowPostTrade = await vTokenBorrow.balanceOf(addressToApprove)
        console.log("Collateral", formatEther(collateralPostTrade))
        console.log("Debt", formatEther(borrowPostTrade))
        // validate collateral
        expect(collateralPostTrade.gt(ONE_18.mul(31))).to.equal(true)
        // validate debt
        expect(borrowPostTrade.toString()).to.equal(amountBorrow.toString())


        const slots = await lens.getUserSlots(alice.address, factory.address, aaveTest.pool.address)

        console.log(slots[0].totalCollateralBase.toString(), slots[0].totalDebtBase.toString())
    })

    it('closes slot with permit', async () => {
        const collatKey = 'DAI'
        const debtKey = 'USDC'
        const collateral = aaveTest.tokens[collatKey]
        const debt = aaveTest.tokens[debtKey]
        const aTokenCollateral = aaveTest.aTokens[collatKey]
        const vTokenBorrow = aaveTest.vTokens[debtKey]
        const amountCollateral = parseUnits('1', 18)
        const targetCollateral = parseUnits('30', 18)
        // repay more than he balances
        const amountBorrow = targetCollateral.mul(101).div(99)

        // get slot address
        const slotAddress = await factory.getNextAddress()
        console.log("Slot", slotAddress)

        await collateral.connect(alice).approve(slotAddress, ethers.constants.MaxUint256)



        const paramsSwapOpen = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                debt.address,
                collateral.address,
                amountBorrow
            ]
        )

        const openParams = {
            owner: alice.address,
            payToken: collateral.address,
            amountCollateral,
            interestRateMode: InterestRateMode.VARIABLE,
            tokenCollateral: collateral.address,
            tokenBorrow: debt.address,
            targetCollateralAmount: targetCollateral,
            borrowAmount: amountBorrow,
            swapParamsIn: '0x',
            marginSwapParams: paramsSwapOpen
        }

        await factory.connect(alice).createSlot(
            openParams
        )

        const borrow = await vTokenBorrow.balanceOf(slotAddress)
        console.log("Debt", formatEther(borrow))

        const slotsAlice = await lens.getUserSlots(alice.address, factory.address, aaveTest.pool.address)
        console.log("slotsAlice", slotsAlice)

        const amountToRepay = borrow.mul(102).div(100)
        // function swap(address inAsset, address outAsset, uint256 inAm)
        const paramsClose = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                collateral.address,
                debt.address,
                amountToRepay
            ]
        )
        console.log("Get Slot contract")
        const slot = await new AaveSlot__factory(alice).attach(slotAddress)


        const slotsList = await lens.getUserSlots(alice.address, factory.address, aaveTest.pool.address)

        console.log('slotsList', slotsList)
        const sigVRS = await produceCloseSig(
            bob,
            slot
        )

        const sig = {
            owner: bob.address,
            slot: slotAddress,
            deadline: ethers.constants.MaxUint256,
            v: sigVRS.split.v,
            r: sigVRS.split.r,
            s: sigVRS.split.s
        }

        const paramsWithPermit = {
            swapParams: paramsClose,
            signature: sig
        }

        await slot.connect(alice).closeFullPositionWithSig(
            paramsWithPermit
        )

        const collateralPostTrade = await aTokenCollateral.balanceOf(slotAddress)
        const borrowPostTrade = await vTokenBorrow.balanceOf(slotAddress)
        console.log("Collateral", formatEther(collateralPostTrade))
        console.log("Debt", formatEther(borrowPostTrade))
        // validate collateral
        expect(collateralPostTrade.toString()).to.equal('0')
        // validate debt
        expect(borrowPostTrade.toString()).to.equal('0')


        const slots = await lens.getUserSlots(alice.address, factory.address, aaveTest.pool.address)

        console.log(slots[0].totalCollateralBase.toString(), slots[0].totalDebtBase.toString())
    })


    it('deploys slots with permit - lens shows data', async () => {
        const collatKey = 'DAI'
        const debtKey = 'USDC'
        const collateral = aaveTest.tokens[collatKey]
        const debt = aaveTest.tokens[debtKey]
        const payKey = 'AAVE'
        const pay = aaveTest.tokens[payKey]
        const amountCollateral = parseUnits('1', 18)
        const targetCollateral = parseUnits('30', 18)

        // this time the router sends less
        await mockRouter.connect(deployer).setRate(ONE_18.mul(95).div(100))

        const amountBorrow = targetCollateral.mul(107).div(100)

        // approve projected address
        const addressToApprove = await factory.getAddress(1)
        console.log("Slot", addressToApprove)

        // function swap(address inAsset, address outAsset, uint256 inAm)
        const params = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                debt.address,
                collateral.address,
                amountBorrow
            ]
        )



        // function swap(address inAsset, address outAsset, uint256 inAm)
        const paramsSwapIn = mockRouter.interface.encodeFunctionData(
            'swap',
            [
                pay.address,
                collateral.address,
                amountCollateral
            ]
        )


        const sigVRS = await produceSig(alice, addressToApprove, pay as FiatWithPermit, amountCollateral.toString())

        const sig = {
            owner: alice.address,
            spender: addressToApprove,
            value: amountCollateral,
            deadline: ethers.constants.MaxUint256,
            v: sigVRS.split.v,
            r: sigVRS.split.r,
            s: sigVRS.split.s
        }

        const paramsWithPermit = {
            payToken: pay.address,
            tokenCollateral: collateral.address,
            interestRateMode: InterestRateMode.VARIABLE,
            tokenBorrow: debt.address,
            targetCollateralAmount: targetCollateral,
            borrowAmount: amountBorrow,
            swapParamsIn: paramsSwapIn,
            marginSwapParams: params,
            permit: sig
        }

        await factory.connect(bob).createSlotWithPermit(
            paramsWithPermit
        )

        const slots = await lens.getUserSlots(alice.address, factory.address, aaveTest.pool.address)

        expect(slots.length).to.be.greaterThan(0)
    })




})
