import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { FlexSlotFactory__factory, ImplementationProvider__factory, Slot__factory } from '../../types';

// ADDRESSES 
const ovixUnderlyings = [
    '0xa2036f0538221a77A3937F1379699f44945018d0', // Matic
    '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035', // USDC
    '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', // USDT
]

const ovixOTokens = [
    '0x8903Dc1f4736D2FcB90C1497AebBABA133DaAC76', // oMatic
    '0x68d9baA40394dA2e2c1ca05d30BF33F52823ee7B', // oUSDC
    '0xad41C77d99E282267C1492cdEFe528D7d5044253', // oUSDT
]

const ovixCEther = '0xee1727f5074E747716637e1776B7F7C7133f16b1'

const ovixComptroller = '0x6EA32f626e3A5c41547235ebBdf861526e11f482'

const zkEVMWTH = '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'

const zkAlgebraPoolDeployer = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy 1delta on", chainId, "by", operator.address)

    console.log("Deploy logic")
    console.log("Parameters",
        zkEVMWTH,
        zkAlgebraPoolDeployer,
        ovixUnderlyings,
        ovixOTokens,
        ovixCEther,
        ovixComptroller,
        ovixUnderlyings.length
    )

    const implementation = await new Slot__factory(operator).deploy(
        zkEVMWTH,
        zkAlgebraPoolDeployer,
        ovixUnderlyings,
        ovixOTokens,
        ovixCEther,
        ovixComptroller,
        ovixUnderlyings.length
    )
    await implementation.deployed()

    console.log("Deploy implementation provider")
    const implementationProvider = await new ImplementationProvider__factory(operator).deploy(implementation.address)
    await implementationProvider.deployed()

    console.log('Deploy factory')
    const factory = await new FlexSlotFactory__factory(operator).deploy(implementationProvider.address)
    await factory.deployed()


    console.log('Addresses')
    console.log('logic:', implementation.address)
    console.log('implementationProvider:', implementationProvider.address)
    console.log('factory:', factory.address)

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


// logic: 0x816EBC5cb8A5651C902Cb06659907A93E574Db0B
// implementationProvider: 0x8E24CfC19c6C00c524353CB8816f5f1c2F33c201
// factory: 0xcB6Eb8df68153cebF60E1872273Ef52075a5C297
