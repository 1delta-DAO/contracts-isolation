import { abi as FACTORY_V2_ABI, bytecode as FACTORY_V2_BYTECODE } from '@uniswap/v2-core/build/UniswapV2Factory.json'
import { ethers } from 'hardhat'
import { AlgebraFactory, AlgebraFactory__factory, AlgebraPoolDeployer__factory, IAlgebraFactory, IWETH9, AlgebraMockTimeSwapRouter } from '../../../types'

import WNativeToken from '../contracts/WETH9.json'
import { Contract } from '@ethersproject/contracts'
import { constants, Wallet } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export const vaultAddress = '0x1d8b6fA722230153BE08C4Fa4Aa4B4c7cd01A95a';

const wnativeFixture: () => Promise<{ wnative: IWETH9 }> = async () => {
  const wnativeFactory = await ethers.getContractFactory(WNativeToken.abi, WNativeToken.bytecode);
  const wnative = (await wnativeFactory.deploy()) as IWETH9;

  return { wnative }
}

export const v2FactoryFixture: () => Promise<{ factory: Contract }> = async () => {
  const v2FactoryFactory = await ethers.getContractFactory(FACTORY_V2_ABI, FACTORY_V2_BYTECODE);
  const factory = await v2FactoryFactory.deploy(constants.AddressZero);

  return { factory }
}

const v3CoreFactoryFixture = async (signer: SignerWithAddress) => {

  // precompute
  const poolDeployerAddress = ethers.utils.getContractAddress({
    from: signer.address,
    nonce: (await signer.getTransactionCount()) + 1
  })

  const factory = await new AlgebraFactory__factory(signer).deploy(poolDeployerAddress);

  const poolDeployer = await new AlgebraPoolDeployer__factory(signer).deploy(factory.address, vaultAddress);

  return { poolDeployer, factory }
}

export const v3RouterFixture= async (signer: SignerWithAddress) => {
  const { wnative } = await wnativeFixture()
  const {factory, poolDeployer} = await v3CoreFactoryFixture(signer)
  const router = (await (await ethers.getContractFactory('AlgebraMockTimeSwapRouter')).deploy(
    factory.address,
    wnative.address,
    await factory.poolDeployer()
  )) as AlgebraMockTimeSwapRouter

  return { factory, wnative, router, poolDeployer }
}


export const v3RouterFixtureNoWeth= async (signer: SignerWithAddress, wethAddress: string) => {
  const {factory, poolDeployer} = await v3CoreFactoryFixture(signer)
  const router = (await (await ethers.getContractFactory('AlgebraMockTimeSwapRouter')).deploy(
    factory.address,
    wethAddress,
    await factory.poolDeployer()
  )) as AlgebraMockTimeSwapRouter

  return { factory, router, poolDeployer }
}
