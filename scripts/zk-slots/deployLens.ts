import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { OVixLensZK__factory } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy lens on", chainId, "by", operator.address)

    const lens = await new OVixLensZK__factory(operator).deploy()
    await lens.deployed()

    console.log("lens:", lens.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


    // new
    // lens: 0x3011271f49E0eA9D481cf0c0a6d343b458107F4c

    // old
    // lens: 0x830d7Fb34Cf45BD0F9A5A8f4D899998c692541e2

