# Margin trading in slots by 1delta

Alows margin trading that aggregates through UniswapV3 and Algebra's V3.

Creates UUPS Upgradeable / Diamond contracts as "Slots"

These slots are holding the user's baances.

The slot consits of any pair available in the lender.

User can pay in any currency.


# New implementation with Swap Aggregation

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

## Encoding paths

Encoding paths is required to create and close slots.

```ts
encodeAggregtorPathEthers(
            ['0x...a', '0x...b', '0x...c', '0x...d'], // This is the token path as address array 
            [FeeAmount.MEDIUM, FeeAmount.LOW, FeeAmount.MEDIUM], // array of Uni V3 style pool Fees (if a Uniswap V3 fork like Dove is used)
            [0, 3, 3], // specifies the margin interaction
            [1, 1, 1], // specifies DEX -> 0 for Algebra / Quickswap and 1 for Doveswap
            0 // flag for closing entire position (ignored when opening a position), 1 is for closing for the desired output amount
        )
```

The margin interactions are the following:
- 0: Open a position
- 1: Close a position
- 2: Exact output swap
- 3: Exact input swap

When composing a path longer than two tokens for opening a position, the margin interaction array has to start with the margin interaction followed by exactInput flags. In the example above, the path contains 4 tokens, meaning that on top of the margin open action 0, two exact input flags have to follow.

When closing, one has to chain the close interaction 1 with the respective amount of exact output swaps. In the example above, if we would want to use the path to close the position instead, we would use the array `[1, 2 ,2]`.

When calculating a path for depositing, either
- a single address is used; or
- only exact input swaps are executed. In the example abve, this would mean that the margin interaction array would be `[3, 3, 3]`

**Supported DEXs:** Currently, the implementation supports 2 DEXs on zkEVm, Algebra or Quickswap and DoveSwap with many more to come.

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