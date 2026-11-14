// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {IPriceFeed} from "./interfaces/IMezo.sol";

/// @notice Morpho oracle for a BTC (18 decimals) collateral, mUSDC (6 decimals) loan market,
///         priced from Mezo's own PriceFeed so both products see the same BTC price.
/// @dev Morpho wants the price of 1 collateral unit in loan units, scaled by 1e36.
///      priceFeed returns USD per BTC at 1e18, so:
///      price = p1e18 * 1e36 * 1e6 / (1e18 * 1e18) = p1e18 * 1e6.
contract MezoPriceOracle is IOracle {
    IPriceFeed public immutable priceFeed;

    constructor(IPriceFeed priceFeed_) {
        priceFeed = priceFeed_;
    }

    function price() external view returns (uint256) {
        return priceFeed.fetchPrice() * 1e6;
    }
}
