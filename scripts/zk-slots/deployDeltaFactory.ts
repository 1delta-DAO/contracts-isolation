import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { DeltaSlot__factory, FlexSlotFactory__factory, ImplementationProvider__factory } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy 1delta on", chainId, "by", operator.address)

    console.log("Deploy implementation provider")
    const implementationProvider = await new ImplementationProvider__factory(operator).deploy()
    await implementationProvider.deployed()

    console.log('Deploy factory')
    const factory = await new FlexSlotFactory__factory(operator).deploy(implementationProvider.address)
    await factory.deployed()

    console.log("Deploy logic")
    const implementation = await new DeltaSlot__factory(operator).deploy(factory.address)
    await implementation.deployed()

    console.log("Set implementation")
    const tx = await implementationProvider.setImplementation(implementation.address)
    await tx.wait()

    console.log('Addresses')
    console.log('logic:', implementation.address)
    console.log('implementationProvider:', implementationProvider.address)
    console.log('factory:', factory.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

    // new addresses
    // logic: 0x29E8aF61FCA6B2e85Ce9C2164399e7AEabA8C590
    // implementationProvider: 0x55973A7eDAb10b9F7B44D22F88F21F8baCddA6E9
    // factory: 0xD4F433941EC1A1e8878a9A13cfd9afea0a34509C


    // old Addresses
    // logic: 0x86AA31d845eb7d46BBa200183b080F6049321dE0
    // implementationProvider: 0x894fc5177d8e670A4EF4C0aDA2FC5C04861b46Ab
    // factory: 0x925716D57c842B50806884EDb295bA3E3A8EBdFE
    
