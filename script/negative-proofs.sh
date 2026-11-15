#!/usr/bin/env bash
# Sends deliberately invalid switches to DebtSwitchRouter on Mezo testnet so each refusal is visible
# on the explorer. Gas limits are set by hand because estimation fails on a reverting call.
# Usage: DEPLOYER_KEY_FILE=... VICTIM=0x... script/negative-proofs.sh
set -euo pipefail

RPC="${RPC_URL:-https://rpc.test.mezo.org}"
KEY="$(cat "${DEPLOYER_KEY_FILE:?}")"
ME="$(cast wallet address "$KEY")"
VICTIM="${VICTIM:?address of another borrower}"
D=deployments/31611.json
j() { python3 -c "import json;d=json.load(open('$D'));print($1)"; }
ROUTER=$(j "d['debtSwitchRouter']")
MARKET="($(j "d['mezo']['musdc']"),$(j "d['mezo']['btc']"),$(j "d['oracle']"),$(j "d['irm']"),$(j "d['lltv']"))"
SIG='morphoToTrove(((address,address,address,address,uint256),address,uint256,address,address,uint256,uint256,bytes))'
ZERO=0x0000000000000000000000000000000000000000
DEADLINE=$(( $(date +%s) + 1800 ))

[ "$(cast chain-id --rpc-url "$RPC")" = "31611" ] || { echo "not Mezo testnet" >&2; exit 1; }

send_expect_revert() {
  local label="$1"; shift
  local out hash status
  out="$(cast send "$ROUTER" "$SIG" "$@" --gas-limit 400000 --private-key "$KEY" --rpc-url "$RPC" --json 2>&1 || true)"
  hash="$(printf '%s' "$out" | python3 -c 'import json,sys
try:
  r=json.load(sys.stdin); r=r.get("data",r); print(r["transactionHash"])
except Exception: print("")')"
  [ -n "$hash" ] || { echo "$label: not mined: $out" >&2; exit 1; }
  status="$(cast receipt "$hash" --json --rpc-url "$RPC" | python3 -c 'import json,sys;r=json.load(sys.stdin);print(r.get("data",r)["status"])')"
  [ "$status" = "0x0" ] || { echo "$label: expected a revert, got status $status" >&2; exit 1; }
  echo "$label: reverted $hash"
}

# 1. Below the 1,800 MUSD floor: 1,000 MUSD requested.
send_expect_revert "below floor" "($MARKET,$ME,1000000000000000000000,$ZERO,$ZERO,0,$DEADLINE,0x)"

# 2. Wrong caller: this wallet tries to switch someone else's position.
send_expect_revert "wrong caller" "($MARKET,$VICTIM,1800000000000000000000,$ZERO,$ZERO,0,$DEADLINE,0x)"
