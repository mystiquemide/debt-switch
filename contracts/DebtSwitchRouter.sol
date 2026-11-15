// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.24;

import {IMorpho, MarketParams, Position, Market, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {IMorphoFlashLoanCallback} from "morpho-blue/interfaces/IMorphoCallbacks.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {SharesMathLib} from "morpho-blue/libraries/SharesMathLib.sol";
import {IERC20Min, IBorrowerOperations, IBorrowerOperationsSignatures, IPoolRouter} from "./interfaces/IMezo.sol";

/// @title DebtSwitchRouter
/// @notice Moves a whole BTC-backed loan between Morpho mUSDC (variable) and a Mezo MUSD trove (fixed),
///         in either direction, in one transaction, without the borrower holding stablecoins.
/// @dev Immutable, no admin. Holds nothing between transactions. On Mezo, BTC's native balance and
///      the ERC-20 at 0x7b7C are the same balance, so BTC withdrawn from Morpho as an ERC-20 can be
///      sent to BorrowerOperations as msg.value.
contract DebtSwitchRouter is IMorphoFlashLoanCallback {
    using MarketParamsLib for MarketParams;
    using SharesMathLib for uint256;

    struct MorphoToTroveParams {
        MarketParams market; // loanToken must be MUSDC, collateralToken must be BTC
        address borrower; // must equal msg.sender
        uint256 troveDebt; // MUSD requested for the trove, excluding fee and gas compensation
        address upperHint;
        address lowerHint;
        uint256 minMusdcOut; // swap floor for troveDebt MUSD -> mUSDC
        uint256 deadline; // used for both the trove signature and the swap
        bytes troveSignature; // OpenTrove EIP-712 signature by borrower, recipient = this router
    }

    struct TroveToMorphoParams {
        MarketParams market; // loanToken must be MUSDC, collateralToken must be BTC
        address borrower; // must equal msg.sender
        uint256 flashAmount; // mUSDC borrowed for the moment it takes to close the trove, then borrowed on Morpho
        uint256 minMusdOut; // swap floor for flashAmount mUSDC -> MUSD
        uint256 deadline; // used for both the trove signature and the swap
        bytes troveSignature; // CloseTrove EIP-712 signature by borrower, recipient = this router
    }

    struct CloseCallback {
        MarketParams market;
        address borrower;
        uint256 minMusdOut;
        uint256 deadline;
        bytes troveSignature;
    }

    uint8 private constant TO_TROVE = 1;
    uint8 private constant TO_MORPHO = 2;

    struct Callback {
        MarketParams market;
        address borrower;
        uint256 borrowShares;
        uint256 collateral;
        uint256 troveDebt;
        address upperHint;
        address lowerHint;
        uint256 minMusdcOut;
        uint256 deadline;
        bytes troveSignature;
    }

    IMorpho public immutable morpho;
    IBorrowerOperations public immutable borrowerOperations;
    IBorrowerOperationsSignatures public immutable troveSignatures;
    IPoolRouter public immutable poolRouter;
    address public immutable poolFactory;
    IERC20Min public immutable musd;
    IERC20Min public immutable musdc;
    IERC20Min public immutable btc;

    /// Borrower of the switch in progress. Zero outside a switch.
    address private activeBorrower;

    error NotBorrower();
    error NotMorpho();
    error NoSwitchInProgress();
    error SwitchInProgress();
    error WrongMarket();
    error NoMorphoDebt();
    error BelowMinNetDebt(uint256 netDebt, uint256 minNetDebt);
    error SwapBelowFlashLoan(uint256 out, uint256 owed);
    error TransferFailed();

    constructor(
        IMorpho morpho_,
        IBorrowerOperations borrowerOperations_,
        IBorrowerOperationsSignatures troveSignatures_,
        IPoolRouter poolRouter_,
        address poolFactory_,
        IERC20Min musd_,
        IERC20Min musdc_,
        IERC20Min btc_
    ) {
        morpho = morpho_;
        borrowerOperations = borrowerOperations_;
        troveSignatures = troveSignatures_;
        poolRouter = poolRouter_;
        poolFactory = poolFactory_;
        musd = musd_;
        musdc = musdc_;
        btc = btc_;
        // Morpho pulls the repayment and the flash loan back from this contract. The router holds
        // nothing between transactions, so a standing approval exposes nothing.
        if (!musdc_.approve(address(morpho_), type(uint256).max)) revert TransferFailed();
        if (!musd_.approve(address(poolRouter_), type(uint256).max)) revert TransferFailed();
        if (!musdc_.approve(address(poolRouter_), type(uint256).max)) revert TransferFailed();
        // BTC from a closed trove is supplied to Morpho as collateral in the reverse direction.
        if (!btc_.approve(address(morpho_), type(uint256).max)) revert TransferFailed();
    }

    receive() external payable {}

    /// @notice Switch the caller's whole Morpho position into a new MUSD trove.
    /// @dev Requires: Morpho.setAuthorization(this, true) by the borrower, and an OpenTrove signature
    ///      for (assetAmount = Morpho collateral, debtAmount = troveDebt, recipient = this).
    function morphoToTrove(MorphoToTroveParams calldata p) external {
        if (msg.sender != p.borrower) revert NotBorrower();
        if (activeBorrower != address(0)) revert SwitchInProgress();
        if (p.market.loanToken != address(musdc) || p.market.collateralToken != address(btc)) {
            revert WrongMarket();
        }

        uint256 netDebt = p.troveDebt + borrowerOperations.getBorrowingFee(p.troveDebt);
        uint256 floor = borrowerOperations.minNetDebt();
        if (netDebt < floor) revert BelowMinNetDebt(netDebt, floor);

        Id id = p.market.id();
        morpho.accrueInterest(p.market);
        Position memory pos = morpho.position(id, p.borrower);
        if (pos.borrowShares == 0) revert NoMorphoDebt();
        Market memory m = morpho.market(id);
        uint256 debtAssets = uint256(pos.borrowShares).toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares);

        activeBorrower = p.borrower;
        morpho.flashLoan(
            address(musdc),
            debtAssets,
            abi.encode(
                TO_TROVE,
                abi.encode(
                    Callback({
                        market: p.market,
                        borrower: p.borrower,
                        borrowShares: pos.borrowShares,
                        collateral: pos.collateral,
                        troveDebt: p.troveDebt,
                        upperHint: p.upperHint,
                        lowerHint: p.lowerHint,
                        minMusdcOut: p.minMusdcOut,
                        deadline: p.deadline,
                        troveSignature: p.troveSignature
                    })
                )
            )
        );
        activeBorrower = address(0);

        _refund(p.borrower);
    }

    /// @notice Switch the caller's whole MUSD trove into a Morpho mUSDC loan.
    /// @dev Requires: Morpho.setAuthorization(this, true) by the borrower, and a CloseTrove signature
    ///      for (recipient = this). The flash amount is sized off chain so its swap covers the trove's
    ///      debt less Mezo's 200 MUSD reserve; any extra MUSD is refunded.
    function troveToMorpho(TroveToMorphoParams calldata p) external {
        if (msg.sender != p.borrower) revert NotBorrower();
        if (activeBorrower != address(0)) revert SwitchInProgress();
        if (p.market.loanToken != address(musdc) || p.market.collateralToken != address(btc)) {
            revert WrongMarket();
        }
        activeBorrower = p.borrower;
        morpho.flashLoan(
            address(musdc),
            p.flashAmount,
            abi.encode(
                TO_MORPHO,
                abi.encode(
                    CloseCallback({
                        market: p.market,
                        borrower: p.borrower,
                        minMusdOut: p.minMusdOut,
                        deadline: p.deadline,
                        troveSignature: p.troveSignature
                    })
                )
            )
        );
        activeBorrower = address(0);

        _refund(p.borrower);
    }

    /// @inheritdoc IMorphoFlashLoanCallback
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        if (msg.sender != address(morpho)) revert NotMorpho();
        if (activeBorrower == address(0)) revert NoSwitchInProgress();
        (uint8 kind, bytes memory inner) = abi.decode(data, (uint8, bytes));
        if (kind == TO_MORPHO) return _closeIntoMorpho(assets, abi.decode(inner, (CloseCallback)));
        Callback memory c = abi.decode(inner, (Callback));

        // 1. Clear the Morpho debt by shares so no dust is left behind.
        morpho.repay(c.market, 0, c.borrowShares, c.borrower, "");
        // 2. Take the BTC. It arrives as ERC-20 and is spendable as native value.
        morpho.withdrawCollateral(c.market, c.collateral, c.borrower, address(this));
        // 3. Open the trove in the borrower's name. The MUSD comes here.
        troveSignatures.openTroveWithSignature{value: c.collateral}(
            c.troveDebt, c.upperHint, c.lowerHint, c.borrower, address(this), c.troveSignature, c.deadline
        );
        // 4. MUSD -> mUSDC on the Mezo Pools stable pool.
        IPoolRouter.Route[] memory routes = new IPoolRouter.Route[](1);
        routes[0] = IPoolRouter.Route(address(musd), address(musdc), true, poolFactory);
        uint256[] memory amounts =
            poolRouter.swapExactTokensForTokens(c.troveDebt, c.minMusdcOut, routes, address(this), c.deadline);
        uint256 out = amounts[amounts.length - 1];
        if (out < assets) revert SwapBelowFlashLoan(out, assets);
        // 5. Morpho pulls `assets` back after this returns.
    }

    function _closeIntoMorpho(uint256 assets, CloseCallback memory c) private {
        // 1. mUSDC -> MUSD on the Mezo Pools stable pool.
        IPoolRouter.Route[] memory routes = new IPoolRouter.Route[](1);
        routes[0] = IPoolRouter.Route(address(musdc), address(musd), true, poolFactory);
        poolRouter.swapExactTokensForTokens(assets, c.minMusdOut, routes, address(this), c.deadline);
        // 2. Close the trove in the borrower's name. Mezo burns the MUSD from this router and sends the BTC here.
        troveSignatures.closeTroveWithSignature(c.borrower, address(this), c.troveSignature, c.deadline);
        // 3. All of that BTC becomes the borrower's collateral on Morpho.
        uint256 coll = address(this).balance;
        morpho.supplyCollateral(c.market, coll, c.borrower, "");
        // 4. Borrow against it for the borrower, to repay the flash loan. Morpho refuses if it would be unhealthy.
        morpho.borrow(c.market, assets, 0, c.borrower, address(this));
        // 5. Morpho pulls `assets` back after this returns. Leftover MUSD is refunded to the borrower.
    }

    function _refund(address to) private {
        uint256 bal = musdc.balanceOf(address(this));
        if (bal != 0 && !musdc.transfer(to, bal)) revert TransferFailed();
        bal = musd.balanceOf(address(this));
        if (bal != 0 && !musd.transfer(to, bal)) revert TransferFailed();
        bal = address(this).balance;
        if (bal != 0) {
            (bool ok,) = to.call{value: bal}("");
            if (!ok) revert TransferFailed();
        }
    }
}
