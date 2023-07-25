// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

/* solhint-disable max-line-length */

import "../../external-protocols/openzeppelin/utils/Create2.sol";
import "../../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import "../../external-protocols/openzeppelin/utils/structs/EnumerableSet.sol";
import "../../proxies/SlotProxy.sol";
import "./interfaces/ISlot.sol";
import {SlotFactoryStorage} from "../../proxies/factory/SlotFactoryStorage.sol";
import {IProxy} from "../../proxies/factory/IProxy.sol";

/**
 * A sfactory to create minimal abstract accounts called "slots" that are used to hold isolated leveraged positions
 * Designed to create the position in a single click using create2 - the user can approve the projected slot address or
 * user ERC20Permit to open the position.
 */
contract VixSlotFactory is SlotFactoryStorage {
    error OnlyAdmin();
    using EnumerableSet for EnumerableSet.AddressSet;

    receive() external payable {}

    /**
     * @notice Sets this contract as the implementation for a proxy input
     * @param proxy the proxy contract to accept this implementation
     */
    function _become(IProxy proxy) external {
        require(msg.sender == proxy.admin(), "only proxy admin can change brains");
        proxy._acceptImplementation();
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Factory: Only admin can interact");
        _;
    }

    function initialize(address _moduleProvider, address _dataProvider) external onlyAdmin {
        require(!initialized, "Factory: Already initialized");
        moduleProvider = _moduleProvider;
        dataProvider = _dataProvider;
        initialized = true;
    }
    /**
     * create a slot
     * - deposits collateral in collateral currency
     * - opens a margin position by swapping borrow amount to collateral
     * - users have to erc20-approve before the transaction can be executed
     *      - the address to be approve can be fetched with getNextAddress
     */
    function createSlot(InitParams calldata params) public payable returns (address ret) {
        address owner = msg.sender;
        bytes32 salt = keccak256(abi.encodePacked(owner, slotIds[owner]++));

        ret = payable(new SlotProxy{salt: salt}(moduleProvider));
        uint256 etherSent = msg.value;
        if (etherSent != 0) {
            ISlot(ret).initializeETH{value: etherSent}(owner, params);
        } else {
            ISlot(ret).initialize(owner, params);
        }
        userSlots[owner].add(ret);
    }

    /**
     * Create a slot with permit - non-Ether
     */
    function createSlotWithPermit(InitParamsWithPermit calldata params) public returns (address ret) {
        address owner = params.permit.owner; // owner will always be set to permit signer
        bytes32 salt = keccak256(abi.encodePacked(owner, slotIds[owner]++));

        ret = payable(new SlotProxy{salt: salt}(moduleProvider));

        ISlot(ret).initializeWithPermit(params);

        userSlots[owner].add(ret);
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createSlot()
     */
    function getAddress(address _user, uint256 _id) public view returns (address) {
        return
            Create2.computeAddress(
                keccak256(abi.encodePacked(_user, _id)),
                keccak256(abi.encodePacked(type(SlotProxy).creationCode, abi.encode(moduleProvider)))
            );
    }

    function getNextAddress(address _user) public view returns (address slotAddress) {
        slotAddress = Create2.computeAddress(
            keccak256(abi.encodePacked(_user, slotIds[_user])),
            keccak256(abi.encodePacked(type(SlotProxy).creationCode, abi.encode(moduleProvider)))
        );
    }

    function getSlots(address _user) external view returns (address[] memory slots) {
        slots = userSlots[_user].values();
    }

    function getSlot(address _user, uint256 _id) external view returns (address) {
        return userSlots[_user].at(_id);
    }

    function getSlotCount(address _user) external view returns (uint256) {
        return userSlots[_user].values().length;
    }

    // Admin functions

    /**
     * Allows the admin to withdraw collected fees
     */
    function withdrawFees(address asset) external payable {
        if (msg.sender != admin) revert OnlyAdmin();
        address _asset = asset;
        if (asset == address(0)) {
            payable(admin).transfer(address(this).balance);
        } else {
            IERC20(_asset).transfer(admin, IERC20(_asset).balanceOf(address(this)));
        }
    }

    /**
     * Allows the admin change to a new admin
     */
    function changeAdmin(address newAdmin) external {
        if (msg.sender != admin) revert OnlyAdmin();
        admin = newAdmin;
    }

    function getmoduleProvider() external view returns (address) {
        return moduleProvider;
    }
}
