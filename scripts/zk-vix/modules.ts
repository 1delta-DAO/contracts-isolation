import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { getSelectors, ModuleConfigAction } from '../../test/1delta/helpers/diamond';
import { AggregatorCallbackZK__factory, DeltaModuleProvider__factory, FeeOperator__factory, VixDirect__factory, VixInitializeAggregatorZK__factory } from '../../types';
import { deltaIsolationAddresses, WNATIVE_ADDRESS } from './addresses';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy modules on", chainId, "by", operator.address)

    const moduleProvider = await new DeltaModuleProvider__factory(operator).attach(
        deltaIsolationAddresses.moduleProvider
    )

    console.log("moduleProvider obntained", moduleProvider.address)

    console.log("feeOperator")
    const feeOperator = await new FeeOperator__factory(operator).deploy(1000)
    await feeOperator.deployed()
    console.log("fee operator deployed")
    console.log("feeOperator:", feeOperator)

    console.log("callback")
    const callback = await new AggregatorCallbackZK__factory(operator).deploy(
        deltaIsolationAddresses.dataProvider,
        WNATIVE_ADDRESS
    )
    await callback.deployed()
    console.log("callback deployed")
    console.log("callback", callback.address)

    console.log("initializer")
    const initializer = await new VixInitializeAggregatorZK__factory(operator).deploy(
        deltaIsolationAddresses.dataProvider,
        WNATIVE_ADDRESS,
        feeOperator.address
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


    console.log("feeOperator:", feeOperator)
    console.log("callback", callback.address)
    console.log("initializer", initializer.address)
    console.log("direct", direct.address)


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