// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable max-line-length */

import "../external-protocols/openzeppelin/utils/Create2.sol";
import "../external-protocols/openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import "../external-protocols/openzeppelin/utils/structs/EnumerableSet.sol";
import "../proxies/1DeltaProxy.sol";
import "./Slot.sol";

/**
 * A sfactory to create minimal abstract accounts called "slots" that are used to hold isolated leveraged positions
 * Designed to create the position in a single click using create2 - the user can approve the projected slot address or
 * user ERC20Permit to open the position.
 */
contract SlotFactory {
    error OnlyAdmin();

    address public ADMIN;
    using EnumerableSet for EnumerableSet.AddressSet;
    Slot public immutable accountImplementation;
    mapping(address => EnumerableSet.AddressSet) private _userSlots;
    mapping(address => bool) public isSlot;
    mapping(address => uint256) private _slotIds;

    receive() external payable {}

    constructor(
        address _nativeWrapper,
        address _algebraPoolDeployer,
        address[] memory _tokens,
        address[] memory _cTokens,
        address _cEther,
        IComptroller _comptroller,
        uint256 numTokens
    ) {
        ADMIN = msg.sender;
        accountImplementation = new Slot(_nativeWrapper, _algebraPoolDeployer, _tokens, _cTokens, _cEther, _comptroller, numTokens);
    }

    /**
     * create a slot
     * - deposits collateral in collateral currency
     * - opens a margin position by swapping borrow amount to collateral
     * - users have to erc20-approve before the transaction can be executed
     *      - the address to be approve can be fetched with getNextAddress
     */
    function createSlot(InitParams calldata params) public payable returns (Slot ret) {
        address owner = msg.sender;
        bytes32 salt = keccak256(abi.encodePacked(owner, _slotIds[owner]++));

        ret = Slot(payable(new OneDeltaProxy{salt: salt}(address(accountImplementation))));
        uint256 etherSent = msg.value;
        if (etherSent != 0) {
            ret.initializeETH{value: etherSent}(owner, params);
        } else {
            ret.initialize(owner, params);
        }
        _userSlots[owner].add(address(ret));
        isSlot[owner];
    }

    /**
     * Create a slot with permit - non-Ether
     */
    function createSlotWithPermit(InitParamsWithPermit calldata params) public returns (Slot ret) {
        address owner = params.permit.owner; // owner will always be set to permit signer
        bytes32 salt = keccak256(abi.encodePacked(owner, _slotIds[owner]++));

        ret = Slot(payable(new OneDeltaProxy{salt: salt}(address(accountImplementation))));

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
        slotAddress = Create2.computeAddress(
            keccak256(abi.encodePacked(_user, _slotIds[_user])),
            keccak256(abi.encodePacked(type(OneDeltaProxy).creationCode, abi.encode(address(accountImplementation))))
        );
    }

    function getSlots(address _user) external view returns (address[] memory slots) {
        slots = _userSlots[_user].values();
    }

    function getSlot(address _user, uint256 _id) external view returns (address) {
        return _userSlots[_user].at(_id);
    }

    function getSlotCount(address _user) external view returns (uint256) {
        return _userSlots[_user].values().length;
    }

    // Admin functions

    /**
     * Allows the admin to withdraw collected fees
     */
    function withdrawFees(address asset) external payable {
        address admin = ADMIN;
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
        address admin = ADMIN;
        if (msg.sender != admin) revert OnlyAdmin();
        ADMIN = newAdmin;
    }
}
