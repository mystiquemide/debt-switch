// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho, MarketParams, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {DebtSwitchRouter} from "../contracts/DebtSwitchRouter.sol";
import {MezoPriceOracle} from "../contracts/MezoPriceOracle.sol";
import {
    IERC20Min,
    IBorrowerOperations,
    IBorrowerOperationsSignatures,
    IPoolRouter,
    IPriceFeed
} from "../contracts/interfaces/IMezo.sol";

/// Deploys our Morpho Blue instance (Morpho isn't on Mezo testnet), its interest model, the
/// PriceFeed-backed oracle, the BTC/mUSDC market and DebtSwitchRouter to Mezo testnet 31611.
/// None of these steps touch the chain-native BTC token, so forge can simulate them.
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    address constant BTC = 0x7b7C000000000000000000000000000000000000;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant MUSDC = 0xe1a26db653708A2AD8F824E92Db9852410e33A59;
    address constant BORROWER_OPS = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TROVE_SIGS = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;
    address constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant POOL_ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address constant POOL_FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    uint256 constant LLTV = 0.86e18; // matches Mezo mainnet's Morpho mUSDC liquidation LTV

    function run() external {
        require(block.chainid == 31611, "Mezo testnet only");
        vm.startBroadcast();
        address owner = msg.sender;

        IMorpho morpho = IMorpho(deployCode("Morpho.sol:Morpho", abi.encode(owner)));
        address irm = deployCode("AdaptiveCurveIrm.sol:AdaptiveCurveIrm", abi.encode(address(morpho)));
        morpho.enableIrm(irm);
        morpho.enableLltv(LLTV);
        MezoPriceOracle oracle = new MezoPriceOracle(IPriceFeed(PRICE_FEED));
        MarketParams memory market =
            MarketParams({loanToken: MUSDC, collateralToken: BTC, oracle: address(oracle), irm: irm, lltv: LLTV});
        morpho.createMarket(market);

        DebtSwitchRouter router = new DebtSwitchRouter(
            morpho,
            IBorrowerOperations(BORROWER_OPS),
            IBorrowerOperationsSignatures(TROVE_SIGS),
            IPoolRouter(POOL_ROUTER),
            POOL_FACTORY,
            IERC20Min(MUSD),
            IERC20Min(MUSDC),
            IERC20Min(BTC)
        );
        vm.stopBroadcast();

        console2.log("MORPHO", address(morpho));
        console2.log("IRM", irm);
        console2.log("ORACLE", address(oracle));
        console2.log("ROUTER", address(router));
        console2.log("MARKET_ID");
        console2.logBytes32(Id.unwrap(market.id()));
    }
}
