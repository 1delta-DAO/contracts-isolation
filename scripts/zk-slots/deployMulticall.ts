import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { Multicall2__factory,  } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy multicall on", chainId, "by", operator.address)

    const multicall = await new Multicall2__factory(operator).deploy()
    await multicall.deployed()

    console.log("multicall:", multicall.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

    // multicall: 0xCe434378adacC51d54312c872113D687Ac19B516

