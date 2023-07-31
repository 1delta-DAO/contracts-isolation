import '@nomiclabs/hardhat-ethers'
import hre, { ethers } from 'hardhat'
import { ModuleConfigAction } from '../../test/1delta/helpers/diamond';
import {
    DeltaModuleProvider__factory,
} from '../../types';
import { deltaIsolationAddresses } from './addresses';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy modules on", chainId, "by", operator.address)

    const moduleProvider = await new DeltaModuleProvider__factory(operator).attach(
        deltaIsolationAddresses.moduleProvider
    )

    console.log("moduleProvider obntained", moduleProvider.address)

    const initSelectors = await moduleProvider.moduleFunctionSelectors(deltaIsolationAddresses.initializer)
    const callbackSelectors = await moduleProvider.moduleFunctionSelectors(deltaIsolationAddresses.callback)
    const directSelectors = await moduleProvider.moduleFunctionSelectors(deltaIsolationAddresses.direct)
    const moduleSelectors = [
        initSelectors,
        callbackSelectors,
        directSelectors
    ]

    const cut: {
        moduleAddress: string,
        action: any,
        functionSelectors: any[]
    }[] = []
    for (const selector of moduleSelectors) {
        cut.push({
            moduleAddress: ethers.constants.AddressZero,
            action: ModuleConfigAction.Remove,
            functionSelectors: selector.functionSelectors
        })
    }

    console.log("Cut:", cut)
    console.log("Attempt module adjustment - estiamte gas")
    await moduleProvider.estimateGas.configureModules(cut)
    console.log("Estimate successful - configure!")
    const tx = await moduleProvider.configureModules(cut)
    console.log('Module adjustment tx: ', tx.hash)
    const receipt = await tx.wait()
    if (!receipt.status) {
        throw Error(`Module adjustment failed: ${tx.hash}`)
    } else {
        console.log('Completed module adjustment')
        console.log("Upgrade done")
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });