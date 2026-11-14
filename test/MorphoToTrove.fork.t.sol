// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IMorpho, MarketParams, Position, Id} from "morpho-blue/interfaces/IMorpho.sol";
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
import {BtcStandIn, OracleStandIn} from "./standins/MezoStandIns.sol";

interface ITroveManager {
    function getTroveStatus(address borrower) external view returns (uint256);
    function getTroveColl(address borrower) external view returns (uint256);
    function getTroveDebt(address borrower) external view returns (uint256);
}

/// Fork tests against live Mezo testnet (31611) contracts: BorrowerOperations, BorrowerOperationsSignatures,
/// TroveManager, MUSD and the Mezo Pools MUSD/mUSDC stable pool all run as deployed. Morpho Blue is our own
/// deployment (Morpho isn't on Mezo testnet). BTC and the BTC/USD oracle are chain-native, so they run as
/// test-only stand-ins (see test/standins).
contract MorphoToTroveForkTest is Test {
    using MarketParamsLib for MarketParams;

    address constant BTC = 0x7b7C000000000000000000000000000000000000;
    address constant BTC_ORACLE = 0x7b7c000000000000000000000000000000000015;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant MUSDC = 0xe1a26db653708A2AD8F824E92Db9852410e33A59;
    address constant BORROWER_OPS = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TROVE_SIGS = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;
    address constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant POOL_ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address constant POOL_FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;

    uint256 constant LLTV = 0.86e18;
    uint256 constant COLLATERAL = 0.1e18; // 0.1 BTC
    uint256 constant MORPHO_DEBT = 1_500e6; // 1,500 mUSDC

    bytes32 constant OPEN_TROVE_TYPEHASH = keccak256(
        "OpenTrove(uint256 assetAmount,uint256 debtAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)"
    );

    IMorpho morpho;
    DebtSwitchRouter router;
    MarketParams market;
    address borrower;
    uint256 borrowerKey;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("mezo_testnet"));
        _installStandIns();

        morpho = IMorpho(deployCode("Morpho.sol:Morpho", abi.encode(address(this))));
        address irm = deployCode("AdaptiveCurveIrm.sol:AdaptiveCurveIrm", abi.encode(address(morpho)));
        morpho.enableIrm(irm);
        morpho.enableLltv(LLTV);
        market = MarketParams({
            loanToken: MUSDC,
            collateralToken: BTC,
            oracle: address(new MezoPriceOracle(IPriceFeed(PRICE_FEED))),
            irm: irm,
            lltv: LLTV
        });
        morpho.createMarket(market);

        // Seed the market with mUSDC liquidity.
        address supplier = makeAddr("supplier");
        deal(MUSDC, supplier, 50_000e6);
        vm.startPrank(supplier);
        IERC20Min(MUSDC).approve(address(morpho), type(uint256).max);
        morpho.supply(market, 50_000e6, 0, supplier, "");
        vm.stopPrank();

        router = new DebtSwitchRouter(
            morpho,
            IBorrowerOperations(BORROWER_OPS),
            IBorrowerOperationsSignatures(TROVE_SIGS),
            IPoolRouter(POOL_ROUTER),
            POOL_FACTORY,
            IERC20Min(MUSD),
            IERC20Min(MUSDC),
            IERC20Min(BTC)
        );

        // A borrower with a Morpho position, who then spends the borrowed mUSDC.
        (borrower, borrowerKey) = makeAddrAndKey("borrower");
        vm.deal(borrower, COLLATERAL + 0.01e18);
        vm.startPrank(borrower);
        IERC20Min(BTC).approve(address(morpho), COLLATERAL);
        morpho.supplyCollateral(market, COLLATERAL, borrower, "");
        morpho.borrow(market, MORPHO_DEBT, 0, borrower, borrower);
        IERC20Min(MUSDC).transfer(makeAddr("spent"), MORPHO_DEBT);
        morpho.setAuthorization(address(router), true);
        vm.stopPrank();
    }

    // --- positive path ---

    function test_MorphoToTrove_SwitchesWholePosition() public {
        assertEq(IERC20Min(MUSDC).balanceOf(borrower), 0, "starts with no mUSDC");
        assertEq(IERC20Min(MUSD).balanceOf(borrower), 0, "starts with no MUSD");

        DebtSwitchRouter.MorphoToTroveParams memory p = _params(_troveDebtFor(MORPHO_DEBT));
        vm.prank(borrower);
        router.morphoToTrove(p);

        Position memory pos = morpho.position(market.id(), borrower);
        assertEq(pos.borrowShares, 0, "morpho debt cleared");
        assertEq(pos.collateral, 0, "morpho collateral moved");

        ITroveManager tm = ITroveManager(TROVE_MANAGER);
        assertEq(tm.getTroveStatus(borrower), 1, "trove active");
        assertEq(tm.getTroveColl(borrower), COLLATERAL, "all BTC in trove");
        uint256 netDebt = tm.getTroveDebt(borrower) - 200e18;
        assertGe(netDebt, IBorrowerOperations(BORROWER_OPS).minNetDebt(), "at or above floor");

        assertGt(IERC20Min(MUSDC).balanceOf(borrower), 0, "swap surplus refunded");
        _assertRouterEmpty();
    }

    function test_RouterHoldsNothing() public {
        DebtSwitchRouter.MorphoToTroveParams memory p = _params(_troveDebtFor(MORPHO_DEBT));
        vm.prank(borrower);
        router.morphoToTrove(p);
        _assertRouterEmpty();
    }

    function test_ClosesFullyAfterAccrual() public {
        vm.warp(block.timestamp + 30 days);
        vm.roll(block.number + 1);
        _installStandIns(); // refresh the oracle timestamp after the warp
        DebtSwitchRouter.MorphoToTroveParams memory p = _params(_troveDebtFor(MORPHO_DEBT * 101 / 100));
        vm.prank(borrower);
        router.morphoToTrove(p);
        assertEq(morpho.position(market.id(), borrower).borrowShares, 0);
        _assertRouterEmpty();
    }

    // --- negative path ---

    function test_RevertWhen_BelowMinNetDebt() public {
        uint256 small = 1_000e18;
        uint256 fee = IBorrowerOperations(BORROWER_OPS).getBorrowingFee(small);
        DebtSwitchRouter.MorphoToTroveParams memory p = _params(small);
        vm.expectRevert(
            abi.encodeWithSelector(
                DebtSwitchRouter.BelowMinNetDebt.selector, small + fee, IBorrowerOperations(BORROWER_OPS).minNetDebt()
            )
        );
        vm.prank(borrower);
        router.morphoToTrove(p);
        assertGt(morpho.position(market.id(), borrower).borrowShares, 0, "position unchanged");
    }

    function test_RevertWhen_CallerNotBorrower() public {
        DebtSwitchRouter.MorphoToTroveParams memory p = _params(_troveDebtFor(MORPHO_DEBT));
        vm.expectRevert(DebtSwitchRouter.NotBorrower.selector);
        vm.prank(makeAddr("attacker"));
        router.morphoToTrove(p);
    }

    function test_RevertWhen_CallbackNotFromMorpho() public {
        vm.expectRevert(DebtSwitchRouter.NotMorpho.selector);
        router.onMorphoFlashLoan(1, "");
    }

    function test_RevertWhen_SlippageExceeded() public {
        DebtSwitchRouter.MorphoToTroveParams memory p = _params(_troveDebtFor(MORPHO_DEBT));
        p.minMusdcOut = type(uint128).max;
        vm.expectRevert(bytes4(keccak256("InsufficientOutputAmount()"))); // Mezo Pools router
        vm.prank(borrower);
        router.morphoToTrove(p);
        assertGt(morpho.position(market.id(), borrower).borrowShares, 0, "position unchanged");
    }

    function test_RevertWhen_SignatureReplayed() public {
        DebtSwitchRouter.MorphoToTroveParams memory p = _params(_troveDebtFor(MORPHO_DEBT));
        // Burn the nonce by using the same signature once directly.
        vm.deal(address(this), COLLATERAL);
        IBorrowerOperationsSignatures(TROVE_SIGS).openTroveWithSignature{value: COLLATERAL}(
            p.troveDebt, address(0), address(0), borrower, address(router), p.troveSignature, p.deadline
        );
        vm.expectRevert(bytes("BorrowerOperationsSignatures: Invalid signature")); // nonce moved on
        vm.prank(borrower);
        router.morphoToTrove(p);
    }

    // --- helpers ---

    function _installStandIns() internal {
        bytes memory raw =
            vm.rpc("eth_call", string.concat('[{"to":"', vm.toString(BTC_ORACLE), '","data":"0xfeaf968c"},"latest"]'));
        (, int256 answer,,,) = abi.decode(raw, (uint80, int256, uint256, uint256, uint80));
        bytes memory rawDec =
            vm.rpc("eth_call", string.concat('[{"to":"', vm.toString(BTC_ORACLE), '","data":"0x313ce567"},"latest"]'));
        uint8 dec = abi.decode(rawDec, (uint8));
        vm.etch(BTC_ORACLE, address(new OracleStandIn(answer, dec)).code);
        if (BTC.code.length != address(new BtcStandIn()).code.length) vm.etch(BTC, address(new BtcStandIn()).code);
        vm.allowCheatcodes(BTC); // the stand-in moves native balances with vm.deal
    }

    /// Smallest MUSD amount whose swap covers `musdcOwed`, from the live pool quote, plus 1% headroom.
    function _troveDebtFor(uint256 musdcOwed) internal view returns (uint256) {
        IPoolRouter.Route[] memory r = new IPoolRouter.Route[](1);
        r[0] = IPoolRouter.Route(MUSD, MUSDC, true, POOL_FACTORY);
        uint256 perThousand = IPoolRouter(POOL_ROUTER).getAmountsOut(1_000e18, r)[1];
        uint256 debt = musdcOwed * 1_000e18 / perThousand * 101 / 100;
        uint256 floor = IBorrowerOperations(BORROWER_OPS).minNetDebt();
        return debt < floor ? floor : debt;
    }

    function _params(uint256 troveDebt) internal view returns (DebtSwitchRouter.MorphoToTroveParams memory p) {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = IBorrowerOperationsSignatures(TROVE_SIGS).getNonce(borrower);
        bytes32 structHash = keccak256(
            abi.encode(OPEN_TROVE_TYPEHASH, COLLATERAL, troveDebt, borrower, address(router), nonce, deadline)
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BorrowerOperationsSignatures"),
                keccak256("1"),
                block.chainid,
                TROVE_SIGS
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(borrowerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        p = DebtSwitchRouter.MorphoToTroveParams({
            market: market,
            borrower: borrower,
            troveDebt: troveDebt,
            upperHint: address(0),
            lowerHint: address(0),
            minMusdcOut: 0,
            deadline: deadline,
            troveSignature: abi.encodePacked(r, s, v)
        });
    }

    function _assertRouterEmpty() internal view {
        assertEq(address(router).balance, 0, "router BTC");
        assertEq(IERC20Min(MUSD).balanceOf(address(router)), 0, "router MUSD");
        assertEq(IERC20Min(MUSDC).balanceOf(address(router)), 0, "router mUSDC");
    }
}
