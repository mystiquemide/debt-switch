# Debt Switch

Move a Bitcoin loan on Mezo between variable-rate mUSDC and fixed-rate MUSD in one transaction, without repaying first.

## The story

On Nov 14, 2026, the Mezo app quoted me two loans against 0.20 BTC: mUSDC at 2.4% variable, or MUSD at 1.0% fixed.

Moving from one to the other means repaying the first loan in full with cash, then opening the second. A Mezo Wave 1 participant put the trove side plainly: "the only way out is to buy it all back and repay."

The receipt: [this testnet transaction](https://explorer.test.mezo.org/tx/0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5) closed a Morpho mUSDC loan and opened an MUSD trove for the same BTC, from a wallet holding zero stablecoins.

## One-liner

I didn't build a refinancing aggregator, a keeper bot or a vault. I built one immutable router that switches your whole loan atomically, or reverts and leaves it untouched.

## How it works

A Morpho flash loan pays off your mUSDC debt.
Your BTC comes out of Morpho and opens a trove in your name through Mezo's own signed delegation, `openTroveWithSignature`.
The new MUSD is swapped to mUSDC on the Mezo Pools stable pool, and that repays the flash loan.
Anything left over goes back to you in the same transaction. The router keeps nothing.

| Step | Contract | Result |
|---|---|---|
| Approve the router on Morpho | Morpho `setAuthorization` | One-time, revocable in the app |
| Sign the OpenTrove message | Mezo `BorrowerOperationsSignatures` (EIP-712) | Binds BTC amount, debt, recipient, nonce, deadline |
| `morphoToTrove` | `DebtSwitchRouter` | Flash loan, repay by shares, withdraw BTC, open trove, swap, repay flash |
| Any check fails | Whole transaction | Reverts, position unchanged |
| After the switch | Router balances | 0 BTC, 0 MUSD, 0 mUSDC |

![Before and after a switch in the app](docs/after.png)

## Try it in 2 minutes

There's no hosted app yet. The fastest checks:

1. Open the [switch transaction](https://explorer.test.mezo.org/tx/0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5) and read the logs: Morpho `Repay` and `WithdrawCollateral`, Mezo `TroveUpdated`, the MUSD/mUSDC swap, and the flash loan settling, all in one transaction.
2. Read the result yourself:

```bash
cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getTroveStatus(address)(uint8)" 0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4 --rpc-url https://rpc.test.mezo.org
```

It returns `1`, an active trove. The same borrower's Morpho position reads 0 debt and 0 collateral.

3. Run the app against testnet with any browser wallet on Mezo Testnet (chain 31611):

```bash
cd app && npm install && npm run dev
```

The app reads both positions live. To switch, the wallet needs an open loan on the Debt Switch Morpho market below and no existing trove.

## Ways I tried to break it

| Case | Outcome | Proof |
|---|---|---|
| Switch into a trove below Mezo's 1,800 MUSD minimum | Reverts `BelowMinNetDebt(1001, 1800)` | [tx](https://explorer.test.mezo.org/tx/0xaf9e00b1c6f240869b02960e8a8bb5314a41b35a3aeab391331c7091a7f1e027), `test_RevertWhen_BelowMinNetDebt` |
| Someone else triggers your switch | Reverts `NotBorrower()` | [tx](https://explorer.test.mezo.org/tx/0xc3d1628ca463dd13b0e4d293d32fc449d519897ac50ac14b7a0e2a68a88b45c8), `test_RevertWhen_CallerNotBorrower` |
| Swap returns less than your minimum | Reverts `InsufficientOutputAmount()` from Mezo Pools | `test_RevertWhen_SlippageExceeded` |
| Replay a used trove signature | Reverts in Mezo: "Invalid signature" | `test_RevertWhen_SignatureReplayed` |
| Fake flash-loan callback | Reverts `NotMorpho()` | `test_RevertWhen_CallbackNotFromMorpho` |
| 30 days of interest before switching | Debt cleared by shares, no dust | `test_ClosesFullyAfterAccrual` |
| Router keeps funds | 0 BTC, 0 MUSD, 0 mUSDC after every switch | `test_RouterHoldsNothing`, on-chain read |
| Out of gas mid-switch on testnet | Whole switch reverted, position untouched | [tx](https://explorer.test.mezo.org/tx/0xe27a019f44ee2d1836a2b458579368d13bfcd557317191f3ebb5c2eeda09aebe) |

Tests live in [`test/MorphoToTrove.fork.t.sol`](test/MorphoToTrove.fork.t.sol) and run against a fork of Mezo testnet, using Mezo's deployed MUSD, BorrowerOperations, TroveManager and Mezo Pools contracts.

## Addresses

Mezo Testnet, chain 31611. All four of our contracts are source-verified on the explorer.

| Contract | Address |
|---|---|
| DebtSwitchRouter | [`0x7bb308048C4C511A4102640eDCD8027c22123af7`](https://explorer.test.mezo.org/address/0x7bb308048C4C511A4102640eDCD8027c22123af7) |
| Morpho Blue (our deployment) | [`0x9074F3348585bECdde74fa1c0DE0722043F9f76e`](https://explorer.test.mezo.org/address/0x9074F3348585bECdde74fa1c0DE0722043F9f76e) |
| AdaptiveCurveIrm | [`0x50E828C8Ca6e0EE5c355179A1a8b20Cce943373d`](https://explorer.test.mezo.org/address/0x50E828C8Ca6e0EE5c355179A1a8b20Cce943373d) |
| MezoPriceOracle | [`0x101764Ed730a37f39B80DCe97882bdff76be24c9`](https://explorer.test.mezo.org/address/0x101764Ed730a37f39B80DCe97882bdff76be24c9) |
| BTC/mUSDC market id | `0x19e8401c76f050f4aeb9d145c4f6d2cde9dbba187cd180353018637d261ee541` |

Morpho isn't deployed on Mezo testnet, so this is our own unmodified Morpho Blue v1.0.0 with an 86% LLTV, matching Mezo mainnet's mUSDC market. The oracle reads Mezo's own PriceFeed. Every Mezo address is in [`deployments/31611.json`](deployments/31611.json).

## Real usage

| Date | What happened | Tx |
|---|---|---|
| 2026-11-14 | A contract moved BTC between native and ERC-20 form on live testnet, which the switch depends on | [0x5cce5c66...](https://explorer.test.mezo.org/tx/0x5cce5c66b31ece55b21d793b4e69b0e2be4cab52e89304594f1dc9c7779f35b0) |
| 2026-11-15 | A demo borrower borrowed 300 mUSDC against 0.04 BTC on Morpho | [0x60c5842d...](https://explorer.test.mezo.org/tx/0x60c5842d1d22b4e009bad481a0bd8172c781ac1a8c217705ac99067a6a48356c) |
| 2026-11-15 | The same borrower switched to a 1.00% fixed MUSD trove through the app | [0x99953623...](https://explorer.test.mezo.org/tx/0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5) |
| 2026-11-15 | The borrower revoked the router's Morpho approval through the app | [0xdc4a1b45...](https://explorer.test.mezo.org/tx/0xdc4a1b45dfec0e4a24eea00064e255898d9603464c2eed17408b9af736adce2b) |

All of this is a demo wallet on testnet. No one else has used it yet.

## How this differs

| Alternative | What it does | Why this is different |
|---|---|---|
| Repay, then reborrow by hand | Two separate loans with cash in between | Needs the full debt in cash. Debt Switch needs none. |
| Mezo app | Opens and manages each product separately | No path between the two products |
| Flash-loan refinance tutorials | Move debt between two lending markets of the same kind | The destination here is a Liquity-style trove owned by the user, opened through Mezo's signed delegation, so the router never owns the trove |
| Automation platforms with per-user proxy wallets | Run multi-step recipes through a proxy you deploy | No proxy, no admin, no stored state. One immutable contract. |

## Honest limitations

- Unaudited. Fork tests and live testnet runs aren't an audit.
- Testnet only. Morpho on testnet is our deployment, not Mezo's.
- One direction is live: Morpho to MUSD. The reverse, MUSD to Morpho, isn't built yet.
- Whole positions only. Partial switches aren't supported.
- Mezo troves need 1,800 MUSD of net debt. A smaller Morpho loan becomes an 1,800 MUSD trove, and the extra comes back to you as mUSDC. The demo shows this: 300 mUSDC of debt became 2,000 MUSD of trove debt, with 1,139.24 mUSDC returned.
- The testnet MUSD/mUSDC pool is skewed, at about 0.80 mUSDC per MUSD, so testnet swaps look worse than mainnet's.
- The Morpho approval stays active until you revoke it. The app offers a one-click revoke.
- The slippage and replay refusals are proven in fork tests only. Their on-chain proofs need more testnet BTC than the faucet allowed.

## What's real

Every contract call in the shipped path hits real Mezo testnet contracts, and every number in the app comes from an on-chain read. Fork tests replace two chain-native Mezo contracts that a fork can't run: the BTC token at `0x7b7C...0000` and the BTC/USD oracle. Their test-only stand-ins live in [`test/standins`](test/standins) and are never deployed. The live testnet transactions above cover the real versions.

`forge test`: 10 passed, 0 failed, from a fresh clone.

## Run locally

```bash
git clone --recurse-submodules https://github.com/mystiquemide/debt-switch && cd debt-switch
forge test
cd app && npm install && npm run dev
```

Needs Foundry with `evm_version = shanghai`, already set in `foundry.toml` because Mezo's block headers have no blob gas fields. Deploy scripts take keys from files outside the repo, for example `DEPLOYER_KEY_FILE=path/to/testnet.key`.

## License

GPL-2.0-or-later. Morpho Blue v1.0.0 has passed its BUSL change date to GPL-2.0-or-later. AdaptiveCurveIrm is MIT.
