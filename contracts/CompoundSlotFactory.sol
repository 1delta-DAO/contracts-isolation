// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

/* solhint-disable max-line-length */

import "./external-protocols/openzeppelin/utils/Create2.sol";
import "./external-protocols/openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import "./external-protocols/openzeppelin/utils/structs/EnumerableSet.sol";
import "./proxies/1DeltaProxy.sol";
import "./CompoundSlot.sol";

/**
 * A sfactory to create minimal abstract accounts called "slots" that are used to hold isolated leveraged positions
 * Designed to create the position in a single click using create2 - the user can approve the projected slot address or
 * user ERC20Permit to open the position.
 */
contract CompoundSlotFactory {
    using EnumerableSet for EnumerableSet.AddressSet;
    CompoundSlot public immutable accountImplementation;
    mapping(address => EnumerableSet.AddressSet) private _userSlots;
    mapping(address => bool) public isSlot;
    uint256 public currentId;
    mapping(address => uint256) private _slotIds;

    constructor(
        address _factory,
        address _nativeWrapper,
        address[] memory _tokens,
        address[] memory _cTokens,
        address _cEther,
        IComptroller _comptroller,
        uint256 numTokens
    ) {
        accountImplementation = new CompoundSlot(_factory, _nativeWrapper, _tokens, _cTokens, _cEther, _comptroller, numTokens);
    }

    /**
     * create a slot
     * - deposits collateral in collateral currency
     * - opens a margin position by swapping borrow amount to collateral
     * - users have to erc20-approve before the transaction can be executed
     *      - the address to be approve can be fetched with getNextAddress
     */
    function createSlot(InitParams calldata params) public payable returns (CompoundSlot ret) {
        address owner = msg.sender;
        (address slot, bytes32 salt) = _getNextAddressAndSalt(owner, _slotIds[owner]++);

        if (slot.code.length > 0) {
            revert("Slot already used");
        }
        ret = CompoundSlot(payable(new OneDeltaProxy{salt: salt}(address(accountImplementation))));

        ret.initialize{value: msg.value}(params);

        _userSlots[owner].add(address(ret));
        isSlot[owner];
    }

    /**
     * create an account, and return its address.
     * returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     * This method returns an existing account address so that entryPoint.getSenderAddress() would work even after account creation
     */
    function createSlotWithPermit(InitParamsWithPermit calldata params) public returns (CompoundSlot ret) {
        address owner = params.permit.owner;
        (address slot, bytes32 salt) = _getNextAddressAndSalt(owner, _slotIds[owner]++);

        if (slot.code.length > 0) {
            revert("Slot already used");
        }
        ret = CompoundSlot(payable(new OneDeltaProxy{salt: salt}(address(accountImplementation))));

        ret.initializeWithPermit(params);

        _userSlots[owner].add(address(ret));
        isSlot[owner];
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createSlot()
     */
    function getAddress(address _user, uint256 _id) public view returns (address) {
        return
            Create2.computeAddress(
                keccak256(abi.encodePacked(_user, _id)),
                keccak256(abi.encodePacked(type(OneDeltaProxy).creationCode, abi.encode(address(accountImplementation))))
            );
    }

    function getNextAddress(address _user) public view returns (address slotAddress) {
        (slotAddress, ) = _getNextAddressAndSalt(_user, _slotIds[_user]);
    }

    function _getNextAddressAndSalt(address _user, uint256 _id) private view returns (address slotAddress, bytes32 salt) {
        salt = keccak256(abi.encodePacked(_user, _id));
        slotAddress = Create2.computeAddress(
            salt,
            keccak256(abi.encodePacked(type(OneDeltaProxy).creationCode, abi.encode(address(accountImplementation))))
        );
    }

    function getSlots(address _user) external view returns (address[] memory slots) {
        slots = _userSlots[_user].values();
    }

    function removeSlot(address owner) external {
        address _slot = msg.sender;
        require(isSlot[_slot], "only slot can call");
        // remove entry
        delete isSlot[_slot];
        _userSlots[owner].remove(_slot);
    }
}
