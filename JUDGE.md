# Judge guide

How to verify Debt Switch in about 5 minutes, with what you should see at each step. Every link goes to Mezo Testnet (chain 31611).

## What you are checking

Debt Switch claims one thing:

> A borrower with a Morpho mUSDC loan on Mezo can move it into an MUSD trove **in one transaction**, with **no stablecoins in their wallet**, and the router **keeps nothing**.

The steps below check that claim from the chain, not from our word.

## 1. The switch itself (2 minutes)

Open the transaction's token transfers:
**https://explorer.test.mezo.org/tx/0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5?tab=token_transfers**

You should see, in this order:

| Row | Transfer | Meaning |
|---|---|---|
| 1 | 300.000133 mUSDC, Morpho to DebtSwitchRouter | The flash loan |
| 2 | 300.000133 mUSDC, DebtSwitchRouter to Morpho | The borrower's Morpho debt repaid |
| 3 | 0.04 BTC, Morpho to DebtSwitchRouter | The collateral withdrawn |
| 4-5 | MUSD minted to PCV | Mezo's protocol share, including the issuance fee |
| 6 | 1,798.2017982 MUSD minted to DebtSwitchRouter | The new trove's debt, minted by Mezo |
| 7 | 200 MUSD minted to GasPool | Mezo's liquidation reserve |
| 8-9 | 1,798.20 MUSD to Pool, 1,439.25 mUSDC back | The Mezo Pools swap |
| 10 | 0.18 MUSD to the pool fee address | The swap fee |
| 11 | 300.000133 mUSDC, router to Morpho | The flash loan repaid |
| 12 | 1,139.246954 mUSDC, router to `0x5c64...67B4` | The refund to the borrower |

The router receives and sends out matching amounts, so it ends with nothing.

**The borrower had no stablecoins before.** The borrower's only incoming stablecoin before this was the 300 mUSDC Morpho loan, which they sent away in [`0x142090e8...`](https://explorer.test.mezo.org/tx/0x142090e88ed09099c5927056edac0a984a64c9bc05e9e5f82550e29b2020f137). Check the [borrower's address page](https://explorer.test.mezo.org/address/0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4).

## 2. The state afterwards (1 minute)

In the app, no wallet needed: open **https://debtswitch.midelabs.xyz/?address=0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4**. It reads the demo borrower's Morpho position and trove live from chain, and explains how the switch was sized.

With Foundry's `cast`:

```bash
# Trove: status 1 = active
cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getTroveStatus(address)(uint8)" \
  0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4 --rpc-url https://rpc.test.mezo.org

# Trove collateral: 40000000000000000 (0.04 BTC)
cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getTroveColl(address)(uint256)" \
  0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4 --rpc-url https://rpc.test.mezo.org

# Morpho position: 0, 0, 0
cast call 0x9074F3348585bECdde74fa1c0DE0722043F9f76e "position(bytes32,address)(uint256,uint128,uint128)" \
  0x19e8401c76f050f4aeb9d145c4f6d2cde9dbba187cd180353018637d261ee541 \
  0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4 --rpc-url https://rpc.test.mezo.org

# Router balances: all 0
cast balance 0x7bb308048C4C511A4102640eDCD8027c22123af7 --rpc-url https://rpc.test.mezo.org
cast call 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 "balanceOf(address)(uint256)" 0x7bb308048C4C511A4102640eDCD8027c22123af7 --rpc-url https://rpc.test.mezo.org
cast call 0xe1a26db653708A2AD8F824E92Db9852410e33A59 "balanceOf(address)(uint256)" 0x7bb308048C4C511A4102640eDCD8027c22123af7 --rpc-url https://rpc.test.mezo.org
```

## 3. The refusals (1 minute)

| Case | Transaction | Expected |
|---|---|---|
| Below Mezo's 1,800 MUSD floor | [`0xaf9e00b1...`](https://explorer.test.mezo.org/tx/0xaf9e00b1c6f240869b02960e8a8bb5314a41b35a3aeab391331c7091a7f1e027) | Failed, `BelowMinNetDebt(1001e18, 1800e18)` |
| Caller isn't the borrower | [`0xc3d1628c...`](https://explorer.test.mezo.org/tx/0xc3d1628ca463dd13b0e4d293d32fc449d519897ac50ac14b7a0e2a68a88b45c8) | Failed, `NotBorrower()` |
| Out of gas mid-switch (a real failure, not staged) | [`0xe27a019f...`](https://explorer.test.mezo.org/tx/0xe27a019f44ee2d1836a2b458579368d13bfcd557317191f3ebb5c2eeda09aebe) | Failed. The next transaction for the same borrower is the successful switch, which shows nothing had changed. |

Slippage and signature replay are covered by fork tests. See step 5.

## 4. The code (1 minute)

- **Router, verified source:** https://explorer.test.mezo.org/address/0x7bb308048C4C511A4102640eDCD8027c22123af7?tab=contract
  - `morphoToTrove`: the caller check, the floor pre-check, debt computed by shares, then the flash loan.
  - `onMorphoFlashLoan`: repay, withdraw, `openTroveWithSignature`, swap, and a check that the swap covers the flash loan.
  - No owner, no setters, no upgrade path.
- **Oracle:** `MezoPriceOracle.price()` returns Mezo PriceFeed × 1e6. Check it against PriceFeed directly. The first value should be the second followed by six more digits. If the price updates between the two calls, they can differ slightly.

```bash
cast call 0x101764Ed730a37f39B80DCe97882bdff76be24c9 "price()(uint256)" --rpc-url https://rpc.test.mezo.org
cast call 0x86bCF0841622a5dAC14A313a15f96A95421b9366 "fetchPrice()(uint256)" --rpc-url https://rpc.test.mezo.org
```

## 5. The tests (optional, 2 minutes)

```bash
git clone --recurse-submodules https://github.com/mystiquemide/debt-switch && cd debt-switch
forge test
```

Expected: `10 tests passed, 0 failed`. The tests fork live Mezo Testnet and use Mezo's deployed MUSD, BorrowerOperations, BorrowerOperationsSignatures, TroveManager and Mezo Pools.

| Test | Proves |
|---|---|
| `test_MorphoToTrove_SwitchesWholePosition` | Full switch: Morpho cleared, trove active with all BTC, at or above the floor, router empty |
| `test_RouterHoldsNothing` | Zero BTC, MUSD and mUSDC in the router afterwards |
| `test_ClosesFullyAfterAccrual` | 30 days of interest, still no dust |
| `test_RevertWhen_BelowMinNetDebt` | Floor refusal with exact values |
| `test_RevertWhen_CallerNotBorrower` | Only the borrower can switch |
| `test_RevertWhen_CallbackNotFromMorpho` | Fake callbacks rejected |
| `test_RevertWhen_SlippageExceeded` | Mezo Pools `InsufficientOutputAmount` |
| `test_RevertWhen_SignatureReplayed` | Mezo's nonce rejects a used signature |
| `test_ScalesToMorphoUnits`, `testFuzz_ValueMatchesUsd` | Oracle unit maths |

Mezo's native BTC token and BTC/USD oracle can't execute on a fork, so the tests replace those two with test-only stand-ins (`test/standins`). Everything else in the switch runs as deployed. The live transactions in steps 1 to 3 use the real ones.

## Where Mezo is load-bearing

| Mezo primitive | Role in the switch |
|---|---|
| `BorrowerOperationsSignatures.openTroveWithSignature` | Opens the trove in the borrower's name from the router |
| MUSD | Minted inside the switch, it's the new debt |
| `BorrowerOperations.minNetDebt`, `getBorrowingFee` | Floor check and exact trove sizing |
| HintHelpers, SortedTroves | Cheap trove insertion. Without them the insert ran out of gas on testnet. |
| PriceFeed | Single BTC price for Morpho and the trove |
| Mezo Pools MUSD/mUSDC stable pool | Converts the MUSD back to mUSDC to repay the flash loan |

## Things to know

- The Morpho Blue instance is ours. Morpho isn't deployed on Mezo Testnet. It's unmodified v1.0.0 with an 86% LLTV, matching Mezo mainnet's mUSDC market.
- The demo Morpho loan was 300 mUSDC, below Mezo's 1,800 MUSD trove floor, so the trove was sized to the floor and the extra came back as mUSDC. The skewed testnet pool (about 0.80 mUSDC per MUSD) makes that refund smaller than it would be on mainnet.
- All the transactions come from demo wallets we funded on testnet. They show the mechanism working. They aren't third-party users.
