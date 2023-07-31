// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "../../../external-protocols/oVix/IOErc20.sol";
import "../../../external-protocols/oVix/IOToken.sol";
import "../../../external-protocols/oVix/PriceOracle.sol";
import "../../../external-protocols/oVix/IEIP20.sol";
import "../interfaces/ISlot.sol";

// solhint-disable max-line-length

interface OVixLensInterface {
    function markets(address)
        external
        view
        returns (
            bool,
            bool,
            uint256
        );

    function oracle() external view returns (PriceOracle);

    function getAccountLiquidity(address)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        );

    function getAssetsIn(address) external view returns (IOToken[] memory);

    function claimComp(address) external;

    function compAccrued(address) external view returns (uint256);

    function compSpeeds(address) external view returns (uint256);

    function rewardSupplySpeeds(address) external view returns (uint256);

    function rewardBorrowSpeeds(address) external view returns (uint256);

    function borrowCaps(address) external view returns (uint256);
}

interface IERC20Base {
    function decimals() external view returns (uint8);

    function symbol() external view returns (string memory);
}

interface IOneDeltaSlotFactory {
    function getSlots(address _user) external view returns (address[] memory slots);
}

contract VixLens {
    struct IOTokenMetadata {
        address oToken;
        uint256 exchangeRateCurrent;
        uint256 supplyRatePerBlock;
        uint256 borrowRatePerBlock;
        uint256 reserveFactorMantissa;
        uint256 totalBorrows;
        uint256 totalReserves;
        uint256 totalSupply;
        uint256 totalCash;
        bool isListed;
        bool autoCollaterize;
        uint256 collateralFactorMantissa;
        address underlyingAssetAddress;
        uint256 oTokenDecimals;
        uint256 underlyingDecimals;
        uint256 compSupplySpeed;
        uint256 compBorrowSpeed;
        uint256 borrowCap;
    }

    function getCompSpeeds(OVixLensInterface comptroller, IOToken oToken) internal returns (uint256, uint256) {
        // Getting comp speeds is gnarly due to not every network having the
        // split comp speeds from Proposal 62 and other networks don't even
        // have comp speeds.
        uint256 compSupplySpeed = 0;
        (bool compSupplySpeedSuccess, bytes memory compSupplySpeedReturnData) = address(comptroller).call(
            abi.encodePacked(comptroller.rewardSupplySpeeds.selector, abi.encode(address(oToken)))
        );
        if (compSupplySpeedSuccess) {
            compSupplySpeed = abi.decode(compSupplySpeedReturnData, (uint256));
        }

        uint256 compBorrowSpeed = 0;
        (bool compBorrowSpeedSuccess, bytes memory compBorrowSpeedReturnData) = address(comptroller).call(
            abi.encodePacked(comptroller.rewardBorrowSpeeds.selector, abi.encode(address(oToken)))
        );
        if (compBorrowSpeedSuccess) {
            compBorrowSpeed = abi.decode(compBorrowSpeedReturnData, (uint256));
        }

        // If the split comp speeds call doesn't work, try the  oldest non-spit version.
        if (!compSupplySpeedSuccess || !compBorrowSpeedSuccess) {
            (bool compSpeedSuccess, bytes memory compSpeedReturnData) = address(comptroller).call(
                abi.encodePacked(comptroller.compSpeeds.selector, abi.encode(address(oToken)))
            );
            if (compSpeedSuccess) {
                compSupplySpeed = compBorrowSpeed = abi.decode(compSpeedReturnData, (uint256));
            }
        }
        return (compSupplySpeed, compBorrowSpeed);
    }

    function oTokenMetadata(IOToken oToken) public returns (IOTokenMetadata memory) {
        uint256 exchangeRateCurrent = oToken.exchangeRateCurrent();
        OVixLensInterface comptroller = OVixLensInterface(address(oToken.comptroller()));
        (bool isListed, bool autoCollaterize, uint256 collateralFactorMantissa) = comptroller.markets(address(oToken));
        address underlyingAssetAddress;
        uint256 underlyingDecimals;

        if (compareStrings(oToken.symbol(), "oETH")) {
            underlyingAssetAddress = address(0);
            underlyingDecimals = 18;
        } else {
            IOErc20 cErc20 = IOErc20(address(oToken));
            underlyingAssetAddress = cErc20.underlying();
            underlyingDecimals = IEIP20(cErc20.underlying()).decimals();
        }

        (uint256 compSupplySpeed, uint256 compBorrowSpeed) = getCompSpeeds(comptroller, oToken);

        uint256 borrowCap = 0;
        (bool borrowCapSuccess, bytes memory borrowCapReturnData) = address(comptroller).call(
            abi.encodePacked(comptroller.borrowCaps.selector, abi.encode(address(oToken)))
        );
        if (borrowCapSuccess) {
            borrowCap = abi.decode(borrowCapReturnData, (uint256));
        }

        return
            IOTokenMetadata({
                oToken: address(oToken),
                exchangeRateCurrent: exchangeRateCurrent,
                supplyRatePerBlock: oToken.supplyRatePerTimestamp(),
                borrowRatePerBlock: oToken.borrowRatePerTimestamp(),
                reserveFactorMantissa: oToken.reserveFactorMantissa(),
                totalBorrows: oToken.totalBorrows(),
                totalReserves: oToken.totalReserves(),
                totalSupply: oToken.totalSupply(),
                totalCash: oToken.getCash(),
                isListed: isListed,
                autoCollaterize: autoCollaterize,
                collateralFactorMantissa: collateralFactorMantissa,
                underlyingAssetAddress: underlyingAssetAddress,
                oTokenDecimals: oToken.decimals(),
                underlyingDecimals: underlyingDecimals,
                compSupplySpeed: compSupplySpeed,
                compBorrowSpeed: compBorrowSpeed,
                borrowCap: borrowCap
            });
    }

    function oTokenMetadataAll(IOToken[] calldata oTokens) external returns (IOTokenMetadata[] memory) {
        uint256 oTokenCount = oTokens.length;
        IOTokenMetadata[] memory res = new IOTokenMetadata[](oTokenCount);
        for (uint256 i = 0; i < oTokenCount; i++) {
            res[i] = oTokenMetadata(oTokens[i]);
        }
        return res;
    }

    struct IOTokenBalances {
        address oToken;
        uint256 balanceOf;
        uint256 borrowBalanceCurrent;
        uint256 balanceOfUnderlying;
        uint256 tokenBalance;
        uint256 tokenAllowance;
    }

    function oTokenBalances(IOToken oToken, address payable account) public returns (IOTokenBalances memory) {
        uint256 balanceOf = oToken.balanceOf(account);
        uint256 borrowBalanceCurrent = oToken.borrowBalanceCurrent(account);
        uint256 balanceOfUnderlying = oToken.balanceOfUnderlying(account);
        uint256 tokenBalance;
        uint256 tokenAllowance;

        if (compareStrings(oToken.symbol(), "oETH")) {
            tokenBalance = account.balance;
            tokenAllowance = account.balance;
        } else {
            IOErc20 cErc20 = IOErc20(address(oToken));
            IEIP20 underlying = IEIP20(cErc20.underlying());
            tokenBalance = underlying.balanceOf(account);
            tokenAllowance = underlying.allowance(account, address(oToken));
        }

        return
            IOTokenBalances({
                oToken: address(oToken),
                balanceOf: balanceOf,
                borrowBalanceCurrent: borrowBalanceCurrent,
                balanceOfUnderlying: balanceOfUnderlying,
                tokenBalance: tokenBalance,
                tokenAllowance: tokenAllowance
            });
    }

    function oTokenBalancesAll(IOToken[] calldata oTokens, address payable account) external returns (IOTokenBalances[] memory) {
        uint256 oTokenCount = oTokens.length;
        IOTokenBalances[] memory res = new IOTokenBalances[](oTokenCount);
        for (uint256 i = 0; i < oTokenCount; i++) {
            res[i] = oTokenBalances(oTokens[i], account);
        }
        return res;
    }

    struct IOTokenUnderlyingPrice {
        address oToken;
        uint256 underlyingPrice;
    }

    function oTokenUnderlyingPrice(IOToken oToken) public view returns (IOTokenUnderlyingPrice memory) {
        OVixLensInterface comptroller = OVixLensInterface(address(oToken.comptroller()));
        PriceOracle priceOracle = comptroller.oracle();

        return IOTokenUnderlyingPrice({oToken: address(oToken), underlyingPrice: priceOracle.getUnderlyingPrice(oToken)});
    }

    function oTokenUnderlyingPriceAll(IOToken[] calldata oTokens) external view returns (IOTokenUnderlyingPrice[] memory) {
        uint256 oTokenCount = oTokens.length;
        IOTokenUnderlyingPrice[] memory res = new IOTokenUnderlyingPrice[](oTokenCount);
        for (uint256 i = 0; i < oTokenCount; i++) {
            res[i] = oTokenUnderlyingPrice(oTokens[i]);
        }
        return res;
    }

    struct AccountLimits {
        IOToken[] markets;
        uint256 liquidity;
        uint256 shortfall;
    }

    function getAccountLimits(OVixLensInterface comptroller, address account) public view returns (AccountLimits memory) {
        (uint256 errorCode, uint256 liquidity, uint256 shortfall) = comptroller.getAccountLiquidity(account);
        require(errorCode == 0);

        return AccountLimits({markets: comptroller.getAssetsIn(account), liquidity: liquidity, shortfall: shortfall});
    }

    function compareStrings(string memory a, string memory b) internal pure returns (bool) {
        return (keccak256(abi.encodePacked((a))) == keccak256(abi.encodePacked((b))));
    }

    struct SlotData {
        address slot;
        address owner;
        string collateralSymbol;
        address collateral;
        uint8 collateralDecimals;
        address cCollateral;
        string debtSymbol;
        address debt;
        uint8 debtDecimals;
        address cDebt;
        uint256 collateralBalance;
        uint256 debtBalance;
        uint256 collateralSwapped;
        uint256 debtSwapped;
        uint32 creationTime;
        uint32 closeTime;
    }

    function getUserSlots(address _user, address _slotFactory) external returns (SlotData[] memory userSlots) {
        address[] memory slots = IOneDeltaSlotFactory(_slotFactory).getSlots(_user);
        uint256 length = slots.length;
        userSlots = new SlotData[](length);
        for (uint256 i = 0; i < length; i++) {
            userSlots[i] = getSlotData(slots[i]);
        }
    }

    function getSlotData(address _slot) public returns (SlotData memory slotData) {
        address slot = _slot;
        VixDetailsStorage memory details = ISlot(slot).getDetails();
        GeneralStorage memory general = ISlot(slot).getGeneral();
        (address cCollateral, address cDebt) = ISlot(slot).getOTokens();

        bool collateralIsETH = compareStrings(IOToken(cCollateral).symbol(), "oETH");
        bool debtIsETH = compareStrings(IOToken(cDebt).symbol(), "oETH");

        // collateral data
        slotData.collateral = general.collateral;
        slotData.collateralSymbol = collateralIsETH ? "ETH" : IERC20Base(general.collateral).symbol();
        slotData.collateralDecimals = collateralIsETH ? 18 : IERC20Base(general.collateral).decimals();
        slotData.cCollateral = cCollateral;

        // debt data
        slotData.cDebt = cDebt;
        slotData.debt = general.debt;
        slotData.debtDecimals = debtIsETH ? 18 : IERC20Base(general.debt).decimals();
        slotData.debtSymbol = debtIsETH ? "ETH" : IERC20Base(general.debt).symbol();

        // balances
        slotData.collateralBalance = IOToken(cCollateral).balanceOfUnderlying(slot);
        slotData.debtBalance = IOToken(cDebt).borrowBalanceCurrent(slot);
        slotData.collateralSwapped = details.collateralSwapped;
        slotData.debtSwapped = details.debtSwapped;

        // ownership & slot
        slotData.owner = ISlot(slot).getOwner();
        slotData.slot = slot;

        // times
        slotData.creationTime = details.creationTime;
        slotData.closeTime = details.closeTime;
    }

    function add(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, errorMessage);
        return c;
    }

    function sub(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        uint256 c = a - b;
        return c;
    }
}
