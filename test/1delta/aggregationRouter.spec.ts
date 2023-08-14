import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, waffle } from 'hardhat'
import {
    ERC20Mock__factory,
    AggregationRouter,
    AggregationRouter__factory
} from '../../types';
import { BigNumber, constants } from 'ethers';
import { expandTo18Decimals } from '../uniswap-v3/core/shared/utilities';
import { encodeAggregtorPathEthersRouter } from '../uniswap-v3/periphery/shared/path';
import { formatEther } from 'ethers/lib/utils';
import { addAlgebraLiquidity, algebraFixture, AlgebraFixture } from './shared/algebraFixture';
import { tokenFixture, TokenFixture } from './shared/tokensFixture';
import { MockProvider } from 'ethereum-waffle';
import { addUniswapLiquidity, uniswapMinimalFixtureNoTokens, UniswapMinimalFixtureNoTokens } from './shared/uniswapFixture';
import { FeeAmount } from '../uniswap-v3/periphery/shared/constants';

const approve = async (signer: SignerWithAddress, token: string, spender: string) => {
    const tokenConttract = await new ERC20Mock__factory(signer).attach(token)
    await tokenConttract.approve(spender, constants.MaxUint256)
}

const toNumber = (n: BigNumber | string) => {
    return Number(formatEther(n))
}

const ALG_POOL_CODE_HASH = '0x15b69bf972c5c2df89dd7772b62e872d4048b3741a214df60be904ec5620d9df';
const DOV_POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';


// Tests all configurations for the minimal slot variant
describe('Aggragtion Router', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let partner: SignerWithAddress
    let uniswap: UniswapMinimalFixtureNoTokens
    let algebra: AlgebraFixture
    let tokenData: TokenFixture
    let provider: MockProvider
    let aggregationRouter: AggregationRouter

    before('get wallets and fixture', async () => {
        [deployer, alice, bob, carol, partner] = await ethers.getSigners();
        tokenData = await tokenFixture(deployer, 6)
        algebra = await algebraFixture(deployer, tokenData.wnative.address)
        uniswap = await uniswapMinimalFixtureNoTokens(deployer, tokenData.wnative.address)
        provider = waffle.provider;

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

        aggregationRouter = await new AggregationRouter__factory(deployer).deploy(
            tokenData.wnative.address,
            algebra.poolDeployer.address,
            uniswap.factory.address,
            ALG_POOL_CODE_HASH,
            DOV_POOL_INIT_CODE_HASH,

        )


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



    it.only('SINGLE: allows to swap exact in', async () => {

        const inIndex = 3
        const routeIndexes = [3, 2]
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => tokenData.tokens[t].address)
        console.log("route", _tokensInRoute, alice.address)
        const path = encodeAggregtorPathEthersRouter(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [1],
        )

        await approve(alice, _tokensInRoute[0], aggregationRouter.address)


        await aggregationRouter.connect(alice).exactInput(
            swapAmount,
            swapAmount.mul(95).div(100),
            alice.address,
            path,
        )

    })

    it.only('SINGLE: allows to swap exact out', async () => {

        const inIndex = 3
        const routeIndexes = [2, 3]
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => tokenData.tokens[t].address).reverse()
        console.log("route", _tokensInRoute, alice.address)
        const path = encodeAggregtorPathEthersRouter(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [0],
        )

        await approve(alice, _tokensInRoute[_tokensInRoute.length - 1], aggregationRouter.address)


        await aggregationRouter.connect(alice).exactOutput(
            swapAmount,
            swapAmount.mul(105).div(100),
            alice.address,
            path,
        )

    })

    it.only('MULTI: allows to swap exact in', async () => {

        const inIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => tokenData.tokens[t].address)
        console.log("route", _tokensInRoute, alice.address)
        const path = encodeAggregtorPathEthersRouter(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [1, 0, 1],
        )

        await approve(alice, _tokensInRoute[0], aggregationRouter.address)


        await aggregationRouter.connect(alice).exactInput(
            swapAmount,
            swapAmount.mul(95).div(100),
            alice.address,
            path,
        )

    })

    it.only('MULTI: allows to swap exact out', async () => {

        const inIndex = 3
        const routeIndexes = [3, 2, 1, 0]
        const swapAmount = expandTo18Decimals(50)

        let _tokensInRoute = routeIndexes.map(t => tokenData.tokens[t].address).reverse()
        console.log("route", _tokensInRoute, alice.address)
        const path = encodeAggregtorPathEthersRouter(
            _tokensInRoute,
            new Array(_tokensInRoute.length - 1).fill(FeeAmount.MEDIUM),
            [1, 1, 0],
        )

        await approve(alice, _tokensInRoute[_tokensInRoute.length - 1], aggregationRouter.address)


        await aggregationRouter.connect(alice).exactOutput(
            swapAmount,
            swapAmount.mul(105).div(100),
            alice.address,
            path,
        )

    })


})


// ·---------------------------------------------------------------------------------------------------------------------|---------------------------|-----------|-----------------------------·
// |                                                Solc version: 0.8.15                                                 ·  Optimizer enabled: true  ·  Runs: 1  ·  Block limit: 30000000 gas  │
// ······················································································································|···························|···········|······························
// |  Methods                                                                                                            ·              34 gwei/gas              ·       1862.68 usd/eth       │
// ···········································································|··········································|·············|·············|···········|···············|··············
// |  Contract                                                    ·  Method                                              ·  Min        ·  Max        ·  Avg      ·  # calls      ·  usd (avg)  │
// ·······························································|······················································|·············|·············|···········|···············|··············
// |  AggregationRouter                                           ·  exactInput                                          ·          -  ·          -  ·   318996  ·            1  ·       7.66  │
// ·······························································|······················································|·············|·············|···········|···············|··············
// |  AggregationRouter                                           ·  exactOutput                                         ·          -  ·          -  ·   308175  ·            1  ·       7.40  │
// ·······························································|······················································|·············|·············|···········|···············|··············
