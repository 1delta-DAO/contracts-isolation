import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat'
import {
    MockSignatureValidator,
    MockSignatureValidator__factory
} from '../../types';
import { produceCloseSig } from './shared/permitUtils';

// Tests whether the signature validation works
describe('Sig Test', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let sigValdiator: MockSignatureValidator

    beforeEach('Deploy', async () => {
        [deployer, alice, bob, carol] = await ethers.getSigners();

        sigValdiator = await new MockSignatureValidator__factory(deployer).deploy()
    })

    it('Validates correct sig', async () => {

        const sigVRS = await produceCloseSig(
            alice,
            sigValdiator
        )

        await sigValdiator.connect(bob).checkSig(
            alice.address,
            sigValdiator.address,
            ethers.constants.MaxUint256,
            sigVRS.split.v,
            sigVRS.split.r,
            sigVRS.split.s
        )
    })

    it('Throws on incorrect sig', async () => {

        const sigVRS = await produceCloseSig(
            alice,
            sigValdiator
        )

        await expect(sigValdiator.connect(bob).checkSig(
            alice.address,
            bob.address,
            ethers.constants.MaxUint256,
            sigVRS.split.v,
            sigVRS.split.r,
            sigVRS.split.s
        )).to.be.revertedWith("SignatureValidator: invalid signature")

    })




})
