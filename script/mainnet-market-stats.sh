#!/usr/bin/env bash
# Reads Mezo mainnet: the Morpho BTC/mUSDC market (size, rate, active borrowers) and the MUSD trove
# system (count, debt, fixed rate). Read-only. Needs cast and curl.
set -euo pipefail
R="${MAINNET_RPC:-https://mainnet.mezo.public.validationcloud.io}"
MORPHO=0x565834ce7e40b8987bc20ebf83e2159467bda311
ID=0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db   # BTC / mUSDC, 86% LLTV
TROVE_MANAGER=0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193
INTEREST_RATE_MANAGER=0x4a453700d157717Fe02fB62E7700ED7845048285

PARAMS=$(cast call $MORPHO 'idToMarketParams(bytes32)(address,address,address,address,uint256)' $ID --rpc-url $R | awk '{print $1}' | paste -sd,)
MK=($(cast call $MORPHO 'market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)' $ID --rpc-url $R | awk '{print $1}'))
IRM=$(echo "$PARAMS" | cut -d, -f4)
RATE=$(cast call $IRM 'borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))(uint256)' \
  "($PARAMS)" "($(IFS=,; echo "${MK[*]}"))" --rpc-url $R | awk '{print $1}')

BORROW_TOPIC=$(cast keccak 'Borrow(bytes32,address,address,address,uint256,uint256)')
BORROWERS=$(curl -s "https://api.explorer.mezo.org/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=$MORPHO&topic0=$BORROW_TOPIC&topic1=$ID&topic0_1_opr=and" \
  | python3 -c 'import json,sys;print(" ".join(sorted({"0x"+l["topics"][2][26:] for l in json.load(sys.stdin)["result"]})))')
DEBTS=""
for a in $BORROWERS; do
  sh=$(cast call $MORPHO 'position(bytes32,address)(uint256,uint128,uint128)' $ID $a --rpc-url $R | sed -n 2p | awk '{print $1}')
  DEBTS="$DEBTS $sh"
done

python3 - "${MK[0]}" "${MK[2]}" "${MK[3]}" "$RATE" $DEBTS <<'PY'
import sys, math
supply, tba, tbs, rate = (int(x) for x in sys.argv[1:5])
debts = sorted((int(s) * (tba + 1) // (tbs + 10**6) / 1e6 for s in sys.argv[5:] if int(s) > 0), reverse=True)
print(f"Morpho BTC/mUSDC: supplied {supply/1e6:,.0f} mUSDC, borrowed {tba/1e6:,.0f} mUSDC, "
      f"variable borrow APY {(math.exp(rate/1e18*31536000)-1)*100:.2f}%")
big = [d for d in debts if d >= 1800]
print(f"Active borrowers: {len(debts)}. At or above the 1,800 MUSD trove floor: {len(big)}, owing {sum(big):,.0f} mUSDC")
PY
echo "MUSD troves: $(cast call $TROVE_MANAGER 'getTroveOwnersCount()(uint256)' --rpc-url $R), system debt $(cast call $TROVE_MANAGER 'getEntireSystemDebt()(uint256)' --rpc-url $R | awk '{printf "%.0f", $1/1e18}') MUSD, fixed rate $(cast call $INTEREST_RATE_MANAGER 'interestRate()(uint16)' --rpc-url $R) bps"
POOL=0xEd812AEc0Fecc8fD882Ac3eccC43f3aA80A6c356   # MUSD/mUSDC stable pool
RES=($(cast call $POOL 'getReserves()(uint256,uint256,uint256)' --rpc-url $R | awk '{print $1}'))
echo "MUSD/mUSDC pool: $(python3 -c "print(f'{${RES[0]}/1e6:,.0f} mUSDC, {${RES[1]}/1e18:,.0f} MUSD')")"
echo "Block $(cast block-number --rpc-url $R)"
