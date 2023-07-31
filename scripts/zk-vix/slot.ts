import '@nomiclabs/hardhat-ethers'
import { constants } from 'ethers';
import hre from 'hardhat'
import {  VixDirect__factory } from '../../types';

async function main() {

    const accounts = await hre.ethers.getSigners()
    const operator = accounts[0]
    const chainId = await operator.getChainId();

    console.log("Amend Slot on", chainId, "by", operator.address)

    const slot = await new VixDirect__factory(operator).attach('0x22F8cb8BD27cE5d6A36C68B4500Af514a32a050e')
    console.log('Slot gottent', slot.address)

    await slot.transferSlot(constants.AddressZero)
    console.log('Slot transferred')
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
