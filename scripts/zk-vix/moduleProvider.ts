import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { DeltaModuleProvider__factory, VixLens__factory } from '../../types';

async function main() {
    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy lens on", chainId, "by", operator.address)

    console.log("moduleProvider")
    const moduleProvider = await new DeltaModuleProvider__factory(operator).deploy()
    await moduleProvider.deployed()
    console.log("moduleProvider deployed")
    console.log("moduleProvider:", moduleProvider.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
