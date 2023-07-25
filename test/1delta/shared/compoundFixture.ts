import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat"
import {
  CErc20Harness,
  CErc20HarnessNoReturn,
  CErc20HarnessNoReturn__factory,
  CErc20Harness__factory,
  CEther,
  CEtherHarness__factory,
  ComptrollerHarness,
  ComptrollerHarness__factory,
  Comp__factory,
  ERC20Mock,
  FalseMarkerMethodInterestRateModel,
  FiatWithPermit,
  InterestRateModelHarness,
  InterestRateModelHarness__factory,
  JumpRateModel,
  SimplePriceOracle,
  SimplePriceOracle__factory,
  Unitroller,
  Unitroller__factory,
  WhitePaperInterestRateModel,
}
  from "../../../types"
import ComptrollerHarnessArtifact from "../../../artifacts/contracts/external-protocols/compound/test/ComptrollerHarness.sol/ComptrollerHarness.json"
import UnitrollerArtifact from "../../../artifacts/contracts/external-protocols/compound/Unitroller.sol/Unitroller.json"

export const ONE_18 = ethers.BigNumber.from(10).pow(18)
export const ZERO = ethers.BigNumber.from(0)
export const ONE = ethers.BigNumber.from(1)


export function etherMantissa(num: number | BigNumber, scale: number | BigNumber = ONE_18) {
  if (num < 0)
    return ethers.BigNumber.from(2).pow(256).add(num);
  return ethers.BigNumber.from(num).mul(scale);
}


export interface CompoundFixture {
  cTokens: (CErc20Harness | CErc20HarnessNoReturn)[]
  underlyings: (ERC20Mock | FiatWithPermit)[]
  cEther: CEther
  comptroller: ComptrollerHarness
  unitroller: Unitroller
  interestRateModels: (InterestRateModelHarness | FalseMarkerMethodInterestRateModel | WhitePaperInterestRateModel | JumpRateModel)[]
  cEthInterestRateModel: InterestRateModelHarness | FalseMarkerMethodInterestRateModel | WhitePaperInterestRateModel | JumpRateModel,
  priceOracle: SimplePriceOracle
}

export interface CompoundOptions {
  underlyings: (ERC20Mock | FiatWithPermit)[]
  collateralFactors: BigNumber[]
  exchangeRates: BigNumber[]
  borrowRates: BigNumber[]
  cEthExchangeRate: BigNumber
  cEthBorrowRate: BigNumber
  ethCollateralFactor?: BigNumber
  compRate?: BigNumber
  closeFactor?: BigNumber

}

export async function generateCompoundFixture(signer: SignerWithAddress, options: CompoundOptions, vix = false): Promise<CompoundFixture> {

  // deploy unitroller
  const unitroller = await new Unitroller__factory(signer).deploy()

  // deploy oracle
  const priceOracle = await new SimplePriceOracle__factory(signer).deploy();



  // deploy comptroller harness
  const comptrollerLogic = await new ComptrollerHarness__factory(signer).deploy()
  const comptroller = await ethers.getContractAt(
    [...ComptrollerHarnessArtifact.abi, ...UnitrollerArtifact.abi],
    unitroller.address) as ComptrollerHarness // ( await new ethers.Contract(unitroller.address,comptrollerLogic.interface)) as ComptrollerHarness


  // set implementation
  await unitroller._setPendingImplementation(comptrollerLogic.address)

  await comptrollerLogic.connect(signer)._become(unitroller.address)

  const comp = await new Comp__factory(signer).deploy(signer.address)
  const closeFactor = options?.closeFactor ?? ONE_18.mul(51).div(1000);

  const liquidationIncentive = etherMantissa(1);
  const compRate = options?.compRate ?? ONE_18;

  // set parameters
  await comptroller.connect(signer).setCompAddress(comp.address)
  await comptroller.connect(signer)._setLiquidationIncentive(liquidationIncentive);
  await comptroller.connect(signer)._setCloseFactor(closeFactor);
  await comptroller.connect(signer).harnessSetCompRate(compRate)
  await comptroller.connect(signer)._setPriceOracle(priceOracle.address);

  const interestRateModelCETH = await new InterestRateModelHarness__factory(signer).deploy(options.cEthBorrowRate)

  const cEther = await new CEtherHarness__factory(signer).deploy(
    comptroller.address,
    interestRateModelCETH.address,
    options.cEthExchangeRate,
    'cEther',
    'cETH',
    18,
    signer.address
  )

  await priceOracle.setUnderlyingPrice(cEther.address, options.cEthExchangeRate);
  await comptroller._supportMarket(cEther.address)
  await comptroller.harnessAddCompMarkets([cEther.address]);
  await comptroller._setCollateralFactor(cEther.address, options.ethCollateralFactor ?? ONE_18.mul(7).div(10))

  let cTokens: (CErc20Harness| CErc20HarnessNoReturn)[] = [], interestRateModels: InterestRateModelHarness[] = [];
  for (let i = 0; i < options.underlyings.length; i++) {
    const interestRateModel = await new InterestRateModelHarness__factory(signer).deploy(options.borrowRates[i])
    const decimals = 18;
    const symbol = 'OMG' + i;
    const name = `Erc20 ${i}`;
    const underlying = options.underlyings[i]
    const cerc20Token = await new ( vix? CErc20HarnessNoReturn__factory: CErc20Harness__factory)(signer).deploy(
      underlying.address,
      comptroller.address,
      interestRateModel.address,
      options.exchangeRates[i],
      name,
      symbol,
      decimals,
      signer.address
    );
    const cToken = cerc20Token
    cTokens.push(cToken)
    interestRateModels.push(interestRateModel)


    const price = options.exchangeRates[i];
    await priceOracle.setUnderlyingPrice(cToken.address, price);
    await comptroller._supportMarket(cToken.address)
    await comptroller.harnessAddCompMarkets([cToken.address]);
    await comptroller._setCollateralFactor(cToken.address, options.collateralFactors[i])
  }

  return {
    cEther,
    cTokens,
    comptroller,
    unitroller,
    interestRateModels,
    cEthInterestRateModel: interestRateModelCETH,
    priceOracle,
    underlyings: options.underlyings
  }
}