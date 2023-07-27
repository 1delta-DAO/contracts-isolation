import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, waffle } from 'hardhat'
import {
    DataProvider,
    DataProvider__factory,
    AggregationQuoter,
    AggregationQuoter__factory
} from '../../types';
import { constants } from 'ethers';
import { expandTo18Decimals } from '../uniswap-v3/core/shared/utilities';
import { encodePath } from '../uniswap-v3/periphery/shared/path';
import { addAlgebraLiquidity, algebraFixture, AlgebraFixture } from './shared/algebraFixture';
import { tokenFixture, TokenFixture } from './shared/tokensFixture';
import { MockProvider } from 'ethereum-waffle';
import { addUniswapLiquidity, uniswapMinimalFixtureNoTokens, UniswapMinimalFixtureNoTokens } from './shared/uniswapFixture';
import { FeeAmount } from '../uniswap-v3/periphery/shared/constants';

const ALG_POOL_CODE_HASH = '0x15b69bf972c5c2df89dd7772b62e872d4048b3741a214df60be904ec5620d9df';
const DOV_POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';


// Tests all configurations for the minimal slot variant
describe('Diamond Slot aggregation trading via data provider', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let uniswap: UniswapMinimalFixtureNoTokens
    let algebra: AlgebraFixture
    let tokenData: TokenFixture
    let provider: MockProvider
    let dataProvider: DataProvider
    let quoter: AggregationQuoter

    before('get wallets and fixture', async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();
        tokenData = await tokenFixture(deployer, 6)
        algebra = await algebraFixture(deployer, tokenData.wnative.address)
        uniswap = await uniswapMinimalFixtureNoTokens(deployer, tokenData.wnative.address)
        provider = waffle.provider;

        dataProvider = await new DataProvider__factory(deployer).deploy()

        quoter = await new AggregationQuoter__factory(deployer).deploy(
            algebra.poolDeployer.address,
            uniswap.factory.address,
            ALG_POOL_CODE_HASH,
            DOV_POOL_INIT_CODE_HASH
        )

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


    it('QUOTER: quotes mixed exactIn', async () => {
        const routeIndexes = [3, 2, 1, 0]
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => tokenData.tokens[t].address)
        console.log("_tokensInRoute", _tokensInRoute)
        const path = encodePath(
            _tokensInRoute,
            [FeeAmount.ALGEBRA, FeeAmount.MEDIUM, FeeAmount.MEDIUM],
        )

        const quote = await quoter.callStatic.quoteExactInput(
            path,
            swapAmount
        )
        console.log(quote.toString())

    })

    it('QUOTER: quotes mixed exactOut', async () => {
        const routeIndexes = [3, 2, 1, 0]
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => tokenData.tokens[t].address)
        const path = encodePath(
            _tokensInRoute,
            [FeeAmount.ALGEBRA, FeeAmount.MEDIUM, FeeAmount.MEDIUM],
        )

        const quote = await quoter.callStatic.quoteExactOutput(
            path,
            swapAmount
        )
        console.log(quote.toString())

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

