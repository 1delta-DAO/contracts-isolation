import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import {
    FeeOperator__factory,
} from '../../types';
import { deltaIsolationAddresses } from './addresses';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy modules on", chainId, "by", operator.address)

    console.log("feeOperator")
    // const feeOperator = await new FeeOperator__factory(operator).deploy(1000)
    // await feeOperator.deployed()
    const feeOperator = await new FeeOperator__factory(operator).attach(deltaIsolationAddresses.feeOperator)
    const dat = await feeOperator.getProtocolShare()
    console.log(dat.toString())
    console.log("fee operator deployed")
    console.log("feeOperator:", feeOperator.address)

    console.log("setup completed")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });