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
import "./style.css";
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
  | { kind: "busy"; step: string; hash?: Hex }
  | { kind: "reverted"; message: string; hash?: Hex }
  | { kind: "switched"; hash: Hex };

const app = document.querySelector<HTMLDivElement>("#app")!;
let phase: Phase = window.ethereum ? { kind: "disconnected" } : { kind: "no-wallet" };
let wallet: WalletClient | undefined;
let account: Address | undefined;
let snap: Snapshot | undefined;
let preview: Preview | undefined;
/** Read-only view of any address via ?address=0x..., no wallet needed. */
let readOnly = false;

// The demo borrower whose Morpho loan was switched live on testnet through this app.
const DEMO_BORROWER = "0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4" as Address;
const DEMO_SWITCH_TX = "0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5" as Hex;
const demoLink = `<p class="small"><a href="?address=${DEMO_BORROWER}">See a real switched loan on testnet, no wallet needed</a></p>`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

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
      phase = { kind: "busy", step: "Approve Debt Switch on Morpho in your wallet" };
      render();
      const h = await wallet.writeContract({
        account,
        chain: mezoTestnet,
        address: ADDR.morpho,
        abi: morphoAbi,
        functionName: "setAuthorization",
        args: [ADDR.router, true],
      });
      phase = { kind: "busy", step: "Waiting for the Morpho approval to confirm", hash: h };
      render();
      const rc = await publicClient.waitForTransactionReceipt({ hash: h });
      if (rc.status !== "success") throw new Error("The Morpho approval reverted.");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    phase = { kind: "busy", step: "Sign the MUSD trove message in your wallet" };
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

    phase = { kind: "busy", step: "Simulating the switch" };
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
    phase = { kind: "busy", step: "Confirm the switch in your wallet" };
    render();
    hash = await wallet.writeContract({ ...request, account, chain: mezoTestnet, gas: (gas * 3n) / 2n });
    phase = { kind: "busy", step: "Switch submitted, waiting for confirmation", hash };
    render();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      phase = { kind: "reverted", message: "The switch reverted on-chain. Your position is unchanged.", hash };
      render();
      return;
    }
    snap = await readSnapshot(account);
    preview = undefined;
    phase = { kind: "switched", hash };
  } catch (e) {
    phase = { kind: "reverted", message: decodeError(e), hash };
    if (account) snap = await readSnapshot(account).catch(() => snap);
  }
  render();
}

async function revoke() {
  if (!wallet || !account) return;
  try {
    phase = { kind: "busy", step: "Revoke Debt Switch on Morpho in your wallet" };
    render();
    const h = await wallet.writeContract({
      account,
      chain: mezoTestnet,
      address: ADDR.morpho,
      abi: morphoAbi,
      functionName: "setAuthorization",
      args: [ADDR.router, false],
    });
    phase = { kind: "busy", step: "Waiting for the revoke to confirm", hash: h };
    render();
    await publicClient.waitForTransactionReceipt({ hash: h });
    await refresh();
  } catch (e) {
    phase = { kind: "reverted", message: decodeError(e) };
    render();
  }
}

// ---------- rendering ----------

function row(label: string, value: string) {
  return `<div class="row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
}

function positionCards(s: Snapshot) {
  const morpho =
    s.morpho.borrowShares > 0n || s.morpho.collateral > 0n
      ? `${row("Debt", `${fmt(s.morpho.debtAssets, 6)} mUSDC`)}${row("Collateral", `${fmt(s.morpho.collateral, 18, 4)} BTC`)}${row(
          "LTV",
          s.morpho.collateral === 0n ? "-" : pct((s.morpho.debtAssets * 10n ** 30n) / ((s.morpho.collateral * s.btcPrice) / 10n ** 18n))
        )}${row("Rate", "Variable (AdaptiveCurveIrm)")}`
      : `<p class="muted">No Morpho position.</p>`;
  const trove =
    s.trove.status === 1
      ? `${row("Debt", `${fmt(s.trove.debt, 18)} MUSD`)}${row("Collateral", `${fmt(s.trove.coll, 18, 4)} BTC`)}${row(
          "Collateral ratio",
          pct((s.trove.coll * s.btcPrice) / s.trove.debt)
        )}${row("Rate", `${(s.trove.rateBps / 100).toFixed(2)}% fixed`)}`
      : `<p class="muted">No MUSD trove.</p>`;
  return `
    <section class="cards">
      <article class="card"><h3>Morpho mUSDC <small>variable</small></h3>${morpho}</article>
      <article class="card"><h3>MUSD trove <small>fixed</small></h3>${trove}</article>
    </section>
    <p class="muted small">BTC price ${fmt(s.btcPrice, 18)} USD from Mezo PriceFeed. Wallet holds ${fmt(s.wallet.musdc, 6)} mUSDC and ${fmt(
      s.wallet.musd,
      18
    )} MUSD.</p>`;
}

function previewCard(s: Snapshot, p: Preview) {
  const blocked = p.blocks.length > 0;
  const busy = phase.kind === "busy";
  return `
    <section class="card preview">
      <h3>Switch to fixed MUSD</h3>
      ${row("Morpho debt repaid", `${fmt(s.morpho.debtAssets, 6)} mUSDC`)}
      ${row("BTC moved", `${fmt(s.morpho.collateral, 18, 4)} BTC`)}
      ${row("New trove debt", `${fmt(p.troveDebt, 18)} MUSD`)}
      ${row("Issuance fee", `${fmt(p.fee, 18)} MUSD`)}
      ${row("Liquidation reserve", "200.00 MUSD")}
      ${row("Fixed rate", `${(s.troveRateBps / 100).toFixed(2)}%`)}
      ${row("Swap", `${fmt(p.troveDebt, 18)} MUSD to ${fmt(p.swapOut, 6)} mUSDC (min ${fmt(p.minMusdcOut, 6)})`)}
      ${row("Refunded to you", `about ${fmt(p.refund, 6)} mUSDC`)}
      ${row("New collateral ratio", pct(p.icr))}
      ${row("Liquidation price", `${fmt(p.liquidationPrice, 18)} USD`)}
      ${
        p.netDebt > 0n && s.morpho.debtAssets * 10n ** 12n < s.minNetDebt
          ? `<p class="note">Mezo troves need at least ${fmt(s.minNetDebt, 18, 0)} MUSD of net debt, so the trove is sized to the minimum and the extra comes back to you as mUSDC.</p>`
          : ""
      }
      ${
        p.troveDebt > 0n && (p.swapOut * 10n ** 12n * 100n) / p.troveDebt < 97n
          ? `<p class="note">The MUSD/mUSDC pool is paying ${(Number((p.swapOut * 10n ** 12n * 10000n) / p.troveDebt) / 10000).toFixed(4)} mUSDC per MUSD right now, so the swap costs more than it would at 1:1. The testnet pool is unbalanced.</p>`
          : ""
      }
      ${blocked ? `<ul class="blocks">${p.blocks.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${
        readOnly
          ? `<p class="note">Read-only view. Connect this wallet to switch it.</p>`
          : `<button id="switch" ${blocked || busy ? "disabled" : ""}>${s.authorized ? "Sign and switch" : "Approve, sign and switch"}</button>`
      }
      <p class="muted small">One Morpho approval, one signature, one transaction. If any step fails, the whole switch reverts.</p>
    </section>`;
}

function status() {
  switch (phase.kind) {
    case "busy":
      return `<div class="status busy"><span class="spinner"></span>${esc(phase.step)}${
        phase.hash ? ` <a href="${txUrl(phase.hash)}" target="_blank" rel="noopener">view tx</a>` : ""
      }</div>`;
    case "reverted":
      return `<div class="status error" role="alert">${esc(phase.message)}${
        phase.hash ? ` <a href="${txUrl(phase.hash)}" target="_blank" rel="noopener">view tx</a>` : ""
      } <button id="retry" class="link">Re-check</button></div>`;
    case "switched":
      return `<div class="status ok" role="status">Switched. Your loan is now a fixed-rate MUSD trove.
        <a href="${txUrl(phase.hash)}" target="_blank" rel="noopener">View transaction</a></div>`;
    default:
      return "";
  }
}

function body(): string {
  switch (phase.kind) {
    case "no-wallet":
      return `<section class="card center"><p>No browser wallet found. Install MetaMask or Rabby to use Debt Switch.</p>${demoLink}</section>`;
    case "disconnected":
      return `<section class="card center"><p>Connect the wallet that holds your Mezo testnet loan.</p><button id="connect">Connect wallet</button>${demoLink}</section>`;
    case "wrong-network":
      return `<section class="card center"><p>Your wallet is on chain ${phase.chainId}. Debt Switch runs on Mezo Testnet (31611).</p><button id="network">Switch to Mezo Testnet</button></section>`;
    case "reading":
      return `<section class="card center"><span class="spinner"></span> Reading your positions from Mezo testnet</section>`;
    case "read-error":
      return `<section class="card center error" role="alert"><p>Couldn't read your positions: ${esc(phase.message)}</p><button id="retry">Retry</button></section>`;
  }
  if (!snap) return "";
  const hasMorpho = snap.morpho.borrowShares > 0n;
  const empty =
    !hasMorpho && snap.trove.status !== 1
      ? `<section class="card center"><p>This wallet has no Morpho mUSDC loan or MUSD trove on Mezo testnet.</p><p><a href="https://mezo.org" target="_blank" rel="noopener">Open a loan on Mezo</a></p></section>`
      : "";
  const demoNote =
    readOnly && account?.toLowerCase() === DEMO_BORROWER.toLowerCase()
      ? `<section class="card demo">
          <h3>What happened to this loan</h3>
          <p>This wallet had a 300 mUSDC variable-rate loan on Morpho against 0.04 BTC, and no stablecoins. It switched to a fixed 1.00% MUSD trove through this app in <a href="${txUrl(DEMO_SWITCH_TX)}" target="_blank" rel="noopener">one transaction</a>.</p>
          <p>Mezo troves need at least 1,800 MUSD of net debt, so the 300 mUSDC loan became a 2,000 MUSD trove (1,800 plus Mezo's 200 MUSD liquidation reserve). The extra came back to the wallet as 1,139.25 mUSDC. The testnet MUSD/mUSDC pool pays about 0.80 mUSDC per MUSD, so the swap cost about 359 mUSDC more than a 1:1 pool would. A loan above 1,800 MUSD is switched at its own size.</p>
        </section>`
      : "";
  const revokeRow = !readOnly && snap.authorized
    ? `<section class="card revoke"><p>Debt Switch is still approved to manage your Morpho position. Nothing uses it between switches, but you can revoke it.</p><button id="revoke" class="secondary" ${
        phase.kind === "busy" ? "disabled" : ""
      }>Revoke approval</button></section>`
    : "";
  return `${status()}${demoNote}${positionCards(snap)}${empty}${hasMorpho && preview ? previewCard(snap, preview) : ""}${revokeRow}`;
}

function render() {
  app.innerHTML = `
    <header>
      <h1>Debt Switch</h1>
      <p class="tag">Move a Bitcoin loan between Mezo's variable mUSDC and fixed MUSD in one transaction, without repaying first.</p>
      ${
        account
          ? readOnly
            ? `<p class="acct">Viewing <a href="${addrUrl(account)}" target="_blank" rel="noopener">${short(account)}</a> on Mezo Testnet, read-only. ${
                window.ethereum ? `<button id="connect" class="link">Connect your own wallet</button>` : ""
              }</p>`
            : `<p class="acct">Connected <a href="${addrUrl(account)}" target="_blank" rel="noopener">${short(account)}</a> on Mezo Testnet</p>`
          : ""
      }
    </header>
    <main>${body()}</main>
    <footer class="muted small">
      Router <a href="${addrUrl(ADDR.router)}" target="_blank" rel="noopener">${short(ADDR.router)}</a>.
      Morpho Blue here is our own testnet deployment, since Morpho isn't deployed on Mezo testnet.
      MUSD, BorrowerOperationsSignatures and Mezo Pools are Mezo's own contracts.
    </footer>`;
  document.querySelector("#connect")?.addEventListener("click", connect);
  document.querySelector("#network")?.addEventListener("click", switchNetwork);
  document.querySelector("#retry")?.addEventListener("click", () => (readOnly ? refresh() : wallet ? checkNetworkAndRead() : connect()));
  document.querySelector("#switch")?.addEventListener("click", runSwitch);
  document.querySelector("#revoke")?.addEventListener("click", revoke);
}

window.ethereum?.on?.("accountsChanged", (accs: Address[]) => {
  if (readOnly) return;
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

const viewAddress = new URLSearchParams(location.search).get("address");
if (viewAddress && isAddress(viewAddress)) {
  readOnly = true;
  account = getAddress(viewAddress);
  refresh();
} else {
  render();
}
