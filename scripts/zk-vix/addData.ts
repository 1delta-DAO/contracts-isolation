import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { DataProvider__factory } from '../../types';
import { deltaIsolationAddresses } from './addresses';

const VIX_COMPTROLLER = '0x6EA32f626e3A5c41547235ebBdf861526e11f482'

const O_NATIVE = '0xee1727f5074E747716637e1776B7F7C7133f16b1'
const O_USDT = '0xad41C77d99E282267C1492cdEFe528D7d5044253'
const O_MATIC = '0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76'
const O_USDC = '0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B'
// const O_WBTC = '0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B'


const usdtAddress = "0x1E4a5963aBFD975d8c9021ce480b42188849D41d"
const usdcAddress = "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035"
const daiAddress = '0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4'
const wethAddress = '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'
const wbtcAddress = '0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1'
const maticAddress = '0xa2036f0538221a77A3937F1379699f44945018d0'

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy dataProvider on", chainId, "by", operator.address)

    const dataProvider = await new DataProvider__factory(operator).attach(deltaIsolationAddresses.dataProvider)

    let tx = await dataProvider.setComptroller(VIX_COMPTROLLER)
    await tx.wait()

    tx = await dataProvider.setOEther(O_NATIVE)
    await tx.wait()

    tx = await dataProvider.setOToken(usdtAddress, O_USDT)
    await tx.wait()

    tx = await dataProvider.setOToken(maticAddress, O_MATIC)
    await tx.wait()

    tx = await dataProvider.setOToken(usdcAddress, O_USDC)
    await tx.wait()

    // tx = await dataProvider.setOToken(wbtcAddress, O_WBTC)
    // await tx.wait()
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });