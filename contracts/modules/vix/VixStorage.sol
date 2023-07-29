// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.21;

// We do not use an array of stucts to avoid pointer conflicts

// just stores user-related data
struct AdminStorage {
    address owner;
}

// stores assets
struct GeneralStorage {
    address debt;
    address collateral;
    address deposit; // in the general case this is expected to be the collateral, too
}

struct VixDetailsStorage {
    uint112 collateralSwapped;
    uint112 debtSwapped;
    uint32 closeTime;
    // one slot
    uint32  creationTime;
    uint8  initialized;
}

// for exact output multihop swaps
struct Cache {
    uint256 amount;
    address cachedAddress;
}

library LibStorage {
    // Storage are structs where the data gets updated throughout the lifespan of the project
    bytes32 constant GENERAL_STORAGE = keccak256("VixSlot.storage.position");
    bytes32 constant DETAILS_STORAGE = keccak256("VixSlot.storage.details");
    bytes32 constant ADMIN_STORAGE = keccak256("VixSlot.storage.admin");
    bytes32 constant CACHE = keccak256("VixSlot.storage.cache");

    function generalStorage() internal pure returns (GeneralStorage storage ps) {
        bytes32 position = GENERAL_STORAGE;
        assembly {
            ps.slot := position
        }
    }

    function cacheStorage() internal pure returns (Cache storage cs) {
        bytes32 position = CACHE;
        assembly {
            cs.slot := position
        }
    }

    function adminStorage() internal pure returns (AdminStorage storage ads) {
        bytes32 position = ADMIN_STORAGE;
        assembly {
            ads.slot := position
        }
    }
    function detailsStorage() internal pure returns (VixDetailsStorage storage ads) {
        bytes32 position = ADMIN_STORAGE;
        assembly {
            ads.slot := position
        }
    }
}

abstract contract WithVixStorage {
    function gs() internal pure returns (GeneralStorage storage) {
        return LibStorage.generalStorage();
    }

    function cs() internal pure returns (Cache storage) {
        return LibStorage.cacheStorage();
    }

    function ads() internal pure returns (AdminStorage storage) {
        return LibStorage.adminStorage();
    }

    function ds() internal pure returns (VixDetailsStorage storage) {
        return LibStorage.detailsStorage();
    }
}
