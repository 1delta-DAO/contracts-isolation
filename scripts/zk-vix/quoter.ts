import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { AggregationQuoter__factory } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy quoter on", chainId, "by", operator.address)

    const ALG_FF_FACTORY_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
    const ALG_POOL_CODE_HASH = '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4';

    const DOV_FF_FACTORY_ADDRESS = '0xdE474Db1Fa59898BC91314328D29507AcD0D593c';
    const DOV_POOL_INIT_CODE_HASH = '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a';

    const quoter = await new AggregationQuoter__factory(operator).deploy(
        ALG_FF_FACTORY_ADDRESS,
        DOV_FF_FACTORY_ADDRESS,
        ALG_POOL_CODE_HASH,
        DOV_POOL_INIT_CODE_HASH
    )

    console.log('Addresses')
    console.log('quoter:', quoter.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


// quoter: 0xf9b36A3FAFa4AD006b360b3CDdb7DAA72F299180
    