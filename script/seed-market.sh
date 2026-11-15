#!/usr/bin/env bash
# Seeds our testnet Morpho BTC/mUSDC market and opens the demo borrower's Morpho position.
# Uses cast, not forge script, because these steps move Mezo's chain-native BTC.
# Usage: DEPLOYER_KEY_FILE=... BORROWER_KEY_FILE=... script/seed-market.sh
set -euo pipefail

RPC="${RPC_URL:-https://rpc.test.mezo.org}"
DKEY="$(cat "${DEPLOYER_KEY_FILE:?}")"
BKEY="$(cat "${BORROWER_KEY_FILE:?}")"
DEPLOYER="$(cast wallet address "$DKEY")"
BORROWER="$(cast wallet address "$BKEY")"

BTC=0x7b7C000000000000000000000000000000000000
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
MUSDC=0xe1a26db653708A2AD8F824E92Db9852410e33A59
POOL_ROUTER=0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9
POOL_FACTORY=0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A
MORPHO="${MORPHO:?set MORPHO}"
ORACLE="${ORACLE:?set ORACLE}"
IRM="${IRM:?set IRM}"
MARKET="($MUSDC,$BTC,$ORACLE,$IRM,860000000000000000)"

LIQUIDITY_BTC="${LIQUIDITY_BTC:-6000000000000000}"    # 0.006 BTC swapped into mUSDC liquidity
BORROWER_FUND="${BORROWER_FUND:-40500000000000000}"   # 0.0405 BTC to the borrower
COLLATERAL="${COLLATERAL:-40000000000000000}"         # 0.040 BTC Morpho collateral
BORROW="${BORROW:-300000000}"                         # 300 mUSDC Morpho debt

[ "$(cast chain-id --rpc-url "$RPC")" = "31611" ] || { echo "not Mezo testnet" >&2; exit 1; }

tx() { local key="$1"; shift; cast send "$@" --private-key "$key" --rpc-url "$RPC" --json \
  | python3 -c 'import json,sys;r=json.load(sys.stdin);r=r.get("data",r);assert r.get("status")=="0x1",r;print(r["transactionHash"])'; }
bal() { cast call "$1" 'balanceOf(address)(uint256)' "$2" --rpc-url "$RPC" | cut -d' ' -f1; }

ROUTE="[($BTC,$MUSD,false,$POOL_FACTORY),($MUSD,$MUSDC,true,$POOL_FACTORY)]"
QUOTE="$(cast call "$POOL_ROUTER" 'getAmountsOut(uint256,(address,address,bool,address)[])(uint256[])' "$LIQUIDITY_BTC" "$ROUTE" --rpc-url "$RPC" | tr -d '[]' | awk -F', ' '{print $3}' | cut -d' ' -f1)"
MIN_OUT=$((QUOTE * 99 / 100))
DEADLINE=$(( $(date +%s) + 1800 ))

h=$(tx "$DKEY" "$BTC" 'approve(address,uint256)' "$POOL_ROUTER" "$LIQUIDITY_BTC"); echo "liquidity: approve BTC $h"
h=$(tx "$DKEY" "$POOL_ROUTER" 'swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)' "$LIQUIDITY_BTC" "$MIN_OUT" "$ROUTE" "$DEPLOYER" "$DEADLINE"); echo "liquidity: swap BTC->MUSD->mUSDC $h"
L="$(bal "$MUSDC" "$DEPLOYER")"
h=$(tx "$DKEY" "$MUSDC" 'approve(address,uint256)' "$MORPHO" 115792089237316195423570985008687907853269984665640564039457584007913129639935); echo "liquidity: approve mUSDC $h"
h=$(tx "$DKEY" "$MORPHO" 'supply((address,address,address,address,uint256),uint256,uint256,address,bytes)' "$MARKET" "$L" 0 "$DEPLOYER" 0x); echo "liquidity: supply $L mUSDC $h"

h=$(tx "$DKEY" "$BORROWER" --value "$BORROWER_FUND"); echo "borrower: fund $h"
h=$(tx "$BKEY" "$BTC" 'approve(address,uint256)' "$MORPHO" "$COLLATERAL"); echo "borrower: approve BTC $h"
h=$(tx "$BKEY" "$MORPHO" 'supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)' "$MARKET" "$COLLATERAL" "$BORROWER" 0x); echo "borrower: supplyCollateral $h"
h=$(tx "$BKEY" "$MORPHO" 'borrow((address,address,address,address,uint256),uint256,uint256,address,address)' "$MARKET" "$BORROW" 0 "$BORROWER" "$BORROWER"); echo "borrower: borrow $h"
# The borrower spends the loan. It goes back to the supplier, who lends it out again, which keeps
# enough idle liquidity in the market for the switch's flash loan.
h=$(tx "$BKEY" "$MUSDC" 'transfer(address,uint256)' "$DEPLOYER" "$BORROW"); echo "borrower: spend mUSDC $h"
h=$(tx "$DKEY" "$MORPHO" 'supply((address,address,address,address,uint256),uint256,uint256,address,bytes)' "$MARKET" "$BORROW" 0 "$DEPLOYER" 0x); echo "liquidity: resupply $h"

echo "borrower $BORROWER: mUSDC=$(bal "$MUSDC" "$BORROWER") MUSD=$(bal "$MUSD" "$BORROWER") BTC=$(cast balance "$BORROWER" --rpc-url "$RPC")"
