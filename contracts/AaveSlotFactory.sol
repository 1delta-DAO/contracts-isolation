// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable max-line-length */

import "./external-protocols/openzeppelin/utils/Create2.sol";
import "./external-protocols/openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import "./external-protocols/openzeppelin/utils/structs/EnumerableSet.sol";
import "./proxies/1DeltaProxy.sol";
import "./AaveSlot.sol";

/**
 * A sfactory to create minimal abstract accounts called "slots" that are used to hold isolated leveraged positions
 * Designed to create the position in a single click using create2 - the user can approve the projected slot address or
 * user ERC20Permit to open the position.
 */
contract AaveSlotFactory {
    using EnumerableSet for EnumerableSet.AddressSet;
    AaveSlot public immutable accountImplementation;
    mapping(address => EnumerableSet.AddressSet) private _userPositions;
    uint256 public currentId;

    constructor(
        address[] memory _tokens,
        address[] memory _aTokens,
        address[] memory _vTokens,
        address[] memory _sTokens,
        address _aavePool,
        address _wrappedNative,
        address _1inchRouter,
        uint256 _numTokens
    ) {
        accountImplementation = new AaveSlot( _tokens, _aTokens, _vTokens, _sTokens, _aavePool, _wrappedNative, _1inchRouter, _numTokens);
    }

    /**
     * create a slot
     * - deposits collateral in collateral currency
     * - opens a margin position by swapping borrow amount to collateral
     * - users have to erc20-approve before the transaction can be executed
     *      - the address to be approve can be fetched with getNextAddress
     */
    function createSlot(AaveSlot.OpenParams calldata params) public payable returns (AaveSlot ret) {
        uint256 salt = ++currentId;
        address addr = getAddress(salt);
        if (addr.code.length > 0) {
            return AaveSlot(payable(addr));
        }
        ret = AaveSlot(payable(new OneDeltaProxy{salt: bytes32(salt)}(address(accountImplementation))));

        ret.initialize{value: msg.value}(params);

        _userPositions[params.owner].add(address(ret));
    }

    /**
     * create an account, and return its address.
     * returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     * This method returns an existing account address so that entryPoint.getSenderAddress() would work even after account creation
     */
    function createSlotWithPermit(AaveSlot.OpenWithPermitParams calldata params) public returns (AaveSlot ret) {
        uint256 salt = ++currentId;
        address addr = getAddress(salt);
        if (addr.code.length > 0) {
            return AaveSlot(payable(addr));
        }
        ret = AaveSlot(payable(new OneDeltaProxy{salt: bytes32(salt)}(address(accountImplementation))));

        ret.initializeWithPermit(params);

        _userPositions[params.permit.owner].add(address(ret));
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createSlot()
     */
    function getAddress(uint256 salt) public view returns (address) {
        return
            Create2.computeAddress(
                bytes32(salt),
                keccak256(abi.encodePacked(type(OneDeltaProxy).creationCode, abi.encode(address(accountImplementation))))
            );
    }

    function getNextAddress() public view returns (address) {
        return
            Create2.computeAddress(
                bytes32(currentId + 1),
                keccak256(abi.encodePacked(type(OneDeltaProxy).creationCode, abi.encode(address(accountImplementation))))
            );
    }

    function getSlots(address _user) external view returns (address[] memory slots) {
        slots = _userPositions[_user].values();
    }
}
