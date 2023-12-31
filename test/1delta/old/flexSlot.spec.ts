import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, network, waffle } from 'hardhat'
import { expect } from '../shared/expect'
import { CompoundFixture, CompoundOptions, generateCompoundFixture, ONE_18 } from '../shared/compoundFixture'
import { Slot__factory, ERC20Mock__factory, OVixLensZK__factory, OVixLensZK, SlotFactory, SlotFactory__factory, FlexSlotFactory, FlexSlotFactory__factory, ImplementationProvider, ImplementationProvider__factory, Slot, FiatWithPermit } from '../../../types';
import { BigNumber, constants } from 'ethers';
import { expandTo18Decimals } from '../../uniswap-v3/core/shared/utilities';
import { feedCompound, feedCompoundETH } from '../shared/misc';
import { encodeAddress, encodeAlgebraPathEthersSimple } from '../../uniswap-v3/periphery/shared/path';
import { formatEther } from 'ethers/lib/utils';
import { addAlgebraLiquidity, algebraFixture, AlgebraFixture } from '../shared/algebraFixture';
import { tokenFixture, TokenFixture } from '../shared/tokensFixture';
import { MockProvider } from 'ethereum-waffle';
import { produceSig } from '../shared/permitUtils';


// Tests all configurations for the minimal slot variant
describe('Compact Slot Trading', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let compoundFixture: CompoundFixture
    let opts: CompoundOptions
    let algebra: AlgebraFixture
    let tokenData: TokenFixture
    let compoundSlotFactory: FlexSlotFactory
    let provider: MockProvider
    let lens: OVixLensZK
    let implementationProvider: ImplementationProvider
    let implementation: Slot

    before('get wallets and fixture', async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();
        tokenData = await tokenFixture(deployer, 6)
        algebra = await algebraFixture(deployer, tokenData.wnative.address)
        provider = waffle.provider;
        opts = {
            underlyings: tokenData.tokens,
            collateralFactors: tokenData.tokens.map(x => ONE_18.mul(8).div(10)),
            exchangeRates: tokenData.tokens.map(x => ONE_18),
            borrowRates: tokenData.tokens.map(x => ONE_18),
            cEthExchangeRate: ONE_18,
            cEthBorrowRate: ONE_18,
            compRate: ONE_18,
            closeFactor: ONE_18
        }

        await tokenData.wnative.connect(deployer).deposit({ value: expandTo18Decimals(1_500) })
        // approve & fund wallets
        for (const token of tokenData.tokens) {
            await token.approve(algebra.router.address, constants.MaxUint256)
            await token.approve(algebra.nft.address, constants.MaxUint256)

            await token.connect(bob).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(bob).approve(algebra.nft.address, constants.MaxUint256)
            await token.connect(alice).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(alice).approve(algebra.nft.address, constants.MaxUint256)
            await token.connect(carol).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(carol).approve(algebra.nft.address, constants.MaxUint256)

            await token.connect(bob).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(alice).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(carol).approve(algebra.router.address, constants.MaxUint256)

            await token.connect(deployer).transfer(bob.address, expandTo18Decimals(1_000_000))
            await token.connect(deployer).transfer(alice.address, expandTo18Decimals(1_000_000))
            await token.connect(deployer).transfer(carol.address, expandTo18Decimals(1_000_000))

            await token.connect(deployer).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(bob).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(carol).approve(algebra.router.address, constants.MaxUint256)
            await token.connect(alice).approve(algebra.router.address, constants.MaxUint256)
        }

        compoundFixture = await generateCompoundFixture(deployer, opts)

        lens = await new OVixLensZK__factory(deployer).deploy()

        implementation = await new Slot__factory(deployer).deploy(
            tokenData.wnative.address,
            algebra.poolDeployer.address,
            compoundFixture.underlyings.map(u => u.address),
            compoundFixture.cTokens.map(c => c.address),
            compoundFixture.cEther.address,
            compoundFixture.comptroller.address,
            compoundFixture.underlyings.length
        )
        implementationProvider = await new ImplementationProvider__factory(deployer).deploy()
        await implementationProvider.setImplementation(implementation.address)
        compoundSlotFactory = await new FlexSlotFactory__factory(deployer).deploy(
            implementationProvider.address,

        )

        await feedCompound(deployer, compoundFixture)
        await feedCompoundETH(deployer, compoundFixture)


        console.log("add WETH 0")
        await addAlgebraLiquidity(
            deployer,
            tokenData.wnative.address,
            tokenData.tokens[0].address,
            expandTo18Decimals(1_000),
            expandTo18Decimals(1_000),
            algebra
        )


        // ALGEBRA LIQUDITY

        console.log("add 3 4")
        await addAlgebraLiquidity(
            deployer,
            tokenData.tokens[3].address,
            tokenData.tokens[4].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            algebra
        )

        console.log("add 2 3")
        await addAlgebraLiquidity(
            deployer,
            tokenData.tokens[2].address,
            tokenData.tokens[3].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            algebra
        )

        console.log("add 0 1")
        await addAlgebraLiquidity(
            deployer,
            tokenData.tokens[0].address,
            tokenData.tokens[1].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            algebra
        )

        console.log("add 1 2")
        await addAlgebraLiquidity(
            deployer,
            tokenData.tokens[1].address,
            tokenData.tokens[2].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            algebra
        )


    })


    it('SETUP: allows collateral provision and redemption', async () => {
        const underlying = compoundFixture.underlyings[0]
        const cToken = compoundFixture.cTokens[0]
        const am = expandTo18Decimals(1)
        await underlying.connect(deployer).transfer(alice.address, am)

        await underlying.connect(alice).approve(cToken.address, am)

        await cToken.connect(alice).mint(am)

        await cToken.connect(alice).redeemUnderlying(am)

    })

    it('SETUP: allows borrow and repay', async () => {

        const borrow_underlying = compoundFixture.underlyings[0]
        const supply_underlying = compoundFixture.underlyings[1]

        const borrow_cToken = compoundFixture.cTokens[0]
        const supply_cToken = compoundFixture.cTokens[1]

        const comptroller = compoundFixture.comptroller

        // supplies
        const supply_am = expandTo18Decimals(3)
        const borrow_am = expandTo18Decimals(1)

        // transfer supply amount to other acc
        await supply_underlying.connect(deployer).transfer(bob.address, supply_am.div(2))

        // supply amount to protocol for other acc to borrow
        await borrow_underlying.connect(deployer).approve(borrow_cToken.address, borrow_am)
        await borrow_cToken.connect(deployer).mint(borrow_am.div(2))

        // enter market
        await comptroller.connect(bob).enterMarkets(compoundFixture.cTokens.map(cT => cT.address))

        // user has to add collateral
        await supply_underlying.connect(bob).approve(supply_cToken.address, borrow_am)
        await supply_cToken.connect(bob).mint(borrow_am.div(2))

        // other account borrows amount
        await borrow_cToken.connect(bob).borrow(borrow_am.div(4))

        await network.provider.send("evm_increaseTime", [3600])
        await network.provider.send("evm_mine")

        // repay amount
        await borrow_underlying.connect(bob).approve(borrow_cToken.address, borrow_am.div(4))
        await borrow_cToken.connect(bob).repayBorrow(borrow_am.div(4))
    })

    it('SINGLE: allows to deploy standard slot', async () => {

        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('SINGLE PERMIT: allows to deploy standard slot', async () => {

        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        // sign
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        const sigVRS = await produceSig(alice, projAddress, compoundFixture.underlyings[inIndex] as FiatWithPermit, depositAmount.toString())

        const sig = {
            owner: alice.address,
            spender: projAddress,
            value: depositAmount,
            deadline: ethers.constants.MaxUint256,
            v: sigVRS.split.v,
            r: sigVRS.split.r,
            s: sigVRS.split.s
        }

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            marginPath: path,
            permit: sig
        }

        // create
        await compoundSlotFactory.connect(alice).createSlotWithPermit(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })



    it('BASIC: allows standard repay and withdrawal on slot / gatekeep', async () => {

        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        const slot = await Slot__factory.connect(projAddress, alice)

        const balPre = await compoundFixture.underlyings[supplyIndex].balanceOf(alice.address)


        await approve(alice, compoundFixture.underlyings[borrowIndex].address, projAddress)
        await slot.repay(borrowPost)
        await slot.withdraw(supplyPost.mul(1e15 - 1).div(1e15), false)

        const borrowPostRepay = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostWithdrawal = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostRepay.lte(1000)).to.equal(true)
        expect(supplyPostWithdrawal.lte(1e12)).to.equal(true)
        const balPost = await compoundFixture.underlyings[supplyIndex].balanceOf(alice.address)

        expect(toNumber(balPost.sub(balPre))).to.greaterThanOrEqual(toNumber(supplyPost) * 0.9999)
        const pathVaid = encodeAlgebraPathEthersSimple(
            _tokensInRoute,
            [1, 2, 2],
            0
        )
        await expect(slot.connect(deployer).close(
            0,
            expandTo18Decimals(100),
            pathVaid
        )).to.be.revertedWith("OnlyOwner()")

    })


    it('CLOSE: to close slot', async () => {

        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(
            _tokensInRoute,
            [1, 2, 2],
            0
        )
        // approve
        const projAddress = await compoundSlotFactory.getAddress(alice.address, 0)
        const slot = await Slot__factory.connect(projAddress, alice)

        // create
        await slot.close(
            0,
            expandTo18Decimals(100),
            path
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal('0')
        expect(toNumber(supplyPost)).to.equal(0)
    })

    it('MULTI + SAWP IN: allows to deploy standard slot with swap-in', async () => {

        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        const routeIndexesSwapIn = [2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAlgebraPathEthersSimple(_tokensInRouteSwapIn, [3, 3], 0)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })


    it('MULTI + SAWP IN PERMIT: allows to deploy standard slot with swap-in', async () => {

        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        const routeIndexesSwapIn = [2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAlgebraPathEthersSimple(_tokensInRouteSwapIn, [3, 3], 0)


        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        const sigVRS = await produceSig(alice, projAddress, compoundFixture.underlyings[inIndex] as FiatWithPermit, depositAmount.toString())

        const sig = {
            owner: alice.address,
            spender: projAddress,
            value: depositAmount,
            deadline: ethers.constants.MaxUint256,
            v: sigVRS.split.v,
            r: sigVRS.split.r,
            s: sigVRS.split.s
        }

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            marginPath: path,
            permit: sig
        }

        // create
        await compoundSlotFactory.connect(alice).createSlotWithPermit(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })


    it('MULTI + SWAP IN ETHER: allows to deploy standard slot with swap-in Ether', async () => {

        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(1).div(100)
        const swapAmount = expandTo18Decimals(5).div(1000)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        let _tokensInRouteSwapIn = [tokenData.wnative.address, compoundFixture.underlyings[0].address]
        const swapPath = encodeAlgebraPathEthersSimple(_tokensInRouteSwapIn, [3], 0)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(alice).createSlot(
            params, { value: depositAmount }
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('ALGEBRA GENERAL: allows to deploy standard slot algebra', async () => {

        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(
            _tokensInRoute,
            [0, 3, 3],
            0
        )

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('MULTI + SWAP IN:allows to deploy standard slot with swap-in', async () => {

        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        const routeIndexesSwapIn = [2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthersSimple(_tokensInRoute, [0, 3, 3], 0)

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAlgebraPathEthersSimple(_tokensInRouteSwapIn, [3, 3], 0)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(params.minimumAmountDeposited)))
    })

    it('SINGLE: allows to deploy standard slot ETH collateral and close', async () => {

        const inIndex = 2
        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [0],
            0
        )

        const swapPath = encodeAddress(tokenData.wnative.address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params,
            { value: depositAmount }
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await Slot__factory.connect(projAddress, bob)


        const closePath = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [1],
            0
        )
        const balBefore = await provider.getBalance(bob.address);

        await slot.close(
            0,
            swapAmount.mul(105).div(100),
            closePath
        )
        const balAfter = await provider.getBalance(bob.address);
        const borrowPostClose = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(101).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })

    it('WITHDRAW ETH: Allows to withdraw ETH', async () => {

        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [0],
            0
        )

        const swapPath = encodeAddress(tokenData.wnative.address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params,
            { value: depositAmount }
        )

        const slot = await Slot__factory.connect(projAddress, bob)

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        await approve(bob, compoundFixture.underlyings[borrowIndex].address, projAddress)
        await slot.repay(borrowPost)
        const balBeforeWithdraw = await provider.getBalance(bob.address)
        await slot.withdraw(supplyPost.mul(1e15 - 1).div(1e15), false)
        const supplyPostWithdraw = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)
        const balAfterWithdraw = await provider.getBalance(bob.address);
        expect(supplyPostWithdraw.lte(1e12)).to.equal(true)
        expect(toNumber(balAfterWithdraw.sub(balBeforeWithdraw))).to.greaterThan(toNumber(supplyPost) * 0.98)
    })


    it('SINGLE + SWAP IN: allows to deploy standard slot ETH collateral and close', async () => {

        const inIndex = 1
        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [0],
            0
        )

        const swapPath = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [3, 3],
            0
        )

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(94).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(params.minimumAmountDeposited)))


        const slot = await Slot__factory.connect(projAddress, bob)


        const closePath = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [1],
            0
        )
        const balBefore = await provider.getBalance(bob.address);

        await slot.close(
            0,
            swapAmount.mul(105).div(100),
            closePath
        )
        const balAfter = await provider.getBalance(bob.address);
        const borrowPostClose = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(105).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('SINGLE: allows to deploy standard slot ETH debt and close', async () => {

        const inIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.wnative.address, tokenData.tokens[0].address],
            [0],
            0
        )

        const swapPath = encodeAddress(tokenData.tokens[0].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await Slot__factory.connect(projAddress, bob)


        const closePath = encodeAlgebraPathEthersSimple(
            [tokenData.wnative.address, tokenData.tokens[0].address],
            [1],
            0
        )
        const balBefore = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);

        await slot.close(
            0,
            swapAmount.mul(105).div(100),
            closePath
        )
        const balAfter = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);
        const borrowPostClose = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(101).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('REPAY ETH: Allows repay of ETH', async () => {

        const inIndex = 0
        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.wnative.address, tokenData.tokens[0].address],
            [0],
            0
        )

        const swapPath = encodeAddress(tokenData.tokens[0].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)

        const slot = await Slot__factory.connect(projAddress, bob)

        await slot.repay(0, { value: borrowPost })

        const borrowPostRepay = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)

        expect(borrowPostRepay.lte(1000)).to.equal(true)
    })

    it('MULTI: allows to deploy standard slot ETH collateral and close', async () => {


        const borrowIndex = 1
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [0, 3],
            0
        )

        const swapPath = encodeAddress(tokenData.wnative.address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params,
            { value: depositAmount }
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await Slot__factory.connect(projAddress, bob)


        const closePath = encodeAlgebraPathEthersSimple(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [1, 2],
            0
        )
        const balBefore = await provider.getBalance(bob.address);
        const supplyPreClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        await slot.close(
            0,
            swapAmount.mul(105).div(100),
            closePath
        )
        const balAfter = await provider.getBalance(bob.address);
        const borrowPostClose = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(101).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('MULTI: allows to deploy standard slot ETH debt and close', async () => {

        const inIndex = 1
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAlgebraPathEthersSimple(
            [tokenData.wnative.address, tokenData.tokens[0].address, tokenData.tokens[1].address],
            [0, 3],
            0
        )

        const swapPath = encodeAddress(tokenData.tokens[1].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            marginPath: path
        }

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await Slot__factory.connect(projAddress, bob)


        const closePath = encodeAlgebraPathEthersSimple(
            [tokenData.wnative.address, tokenData.tokens[0].address, tokenData.tokens[1].address],
            [1, 2],
            0
        )
        const balBefore = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);

        await slot.close(
            0,
            swapAmount.mul(105).div(100),
            closePath
        )
        const balAfter = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);
        const borrowPostClose = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(101).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })

    it('ADMIN: can withdraw ETH fees', async () => {

        const balFactoryBefore = await provider.getBalance(compoundSlotFactory.address);
        const balbefore = await provider.getBalance(deployer.address);
        // withdraw eth
        const tx = await compoundSlotFactory.connect(deployer).withdrawFees(
            ethers.constants.AddressZero
        )
        const receipt = await tx.wait();
        // here we receive ETH, but the transaction costs some, too - so we have to record and subtract that
        const gasUsed = (receipt.cumulativeGasUsed).mul(receipt.effectiveGasPrice);
        const balAfter = await provider.getBalance(deployer.address);
        expect(toNumber(balAfter.sub(balbefore).add(gasUsed))).to.greaterThanOrEqual(toNumber(balFactoryBefore))
        const balFactory = await provider.getBalance(compoundSlotFactory.address);
        expect((balFactory).toString()).to.eq('0')
    })

    it('ADMIN: can transfer ownership / and withdraw ERC20 fees', async () => {

        await compoundSlotFactory.connect(deployer).changeAdmin(
            carol.address
        )

        const balFactory = await compoundFixture.underlyings[0].balanceOf(compoundSlotFactory.address);

        const balbefore = await compoundFixture.underlyings[0].balanceOf(carol.address);
        // withdraw eth
        await compoundSlotFactory.connect(carol).withdrawFees(
            compoundFixture.underlyings[0].address
        )

        const balAfter = await compoundFixture.underlyings[0].balanceOf(carol.address);
        expect((balAfter.sub(balbefore)).toString()).to.eq(balFactory.toString())

        const balFactoryAfter = await compoundFixture.underlyings[0].balanceOf(compoundSlotFactory.address);
        expect((balFactoryAfter).toString()).to.eq('0')
    })

    it('ADMIN: prevents unauthorized', async () => {

        await expect(compoundSlotFactory.connect(deployer).changeAdmin(
            deployer.address
        )).to.be.revertedWith('OnlyAdmin()')
    })

    it('LENS: shows slots', async () => {
        const data = await lens.callStatic.getUserSlots(alice.address, compoundSlotFactory.address)
        console.log(data)
        expect(data.length).to.greaterThanOrEqual(1)
    })
})

const approve = async (signer: SignerWithAddress, token: string, spender: string) => {
    const tokenConttract = await new ERC20Mock__factory(signer).attach(token)
    await tokenConttract.approve(spender, constants.MaxUint256)
}

const toNumber = (n: BigNumber | string) => {
    return Number(formatEther(n))
}