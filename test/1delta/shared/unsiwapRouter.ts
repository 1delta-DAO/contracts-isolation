import { ethers, waffle } from 'hardhat'
import { IWETH9, MockTimeSwapRouter, UniswapV3Factory, UniswapV3Factory__factory, WETH9__factory } from '../../../types'

import WETH9Artifact from '../contracts/WETH9.json'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'


export interface RouterFixture {
    weth9: IWETH9
    factory: UniswapV3Factory
    router: MockTimeSwapRouter
}

export async function uniswapV3RouterFixture(signer: SignerWithAddress): Promise<RouterFixture> {
    const weth9 =await new WETH9__factory(signer).deploy()
    const factory = await new UniswapV3Factory__factory(signer).deploy()
    const router = (await (await ethers.getContractFactory('MockTimeSwapRouter')).deploy(
        factory.address,
        weth9.address
    )) as MockTimeSwapRouter

    return { factory, weth9, router }
}


export interface RouterFixtureNoWETH {
    factory: UniswapV3Factory
    router: MockTimeSwapRouter
}

export async function uniswapV3RouterFixtureNoWETH(signer: SignerWithAddress, wethAddress: string): Promise<RouterFixtureNoWETH> {

    const factory = await new UniswapV3Factory__factory(signer).deploy()

    const router = (await (await ethers.getContractFactory('MockTimeSwapRouter')).deploy(
        factory.address,
        wethAddress
    )) as MockTimeSwapRouter

    return { factory, router }
}



export interface RouterFixtureMinimal {
    factory: UniswapV3Factory
}

export async function minimalUniswapV3RouterFixtureNoWETH(signer: SignerWithAddress, wethAddress: string): Promise<RouterFixtureMinimal> {

    const factory = await new UniswapV3Factory__factory(signer).deploy()

    return { factory }
}

