import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import {
    AggregationRouter__factory,
} from '../../types';
import { WNATIVE_ADDRESS } from './addresses';


const ALG_FF_FACTORY_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
const ALG_POOL_CODE_HASH = '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4';

const DOV_FF_FACTORY_ADDRESS = '0xdE474Db1Fa59898BC91314328D29507AcD0D593c';
const DOV_POOL_INIT_CODE_HASH = '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy router on", chainId, "by", operator.address)
    const router = await new AggregationRouter__factory(operator).deploy(
        WNATIVE_ADDRESS,
        ALG_FF_FACTORY_ADDRESS,
        DOV_FF_FACTORY_ADDRESS,
        ALG_POOL_CODE_HASH,
        DOV_POOL_INIT_CODE_HASH
    )
    await router.deployed()
    console.log("aggregationRouter:", router.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });