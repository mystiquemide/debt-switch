#!/usr/bin/env bash
# Live proof on Mezo testnet that a contract can hop BTC between native and ERC-20 form.
# Forks can't run this: the BTC token at 0x7b7C is implemented by the chain itself.
# Usage: DEPLOYER_KEY_FILE=path/to/key script/btc-roundtrip.sh
set -euo pipefail

RPC="${RPC_URL:-https://rpc.test.mezo.org}"
KEY_FILE="${DEPLOYER_KEY_FILE:?set DEPLOYER_KEY_FILE to a file holding a testnet-only private key}"
KEY="$(cat "$KEY_FILE")"
BTC=0x7b7C000000000000000000000000000000000000
AMOUNT="${AMOUNT:-1000000000000000}" # 0.001 BTC
ME="$(cast wallet address "$KEY")"

[ "$(cast chain-id --rpc-url "$RPC")" = "31611" ] || { echo "not Mezo testnet" >&2; exit 1; }

erc20_of() { cast call "$BTC" 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" | cut -d' ' -f1; }
tx() { cast send "$@" --private-key "$KEY" --rpc-url "$RPC" --json | python3 -c 'import json,sys;r=json.load(sys.stdin);r=r.get("data",r);assert r.get("status")=="0x1",r;print(r["transactionHash"])'; }

HOP="$(forge create contracts/BtcHop.sol:BtcHop --private-key "$KEY" --rpc-url "$RPC" --broadcast --json | python3 -c 'import json,sys;r=json.load(sys.stdin);print(r.get("data",r)["deployedTo"])')"
echo "BtcHop: $HOP"

h=$(tx "$HOP" --value "$AMOUNT"); echo "1. native in: $h"
[ "$(cast balance "$HOP" --rpc-url "$RPC")" = "$AMOUNT" ] || { echo "hop native balance wrong" >&2; exit 1; }
[ "$(erc20_of "$HOP")" = "$AMOUNT" ] || { echo "hop ERC-20 view disagrees with native" >&2; exit 1; }

SINK=0x000000000000000000000000000000000000dEaD
SINK_BEFORE="$(erc20_of "$SINK")"
h=$(tx "$HOP" 'forwardAsErc20(address,uint256)' "$SINK" "$AMOUNT"); echo "2. ERC-20 out: $h"
[ "$(cast balance "$HOP" --rpc-url "$RPC")" = "0" ] || { echo "hop kept native BTC" >&2; exit 1; }
[ "$(python3 -c "print($(erc20_of "$SINK") - $SINK_BEFORE)")" = "$AMOUNT" ] || { echo "sink didn't receive" >&2; exit 1; }

h=$(tx "$BTC" 'approve(address,uint256)' "$HOP" "$AMOUNT"); echo "3. approve: $h"
RCV=0x000000000000000000000000000000000000bEEF
RCV_BEFORE="$(cast balance "$RCV" --rpc-url "$RPC")"
h=$(tx "$HOP" 'forwardAsNative(address,uint256)' "$RCV" "$AMOUNT"); echo "4. ERC-20 in, native out: $h"
[ "$(python3 -c "print($(cast balance "$RCV" --rpc-url "$RPC") - $RCV_BEFORE)")" = "$AMOUNT" ] || { echo "receiver didn't get native BTC" >&2; exit 1; }
[ "$(cast balance "$HOP" --rpc-url "$RPC")" = "0" ] || { echo "hop kept BTC" >&2; exit 1; }

echo "PASS: BTC round trip works in both directions"
