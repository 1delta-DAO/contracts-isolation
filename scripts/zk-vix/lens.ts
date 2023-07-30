import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { VixLens__factory } from '../../types';

async function main() {
    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy lens on", chainId, "by", operator.address)

    const lens = await new VixLens__factory(operator).deploy()
    await lens.deployed()

    console.log('Addresses')
    console.log("lens:", lens.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
