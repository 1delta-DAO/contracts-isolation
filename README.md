# Margin trading in slots by 1delta

Alows margin trading that aggregates through UniswapV3 and Algebra's V3.

Creates UUPS Upgradeable contracts as "Slots"

These slots are holding the user's baances.

The slot consits of any pair available in the lender.

User can pay in any currency.


# New implementation with Swap aggragation

The directory `contracts/modules/vix/aggregator` containes a variant using Diamond-like proxies, more specifically, 
the proxy `contracts/proxies/SlotProxy.sol` to enable maximum functionality at the same cost compared to smaller proxies.

The currently used modules are:

- `contracts/modules/vix/aggregator/AggregatorCallback.sol`: The callback implementation for flash swaps;
- `contracts/modules/vix/aggregator/VixInitializeAggregator.sol`: Initializationa nd closing interface for slots;
- `contracts/modules/vix/VixDirect.sol`: Direct transfer, sweep, withdrawal and repayment interface.

A full set of tests is here `test/1delta/vixSlotAggregatorMixed.spec.ts`. Fee handling is implemented in `contracts/modules/FeeOperator.sol` and tested in `test/1delta/feeOperator.spec.ts`

- `npx hardhat test test/1delta/vixSlotAggregatorMixed.spec.ts`
- `npx hardhat test test/1delta/feeOperator.spec.ts`

Live deployment addresses on Polygon zkEVM are here: `scripts/zk-vix/addresses.ts`.

As of right now, DoveSwap and Quickswap can be aggregated for optimal swaps.

Flexible path parameters allow all sotrs of transactions connected with Flash Swaps.

# Old Contracts

## Implementation for Compound V2 (and forks)

An implementation compatible with Compound V2 style cTokens is also available.

To run the related tests, just execute

- `npx hardhat test test/1delta/flexSlot.spec.ts`

Transactions can fail via "ran out of gas" due to issues with hardhat.

The Polygon zkEVM live version is located in `contracts/slots-simple/zk-evm`, the related facory is `FlexSlotFactory`.

## General Version

A version that allows multiple DEXs is included in `contracts/utils/AlgebraSwapper.sol`. To test this one, just run

- `npx hardhat test test/1delta/compoundSlotsAlgebra.spec.ts`

It also allows multi-asset positions (where pay curency != collateral).