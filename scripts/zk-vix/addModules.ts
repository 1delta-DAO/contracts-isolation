import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { getSelectors, ModuleConfigAction } from '../../test/1delta/helpers/diamond';
import {
    AggregatorCallback__factory,
    DeltaModuleProvider__factory,
    VixDirect__factory,
    VixInitializeAggregator__factory
} from '../../types';
import { deltaIsolationAddresses, WNATIVE_ADDRESS } from './addresses';


const ALG_FF_FACTORY_ADDRESS = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
const ALG_POOL_CODE_HASH = '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4';

const DOV_FF_FACTORY_ADDRESS = '0xdE474Db1Fa59898BC91314328D29507AcD0D593c';
const DOV_POOL_INIT_CODE_HASH = '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy modules on", chainId, "by", operator.address)

    const moduleProvider = await new DeltaModuleProvider__factory(operator).attach(
        deltaIsolationAddresses.moduleProvider
    )

    console.log("moduleProvider obntained", moduleProvider.address)


    console.log("callback")
    const callback = await new AggregatorCallback__factory(operator).deploy(
        ALG_FF_FACTORY_ADDRESS,
        DOV_FF_FACTORY_ADDRESS,
        ALG_POOL_CODE_HASH,
        DOV_POOL_INIT_CODE_HASH,
        deltaIsolationAddresses.dataProvider,
        WNATIVE_ADDRESS
    )
    await callback.deployed()
    console.log("callback deployed")
    console.log("callback", callback.address)

    console.log("initializer")
    const initializer = await new VixInitializeAggregator__factory(operator).deploy(
        ALG_FF_FACTORY_ADDRESS,
        DOV_FF_FACTORY_ADDRESS,
        ALG_POOL_CODE_HASH,
        DOV_POOL_INIT_CODE_HASH,
        deltaIsolationAddresses.dataProvider,
        WNATIVE_ADDRESS,
        deltaIsolationAddresses.feeOperator
    )
    await initializer.deployed()
    console.log("initializer deployed")
    console.log("initializer", initializer.address)

    console.log("direct")
    const direct = await new VixDirect__factory(operator).deploy(
        deltaIsolationAddresses.dataProvider,
        WNATIVE_ADDRESS,
        deltaIsolationAddresses.factoryProxy
    )
    await direct.deployed()
    console.log("direct deployed")
    console.log("direct", direct.address)


    console.log("direct", direct.address)
    console.log("callback", callback.address)
    console.log("initializer", initializer.address)


    const tx = await moduleProvider.configureModules(
        [
            {
                moduleAddress: callback.address,
                action: ModuleConfigAction.Add,
                functionSelectors: getSelectors(callback)
            },
            {
                moduleAddress: initializer.address,
                action: ModuleConfigAction.Add,
                functionSelectors: getSelectors(initializer)
            },
            {
                moduleAddress: direct.address,
                action: ModuleConfigAction.Add,
                functionSelectors: getSelectors(direct)
            },
        ]
    )
    await tx.wait()
    console.log("setup completed")
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });