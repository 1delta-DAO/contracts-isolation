import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, network, waffle } from 'hardhat'
import { expect } from './shared/expect'
import { CompoundFixture, CompoundOptions, generateCompoundFixture, ONE_18, ZERO } from './shared/compoundFixture'
import {
    ERC20Mock__factory,
    OVixLensZK__factory,
    OVixLensZK,
    FiatWithPermit,
    DeltaModuleProvider,
    DeltaModuleProvider__factory,
    VixSlotFactory,
    SlotFactoryProxy__factory,
    VixSlotFactory__factory,
    DataProvider,
    DataProvider__factory,
    VixDirect,
    VixDirect__factory,
    VixInitializeAggregator,
    AggregatorCallback,
    AggregatorCallback__factory,
    VixInitializeAggregator__factory,
    FeeOperator,
    FeeOperator__factory
} from '../../types';
import { BigNumber, constants } from 'ethers';
import { expandTo18Decimals } from '../uniswap-v3/core/shared/utilities';
import { feedCompound, feedCompoundETH } from './shared/misc';
import { encodeAddress, encodeAggregtorPathEthers } from '../uniswap-v3/periphery/shared/path';
import { formatEther } from 'ethers/lib/utils';
import { addAlgebraLiquidity, algebraFixture, AlgebraFixture } from './shared/algebraFixture';
import { tokenFixture, TokenFixture } from './shared/tokensFixture';
import { MockProvider } from 'ethereum-waffle';
import { produceSig } from './shared/permitUtils';
import { getSelectors, ModuleConfigAction } from './helpers/diamond';
import { addUniswapLiquidity, uniswapMinimalFixtureNoTokens, UniswapMinimalFixtureNoTokens } from './shared/uniswapFixture';
import { FeeAmount } from '../uniswap-v3/periphery/shared/constants';

const approve = async (signer: SignerWithAddress, token: string, spender: string) => {
    const tokenConttract = await new ERC20Mock__factory(signer).attach(token)
    await tokenConttract.approve(spender, constants.MaxUint256)
}

const toNumber = (n: BigNumber | string) => {
    return Number(formatEther(n))
}

// Tests all configurations for the minimal slot variant
describe('Diamond Slot aggregation trading via data provider', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let partner: SignerWithAddress
    let compoundFixture: CompoundFixture
    let opts: CompoundOptions
    let uniswap: UniswapMinimalFixtureNoTokens
    let algebra: AlgebraFixture
    let tokenData: TokenFixture
    let provider: MockProvider
    let lens: OVixLensZK
    let moduleProvider: DeltaModuleProvider
    let factory: VixSlotFactory
    let factoryImplementation: VixSlotFactory
    let callback: AggregatorCallback
    let dataProvider: DataProvider
    let initializer: VixInitializeAggregator
    let direct: VixDirect
    let feeOperator: FeeOperator
    let defaultFee: BigNumber
    // collects fee for partner
    let partnerVault: FeeOperator
    let protocolFee: BigNumber

    before('get wallets and fixture', async () => {
        [deployer, alice, bob, carol, partner] = await ethers.getSigners();
        tokenData = await tokenFixture(deployer, 6)
        algebra = await algebraFixture(deployer, tokenData.wnative.address)
        uniswap = await uniswapMinimalFixtureNoTokens(deployer, tokenData.wnative.address)
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
        dataProvider = await new DataProvider__factory(deployer).deploy()
        defaultFee = BigNumber.from(50) // 0.5%
        protocolFee = BigNumber.from(3000) // 30%
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

        compoundFixture = await generateCompoundFixture(deployer, opts, true)

        for (let i = 0; i < compoundFixture.underlyings.length; i++) {
            const asset = compoundFixture.underlyings[i]
            await dataProvider.setOToken(asset.address, compoundFixture.cTokens[i].address)
        }

        await dataProvider.setComptroller(compoundFixture.comptroller.address)
        await dataProvider.setOEther(compoundFixture.cEther.address)


        const factoryProxy = await new SlotFactoryProxy__factory(deployer).deploy()


        partnerVault = await new FeeOperator__factory(partner).deploy(0)

        lens = await new OVixLensZK__factory(deployer).deploy()
        feeOperator = await new FeeOperator__factory(deployer).deploy(protocolFee)

        moduleProvider = await new DeltaModuleProvider__factory(deployer).deploy()

        callback = await new AggregatorCallback__factory(deployer).deploy(
            algebra.poolDeployer.address,
            uniswap.factory.address,
            dataProvider.address,
            tokenData.wnative.address
        )
        initializer = await new VixInitializeAggregator__factory(deployer).deploy(
            algebra.poolDeployer.address,
            uniswap.factory.address,
            dataProvider.address,
            tokenData.wnative.address,
            feeOperator.address
        )
        direct = await new VixDirect__factory(deployer).deploy(
            dataProvider.address,
            tokenData.wnative.address,
            factoryProxy.address

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


        factoryImplementation = await new VixSlotFactory__factory(deployer).deploy()

        await factoryProxy._setPendingImplementation(factoryImplementation.address)
        await factoryImplementation._become(factoryProxy.address)

        factory = await new VixSlotFactory__factory(deployer).attach(factoryProxy.address)


        await factory.initialize(
            moduleProvider.address,
            dataProvider.address
        )

        await feedCompound(deployer, compoundFixture)
        await feedCompoundETH(deployer, compoundFixture)


        // ALGEBRA LIQUDITY

        console.log("add WETH 0")
        await addAlgebraLiquidity(
            deployer,
            tokenData.wnative.address,
            tokenData.tokens[0].address,
            expandTo18Decimals(1_000),
            expandTo18Decimals(1_000),
            algebra
        )

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

        // UNISWAP LIQUIDITY

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
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [0, 3, 3],
            [1, 1, 1],
            0
        )

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })


    it('GENERAL: prevents using a too high fee', async () => {

        const inIndex = 0
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [0, 3, 3],
            [1, 1, 1],
            0
        )

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: 500, // 5%
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await expect(factory.connect(alice).createSlot(
            params
        )).to.be.revertedWith("feeTooHigh()")
    })

    it('SINGLE PERMIT: allows to deploy standard slot', async () => {

        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
            [0, 3, 3],
            [0, 0, 0],
            0
        )

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        // sign
        const projAddress = await factory.getNextAddress(alice.address)
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
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path,
            permit: sig
        }

        // create
        await factory.connect(alice).createSlotWithPermit(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })


    it('MULTI PERMIT: allows to deploy standard slot swap-in', async () => {
        const inIndex = 2
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(5)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
            [0, 3, 3],
            [0, 0, 0],
            0
        )

        const routeIndexesSwapIn = [2, 1, 0]
        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAggregtorPathEthers(
            _tokensInRouteSwapIn,
            [FeeAmount.MEDIUM, FeeAmount.ALGEBRA],
            [3, 3],
            [1, 0],
            0
        )

        // sign
        const projAddress = await factory.getNextAddress(alice.address)
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
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path,
            permit: sig
        }

        // create
        await factory.connect(alice).createSlotWithPermit(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived))
    })

    it('MULTI PERMIT TO ETH: allows to deploy standard slot swap-in to ETH', async () => {

        const inIndex = 1
        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA],
            [0],
            [0],
            0
        )

        const projAddress = await factory.getNextAddress(bob.address)
        const sigVRS = await produceSig(bob, projAddress, compoundFixture.underlyings[inIndex] as FiatWithPermit, depositAmount.toString())

        const sig = {
            owner: bob.address,
            spender: projAddress,
            value: depositAmount,
            deadline: ethers.constants.MaxUint256,
            v: sigVRS.split.v,
            r: sigVRS.split.r,
            s: sigVRS.split.s
        }

        const swapPath = encodeAggregtorPathEthers(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [3, 3],
            [0, 0],
            0
        )

        const params = {
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(94).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path,
            permit: sig
        }

        // create
        await factory.connect(bob).createSlotWithPermit(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(params.minimumAmountDeposited)))
    })


    it('BASIC: allows standard repay and withdrawal on slot / gatekeep', async () => {

        const inIndex = 0
        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const depositAmount = expandTo18Decimals(100)
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [0, 3, 3],
            [1, 1, 1],
            0
        )

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(99).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(alice).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        const slot = await VixDirect__factory.connect(projAddress, alice)

        const balPre = await compoundFixture.underlyings[supplyIndex].balanceOf(alice.address)


        await approve(alice, compoundFixture.underlyings[borrowIndex].address, projAddress)
        await slot.repay(borrowPost)
        await slot.withdraw(supplyPost.mul(1e15 - 1).div(1e15), compoundFixture.underlyings[supplyIndex].address, false)

        const borrowPostRepay = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostWithdrawal = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostRepay.lte(1000)).to.equal(true)
        expect(supplyPostWithdrawal.lte(1e12)).to.equal(true)
        const balPost = await compoundFixture.underlyings[supplyIndex].balanceOf(alice.address)

        expect(toNumber(balPost.sub(balPre))).to.greaterThanOrEqual(toNumber(supplyPost) * 0.999)
        const pathVaid = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [1, 2, 2],
            [1, 1, 1],
            0
        )
        const genSlot = await VixInitializeAggregator__factory.connect(projAddress, alice)
        await expect(genSlot.connect(deployer).close(
            expandTo18Decimals(40),
            expandTo18Decimals(100),
            partnerVault.address,
            defaultFee,
            pathVaid
        )).to.be.revertedWith("OnlyOwner()")

    })


    it('CLOSE: to close slot', async () => {

        const supplyIndex = 0
        const borrowIndex = 3
        const routeIndexes = [3, 2, 1, 0]

        let _tokensInRoute = routeIndexes.map(t => compoundFixture.underlyings[t].address)
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
            [1, 2, 2],
            [0, 0, 0],
            0
        )
        // approve
        const projAddress = await factory.getAddress(alice.address, 0)
        const slot = await VixInitializeAggregator__factory.connect(projAddress, alice)

        // close
        await slot.close(
            0,
            expandTo18Decimals(100),
            partnerVault.address,
            defaultFee,
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
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            [FeeAmount.MEDIUM, FeeAmount.ALGEBRA, FeeAmount.MEDIUM],
            [0, 3, 3],
            [1, 0, 1],
            0
        )

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAggregtorPathEthers(
            _tokensInRouteSwapIn,
            [FeeAmount.MEDIUM, FeeAmount.ALGEBRA],
            [3, 3],
            [1, 0],
            0
        )

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(alice).createSlot(
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
        const path = encodeAggregtorPathEthers(_tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [0, 3, 3],
            [1, 1, 1],
            0
        )

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAggregtorPathEthers(
            _tokensInRouteSwapIn,
            new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.MEDIUM),
            [3, 3],
            [1, 1],
            0
        )


        // approve
        const projAddress = await factory.getNextAddress(alice.address)
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
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path,
            permit: sig
        }

        // create
        await factory.connect(alice).createSlotWithPermit(
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
        const path = encodeAggregtorPathEthers(
            _tokensInRoute, new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
            [0, 3, 3],
            [0, 0, 0],
            0
        )

        let _tokensInRouteSwapIn = [tokenData.wnative.address, compoundFixture.underlyings[0].address]
        const swapPath = encodeAggregtorPathEthers(
            _tokensInRouteSwapIn,
            new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.ALGEBRA),
            [3],
            [0],
            0
        )

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(alice).createSlot(
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
        const path = encodeAggregtorPathEthers(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
            [0, 3, 3],
            [0, 0, 0],
            0
        )

        const swapPath = encodeAddress(compoundFixture.underlyings[inIndex].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(alice.address)
        await approve(alice, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(alice).createSlot(
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
        const path = encodeAggregtorPathEthers(
            _tokensInRoute, new Array(_tokensInRoute.length - 1).fill(FeeAmount.ALGEBRA),
            [0, 3, 3],
            [0, 0, 0],
            0
        )

        let _tokensInRouteSwapIn = routeIndexesSwapIn.map(t => compoundFixture.underlyings[t].address)
        const swapPath = encodeAggregtorPathEthers(
            _tokensInRouteSwapIn,
            new Array(_tokensInRouteSwapIn.length - 1).fill(FeeAmount.ALGEBRA),
            [3, 3],
            [0, 0],
            0)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[supplyIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(params.minimumAmountDeposited)))
    })

    it.only('SINGLE: allows to deploy standard slot ETH collateral and close', async () => {

        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA],
            [0],
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
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)

        // create
        await factory.connect(bob).createSlot(
            params,
            { value: depositAmount }
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await VixInitializeAggregator__factory.connect(projAddress, bob)


        const closePath = encodeAggregtorPathEthers(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA],
            [1],
            [0],
            0
        )
        const balBefore = await provider.getBalance(bob.address);

        await slot.close(
            0,
            swapAmount.mul(105).div(100),
            partnerVault.address,
            defaultFee,
            closePath
        )
        const balAfter = await provider.getBalance(bob.address);
        const borrowPostClose = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(105).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })

    it('WITHDRAW ETH: Allows to withdraw ETH', async () => {

        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA],
            [0],
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
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)

        // create
        await factory.connect(bob).createSlot(
            params,
            { value: depositAmount }
        )

        const slot = await VixDirect__factory.connect(projAddress, bob)

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        await approve(bob, compoundFixture.underlyings[borrowIndex].address, projAddress)
        await slot.repay(borrowPost)
        const balBeforeWithdraw = await provider.getBalance(bob.address)
        await slot.withdraw(supplyPost.mul(1e15 - 1).div(1e15), tokenData.wnative.address, false)
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

        const path = encodeAggregtorPathEthers(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA],
            [0],
            [0],
            0
        )

        const swapPath = encodeAggregtorPathEthers(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [3, 3],
            [0, 0],
            0
        )

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(90).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(90).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(params.minimumAmountDeposited)))


        const slot = await VixInitializeAggregator__factory.connect(projAddress, bob)


        const closePath = encodeAggregtorPathEthers(
            [tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA],
            [1],
            [0],
            0
        )
        const balBefore = await provider.getBalance(bob.address);

        await slot.close(
            0,
            swapAmount.mul(110).div(100),
            partnerVault.address,
            defaultFee,
            closePath
        )
        const balAfter = await provider.getBalance(bob.address);
        const borrowPostClose = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(108).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('SINGLE: allows to deploy standard slot ETH debt and close', async () => {

        const inIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.wnative.address, tokenData.tokens[0].address],
            [FeeAmount.ALGEBRA],
            [0],
            [0],
            0
        )

        const swapPath = encodeAddress(tokenData.tokens[0].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(90).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(90).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await VixInitializeAggregator__factory.connect(projAddress, bob)


        const closePath = encodeAggregtorPathEthers(
            [tokenData.wnative.address, tokenData.tokens[0].address],
            [FeeAmount.ALGEBRA],
            [1],
            [0],
            0
        )
        const balBefore = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);

        await slot.close(
            0,
            swapAmount.mul(110).div(100),
            partnerVault.address,
            defaultFee,
            closePath
        )
        const balAfter = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);
        const borrowPostClose = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(105).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('REPAY ETH: Allows repay of ETH', async () => {

        const inIndex = 0
        const borrowIndex = 0
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.wnative.address, tokenData.tokens[0].address],
            [FeeAmount.ALGEBRA],
            [0],
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
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)

        const slot = await VixDirect__factory.connect(projAddress, bob)

        await slot.repay(0, { value: borrowPost })

        const borrowPostRepay = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)

        expect(borrowPostRepay.lte(1000)).to.equal(true)
    })

    it('MULTI: allows to deploy standard slot ETH collateral and close', async () => {


        const borrowIndex = 1
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [0, 3],
            [0, 0],
            0
        )

        const swapPath = encodeAddress(tokenData.wnative.address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(90).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(90).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)

        // create
        await factory.connect(bob).createSlot(
            params,
            { value: depositAmount }
        )

        const borrowPost = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)) * 0.95)


        const slot = await VixInitializeAggregator__factory.connect(projAddress, bob)


        const closePath = encodeAggregtorPathEthers(
            [tokenData.tokens[1].address, tokenData.tokens[0].address, tokenData.wnative.address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [1, 2],
            [0, 0],
            0
        )
        const balBefore = await provider.getBalance(bob.address);
        const supplyPreClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        await slot.close(
            0,
            swapAmount.mul(110).div(100),
            partnerVault.address,
            defaultFee,
            closePath
        )
        const balAfter = await provider.getBalance(bob.address);
        const borrowPostClose = await compoundFixture.cTokens[borrowIndex].callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cEther.callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(105).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('MULTI: allows to deploy standard slot ETH debt and close', async () => {

        const inIndex = 1
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.wnative.address, tokenData.tokens[0].address, tokenData.tokens[1].address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [0, 3],
            [0, 0],
            0
        )

        const swapPath = encodeAddress(tokenData.tokens[1].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(90).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(90).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await VixInitializeAggregator__factory.connect(projAddress, bob)


        const closePath = encodeAggregtorPathEthers(
            [tokenData.wnative.address, tokenData.tokens[0].address, tokenData.tokens[1].address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [1, 2],
            [0, 0],
            0
        )
        const balBefore = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);

        await slot.close(
            0,
            swapAmount.mul(110).div(100),
            partnerVault.address,
            defaultFee,
            closePath
        )
        const balAfter = await compoundFixture.underlyings[inIndex].balanceOf(bob.address);
        const borrowPostClose = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPostClose = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPostClose.toString()).to.equal('0')
        expect(supplyPostClose.toString()).to.equal('0')

        expect(toNumber(balAfter.sub(balBefore).mul(105).div(100))).to.greaterThanOrEqual(toNumber(depositAmount))
    })


    it('TRANSFER: can transfer a slot', async () => {

        const inIndex = 1
        const depositAmount = expandTo18Decimals(10)
        const swapAmount = expandTo18Decimals(4)

        const path = encodeAggregtorPathEthers(
            [tokenData.wnative.address, tokenData.tokens[0].address, tokenData.tokens[1].address],
            [FeeAmount.ALGEBRA, FeeAmount.ALGEBRA],
            [0, 3],
            [0, 0],
            0
        )

        const swapPath = encodeAddress(tokenData.tokens[1].address)

        const params = {
            amountDeposited: depositAmount,
            minimumAmountDeposited: depositAmount.mul(95).div(100),
            borrowAmount: swapAmount,
            minimumMarginReceived: swapAmount.mul(95).div(100),
            swapPath: swapPath,
            partner: partnerVault.address,
            fee: defaultFee,
            marginPath: path
        }

        // approve
        const projAddress = await factory.getNextAddress(bob.address)
        await approve(bob, compoundFixture.underlyings[inIndex].address, projAddress)

        // create
        await factory.connect(bob).createSlot(
            params
        )

        const borrowPost = await compoundFixture.cEther.callStatic.borrowBalanceCurrent(projAddress)
        const supplyPost = await compoundFixture.cTokens[inIndex].callStatic.balanceOfUnderlying(projAddress)

        expect(borrowPost.toString()).to.equal(swapAmount.toString())
        expect(toNumber(supplyPost)).to.greaterThan(toNumber(params.minimumMarginReceived.add(depositAmount)))


        const slot = await VixDirect__factory.connect(projAddress, bob)

        await slot.transferSlot(alice.address)
        const newOwner = await slot.getOwner()
        expect(newOwner).to.equal(alice.address)
        const slotsAlice = await factory.getSlots(alice.address)
        const slotsBob = await factory.getSlots(bob.address)
        expect(!slotsBob.includes(slot.address)).to.eq(true)
        expect(slotsAlice.includes(slot.address)).to.eq(true)
    })

    it('ADMIN: fees are actually accruing in correct ration partner:protocol', async () => {
        const TENK = BigNumber.from(10_000)
        let fees = ZERO;
        let feesPartner = ZERO;
        for (let i = 0; i < tokenData.tokens.length; i++) {
            const bal = await tokenData.tokens[i].balanceOf(feeOperator.address)
            const balPartner = await tokenData.tokens[i].balanceOf(partnerVault.address)
            fees = fees.add(bal)
            feesPartner = feesPartner.add(balPartner)
        }

        // validate that fees are non zero
        expect(fees.gt(0)).to.eq(true)
        const ethBal = await provider.getBalance(feeOperator.address);
        expect(ethBal.gt(0)).to.eq(true)

        // validate that partner fees are non zero
        expect(feesPartner.gt(0)).to.eq(true)
        const ethBalPartner = await provider.getBalance(partnerVault.address);
        expect(ethBalPartner.gt(0)).to.eq(true)

        // validates that the split is in fact correct
        expect(toNumber(fees.mul(TENK.sub(protocolFee)))).to.equal(toNumber(feesPartner.mul(protocolFee)))
        expect(toNumber(ethBal.mul(TENK.sub(protocolFee)))).to.equal(toNumber(ethBalPartner.mul(protocolFee)))
    })

    it('ADMIN: can withdraw', async () => {
        let fees = ZERO;
        for (let i = 0; i < tokenData.tokens.length; i++) {
            const bal = await tokenData.tokens[i].balanceOf(feeOperator.address)
            if (bal.gt(0)) {
                await feeOperator.withdraw(tokenData.tokens[i].address, deployer.address)
                const balNew = await tokenData.tokens[i].balanceOf(feeOperator.address)
                expect(balNew.eq(0)).to.eq(true)
            }
        }
        const ethBal = await provider.getBalance(feeOperator.address);
        if (ethBal.gt(0)) {
            await feeOperator.withdraw(constants.AddressZero, deployer.address)
        }
        const ethBalPost = await provider.getBalance(feeOperator.address);
        expect(ethBalPost.eq(0)).to.eq(true)
    })

    it('LENS: shows slots', async () => {
        const data = await lens.callStatic.getUserSlots(alice.address, factory.address)
        expect(data.length).to.greaterThanOrEqual(1)
    })
})


// ·---------------------------------------------------------------------------------------------------------------------|---------------------------|-----------|-----------------------------·
// |                                                Solc version: 0.8.15                                                 ·  Optimizer enabled: true  ·  Runs: 1  ·  Block limit: 30000000 gas  │
// ······················································································································|···························|···········|······························
// |  Methods                                                                                                            ·              34 gwei/gas              ·       1862.68 usd/eth       │
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  Contract                                                                ·  Method                                  ·  Min        ·  Max        ·  Avg      ·  # calls      ·  usd (avg)  │
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  AdminUpgradeabilityProxy                                                ·  changeAdmin                             ·          -  ·          -  ·    31903  ·            1  ·       2.02  │
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  AggregationSlotFactory                                                  ·  createSlot                              ·     846487  ·    1188456  ·  1010289  ·           13  ·      63.98  │
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  AggregationSlotFactory                                                  ·  createSlotWithPermit                    ·    1098133  ·    1160384  ·  1129259  ·            2  ·      71.52  │
// ···········································································|··········································|·············|·············|···········|···············|··············

// w fee
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  VixSlotFactory                                                          ·  createSlot                              ·     853874  ·    1212350  ·  1008561  ·           14  ·      26.49  │
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  VixSlotFactory                                                          ·  createSlotWithPermit                    ·    1046654  ·    1249110  ·  1151728  ·            4  ·      30.25  │
// ···········································································|··········································|·············|·············|···········|···············|··············
