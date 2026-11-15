import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  createWalletClient,
  custom,
  getAddress,
  isAddress,
  numberToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from "viem";
import "./tokens.css";
import "./app.css";
import { renderAppNav } from "./nav";
import {
  ADDR,
  MARKET,
  OPEN_TROVE_DOMAIN,
  OPEN_TROVE_TYPES,
  addrUrl,
  buildPreview,
  fmt,
  mezoTestnet,
  morphoAbi,
  pct,
  publicClient,
  readSnapshot,
  routerAbi,
  troveHints,
  txUrl,
  type Preview,
  type Snapshot,
} from "./chain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

type Phase =
  | { kind: "disconnected" }
  | { kind: "no-wallet" }
  | { kind: "wrong-network"; chainId: number }
  | { kind: "reading" }
  | { kind: "read-error"; message: string }
  | { kind: "ready" }
  | { kind: "busy"; flow: "switch" | "revoke"; at: number; step: string; hash?: Hex }
  | { kind: "rejected" }
  | { kind: "reverted"; message: string; hash?: Hex }
  | { kind: "revoked"; hash: Hex }
  | { kind: "switched"; hash: Hex };

const app = document.querySelector<HTMLDivElement>("#app")!;
let phase: Phase = window.ethereum ? { kind: "disconnected" } : { kind: "no-wallet" };
let wallet: WalletClient | undefined;
let account: Address | undefined;
let snap: Snapshot | undefined;
let preview: Preview | undefined;
/** Read-only view of any address via ?address=0x..., no wallet needed. */
let readOnly = false;
/** The wallet the browser already has connected, kept even while viewing another address read-only. */
let walletAddr: Address | undefined;

// The demo borrower whose Morpho loan was switched live on testnet through this app.
const DEMO_BORROWER = "0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4" as Address;
const DEMO_SWITCH_TX = "0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5" as Hex;
const DEMO_HREF = `/app/?address=${DEMO_BORROWER}`;
const TESTNET_DAPP = "https://testnet.mezo.org";
const nav = renderAppNav(document.querySelector<HTMLDivElement>("#nav")!, {
  demoHref: `/app/?address=${DEMO_BORROWER}`,
  explorerHref: `https://explorer.test.mezo.org/address/0x7bb308048C4C511A4102640eDCD8027c22123af7`,
});
const ext = 'target="_blank" rel="noopener"';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

function isRejection(e: unknown) {
  return e instanceof BaseError && !!e.walk((x) => x instanceof UserRejectedRequestError);
}

function decodeError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert) {
      const name = revert.data?.errorName;
      const args = revert.data?.args ?? [];
      switch (name) {
        case "BelowMinNetDebt":
          return `Below the ${fmt(args[1] as bigint, 18, 0)} MUSD minimum: this switch would open a trove with ${fmt(args[0] as bigint, 18)} MUSD net debt.`;
        case "InsufficientOutputAmount":
          return "Slippage: the MUSD to mUSDC swap returned less than your minimum.";
        case "SwapBelowFlashLoan":
          return "The swap didn't return enough mUSDC to repay the flash loan.";
        case "NotBorrower":
          return "Only the borrower can switch their own position.";
        case "NoMorphoDebt":
          return "There's no Morpho debt to switch.";
        case "WrongMarket":
          return "That market isn't BTC/mUSDC.";
      }
      if (revert.reason) return revert.reason;
      if (name) return name;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

async function connect() {
  if (!window.ethereum) return;
  readOnly = false;
  if (location.search) history.replaceState(null, "", location.pathname);
  try {
    wallet = createWalletClient({ chain: mezoTestnet, transport: custom(window.ethereum) });
    [account] = await wallet.requestAddresses();
    walletAddr = account;
    await checkNetworkAndRead();
  } catch (e) {
    phase = { kind: "read-error", message: decodeError(e) };
    render();
  }
}

async function checkNetworkAndRead() {
  if (!wallet) return;
  const chainId = await wallet.getChainId();
  if (chainId !== mezoTestnet.id) {
    phase = { kind: "wrong-network", chainId };
    render();
    return;
  }
  await refresh();
}

async function switchNetwork() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(mezoTestnet.id) }] });
  } catch {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: numberToHex(mezoTestnet.id),
          chainName: mezoTestnet.name,
          nativeCurrency: mezoTestnet.nativeCurrency,
          rpcUrls: [...mezoTestnet.rpcUrls.default.http],
          blockExplorerUrls: [mezoTestnet.blockExplorers.default.url],
        },
      ],
    });
  }
  await checkNetworkAndRead();
}

async function refresh() {
  if (!account) return;
  phase = { kind: "reading" };
  render();
  try {
    snap = await readSnapshot(account);
    preview = snap.morpho.borrowShares > 0n ? await buildPreview(snap) : undefined;
    phase = { kind: "ready" };
  } catch (e) {
    phase = { kind: "read-error", message: decodeError(e) };
  }
  render();
}

async function runSwitch() {
  if (!wallet || !account || !snap || !preview) return;
  let hash: Hex | undefined;
  try {
    // Re-read so the signature binds fresh amounts and the current nonce.
    snap = await readSnapshot(account);
    preview = await buildPreview(snap);
    if (preview.blocks.length) {
      phase = { kind: "ready" };
      render();
      return;
    }

    if (!snap.authorized) {
      phase = { kind: "busy", flow: "switch", at: 0, step: "Approve Debt Switch on Morpho in your wallet" };
      render();
      const h = await wallet.writeContract({
        account,
        chain: mezoTestnet,
        address: ADDR.morpho,
        abi: morphoAbi,
        functionName: "setAuthorization",
        args: [ADDR.router, true],
      });
      phase = { kind: "busy", flow: "switch", at: 0, step: "Waiting for the Morpho approval to confirm", hash: h };
      render();
      const rc = await publicClient.waitForTransactionReceipt({ hash: h });
      if (rc.status !== "success") throw new Error("The Morpho approval reverted.");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    phase = { kind: "busy", flow: "switch", at: 1, step: "Sign the message for your new loan in your wallet" };
    render();
    const signature = await wallet.signTypedData({
      account,
      domain: OPEN_TROVE_DOMAIN,
      types: OPEN_TROVE_TYPES,
      primaryType: "OpenTrove",
      message: {
        assetAmount: snap.morpho.collateral,
        debtAmount: preview.troveDebt,
        borrower: account,
        recipient: ADDR.router,
        nonce: snap.nonce,
        deadline,
      },
    });

    const [upperHint, lowerHint] = await troveHints(snap.morpho.collateral, preview.compositeDebt);
    const params = {
      market: MARKET,
      borrower: account,
      troveDebt: preview.troveDebt,
      upperHint,
      lowerHint,
      minMusdcOut: preview.minMusdcOut,
      deadline,
      troveSignature: signature,
    };

    phase = { kind: "busy", flow: "switch", at: 2, step: "Checking the switch will go through" };
    render();
    const { request } = await publicClient.simulateContract({
      account,
      address: ADDR.router,
      abi: routerAbi,
      functionName: "morphoToTrove",
      args: [params],
    });

    // Nested calls (flash loan callback, trove insert) leave estimates tight, so add headroom.
    const gas = await publicClient.estimateContractGas({ ...request, account });
    phase = { kind: "busy", flow: "switch", at: 3, step: "Confirm the switch in your wallet" };
    render();
    hash = await wallet.writeContract({ ...request, account, chain: mezoTestnet, gas: (gas * 3n) / 2n });
    phase = { kind: "busy", flow: "switch", at: 4, step: "Sent. Waiting for Mezo Testnet to confirm", hash };
    render();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      phase = { kind: "reverted", message: "The switch didn't go through on Mezo Testnet.", hash };
      render();
      return;
    }
    snap = await readSnapshot(account);
    preview = undefined;
    phase = { kind: "switched", hash };
  } catch (e) {
    phase = isRejection(e) ? { kind: "rejected" } : { kind: "reverted", message: decodeError(e), hash };
    if (account) snap = await readSnapshot(account).catch(() => snap);
  }
  render();
}

async function revoke() {
  if (!wallet || !account) return;
  try {
    phase = { kind: "busy", flow: "revoke", at: 0, step: "Confirm in your wallet to turn off access" };
    render();
    const h = await wallet.writeContract({
      account,
      chain: mezoTestnet,
      address: ADDR.morpho,
      abi: morphoAbi,
      functionName: "setAuthorization",
      args: [ADDR.router, false],
    });
    phase = { kind: "busy", flow: "revoke", at: 1, step: "Turning off access", hash: h };
    render();
    await publicClient.waitForTransactionReceipt({ hash: h });
    snap = await readSnapshot(account);
    phase = { kind: "revoked", hash: h };
    render();
  } catch (e) {
    phase = isRejection(e) ? { kind: "rejected" } : { kind: "reverted", message: decodeError(e) };
    render();
  }
}

// ---------- rendering ----------

function row(label: string, value: string) {
  return `<div class="row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function loanCard(tag: string, tagClass: string, title: string, inner: string) {
  return `<article class="loan"><p class="tag ${tagClass}">${tag}</p><h2>${title}</h2>${inner}</article>`;
}

function positionCards(s: Snapshot) {
  const morpho =
    s.morpho.borrowShares > 0n || s.morpho.collateral > 0n
      ? `<dl>${row("You owe", `${fmt(s.morpho.debtAssets, 6)} mUSDC`)}${row("Your Bitcoin", `${fmt(s.morpho.collateral, 18, 4)} BTC`)}${row(
          "Loan to value",
          s.morpho.collateral === 0n ? "No collateral" : pct((s.morpho.debtAssets * 10n ** 30n) / ((s.morpho.collateral * s.btcPrice) / 10n ** 18n))
        )}${row("Rate", "Variable")}</dl>`
      : `<p class="loan-none">No Morpho loan in this wallet</p>`;
  const trove =
    s.trove.status === 1
      ? `<dl>${row("You owe", `${fmt(s.trove.debt, 18)} MUSD`)}${row("Your Bitcoin", `${fmt(s.trove.coll, 18, 4)} BTC`)}${row(
          "Collateral ratio",
          pct((s.trove.coll * s.btcPrice) / s.trove.debt)
        )}${row("Rate", `${(s.trove.rateBps / 100).toFixed(2)}% fixed`)}</dl>`
      : `<p class="loan-none">No MUSD loan in this wallet</p>`;
  return `
    <section class="loans-pair" aria-label="Your loans">
      ${loanCard("Variable rate", "tag-var", "Morpho mUSDC", morpho)}
      ${loanCard("Fixed rate", "tag-fixed", "MUSD trove", trove)}
    </section>
    <p class="fineprint">Bitcoin price ${fmt(s.btcPrice, 18)} USD from Mezo's PriceFeed. This wallet holds ${fmt(s.wallet.musdc, 6)} mUSDC and ${fmt(
      s.wallet.musd,
      18
    )} MUSD.</p>`;
}

function stateCard(opts: { tone?: "error"; title: string; body: string; actions: string }) {
  return `<section class="state${opts.tone === "error" ? " state-error" : ""}"${opts.tone === "error" ? ' role="alert"' : ""}>
    <h2>${opts.title}</h2><p>${opts.body}</p><div class="state-actions">${opts.actions}</div></section>`;
}

function previewCard(s: Snapshot, p: Preview) {
  const blocked = p.blocks.length > 0;
  const busy = phase.kind === "busy";
  const rate = `${(s.troveRateBps / 100).toFixed(2)}%`;
  const poolRate = p.troveDebt > 0n ? Number((p.swapOut * 10n ** 12n * 10000n) / p.troveDebt) / 10000 : 1;
  const sizedUp = s.morpho.debtAssets * 10n ** 12n < s.minNetDebt;
  const action = readOnly
    ? `<p class="preview-readonly">This is a read-only view. Connect this wallet to switch it.</p>`
    : blocked
      ? ""
      : `<button class="btn btn-primary preview-go" id="switch" type="button" ${busy ? "disabled" : ""}>${
          s.authorized ? "Sign and switch" : "Approve, sign and switch"
        }</button>
        <p class="preview-small">${s.authorized ? "One signature, then one transaction." : "One approval, one signature, then one transaction."} If any part fails, nothing changes.</p>`;
  return `
    <section class="preview" aria-labelledby="preview-title">
      <h2 id="preview-title">${blocked ? "You can't switch this loan yet" : `Switch to a fixed ${rate}`}</h2>
      <div class="preview-flip" aria-hidden="true">
        <div><p class="tag tag-var">Now</p><strong>${fmt(s.morpho.debtAssets, 6)} mUSDC</strong><span>Morpho, variable rate</span></div>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>
        <div><p class="tag tag-fixed">After</p><strong>${fmt(p.compositeDebt, 18)} MUSD</strong><span>MUSD loan, ${rate} fixed</span></div>
      </div>
      <dl>
        ${row("You pay off on Morpho", `${fmt(s.morpho.debtAssets, 6)} mUSDC`)}
        ${row("Your Bitcoin moves", `${fmt(s.morpho.collateral, 18, 4)} BTC`)}
        ${row("Your new loan", `${fmt(p.troveDebt, 18)} MUSD`)}
        ${row("One-time fee", `${fmt(p.fee, 18)} MUSD`)}
        ${row("Liquidation reserve", "200.00 MUSD, held until you close")}
        ${row("Swap on Mezo Pools", `${fmt(p.troveDebt, 18)} MUSD for ${fmt(p.swapOut, 6)} mUSDC`)}
        ${row("Lowest you'll accept", `${fmt(p.minMusdcOut, 6)} mUSDC`)}
        ${row("Back to your wallet", `about ${fmt(p.refund, 6)} mUSDC`)}
        ${row("Collateral ratio after", pct(p.icr))}
        ${p.icr >= 11n * 10n ** 17n ? row("Liquidated if Bitcoin falls to", `${fmt(p.liquidationPrice, 18)} USD`) : ""}
      </dl>
      ${
        sizedUp
          ? `<p class="note">Your Morpho loan is under Mezo's ${fmt(s.minNetDebt, 18, 0)} MUSD minimum, so your new loan opens at that minimum and the extra comes back to your wallet.</p>`
          : ""
      }
      ${
        poolRate < 0.97
          ? `<p class="note">Mezo Pools is paying ${poolRate.toFixed(4)} mUSDC per MUSD right now, so the swap costs more than a 1:1 rate would.</p>`
          : ""
      }
      ${
        blocked
          ? `<div class="why" role="alert"><h3>Why not</h3><ul>${p.blocks.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`
          : ""
      }
      ${action}
    </section>`;
}

const SWITCH_STEPS = ["Approve", "Sign", "Check", "Confirm", "Waiting"];
const tick = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;

function stepper(at: number) {
  return `<ol class="stepper">${SWITCH_STEPS.map((label, i) => {
    const state = i < at ? "done" : i === at ? "now" : "next";
    return `<li class="step-${state}"${state === "now" ? ' aria-current="step"' : ""}><span class="step-dot">${state === "done" ? tick : i + 1}</span>${label}</li>`;
  }).join("")}</ol>`;
}

function status() {
  switch (phase.kind) {
    case "busy":
      return `<section class="progress" role="status" aria-live="polite">
        ${phase.flow === "switch" ? stepper(phase.at) : ""}
        <p class="progress-now"><span class="spin"></span>${esc(phase.step)}</p>
        ${phase.hash ? `<a class="progress-tx" href="${txUrl(phase.hash)}" ${ext}>View on the explorer</a>` : ""}
      </section>`;
    case "rejected":
      return stateCard({
        title: "You cancelled in your wallet",
        body: "Nothing was sent and nothing changed. You can try again whenever you're ready.",
        actions: `<button class="btn btn-primary" id="retry" type="button">Try again</button>`,
      });
    case "reverted":
      return stateCard({
        tone: "error",
        title: "That didn't go through",
        body: `${esc(phase.message)} Your loan hasn't changed.${
          phase.hash ? ` <a href="${txUrl(phase.hash)}" ${ext}>See the transaction</a>.` : ""
        }`,
        actions: `<button class="btn btn-primary" id="retry" type="button">Check again</button>`,
      });
    case "switched":
      return `<section class="done" role="status">
        <span class="done-icon">${tick}</span>
        <div>
          <h2>Your loan is now fixed at ${snap ? (snap.trove.rateBps / 100).toFixed(2) : ""}%</h2>
          <p>Your Morpho loan is paid off and your Bitcoin is backing a new MUSD loan in your name</p>
        </div>
        <a class="btn btn-secondary" href="${txUrl(phase.hash)}" ${ext}>View transaction</a>
      </section>`;
    case "revoked":
      return `<section class="done" role="status">
        <span class="done-icon">${tick}</span>
        <div>
          <h2>Access turned off</h2>
          <p>Debt Switch can no longer act on your Morpho loan</p>
        </div>
        <a class="btn btn-secondary" href="${txUrl(phase.hash)}" ${ext}>View transaction</a>
      </section>`;
    default:
      return "";
  }
}

function body(): string {
  switch (phase.kind) {
    case "no-wallet":
      return stateCard({
        title: "You'll need a browser wallet",
        body: "Debt Switch works with browser wallets that support Mezo Testnet, like Rabby or MetaMask. You can still see a real switched loan without one.",
        actions: `<a class="btn btn-primary" href="${DEMO_HREF}">See a real switched loan</a>
          <a class="btn btn-secondary" href="https://rabby.io" ${ext}>Get Rabby</a>
          <a class="btn btn-secondary" href="https://metamask.io/download/" ${ext}>Get MetaMask</a>`,
      });
    case "disconnected":
      return stateCard({
        title: "Connect your wallet",
        body: "Use the wallet that holds your loan on Mezo Testnet. Connecting only lets the app read your loans. Nothing moves until you sign.",
        actions: `<button class="btn btn-primary" id="connect" type="button">Connect wallet</button>
          <a class="btn btn-secondary" href="${DEMO_HREF}">See a real switched loan</a>`,
      });
    case "wrong-network":
      return stateCard({
        title: "Switch to Mezo Testnet",
        body: `Your wallet is on chain ${phase.chainId}. Debt Switch runs on Mezo Testnet, chain 31611. Your wallet will ask you to switch, or to add the network if it doesn't know it yet.`,
        actions: `<button class="btn btn-primary" id="network" type="button">Switch to Mezo Testnet</button>`,
      });
    case "reading":
      return `<section class="loans-pair loans-reading" aria-busy="true" aria-label="Your loans">
          <article class="loan loan-outline"><p class="tag tag-var">Variable rate</p><h2>Morpho mUSDC</h2></article>
          <article class="loan loan-outline"><p class="tag tag-fixed">Fixed rate</p><h2>MUSD trove</h2></article>
        </section>
        <p class="reading" role="status"><span class="spin"></span>Reading your loans from Mezo Testnet</p>`;
    case "read-error":
      return stateCard({
        tone: "error",
        title: "Couldn't reach Mezo Testnet",
        body: "We couldn't read your loans just now. Check your connection, then try again. Your loans aren't affected.",
        actions: `<button class="btn btn-primary" id="retry" type="button">Try again</button>`,
      });
  }
  if (!snap) return "";
  const hasMorpho = snap.morpho.borrowShares > 0n;
  const empty =
    !hasMorpho && snap.trove.status !== 1
      ? stateCard({
          title: readOnly ? "This wallet has no loan on Mezo yet" : "You don't have a loan on Mezo yet",
          body: "Debt Switch moves an existing Morpho loan into a fixed-rate MUSD loan. Open a loan on Mezo Testnet first, then come back to switch it.",
          actions: `<a class="btn btn-primary" href="${TESTNET_DAPP}" ${ext}>Open a loan on Mezo</a>`,
        })
      : "";
  const isDemo = readOnly && account?.toLowerCase() === DEMO_BORROWER.toLowerCase();
  const demoNote = isDemo
    ? `<section class="demo-note">
        <p class="tag tag-marigold">Real testnet switch</p>
        <h2>What happened to this loan</h2>
        <p>This wallet had a 300 mUSDC variable-rate loan on Morpho against 0.04 BTC, and no stablecoins. It switched to an MUSD loan at 1.00% fixed through this app, in <a href="${txUrl(DEMO_SWITCH_TX)}" ${ext}>one transaction</a>.</p>
        <p>Mezo's fixed-rate loans start at 1,800 MUSD, so the 300 mUSDC loan became a 2,000 MUSD loan (1,800 plus Mezo's 200 MUSD liquidation reserve), and the extra came back to the wallet as 1,139.25 mUSDC. The testnet MUSD/mUSDC pool pays about 0.80 mUSDC per MUSD, so the swap cost about 359 mUSDC more than a 1:1 pool would. A loan above 1,800 MUSD switches at its own size.</p>
      </section>`
    : "";
  const troveOnly =
    !hasMorpho && snap.trove.status === 1 && !isDemo && phase.kind !== "switched"
      ? stateCard({
          title: readOnly ? "This loan is already on a fixed rate" : "Your loan is already on a fixed rate",
          body: `${readOnly ? "This wallet has" : "You have"} an MUSD loan at ${(snap.trove.rateBps / 100).toFixed(2)}% fixed, so there's nothing to switch. Moving a fixed-rate loan back to Morpho is the next thing being built.`,
          actions: `<a class="btn btn-primary" href="${addrUrl(account!)}" ${ext}>View on the explorer</a>`,
        })
      : "";
  const revokeRow =
    !readOnly && snap.authorized && phase.kind !== "busy"
      ? `<section class="revoke">
          <div>
            <h2>Debt Switch can still manage your Morpho loan</h2>
            <p>It only acts when you send a switch yourself, but you can turn this access off.</p>
          </div>
          <button class="btn btn-secondary" id="revoke" type="button">Turn off access</button>
        </section>`
      : "";
  return `${status()}${demoNote}${troveOnly}${empty}${positionCards(snap)}${hasMorpho && preview && phase.kind !== "busy" ? previewCard(snap, preview) : ""}${revokeRow}`;
}

function headerNote() {
  if (!account || !readOnly) return "";
  return `<p class="acct"><span class="acct-label">Read-only</span>Viewing <a href="${addrUrl(account)}" ${ext}>${short(account)}</a></p>`;
}

function renderNavState() {
  const isDemo = readOnly && account?.toLowerCase() === DEMO_BORROWER.toLowerCase();
  nav.setCurrent(isDemo ? "demo" : readOnly ? null : "switch");
  let html = "";
  const mine = readOnly ? walletAddr : account;
  if (mine) {
    html = readOnly
      ? `<a class="btn btn-secondary nav-addr" href="/app/" title="Back to your own loan">${short(mine)}</a>`
      : `<a class="btn btn-secondary nav-addr" href="${addrUrl(mine)}" ${ext} title="Connected on Mezo Testnet">${short(mine)}</a>`;
  } else if (window.ethereum) {
    html = `<button class="btn btn-primary" type="button" data-connect>Connect wallet</button>`;
  }
  nav.setWallet(html).querySelector("[data-connect]")?.addEventListener("click", connect);
}

function render() {
  app.innerHTML = `
    <header class="app-head">
      <h1>Switch your loan</h1>
      <p>Move a Morpho loan to a fixed-rate MUSD loan in one transaction.</p>
      ${headerNote()}
    </header>
    <main class="app-main">${body()}</main>`;
  renderNavState();
  document.querySelector("#connect")?.addEventListener("click", connect);
  document.querySelector("#network")?.addEventListener("click", switchNetwork);
  document.querySelector("#retry")?.addEventListener("click", () => (readOnly ? refresh() : wallet ? checkNetworkAndRead() : connect()));
  document.querySelector("#switch")?.addEventListener("click", runSwitch);
  document.querySelector("#revoke")?.addEventListener("click", revoke);
}


window.ethereum?.on?.("accountsChanged", (accs: Address[]) => {
  walletAddr = accs[0];
  if (readOnly) return render();
  account = accs[0];
  if (account) checkNetworkAndRead();
  else {
    phase = { kind: "disconnected" };
    snap = undefined;
    render();
  }
});
window.ethereum?.on?.("chainChanged", () => {
  if (!readOnly) checkNetworkAndRead();
});

async function start() {
  const viewAddress = new URLSearchParams(location.search).get("address");
  // eth_accounts never opens a wallet popup: it only reports a connection the user already approved.
  const existing = window.ethereum
    ? ((await window.ethereum.request({ method: "eth_accounts" }).catch(() => [])) as Address[])
    : [];
  walletAddr = existing[0];
  if (viewAddress && isAddress(viewAddress)) {
    readOnly = true;
    account = getAddress(viewAddress);
    refresh();
  } else if (walletAddr) {
    connect();
  } else {
    render();
  }
}

if (import.meta.env.DEV) {
  // Development only: lets the review harness show a state without sending transactions. Not in production builds.
  (window as unknown as { __showPhase: (p: Phase) => void }).__showPhase = (p) => {
    phase = p;
    render();
  };
}

start();
