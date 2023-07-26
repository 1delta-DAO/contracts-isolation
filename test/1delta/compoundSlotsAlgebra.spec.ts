import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, network } from 'hardhat'
import { expect } from './shared/expect'
import { CompoundFixture, CompoundOptions, generateCompoundFixture, ONE_18 } from './shared/compoundFixture'
import { addUniswapLiquidity, uniswapFixture, UniswapFixture, UniswapMinimalFixtureNoTokens, uniswapMinimalFixtureNoTokens } from './shared/uniswapFixture';
import { AggregationSlotFactory, AggregationSlotFactory__factory, AggregationSlot__factory, CompoundSlotFactory, CompoundSlotFactory__factory, CompoundSlot__factory, ERC20Mock__factory, MinimalSwapRouter, MinimalSwapRouter__factory, OVixLensZK__factory, WETH9 } from '../../types';
import { BigNumber, constants } from 'ethers';
import { expandTo18Decimals, FeeAmount } from '../uniswap-v3/core/shared/utilities';
import { feedCompound, feedCompoundETH } from './shared/misc';
import { encodeAddress, encodeAlgebraPath, encodeAlgebraPathEthers, encodePath } from '../uniswap-v3/periphery/shared/path';
import { formatEther } from 'ethers/lib/utils';
import { addAlgebraLiquidity, algebraFixture, AlgebraFixture } from './shared/algebraFixture';
import { tokenFixture, TokenFixture } from './shared/tokensFixture';


// we prepare a setup for compound in hardhat
// this series of tests checks that the features used for the margin swap implementation
// are correctly set up and working
describe('Compound Slot Trading', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let compoundFixture: CompoundFixture
    let opts: CompoundOptions
    let uniswap: UniswapMinimalFixtureNoTokens
    let algebra: AlgebraFixture
    let tokenData: TokenFixture
    let compoundSlotFactory: AggregationSlotFactory

    before('get wallets and fixture', async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();
        const arr = [1, 2, 4, 5, 6]
        tokenData = await tokenFixture(deployer, 6)
        algebra = await algebraFixture(deployer, tokenData.wnative.address)
        uniswap = await uniswapMinimalFixtureNoTokens(deployer, tokenData.wnative.address)

        opts = {
            underlyings: tokenData.tokens,
            collateralFactors: tokenData.tokens.map(x => ONE_18.mul(5).div(10)),
            exchangeRates: tokenData.tokens.map(x => ONE_18),
            borrowRates: tokenData.tokens.map(x => ONE_18),
            cEthExchangeRate: ONE_18,
            cEthBorrowRate: ONE_18,
            compRate: ONE_18,
            closeFactor: ONE_18
        }

        await tokenData.wnative.connect(deployer).deposit({ value: expandTo18Decimals(100) })
        // approve & fund wallets
        for (const token of tokenData.tokens) {
            await token.approve(uniswap.router.address, constants.MaxUint256)
            await token.approve(uniswap.nft.address, constants.MaxUint256)

            await token.connect(bob).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(bob).approve(uniswap.nft.address, constants.MaxUint256)
            await token.connect(alice).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(alice).approve(uniswap.nft.address, constants.MaxUint256)
            await token.connect(carol).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(carol).approve(uniswap.nft.address, constants.MaxUint256)

            await token.connect(bob).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(alice).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(carol).approve(uniswap.router.address, constants.MaxUint256)

            await token.connect(deployer).transfer(bob.address, expandTo18Decimals(1_000_000))
            await token.connect(deployer).transfer(alice.address, expandTo18Decimals(1_000_000))
            await token.connect(deployer).transfer(carol.address, expandTo18Decimals(1_000_000))

            await token.connect(deployer).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(bob).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(carol).approve(uniswap.router.address, constants.MaxUint256)
            await token.connect(alice).approve(uniswap.router.address, constants.MaxUint256)
        }

        compoundFixture = await generateCompoundFixture(deployer, opts)

        const tst = await new OVixLensZK__factory(deployer).deploy()

        compoundSlotFactory = await new AggregationSlotFactory__factory(deployer).deploy(
            uniswap.factory.address,
            tokenData.wnative.address,
            algebra.poolDeployer.address,
            compoundFixture.underlyings.map(u => u.address),
            compoundFixture.cTokens.map(c => c.address),
            compoundFixture.cEther.address,
            compoundFixture.comptroller.address,
            compoundFixture.underlyings.length
        )

        await feedCompound(deployer, compoundFixture)
        await feedCompoundETH(deployer, compoundFixture)


        console.log("add WETH 0")
        await addUniswapLiquidity(
            deployer,
            tokenData.wnative.address,
            tokenData.tokens[0].address,
            expandTo18Decimals(100),
            expandTo18Decimals(100),
            uniswap
        )

        console.log("add 0 1")
        await addUniswapLiquidity(
            deployer,
            tokenData.tokens[0].address,
            tokenData.tokens[1].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            uniswap
        )

        console.log("add 1 2")
        await addUniswapLiquidity(
            deployer,
            tokenData.tokens[1].address,
            tokenData.tokens[2].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            uniswap
        )

        console.log("add 2 3")
        await addUniswapLiquidity(
            deployer,
            tokenData.tokens[2].address,
            tokenData.tokens[3].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            uniswap
        )

        console.log("add 3 4")
        await addUniswapLiquidity(
            deployer,
            tokenData.tokens[3].address,
            tokenData.tokens[4].address,
            expandTo18Decimals(1_000_000),
            expandTo18Decimals(1_000_000),
            uniswap
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


    it('allows collateral provision and redemption', async () => {
        const underlying = compoundFixture.underlyings[0]
        const cToken = compoundFixture.cTokens[0]
        const am = expandTo18Decimals(1)
        await underlying.connect(deployer).transfer(alice.address, am)

        await underlying.connect(alice).approve(cToken.address, am)

        await cToken.connect(alice).mint(am)

        await cToken.connect(alice).redeemUnderlying(am)
    })

    it('allows borrow and repay', async () => {

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

    it('allows to deploy standard slot', async () => {

        // strat
        // supply 3
        // borrow 0
        // supply 0
        // 
        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(_tokensInRoute, new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM), [0, 3, 3], 0)

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            owner: alice.address,
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            // path to deposit - can be empty if depo ccy = collateral
            swapPath: swapPath,
            // path for margin trade
            marginPath: path
        }

        console.log("path", path, _tokensInRoute)

        // approve
        const projAddress = await compoundSlotFactory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await compoundSlotFactory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })


    it('allows to deploy close slot', async () => {

        // strat
        // supply 3
        // borrow 0
        // supply 0
        // 
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [1, 2, 2],
            0
        )

        const params = {
            path,
            amountToRepay: 0,
            amountInMaximum: expandTo18Decimals(100)
        }
        // approve
        const projAddress = await compoundSlotFactory.getAddress(alice.address, 0)
        const slot = await new CompoundSlot__factory(alice).attach(projAddress)

        const borrowPre = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPre = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)
        console.log("Pre close", borrowPre.toString(), supplyPre.toString())
        // create
        await slot.close(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)

        expect(borrowPost.toString()).to.equal('0')
        expect(toNumber(supplyPost)).to.equal(0)
    })

    it('allows to deploy standard slot with swap-in', async () => {

        // strat
        // supply 3
        // borrow 0
        // supply 0
        // 
        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        const routeIndexesSwapIn = [2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(_tokensInRoute, new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM), [0, 3, 3], 0)

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAlgebraPathEthers(_tokensInRouteSwapIn, new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.MEDIUM), [3, 3], 0)

        const params = {
            owner: alice.address,
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            // path to deposit - can be empty if depo ccy = collateral
            swapPath: swapPath,
            // path for margin trade
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
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)
        console.log(borrowPost.toString(), supplyPost.toString())

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })


    it('allows to deploy standard slot with swap-in Ether', async () => {

        // strat
        // supply 3
        // borrow 0
        // supply 0
        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(1).div(100)
        const swapAmount = expandTo18Decimals(5).div(1000)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(_tokensInRoute, new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM), [0, 3, 3], 0)

        let _tokensInRouteSwapIn = [tokenData.wnative.address, compoundFixture.underlyings[0].address]
        const swapPath = encodeAlgebraPathEthers(_tokensInRouteSwapIn, new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.MEDIUM), [3, 3], 0)

        const params = {
            owner: alice.address,
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            // path to deposit - can be empty if depo ccy = collateral
            swapPath: swapPath,
            // path for margin trade
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
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)
        console.log(borrowPost.toString(), supplyPost.toString())
        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('allows to liquidate slot', async () => {
        const swapRoute = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)
        const depoRoute = [2, 1, 0]
        const borrowIndex = swapRoute[0]
        const supplyIndex = depoRoute[depoRoute.length - 1]

        const slot = await createSlot(alice, compoundFixture, compoundSlotFactory, depoRoute, swapRoute, depositAmount, swapAmount)
        console.log("terminal slot", slot.address)

        let _tokensInRoute = swapRoute.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(_tokensInRoute.reverse(), new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM), [4, 3, 3], 1)
        // encodePath(_tokensInRoute.reverse(), new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM))
        const amountIn = expandTo18Decimals(25)
        const liquidationParams = {
            path,
            amountIn,
            amountOutMinimum: amountIn.mul(99).div(100)
        }

        const supplyPre = await compoundFixture.cTokens[supplyIndex].balanceOf(slot.address)
        const borrowPre = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(slot.address)
        await slot.liquidatePosition(
            liquidationParams
        )
        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(slot.address)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(slot.address)
        console.log(borrowPre.toString(), supplyPre.toString())
        console.log(borrowPost.toString(), supplyPost.toString())
        expect(toNumber(borrowPre.sub(borrowPost))).to.be.lessThanOrEqual(toNumber(amountIn))
        expect(toNumber(supplyPre.sub(supplyPost))).to.be.equal(toNumber(amountIn))
        // expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })



    it('allows to deploy standard slot algebra', async () => {

        // strat
        // supply 3
        // borrow 0
        // supply 0
        // 
        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(
            _tokensInRoute,
            [FeeAmount.ALGEBRA, FeeAmount.MEDIUM, FeeAmount.MEDIUM],
            [0, 3, 3],
            0
        )

        //encodePath(_tokensInRoute, [FeeAmount.ALGEBRA, FeeAmount.MEDIUM, FeeAmount.MEDIUM])

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            owner: alice.address,
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            // path to deposit - can be empty if depo ccy = collateral
            swapPath: swapPath,
            // path for margin trade
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
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })



    it('allows to deploy standard slot algebra mixed collaterals', async () => {

        // strat
        // supply 2
        // borrow 3
        // supply 0
        // 
        const inIndex = 2
        const supplyIndex = inIndex
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(
            _tokensInRoute,
            [FeeAmount.ALGEBRA, FeeAmount.MEDIUM, FeeAmount.MEDIUM],
            [0, 3, 3],
            0
        )

        //encodePath(_tokensInRoute, [FeeAmount.ALGEBRA, FeeAmount.MEDIUM, FeeAmount.MEDIUM])

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            owner: alice.address,
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            // path to deposit - can be empty if depo ccy = collateral
            swapPath: swapPath,
            // path for margin trade
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
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('allows to deploy standard slot with swap-in Algebra only', async () => {

        // strat
        // supply 3
        // borrow 0
        // supply 0
        // 
        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        const routeIndexesSwapIn = [2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(_tokensInRoute, new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA), [0, 3, 3], 0)

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAlgebraPathEthers(_tokensInRouteSwapIn, new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.ALGEBRA), [3, 3], 0)

        const params = {
            owner: bob.address,
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            // path to deposit - can be empty if depo ccy = collateral
            swapPath: swapPath,
            // path for margin trade
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
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(projAddress)
        console.log(borrowPost.toString(), supplyPost.toString())

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('allows to liquidate slot Algebra only', async () => {
        const swapRoute = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)
        const depoRoute = [2, 3]
        const borrowIndex = swapRoute[0]
        const supplyIndex = swapRoute[swapRoute.length - 1]

        const slot = await createSlot(alice, compoundFixture, compoundSlotFactory, depoRoute, swapRoute, depositAmount, swapAmount)
        console.log("terminal slot", slot.address)

        let _tokensInRoute = swapRoute.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAlgebraPathEthers(_tokensInRoute.reverse(), new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA), [4, 3, 3], 1)
        const amountIn = expandTo18Decimals(25)
        const liquidationParams = {
            path,
            amountIn,
            amountOutMinimum: amountIn.mul(99).div(100)
        }

        const supplyPre = await compoundFixture.cTokens[supplyIndex].balanceOf(slot.address)
        const borrowPre = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(slot.address)
        await slot.liquidatePosition(
            liquidationParams
        )
        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(slot.address)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].balanceOf(slot.address)
        console.log(borrowPre.toString(), supplyPre.toString())
        console.log(borrowPost.toString(), supplyPost.toString())
        expect(toNumber(borrowPre.sub(borrowPost))).to.be.lessThanOrEqual(toNumber(amountIn) * 1.005)
        expect(toNumber(borrowPre.sub(borrowPost))).to.be.greaterThanOrEqual(toNumber(amountIn))
        expect(toNumber(supplyPre.sub(supplyPost))).to.be.equal(toNumber(amountIn))
        // expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))

        console.log("Rs", compoundFixture.underlyings[2].address)
        await slot.repaySame(compoundFixture.underlyings[2].address, 0)
    })


})

const createSlot = async (
    signer: SignerWithAddress,
    compoundFixture: CompoundFixture,
    compoundSlotFactory: AggregationSlotFactory,
    depoRoute: number[],
    swapRoute: number[],
    depositAmount: BigNumber,
    swapAmount: BigNumber
) => {

    let _tokensInRoute = swapRoute.map(t => compoundFixture.underlyings[t].address)
    const path = encodeAlgebraPathEthers(
        _tokensInRoute,
        new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
        [0, ...new Array(_tokensInRoute.length - 2).fill(3)],
        0
    )

    let _tokensInRouteSwapIn = depoRoute.map(t => compoundFixture.underlyings[t].address)
    const swapPath = depoRoute.length > 1 ? encodeAlgebraPathEthers(
        _tokensInRouteSwapIn,
        new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.ALGEBRA),
        [3, ...new Array(_tokensInRouteSwapIn.length - 2).fill(3)],
        0
    )
        : encodeAddress(compoundFixture.underlyings[depoRoute[0]].address)

    const params = {
        amountDeposited: depositAmount,
        minimumAmountDeposited: depositAmount.mul(95).div(100),
        borrowAmount: swapAmount,
        minimumMarginReceived: swapAmount.mul(95).div(100),
        // path to deposit - can be empty if depo ccy = collateral
        swapPath: swapPath,
        // path for margin trade
        marginPath: path
    }

    // approve
    const projAddress = await compoundSlotFactory.getNextAddress(signer.address)
    await approve(signer, compoundFixture.underlyings[depoRoute[0]].address, projAddress)

    // create
    await compoundSlotFactory.connect(signer).createSlot(
        params
    )

    console.log("Slot created")
    return await new AggregationSlot__factory(signer).attach(projAddress)
}


const approve = async (signer: SignerWithAddress, token: string, spender: string) => {
    const tokenConttract = await new ERC20Mock__factory(signer).attach(token)
    await tokenConttract.approve(spender, constants.MaxUint256)
}

const toNumber = (n: BigNumber | string) => {
    return Number(formatEther(n))
}