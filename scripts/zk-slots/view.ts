import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { DeltaSlot__factory, FlexSlotFactory__factory, ImplementationProvider__factory } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Deploy 1delta on", chainId, "by", operator.address)

    console.log("Deploy logic")

    const implementation = await new DeltaSlot__factory(operator).attach('0x6Bc6aCB905c1216B0119C87Bf9E178ce298310FA')

    const implementationProvider = await new ImplementationProvider__factory(operator).attach('0xA453ba397c61B0c292EA3959A858821145B2707F')

    console.log('Deploy factory')
    const factory = await new FlexSlotFactory__factory(operator).attach('0x85D682FA4115f6a1Ed91170E705A50D532e3B6BD')

    const addr = await factory.connect(operator).getNextAddress(operator.address)
    console.log("Projected address", addr)

    const params = {
        "amountDeposited": "100000",
        "minimumAmountDeposited": "0",
        "borrowAmount": "121866",
        "minimumMarginReceived": "0",
        "swapPath": "0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035031e4a5963abfd975d8c9021ce480b42188849d41d034f9a0e7fd2bf6067db6994cf12e4495df938e6e900",
        "marginPath": "0xa8ce8aee21bc2a48a5ef670afcc9274c7bbbc035001e4a5963abfd975d8c9021ce480b42188849d41d034f9a0e7fd2bf6067db6994cf12e4495df938e6e900"
    }

    await factory.connect(operator).estimateGas.createSlot(params)

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


    // logic: 0x6Bc6aCB905c1216B0119C87Bf9E178ce298310FA
    // implementationProvider: 0xA453ba397c61B0c292EA3959A858821145B2707F
    // factory: 0x85D682FA4115f6a1Ed91170E705A50D532e3B6BD

