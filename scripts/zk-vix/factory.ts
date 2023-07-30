import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { SlotFactoryProxy__factory, VixLens__factory, VixSlotFactory__factory } from '../../types';
import { deltaIsolationAddresses } from './addresses';



async function main() {
    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy lens on", chainId, "by", operator.address)

    console.log("deploy factoryProxy")
    const factoryProxy = await new SlotFactoryProxy__factory(operator).deploy()
    await factoryProxy.deployed()
    console.log("factoryProxy:", factoryProxy.address)

    console.log("deploy factoryImplementation")
    const factoryImplementation = await new VixSlotFactory__factory(operator).deploy()
    await factoryImplementation.deployed()
    console.log("factoryImplementation:", factoryImplementation.address)

    await factoryProxy._setPendingImplementation(factoryImplementation.address)
    let tx = await factoryImplementation._become(factoryProxy.address)
    await tx.wait()
    console.log("upgrade completed")

    const factory = await new VixSlotFactory__factory(operator).attach(factoryProxy.address)

    console.log('initialize')
    tx = await factory.initialize(
        deltaIsolationAddresses.moduleProvider,
        deltaIsolationAddresses.dataProvider
    )
    await tx.wait()

    console.log('Addresses')
    console.log("factoryProxy:", factoryProxy.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
