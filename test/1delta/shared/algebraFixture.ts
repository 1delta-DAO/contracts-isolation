import { ethers } from 'hardhat'
import { v3RouterFixture, v3RouterFixtureNoWeth } from './algebraRouter'
import { BigNumber, constants, Wallet } from 'ethers'
import {
  IWETH9,
  AlgebraNonfungiblePositionManager,
  AlgebraMockTimeSwapRouter,
  AlgebraNonfungibleTokenPositionDescriptor,
  AlgebraFactory,
  FiatWithPermit,
  FiatWithPermit__factory,
  TransparentUpgradeableProxy__factory,
  AlgebraNonfungiblePositionManager__factory,
  IERC20__factory,
  AlgebraPool__factory,
  LimitOrderManager,
  AlgebraMockTimeNonfungiblePositionManager__factory,
  AlgebraPoolDeployer
} from '../../../types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { encodePriceSqrt } from '../../uniswap-v3/periphery/shared/encodePriceSqrt'

export const MIN_TICK = -887272;
export const MAX_TICK = -MIN_TICK;

export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing


export const MaxUint128 = BigNumber.from(2).pow(128).sub(1)

export enum AlgebraFeeAmount {
  ONE = 100,
  LOW = 500,
  MEDIUM = 500,
  HIGH = 500,
}

export const ALGEBRA_TICK_SPACINGS: { [amount in AlgebraFeeAmount]: number } = {
  [AlgebraFeeAmount.ONE]: 1,
  [AlgebraFeeAmount.LOW]: 60,
  [AlgebraFeeAmount.MEDIUM]: 60,
  [AlgebraFeeAmount.HIGH]: 60,
}


export interface AlgebraFixture {
  factory: AlgebraFactory
  router: AlgebraMockTimeSwapRouter
  nft: AlgebraNonfungiblePositionManager
  nftDescriptor: AlgebraNonfungibleTokenPositionDescriptor
  lomanager: LimitOrderManager
  poolDeployer:AlgebraPoolDeployer
}

export const algebraFixture: (signer: SignerWithAddress, wethAddress: string) => Promise<AlgebraFixture> = async (signer: SignerWithAddress, wethAddress: string) => {
  console.log("Deploying Algebra contracts")
  const { factory, router, poolDeployer } = await v3RouterFixtureNoWeth(signer, wethAddress)

  const nftDescriptorLibraryFactory = await ethers.getContractFactory('AlgebraNFTDescriptor')
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy()
  const positionDescriptorFactory = await ethers.getContractFactory('AlgebraNonfungibleTokenPositionDescriptor', {
    libraries: {
      AlgebraNFTDescriptor: nftDescriptorLibrary.address,
    },
  })

  const nftDescriptor = (await positionDescriptorFactory.deploy(
    wethAddress
  )) as AlgebraNonfungibleTokenPositionDescriptor
  const proxy = await new TransparentUpgradeableProxy__factory(signer).deploy(nftDescriptor.address, signer.address, "0x");

  const nftDescriptorProxied = (await positionDescriptorFactory.attach(proxy.address)) as AlgebraNonfungibleTokenPositionDescriptor;

  const pd = await factory.poolDeployer()
  const nft = await new AlgebraMockTimeNonfungiblePositionManager__factory(signer).deploy(
    factory.address,
    wethAddress,
    nftDescriptorProxied.address,
    pd
  )

  const LOManagerFactory = await ethers.getContractFactory('LimitOrderManager')
  const lomanager = (await LOManagerFactory.deploy(
    factory.address,
    wethAddress,
    await factory.poolDeployer()
  )) as LimitOrderManager
  console.log("Algebra deployed")
  return {
    factory,
    router,
    nft,
    nftDescriptor: nftDescriptorProxied,
    lomanager,
    poolDeployer
  }
}


export async function addAlgebraLiquidity(
  signer: SignerWithAddress,
  tokenAddressA: string,
  tokenAddressB: string,
  amountA: BigNumber,
  amountB: BigNumber,
  algebra: AlgebraFixture
) {
  if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
    [tokenAddressA, tokenAddressB, amountA, amountB] = [tokenAddressB, tokenAddressA, amountB, amountA]

  await algebra.factory.createPool(tokenAddressA, tokenAddressB)

  await algebra.nft.connect(signer).createAndInitializePoolIfNecessary(
    tokenAddressA,
    tokenAddressB,
    encodePriceSqrt(1, 1)
  )

  const liquidityParams = {
    token0: tokenAddressA,
    token1: tokenAddressB,
    fee: AlgebraFeeAmount.MEDIUM,
    tickLower: getMinTick(ALGEBRA_TICK_SPACINGS[AlgebraFeeAmount.MEDIUM]),
    tickUpper: getMaxTick(ALGEBRA_TICK_SPACINGS[AlgebraFeeAmount.MEDIUM]),
    recipient: signer.address,
    amount0Desired: amountA,
    amount1Desired: amountB,
    amount0Min: 0,
    amount1Min: 0,
    deadline: 1,
  }

  const poolA = await algebra.factory.poolByPair(liquidityParams.token0, liquidityParams.token1)
  const pool = await new AlgebraPool__factory(signer).attach(poolA)
  const tA = await new ethers.Contract(tokenAddressA, IERC20__factory.createInterface(), signer)
  await tA.connect(signer).approve(algebra.nft.address, constants.MaxUint256)

  const tB = await new ethers.Contract(tokenAddressB, IERC20__factory.createInterface(), signer)
  await tB.connect(signer).approve(algebra.nft.address, constants.MaxUint256)

  console.log("Pool", pool.address)

  return algebra.nft.connect(signer).mint(liquidityParams)
}
