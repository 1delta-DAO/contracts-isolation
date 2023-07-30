import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { DataProvider__factory } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy dataProvider on", chainId, "by", operator.address)

    const dataProvider = await new DataProvider__factory(operator).deploy()

    console.log('Addresses')
    console.log('dataProvider:', dataProvider.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });