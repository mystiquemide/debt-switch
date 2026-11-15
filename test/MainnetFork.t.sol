// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IMorpho, MarketParams, Position, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {DebtSwitchRouter} from "../contracts/DebtSwitchRouter.sol";
import {
    IERC20Min, IBorrowerOperations, IBorrowerOperationsSignatures, IPoolRouter
} from "../contracts/interfaces/IMezo.sol";
import {BtcStandIn, OracleStandIn} from "./standins/MezoStandIns.sol";

interface ITroveManagerM {
    function getTroveStatus(address) external view returns (uint256);
    function getTroveColl(address) external view returns (uint256);
    function getTroveDebt(address) external view returns (uint256);
}

/// Both switches against Mezo MAINNET (31612) as deployed: the real Morpho Blue and its BTC/mUSDC market,
/// BorrowerOperations, BorrowerOperationsSignatures, TroveManager, MUSD and the Mezo Pools MUSD/mUSDC pool.
/// Only the chain-native BTC token and BTC/USD precompile run as test stand-ins, as in the testnet suite.
contract MainnetForkTest is Test {
    using MarketParamsLib for MarketParams;

    address constant BTC = 0x7b7C000000000000000000000000000000000000;
    address constant BTC_ORACLE = 0x7b7c000000000000000000000000000000000015;
    IMorpho constant MORPHO = IMorpho(0x565834cE7E40b8987BC20EbF83E2159467bDA311);
    bytes32 constant MARKET_ID = 0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db;
    address constant MUSD = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;
    address constant MUSDC = 0x04671C72Aab5AC02A03c1098314b1BB6B560c197;
    address constant BORROWER_OPS = 0x44b1bac67dDA612a41a58AAf779143B181dEe031;
    address constant TROVE_SIGS = 0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a;
    address constant TROVE_MANAGER = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
    address constant POOL_ROUTER = 0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706;
    address constant POOL_FACTORY = 0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248;

    uint256 constant COLLATERAL = 0.1e18;
    uint256 constant MORPHO_DEBT = 1_500e6;

    bytes32 constant OPEN_TYPEHASH = keccak256(
        "OpenTrove(uint256 assetAmount,uint256 debtAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)"
    );
    bytes32 constant CLOSE_TYPEHASH =
        keccak256("CloseTrove(address borrower,address recipient,uint256 nonce,uint256 deadline)");

    DebtSwitchRouter router;
    MarketParams market;
    address borrower;
    uint256 key;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("mezo_mainnet"));
        _installStandIns();
        (address loan, address coll, address oracle, address irm, uint256 lltv) = _params();
        market = MarketParams(loan, coll, oracle, irm, lltv);
        router = new DebtSwitchRouter(
            MORPHO,
            IBorrowerOperations(BORROWER_OPS),
            IBorrowerOperationsSignatures(TROVE_SIGS),
            IPoolRouter(POOL_ROUTER),
            POOL_FACTORY,
            IERC20Min(MUSD),
            IERC20Min(MUSDC),
            IERC20Min(BTC)
        );
        (borrower, key) = makeAddrAndKey("mainnet-borrower");
        vm.deal(borrower, COLLATERAL + 0.01e18);
        vm.startPrank(borrower);
        IERC20Min(BTC).approve(address(MORPHO), COLLATERAL);
        MORPHO.supplyCollateral(market, COLLATERAL, borrower, "");
        MORPHO.borrow(market, MORPHO_DEBT, 0, borrower, borrower);
        IERC20Min(MUSDC).transfer(makeAddr("spent"), MORPHO_DEBT);
        MORPHO.setAuthorization(address(router), true);
        vm.stopPrank();
    }

    function test_Mainnet_MorphoToTrove() public {
        _forward();
        assertEq(MORPHO.position(Id.wrap(MARKET_ID), borrower).borrowShares, 0, "morpho debt cleared");
        assertEq(ITroveManagerM(TROVE_MANAGER).getTroveStatus(borrower), 1, "trove active");
        assertEq(ITroveManagerM(TROVE_MANAGER).getTroveColl(borrower), COLLATERAL, "all BTC in trove");
        assertGt(IERC20Min(MUSDC).balanceOf(borrower), 0, "surplus refunded");
        _assertRouterEmpty();
    }

    function test_Mainnet_TroveToMorpho() public {
        _forward();
        uint256 refund = IERC20Min(MUSDC).balanceOf(borrower);
        address spent = makeAddr("spent");
        vm.prank(borrower);
        IERC20Min(MUSDC).transfer(spent, refund);

        uint256 owed = ITroveManagerM(TROVE_MANAGER).getTroveDebt(borrower) - 200e18;
        IPoolRouter.Route[] memory r = new IPoolRouter.Route[](1);
        r[0] = IPoolRouter.Route(MUSDC, MUSD, true, POOL_FACTORY);
        // Size the flash loan from quotes at the real trade size: the mainnet pool is thin, so slippage grows with size.
        uint256 flash = owed / 1e12;
        for (uint256 i; i < 6; i++) {
            uint256 out = IPoolRouter(POOL_ROUTER).getAmountsOut(flash, r)[1];
            flash = flash * owed / out + 1;
        }
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = IBorrowerOperationsSignatures(TROVE_SIGS).getNonce(borrower);
        bytes memory sig = _sign(keccak256(abi.encode(CLOSE_TYPEHASH, borrower, address(router), nonce, deadline)));
        DebtSwitchRouter.TroveToMorphoParams memory p = DebtSwitchRouter.TroveToMorphoParams({
            market: market,
            borrower: borrower,
            flashAmount: flash * 1005 / 1000,
            minMusdOut: owed,
            deadline: deadline,
            troveSignature: sig
        });
        vm.prank(borrower);
        router.troveToMorpho(p);

        assertEq(ITroveManagerM(TROVE_MANAGER).getTroveStatus(borrower), 2, "trove closed");
        Position memory pos = MORPHO.position(Id.wrap(MARKET_ID), borrower);
        assertEq(pos.collateral, COLLATERAL, "all BTC back on Morpho");
        assertGt(pos.borrowShares, 0, "morpho loan open");
        _assertRouterEmpty();
    }

    function _forward() internal {
        IPoolRouter.Route[] memory r = new IPoolRouter.Route[](1);
        r[0] = IPoolRouter.Route(MUSD, MUSDC, true, POOL_FACTORY);
        uint256 perK = IPoolRouter(POOL_ROUTER).getAmountsOut(1_000e18, r)[1];
        uint256 debt = MORPHO_DEBT * 1_000e18 / perK * 101 / 100;
        uint256 floor = IBorrowerOperations(BORROWER_OPS).minNetDebt();
        if (debt < floor) debt = floor;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = IBorrowerOperationsSignatures(TROVE_SIGS).getNonce(borrower);
        bytes memory sig = _sign(
            keccak256(abi.encode(OPEN_TYPEHASH, COLLATERAL, debt, borrower, address(router), nonce, deadline))
        );
        DebtSwitchRouter.MorphoToTroveParams memory p = DebtSwitchRouter.MorphoToTroveParams({
            market: market,
            borrower: borrower,
            troveDebt: debt,
            upperHint: address(0),
            lowerHint: address(0),
            minMusdcOut: 0,
            deadline: deadline,
            troveSignature: sig
        });
        vm.prank(borrower);
        router.morphoToTrove(p);
    }

    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BorrowerOperationsSignatures"),
                keccak256("1"),
                block.chainid,
                TROVE_SIGS
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _params() internal view returns (address, address, address, address, uint256) {
        (bool ok, bytes memory out) =
            address(MORPHO).staticcall(abi.encodeWithSignature("idToMarketParams(bytes32)", MARKET_ID));
        require(ok);
        return abi.decode(out, (address, address, address, address, uint256));
    }

    function _assertRouterEmpty() internal view {
        assertEq(address(router).balance, 0, "router BTC");
        assertEq(IERC20Min(MUSD).balanceOf(address(router)), 0, "router MUSD");
        assertEq(IERC20Min(MUSDC).balanceOf(address(router)), 0, "router mUSDC");
    }

    function _installStandIns() internal {
        bytes memory raw =
            vm.rpc("eth_call", string.concat('[{"to":"', vm.toString(BTC_ORACLE), '","data":"0xfeaf968c"},"latest"]'));
        (, int256 answer,,,) = abi.decode(raw, (uint80, int256, uint256, uint256, uint80));
        bytes memory rawDec =
            vm.rpc("eth_call", string.concat('[{"to":"', vm.toString(BTC_ORACLE), '","data":"0x313ce567"},"latest"]'));
        vm.etch(BTC_ORACLE, address(new OracleStandIn(answer, abi.decode(rawDec, (uint8)))).code);
        vm.etch(BTC, address(new BtcStandIn()).code);
        vm.allowCheatcodes(BTC);
    }
}
