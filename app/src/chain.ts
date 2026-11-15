import {
  createPublicClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import deployments from "../../deployments/31611.json";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const publicClient = createPublicClient({ chain: mezoTestnet, transport: http() });

const d = deployments;
export const ADDR = {
  router: d.debtSwitchRouter as Address,
  morpho: d.morpho as Address,
  irm: d.irm as Address,
  oracle: d.oracle as Address,
  marketId: d.marketId as Hex,
  btc: d.mezo.btc as Address,
  musd: d.mezo.musd as Address,
  musdc: d.mezo.musdc as Address,
  borrowerOps: d.mezo.borrowerOperations as Address,
  troveSigs: d.mezo.borrowerOperationsSignatures as Address,
  troveManager: d.mezo.troveManager as Address,
  priceFeed: d.mezo.priceFeed as Address,
  poolRouter: d.mezo.poolRouter as Address,
  poolFactory: d.mezo.poolFactory as Address,
  sortedTroves: d.mezo.sortedTroves as Address,
  hintHelpers: d.mezo.hintHelpers as Address,
};

export const MARKET = {
  loanToken: ADDR.musdc,
  collateralToken: ADDR.btc,
  oracle: ADDR.oracle,
  irm: ADDR.irm,
  lltv: BigInt(d.lltv),
} as const;

export const GAS_COMPENSATION = 200n * 10n ** 18n;
export const MCR = 110n * 10n ** 16n; // 110%
const WAD = 10n ** 18n;

export const morphoAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function isAuthorized(address authorizer, address authorized) view returns (bool)",
  "function setAuthorization(address authorized, bool newIsAuthorized)",
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)",
  "function borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
]);

/** The test loan judges can open in one click: the same shape as the demo loan, sized to leave room for others. */
export const TEST_LOAN = { collateral: 4n * 10n ** 16n, borrow: 100n * 10n ** 6n } as const;

export const routerAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct MorphoToTroveParams { MarketParams market; address borrower; uint256 troveDebt; address upperHint; address lowerHint; uint256 minMusdcOut; uint256 deadline; bytes troveSignature; }",
  "function morphoToTrove(MorphoToTroveParams p)",
  "error NotBorrower()",
  "error NotMorpho()",
  "error NoSwitchInProgress()",
  "error SwitchInProgress()",
  "error WrongMarket()",
  "error NoMorphoDebt()",
  "error BelowMinNetDebt(uint256 netDebt, uint256 minNetDebt)",
  "error SwapBelowFlashLoan(uint256 out, uint256 owed)",
  "error TransferFailed()",
  "error InsufficientOutputAmount()",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const borrowerOpsAbi = parseAbi([
  "function minNetDebt() view returns (uint256)",
  "function getBorrowingFee(uint256 debt) view returns (uint256)",
  "function borrowingRate() view returns (uint256)",
]);
const troveSigsAbi = parseAbi(["function getNonce(address user) view returns (uint256)"]);
const troveManagerAbi = parseAbi([
  "function getTroveStatus(address) view returns (uint8)",
  "function getTroveColl(address) view returns (uint256)",
  "function getTroveDebt(address) view returns (uint256)",
  "function getTroveInterestRate(address) view returns (uint16)",
]);
const interestRateManagerAbi = parseAbi(["function interestRate() view returns (uint16)"]);
const borrowerOpsExtraAbi = parseAbi(["function interestRateManager() view returns (address)"]);
const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);
const poolRouterAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
]);

const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 CR, uint256 numTrials, uint256 inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
]);
const sortedTrovesAbi = parseAbi([
  "function getSize() view returns (uint256)",
  "function findInsertPosition(uint256 NICR, address prevId, address nextId) view returns (address, address)",
]);

/**
 * Insert hints for the new trove. Without them SortedTroves walks the whole list on insert, which
 * costs millions of gas on testnet's 260+ troves.
 */
export async function troveHints(coll: bigint, compositeDebt: bigint): Promise<[Address, Address]> {
  const nicr = (coll * 10n ** 20n) / compositeDebt;
  const size = await publicClient.readContract({ address: ADDR.sortedTroves, abi: sortedTrovesAbi, functionName: "getSize" });
  const trials = BigInt(Math.ceil(15 * Math.sqrt(Number(size) || 1)));
  const [approx] = await publicClient.readContract({
    address: ADDR.hintHelpers,
    abi: hintHelpersAbi,
    functionName: "getApproxHint",
    args: [nicr, trials, BigInt(Date.now())],
  });
  const [upper, lower] = await publicClient.readContract({
    address: ADDR.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: "findInsertPosition",
    args: [nicr, approx, approx],
  });
  return [upper, lower];
}

export type MorphoPosition = { borrowShares: bigint; collateral: bigint; debtAssets: bigint };
export type TrovePosition = { status: number; coll: bigint; debt: bigint; rateBps: number };

export type Snapshot = {
  account: Address;
  btcPrice: bigint; // USD per BTC, 1e18
  morpho: MorphoPosition;
  trove: TrovePosition;
  wallet: { btc: bigint; musd: bigint; musdc: bigint };
  authorized: boolean;
  minNetDebt: bigint;
  borrowingRate: bigint; // 1e18 = 100%
  troveRateBps: number; // current fixed rate for new troves, in bps
  nonce: bigint;
};

/** Mirrors Morpho's SharesMathLib.toAssetsUp. */
function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint) {
  const num = shares * (totalAssets + 1n);
  const den = totalShares + 10n ** 6n;
  return (num + den - 1n) / den;
}

export async function readSnapshot(account: Address): Promise<Snapshot> {
  const irmAddr = await publicClient.readContract({
    address: ADDR.borrowerOps,
    abi: borrowerOpsExtraAbi,
    functionName: "interestRateManager",
  });
  const r = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: ADDR.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" },
      { address: ADDR.morpho, abi: morphoAbi, functionName: "position", args: [ADDR.marketId, account] },
      { address: ADDR.morpho, abi: morphoAbi, functionName: "market", args: [ADDR.marketId] },
      { address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getTroveStatus", args: [account] },
      { address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getTroveColl", args: [account] },
      { address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getTroveDebt", args: [account] },
      { address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getTroveInterestRate", args: [account] },
      { address: ADDR.musd, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      { address: ADDR.musdc, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      { address: ADDR.morpho, abi: morphoAbi, functionName: "isAuthorized", args: [account, ADDR.router] },
      { address: ADDR.borrowerOps, abi: borrowerOpsAbi, functionName: "minNetDebt" },
      { address: ADDR.borrowerOps, abi: borrowerOpsAbi, functionName: "borrowingRate" },
      { address: irmAddr, abi: interestRateManagerAbi, functionName: "interestRate" },
      { address: ADDR.troveSigs, abi: troveSigsAbi, functionName: "getNonce", args: [account] },
    ],
  });
  const [price, pos, mkt, tStatus, tColl, tDebt, tRate, musd, musdc, authorized, minNetDebt, borrowingRate, rate, nonce] = r;
  const btc = await publicClient.getBalance({ address: account });
  const [, borrowShares, collateral] = pos;
  const [, , totalBorrowAssets, totalBorrowShares] = mkt;
  return {
    account,
    btcPrice: price,
    morpho: {
      borrowShares,
      collateral,
      debtAssets: borrowShares === 0n ? 0n : toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares),
    },
    trove: { status: Number(tStatus), coll: tColl, debt: tDebt, rateBps: Number(tRate) },
    wallet: { btc, musd, musdc },
    authorized,
    minNetDebt,
    borrowingRate,
    troveRateBps: Number(rate),
    nonce,
  };
}

export type Preview = {
  troveDebt: bigint; // MUSD minted to the router
  fee: bigint;
  netDebt: bigint;
  compositeDebt: bigint;
  swapOut: bigint; // mUSDC out for troveDebt MUSD
  minMusdcOut: bigint;
  refund: bigint; // swapOut - Morpho debt, sent to the borrower
  icr: bigint; // 1e18 = 100%
  liquidationPrice: bigint; // USD per BTC, 1e18
  blocks: string[];
};

const SLIPPAGE_BPS = 50n; // 0.5%
const ACCRUAL_BUFFER_BPS = 10n; // covers interest accrued between preview and execution

async function quote(musdIn: bigint) {
  const amounts = await publicClient.readContract({
    address: ADDR.poolRouter,
    abi: poolRouterAbi,
    functionName: "getAmountsOut",
    args: [musdIn, [{ from: ADDR.musd, to: ADDR.musdc, stable: true, factory: ADDR.poolFactory }]],
  });
  return amounts[amounts.length - 1];
}

/**
 * Sizes the trove from live reads: at least the floor (net debt incl. fee >= minNetDebt), and enough
 * MUSD that its swap covers the Morpho debt that the flash loan repays.
 */
export async function buildPreview(s: Snapshot): Promise<Preview> {
  const blocks: string[] = [];
  if (s.morpho.borrowShares === 0n) blocks.push("There's no Morpho loan in this wallet to switch.");
  if (s.trove.status === 1) blocks.push("This wallet already has an MUSD loan, and Mezo allows one per wallet. Close it first, or switch from a different wallet.");

  const owed = (s.morpho.debtAssets * (10000n + ACCRUAL_BUFFER_BPS)) / 10000n;
  // Smallest debt whose net (debt + fee) clears the floor.
  const floorDebt = (s.minNetDebt * WAD + (WAD + s.borrowingRate) - 1n) / (WAD + s.borrowingRate);
  let troveDebt = floorDebt;
  // The protocol rounds the fee down, so step up until debt + fee clears the floor exactly.
  while (troveDebt + (troveDebt * s.borrowingRate) / WAD < s.minNetDebt) troveDebt += 1n;
  let out = await quote(troveDebt);
  // Grow the trove until the swap covers the Morpho debt with slippage headroom.
  for (let i = 0; i < 8 && (out * (10000n - SLIPPAGE_BPS)) / 10000n < owed; i++) {
    const need = (owed * 10000n) / (10000n - SLIPPAGE_BPS);
    troveDebt = (troveDebt * need) / (out === 0n ? 1n : out) + 10n ** 18n;
    out = await quote(troveDebt);
  }
  const minMusdcOut = (out * (10000n - SLIPPAGE_BPS)) / 10000n;
  if (minMusdcOut < owed) blocks.push("Mezo Pools doesn't have enough mUSDC right now to repay a loan this size. Try a smaller loan, or try again later.");

  const fee = (troveDebt * s.borrowingRate) / WAD;
  const netDebt = troveDebt + fee;
  const compositeDebt = netDebt + GAS_COMPENSATION;
  const coll = s.morpho.collateral;
  const icr = compositeDebt === 0n ? 0n : (coll * s.btcPrice) / compositeDebt;
  const liquidationPrice = coll === 0n ? 0n : (MCR * compositeDebt) / coll;
  if (coll > 0n && icr < MCR) {
    blocks.push(`Not enough Bitcoin behind the new loan. It would be backed at ${pct(icr)}, and Mezo needs at least 110%. Add more Bitcoin to your Morpho loan, then come back.`);
  }
  return {
    troveDebt,
    fee,
    netDebt,
    compositeDebt,
    swapOut: out,
    minMusdcOut,
    refund: out > s.morpho.debtAssets ? out - s.morpho.debtAssets : 0n,
    icr,
    liquidationPrice,
    blocks,
  };
}

export const OPEN_TROVE_TYPES = {
  OpenTrove: [
    { name: "assetAmount", type: "uint256" },
    { name: "debtAmount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const OPEN_TROVE_DOMAIN = {
  name: "BorrowerOperationsSignatures",
  version: "1",
  chainId: mezoTestnet.id,
  verifyingContract: ADDR.troveSigs,
} as const;

export function pct(x1e18: bigint) {
  return `${(Number((x1e18 * 1000n) / WAD) / 10).toFixed(1)}%`;
}

export function fmt(x: bigint, decimals: number, dp = 2) {
  const neg = x < 0n;
  const v = neg ? -x : x;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, dp);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${dp > 0 ? "." + frac : ""}`;
}

export const txUrl = (h: Hex) => `${mezoTestnet.blockExplorers.default.url}/tx/${h}`;
export const addrUrl = (a: Address) => `${mezoTestnet.blockExplorers.default.url}/address/${a}`;
