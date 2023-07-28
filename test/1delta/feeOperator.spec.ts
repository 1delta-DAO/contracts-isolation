import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, waffle } from 'hardhat'
import {
    FeeOperator,
    FeeOperator__factory
} from '../../types';
import { expandTo18Decimals } from '../uniswap-v3/core/shared/utilities';
import { tokenFixture, TokenFixture } from './shared/tokensFixture';
import { MockProvider } from 'ethereum-waffle';
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from 'chai';



// Tests all configurations for the minimal slot variant
describe('Fee Operator', async () => {
    let deployer: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress, carol: SignerWithAddress;
    let partner: SignerWithAddress
    let tokenData: TokenFixture
    let provider: MockProvider
    let feeOperator: FeeOperator
    const timeInterval = 60 * 60 * 24
    before('get wallets and fixture', async () => {
        [deployer, alice, bob, carol, partner] = await ethers.getSigners();
        tokenData = await tokenFixture(deployer, 6)
        provider = waffle.provider;

        // approve & fund wallets
        for (const token of tokenData.tokens) {
            await token.connect(deployer).transfer(bob.address, expandTo18Decimals(1_000_000))
            await token.connect(deployer).transfer(alice.address, expandTo18Decimals(1_000_000))
            await token.connect(deployer).transfer(carol.address, expandTo18Decimals(1_000_000))
        }

        feeOperator = await new FeeOperator__factory(deployer).deploy(0)
    })


    it('OPERATOR: reverts on too early change', async () => {
        await expect(feeOperator.changeShare(
            100
        )).to.be.revertedWith("changeTooEarly()")

    })

    it('OPERATOR: respects intervals', async () => {
        await time.increase(timeInterval);
        await expect(feeOperator.changeShare(
            90000
        )).to.be.revertedWith("changeOutOfBounds()")

    })

    it('OPERATOR: valid increment', async () => {
        await time.increase(timeInterval);
        await feeOperator.changeShare(
            100
        )
        let fee = await feeOperator.getProtocolShare()
        expect(fee.toString()).to.equal('100')
        await time.increase(timeInterval);
        await feeOperator.changeShare(
            150
        )
        fee = await feeOperator.getProtocolShare()
        expect(fee.toString()).to.equal('150')
        await expect(feeOperator.changeShare(
            200
        )).to.be.revertedWith("changeTooEarly()")
    })


    it('OPERATOR: reverts on too large increment', async () => {
        await time.increase(timeInterval);
        await expect(feeOperator.changeShare(
            900
        )).to.be.revertedWith("changeOutOfBounds()")
    })

    it('OPERATOR: reverts on too large decrement', async () => {
        await time.increase(timeInterval);
        await expect(feeOperator.changeShare(
            900
        )).to.be.revertedWith("changeOutOfBounds()")
    })

    it('OPERATOR: valid decrement', async () => {
        await time.increase(timeInterval);
        await feeOperator.changeShare(
            140
        )
        let fee = await feeOperator.getProtocolShare()
        expect(fee.toString()).to.equal('140')
        await time.increase(timeInterval);
        await feeOperator.changeShare(
            60
        )
        fee = await feeOperator.getProtocolShare()
        expect(fee.toString()).to.equal('60')
        await expect(feeOperator.changeShare(
            100
        )).to.be.revertedWith("changeTooEarly()")
    })
})


