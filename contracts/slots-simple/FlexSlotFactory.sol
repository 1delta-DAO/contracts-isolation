// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.21;

/* solhint-disable max-line-length */

import "../external-protocols/openzeppelin/utils/Create2.sol";
import "../external-protocols/openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import "../external-protocols/openzeppelin/token/ERC20/IERC20.sol";
import "../external-protocols/openzeppelin/utils/structs/EnumerableSet.sol";
import "../proxies/1DeltaFlexProxy.sol";
import "./ISlot.sol";
import "../interfaces/compound/ICompoundTypeCERC20.sol";
import "../interfaces/compound/IComptroller.sol";

/**
 * A sfactory to create minimal abstract accounts called "slots" that are used to hold isolated leveraged positions
 * Designed to create the position in a single click using create2 - the user can approve the projected slot address or
 * user ERC20Permit to open the position.
 */
contract FlexSlotFactory {
    error OnlyAdmin();

    address public ADMIN;
    using EnumerableSet for EnumerableSet.AddressSet;
    mapping(address => EnumerableSet.AddressSet) private _userSlots;
    mapping(address => uint256) private _slotIds;

    receive() external payable {}

    address private immutable implemtationPovider;

    constructor(address _implemtationPovider) {
        ADMIN = msg.sender;
        implemtationPovider = _implemtationPovider;
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
        bytes32 salt = keccak256(abi.encodePacked(owner, _slotIds[owner]++));

        ret = payable(new OneDeltaFlexProxy{salt: salt}(implemtationPovider));
        uint256 etherSent = msg.value;
        if (etherSent != 0) {
            ISlot(ret).initializeETH{value: etherSent}(owner, params);
        } else {
            ISlot(ret).initialize(owner, params);
        }
        _userSlots[owner].add(ret);
    }

    /**
     * Create a slot with permit - non-Ether
     */
    function createSlotWithPermit(InitParamsWithPermit calldata params) public returns (address ret) {
        address owner = params.permit.owner; // owner will always be set to permit signer
        bytes32 salt = keccak256(abi.encodePacked(owner, _slotIds[owner]++));

        ret = payable(new OneDeltaFlexProxy{salt: salt}(implemtationPovider));

        ISlot(ret).initializeWithPermit(params);

        _userSlots[owner].add(ret);
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createSlot()
     */
    function getAddress(address _user, uint256 _id) public view returns (address) {
        return
            Create2.computeAddress(
                keccak256(abi.encodePacked(_user, _id)),
                keccak256(abi.encodePacked(type(OneDeltaFlexProxy).creationCode, abi.encode(implemtationPovider)))
            );
    }

    function getNextAddress(address _user) public view returns (address slotAddress) {
        slotAddress = Create2.computeAddress(
            keccak256(abi.encodePacked(_user, _slotIds[_user])),
            keccak256(abi.encodePacked(type(OneDeltaFlexProxy).creationCode, abi.encode(implemtationPovider)))
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

    function getImplemtationPovider() external view returns (address) {
        return implemtationPovider;
    }
}
