# Margin trading in slots by 1delta

Alows margin trading that aggregates throuh UniswapV3 and Algebra's V3.

Creates UUPS Upgradeable contracts as "Slots"

These slots are holding the user's baances.

The slot consits of any pair available in the lender.

User can pay in any currency.


# Implementation for Compound V2 (and forks)

An implementation compatible with Compound V2 style cTokens is also available.

To run the related tests, just execute

- `npx hardhat test test/1delta/flexSlot.spec.ts`

Transactions can fail via "ran out of gas" due to issues with hardhat.

The Polygon zkEVM live version is located in `contracts/slots-simple/zk-evm`, the related facory is `FlexSlotFactory`.

# General Version

A version that allows multiple DEXs is included in `contracts/utils/AlgebraSwapper.sol`. To test this one, just run

- `npx hardhat test test/1delta/compoundSlotsAlgebra.spec.ts`

It also allows multi-asset positions (where pay curency != collateral).