import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { EntryPoint__factory, AaveSlotLens__factory } from '../types';

const aavePool = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
const router = '0x1111111254eeb25477b68fb85ed929f73a960582'

const entryPointAddress = '0x02567769aAD16E77f974c45080b66b3e42933331'

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy 1FX Lens on", chainId, "by", operator.address)

    console.log('Lens')
    const lens = await new AaveSlotLens__factory(operator).deploy()
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

// factory: 0x648cE75895873BECBC4c9a291A28CA1EF121953B
// lens: 0xAe3C2d45270791Ef8aD023D1E66d275255db0499
// entryPoint: 0x02567769aAD16E77f974c45080b66b3e42933331
