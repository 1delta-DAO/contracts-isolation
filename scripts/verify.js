// module.exports = [
//     '0x02567769aAD16E77f974c45080b66b3e42933331', // entryPoint
//     '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // aavePool
//     '0x1111111254eeb25477b68fb85ed929f73a960582' //1inch
// ];

// module.exports =[
//     '0x988ec4e26f39eec06658ad5f73be82e72c4f368e' // implementation
// ]

// npx hardhat verify --network polygon-zk-evm 0x667518b0eFd52071bE34aa4f0cb6951b76dab1d6 --contract contracts/proxies/provider/DeltaModuleProvider.sol:DeltaModuleProvider

// npx hardhat verify --network polygon-zk-evm 0xa58d5f9397fE1C65EfE72f5fBC95C1A957418F58 --contract contracts/proxies/factory/FactoryProxy.sol:SlotFactoryProxy

// npx hardhat verify --network matic 0x648cE75895873BECBC4c9a291A28CA1EF121953B --contract contracts/1FXSlotFactory.sol:OneFXSlotFactory --constructor-args scripts/verify.js

// npx hardhat verify --network matic 0x988ec4e26f39eec06658ad5f73be82e72c4f368e --contract contracts/1FXSlot.sol:OneFXSlot --constructor-args scripts/verify.js

// npx hardhat verify --network polygon-zk-evm 0x3FD934d868a42B1D7b907e099bC1235b2f9609dc --contract contracts/proxy/SlotProxy.sol:SlotProxy --constructor-args scripts/verify.js

// npx hardhat verify --network polygon-zk-evm 0xBcf269cEB210c32FA43BCb82F469667e56f01175 --contract contracts/modules/FeeOperator.sol:FeeOperator --constructor-args scripts/verify.js

// module.exports = [
//     '0x667518b0eFd52071bE34aa4f0cb6951b76dab1d6', // module provider
// ];


// module.exports = [
//     1000, // init fee
// ];

// callback
// module.exports = [
//         '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
//         '0xdE474Db1Fa59898BC91314328D29507AcD0D593c',
//         '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4',
//         '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a',
//         '0x3a69cdd907b3AfD649bb4D636E31d21A3FFF797f',
//         '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'
// ];

// init
// module.exports = [
//     '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
//     '0xdE474Db1Fa59898BC91314328D29507AcD0D593c',
//     '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4',
//     '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a',
//     '0x3a69cdd907b3AfD649bb4D636E31d21A3FFF797f',
//     '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9',
//     '0xBcf269cEB210c32FA43BCb82F469667e56f01175'
//   ]

//   direct 
module.exports = [
    '0x3a69cdd907b3AfD649bb4D636E31d21A3FFF797f',
    '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9',
    '0xa58d5f9397fE1C65EfE72f5fBC95C1A957418F58'
]


// npx hardhat verify --network polygon-zk-evm 0x0e7423bDDf87AC41A768050f3956Fe81D0A01011 --contract contracts/modules/vix/aggregator/VixInitializeAggregator.sol:VixInitializeAggregator --constructor-args scripts/verify.js
// npx hardhat verify --network polygon-zk-evm 0x09B2fe63BC28085C5a0e844A227c40EF441F9b4b --contract contracts/modules/vix/VixDirect.sol:VixDirect --constructor-args scripts/verify.js
// npx hardhat verify --network polygon-zk-evm 0x3a69cdd907b3AfD649bb4D636E31d21A3FFF797f --contract contracts/modules/vix/data-provider/DataProvider.sol:DataProvider 
// npx hardhat verify --network polygon-zk-evm 0xF443a1F74e9eeEa693743ed23a85279fef279187 --contract contracts/modules/vix/VixSlotFactory.sol:VixSlotFactory
// npx hardhat verify --network polygon-zk-evm 0x3aC9681D71248018726b1767C42243101b7E92ab --contract contracts/modules/vix/lens/oVixLensZK.sol:VixLens


// router

// module.exports = [
//     '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9',
//     '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
//     '0xdE474Db1Fa59898BC91314328D29507AcD0D593c',
//     '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4',
//     '0xd3e7f58b9af034cfa7a0597e539bae7c6b393817a47a6fc1e1503cd6eaffe22a'
//   ]
  // npx hardhat verify --network polygon-zk-evm 0xC415733d05EB7EB4fba415c0624ae7a7A7a2c484 --contract contracts/modules/vix/aggregator/AggregationRouter.sol:AggregationRouter --constructor-args scripts/verify.js