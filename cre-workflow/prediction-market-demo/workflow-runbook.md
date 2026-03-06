# Workflow Runbook

Quick command guide for create market, private bet, and settlement workflows.

## 1) Go to CRE workspace

```bash
cd "/Users/yagnesh/Desktop/2026 HACKATHONS/cre-gcp-prediction-market-demo/cre-workflow"
```

## 2) Create market workflow

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload @./create-market-payload.json \
  --non-interactive
```

Broadcast:

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload @./create-market-payload.json \
  --non-interactive \
  --broadcast
```

## 3) Private bet workflow

Load helper command to generate EIP-712 signature + payload:

```bash
generate_private_bet_payload() {
  local market_id="$1"
  local outcome="$2"   # YES or NO
  local out_file="$3"
  local amount_wei="${4:-1000000000000000000}"
  set -a && source .env && set +a
  MARKET_ID="$market_id" OUTCOME="$outcome" OUT_FILE="$out_file" AMOUNT_WEI="$amount_wei" node --input-type=module -e "import fs from 'node:fs'; import { Wallet } from 'ethers'; const req=(v,k)=>{ if(!v) throw new Error(k+' is required'); return String(v).trim(); }; const wallet=new Wallet(req(process.env.CRE_ETH_PRIVATE_KEY,'CRE_ETH_PRIVATE_KEY')); const marketId=Number(req(process.env.MARKET_ID,'MARKET_ID')); const outcome=req(process.env.OUTCOME,'OUTCOME').toUpperCase(); if(outcome!=='YES' && outcome!=='NO') throw new Error('OUTCOME must be YES or NO'); const recipient=process.env.ESCROW_ADDRESS ?? '0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F'; const token=process.env.TOKEN_ADDRESS ?? '0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc'; const amount=process.env.AMOUNT_WEI ?? process.env.BET_AMOUNT_WEI ?? '1000000000000000000'; const timestamp=Math.floor(Date.now()/1000); const domain={name:'CompliantPrivateTokenDemo',version:'0.0.1',chainId:11155111,verifyingContract:'0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13'}; const types={'Private Token Transfer':[ {name:'sender',type:'address'},{name:'recipient',type:'address'},{name:'token',type:'address'},{name:'amount',type:'uint256'},{name:'flags',type:'string[]'},{name:'timestamp',type:'uint256'} ]}; const message={sender:wallet.address,recipient,token,amount,flags:[],timestamp}; const auth=await wallet.signTypedData(domain,types,message); const payload={marketId,outcome,amount,account:wallet.address,recipient,tokenAddress:token,flags:[],timestamp,auth}; fs.writeFileSync(req(process.env.OUT_FILE,'OUT_FILE'),JSON.stringify(payload,null,2)); console.log(JSON.stringify(payload,null,2));"
}
```

Generate payloads:

```bash
generate_private_bet_payload 1 YES ./prediction-market-demo/private-bet-payload-yes.json
generate_private_bet_payload 1 NO ./prediction-market-demo/private-bet-payload-no.json
generate_private_bet_payload 1 YES ./prediction-market-demo/private-bet-payload.json
```

Simulate default payload:

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive
```

Broadcast:

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive \
  --broadcast
```

Broadcast YES and NO payloads:

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload-yes.json \
  --non-interactive \
  --broadcast

cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload-no.json \
  --non-interactive \
  --broadcast
```

## 4) Settlement workflow

```bash
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <TX_HASH_WITH_SETTLEMENT_REQUESTED_EVENT> \
  --evm-event-index 0
```

Broadcast:

```bash
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <TX_HASH_WITH_SETTLEMENT_REQUESTED_EVENT> \
  --evm-event-index 0 \
  --broadcast
```

## 5) Firebase validation (required for Firestore writes)

Anonymous sign-in check:

```bash
set -a && source .env && set +a
curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY_VAR}" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken":true}'
```

If response shows `CONFIGURATION_NOT_FOUND`:
- use Web API key from the same Firebase project as `FIREBASE_PROJECT_ID_VAR`
- enable Firebase Authentication
- enable Anonymous provider

Rules used by this repo are in `../firestore.rules` and must be set in Firebase Console -> Firestore Database -> Rules.

## 6) Full test flow (new market + YES + NO)

```bash
TS=$(date +%s)
cat > /tmp/create-market-e2e.json <<EOF
{
  "question": "E2E Test Market ${TS}: Will BTC close above \$120,000 by Dec 31, 2026?",
  "stakingAddress": "0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F",
  "tokenAddress": "0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc"
}
EOF

cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload @/tmp/create-market-e2e.json \
  --non-interactive \
  --broadcast

node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getMarketCount() view returns (uint256)'],p); const n=await c.getMarketCount(); console.log('newMarketId=',(Number(n)-1));"

generate_private_bet_payload <NEW_MARKET_ID> YES ./prediction-market-demo/private-bet-payload-yes.json
generate_private_bet_payload <NEW_MARKET_ID> NO ./prediction-market-demo/private-bet-payload-no.json

cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload-yes.json \
  --non-interactive \
  --broadcast

cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload-no.json \
  --non-interactive \
  --broadcast
```

## 7) Private settlement flow (event trigger)

```bash
# 1) Close market so MarketClosed event is emitted (example: market 1)
set -a && source .env && set +a
node --input-type=module -e "import { Wallet, JsonRpcProvider, Contract } from 'ethers'; const marketId=1n; const provider=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const wallet=new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider); const market=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function closeMarket(uint256)'], wallet); const tx=await market.closeMarket(marketId); console.log('closeMarketTx=', tx.hash); await tx.wait();"

# 2) Simulate settlement workflow using the close tx hash
cre workflow simulate ./prediction-market-demo \
  --target private-settlement-local-simulation \
  --evm-tx-hash <TX_HASH_WITH_MARKET_CLOSED_EVENT> \
  --evm-event-index 0

# 3) Broadcast settlement workflow
cre workflow simulate ./prediction-market-demo \
  --target private-settlement-local-simulation \
  --evm-tx-hash <TX_HASH_WITH_MARKET_CLOSED_EVENT> \
  --evm-event-index 0 \
  --broadcast
```
