// TEST HARNESS, not part of the app bundle. Drives the built app in Chromium on Mezo testnet with an
// injected EIP-1193 wallet that signs in Node with a testnet-only key read from KEY_FILE.
// Usage: KEY_FILE=~/.debt-switch/borrower.key APP_URL=http://localhost:4173 OUT=dir node e2e/live-switch.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? "playwright");
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
});
const account = privateKeyToAccount(readFileSync(process.env.KEY_FILE, "utf8").trim());
const pub = createPublicClient({ chain, transport: http() });
const wal = createWalletClient({ chain, account, transport: http() });
const out = process.env.OUT ?? "e2e-out";
const action = process.env.ACTION ?? "switch"; // switch | view | revoke
mkdirSync(out, { recursive: true });

async function handle(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return "0x7b7b";
    case "eth_signTypedData_v4": {
      const { domain, types, primaryType, message } = JSON.parse(params[1]);
      delete types.EIP712Domain;
      return account.signTypedData({ domain, types, primaryType, message });
    }
    case "eth_sendTransaction": {
      const t = params[0];
      const hash = await wal.sendTransaction({
        to: t.to,
        data: t.data,
        value: t.value ? BigInt(t.value) : 0n,
        gas: t.gas ? BigInt(t.gas) : undefined,
      });
      console.log("sent", hash);
      return hash;
    }
    default:
      return pub.request({ method, params });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2 });
page.on("console", (m) => m.type() === "error" && console.log("page error:", m.text()));
await page.exposeFunction("__wallet", async (method, params) => {
  try {
    return { ok: await handle(method, params) };
  } catch (e) {
    return { err: String(e?.shortMessage ?? e?.message ?? e) };
  }
});
await page.addInitScript(() => {
  window.ethereum = {
    isTestHarness: true,
    on() {},
    removeListener() {},
    async request({ method, params }) {
      const r = await window.__wallet(method, params ?? []);
      if (r.err) throw Object.assign(new Error(r.err), { code: -32603 });
      return r.ok;
    },
  };
});

await page.goto(process.env.APP_URL ?? "http://localhost:4173");
if (await page.$("#connect")) await page.click("#connect");
await page.waitForSelector(".loans-pair:not(.loans-reading)", { timeout: 60000 });
await page.screenshot({ path: `${out}/1-position.png`, fullPage: true });
console.log((await page.textContent("main")).replace(/\s+/g, " ").slice(0, 1500));

if (action === "switch") {
  await page.click("#switch");
  await page.waitForSelector(".done, .state-error", { timeout: 240000 });
  await page.screenshot({ path: `${out}/2-result.png`, fullPage: true });
  console.log("RESULT:", (await page.textContent("main")).replace(/\s+/g, " ").slice(0, 1500));
  const href = await page.getAttribute(".done a", "href").catch(() => null);
  console.log("TX:", href);
}
if (action === "revoke") {
  await page.screenshot({ path: `${out}/2-revoke-card.png`, fullPage: true });
  await page.click("#revoke");
  await page.waitForSelector(".progress", { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: `${out}/2b-revoking.png`, fullPage: true });
  await page.waitForSelector(".done, .state-error", { timeout: 120000 });
  await page.screenshot({ path: `${out}/3-revoked.png`, fullPage: true });
  console.log("REVOKED");
}
await browser.close();
