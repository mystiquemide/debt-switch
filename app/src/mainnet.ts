import { createPublicClient, defineChain, fallback, http, parseAbi } from "viem";

export const mezoMainnet = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.mezo.public.validationcloud.io"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const client = createPublicClient({
  chain: mezoMainnet,
  transport: fallback([
    http("https://mainnet.mezo.public.validationcloud.io", { timeout: 10_000 }),
    http("https://mezo-mainnet.boar.network", { timeout: 10_000 }),
  ]),
});

// Mezo mainnet addresses: Morpho Blue and its BTC/mUSDC market, and the MUSD trove system.
const MORPHO = "0x565834ce7e40b8987bc20ebf83e2159467bda311";
const MARKET_ID = "0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db";
const TROVE_MANAGER = "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193";
const BORROWER_OPS = "0x44b1bac67dDA612a41a58AAf779143B181dEe031";
const INTEREST_RATE_MANAGER = "0x4a453700d157717Fe02fB62E7700ED7845048285";

const morphoAbi = parseAbi([
  "function market(bytes32) view returns (uint128,uint128,uint128,uint128,uint128,uint128)",
  "function idToMarketParams(bytes32) view returns (address,address,address,address,uint256)",
]);
const irmAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
  "function borrowRateView(MarketParams, Market) view returns (uint256)",
]);
const troveAbi = parseAbi([
  "function getEntireSystemDebt() view returns (uint256)",
  "function MCR() view returns (uint256)",
]);
const boAbi = parseAbi(["function minNetDebt() view returns (uint256)"]);
const irAbi = parseAbi(["function interestRate() view returns (uint16)"]);

export type LoanFacts = {
  block: bigint;
  readAt: Date;
  morpho: { borrowApy: number; lltv: number; borrowed: number };
  trove: { fixedRate: number; maxLtv: number; minNetDebt: number; borrowed: number };
};

export async function readLoanFacts(): Promise<LoanFacts> {
  const [mkt, params, systemDebt, mcr, minNetDebt, rateBps, block] = await Promise.all([
    client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "market", args: [MARKET_ID] }),
    client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "idToMarketParams", args: [MARKET_ID] }),
    client.readContract({ address: TROVE_MANAGER, abi: troveAbi, functionName: "getEntireSystemDebt" }),
    client.readContract({ address: TROVE_MANAGER, abi: troveAbi, functionName: "MCR" }),
    client.readContract({ address: BORROWER_OPS, abi: boAbi, functionName: "minNetDebt" }),
    client.readContract({ address: INTEREST_RATE_MANAGER, abi: irAbi, functionName: "interestRate" }),
    client.getBlockNumber(),
  ]);
  const [loanToken, collateralToken, oracle, irm, lltv] = params;
  const ratePerSecond = await client.readContract({
    address: irm,
    abi: irmAbi,
    functionName: "borrowRateView",
    args: [
      { loanToken, collateralToken, oracle, irm, lltv },
      {
        totalSupplyAssets: mkt[0],
        totalSupplyShares: mkt[1],
        totalBorrowAssets: mkt[2],
        totalBorrowShares: mkt[3],
        lastUpdate: mkt[4],
        fee: mkt[5],
      },
    ],
  });
  return {
    block,
    readAt: new Date(),
    morpho: {
      borrowApy: Math.expm1((Number(ratePerSecond) / 1e18) * 31_536_000) * 100,
      lltv: Number(lltv) / 1e16,
      borrowed: Number(mkt[2]) / 1e6,
    },
    trove: {
      fixedRate: rateBps / 100,
      maxLtv: 1e20 / Number(mcr), // 110% minimum collateral ratio means about 90.9% LTV
      minNetDebt: Number(minNetDebt) / 1e18,
      borrowed: Number(systemDebt) / 1e18,
    },
  };
}
