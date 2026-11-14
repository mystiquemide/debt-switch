// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MezoPriceOracle} from "../contracts/MezoPriceOracle.sol";
import {IPriceFeed} from "../contracts/interfaces/IMezo.sol";

contract FixedFeed is IPriceFeed {
    uint256 public p;

    constructor(uint256 p_) {
        p = p_;
    }

    function fetchPrice() external view returns (uint256) {
        return p;
    }
}

contract MezoPriceOracleTest is Test {
    function test_ScalesToMorphoUnits() public {
        MezoPriceOracle o = new MezoPriceOracle(new FixedFeed(65_230e18));
        // 1 BTC (1e18 units) must be worth 65,230 mUSDC (6 decimals).
        uint256 collateral = 1e18;
        assertEq(collateral * o.price() / 1e36, 65_230e6);
        assertEq(o.price(), 65_230e24);
    }

    function testFuzz_ValueMatchesUsd(uint256 usdPerBtc, uint256 sats) public {
        usdPerBtc = bound(usdPerBtc, 1, 100_000_000); // up to $100M per BTC
        sats = bound(sats, 0, 21_000_000e8); // up to the full supply
        MezoPriceOracle o = new MezoPriceOracle(new FixedFeed(uint256(usdPerBtc) * 1e18));
        uint256 coll = uint256(sats) * 1e10; // sats -> 18 decimals
        assertEq(coll * o.price() / 1e36, coll * uint256(usdPerBtc) * 1e6 / 1e18);
    }
}
