# Workflow Runbook — Quick Operations Guide

Condensed command sequences for the VeritasX prediction market. All commands from `cre-workflow/`.

## Setup

```bash
cd cre-workflow
set -a && source .env && set +a
```

## 1) Create Market

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/create-market-payload.json" \
  --non-interactive \
  --broadcast
```

Get market ID:

```bash
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getMarketCount() view returns (uint256)'],p); const n=await c.getMarketCount(); console.log('newMarketId=',(Number(n)-1));"
```

## 2) Place Private Bets

Load payload generator (paste once):

```bash
generate_private_bet_payload() {
  local market_id="$1"
  local outcome="$2"
  local out_file="$3"
  local amount_wei="${4:-1000000000000000000}"
  set -a && source .env && set +a
  MARKET_ID="$market_id" OUTCOME="$outcome" OUT_FILE="$out_file" AMOUNT_WEI="$amount_wei" node --input-type=module -e "import fs from 'node:fs'; import { Wallet } from 'ethers'; const req=(v,k)=>{ if(!v) throw new Error(k+' is required'); return String(v).trim(); }; const wallet=new Wallet(req(process.env.CRE_ETH_PRIVATE_KEY,'CRE_ETH_PRIVATE_KEY')); const marketId=Number(req(process.env.MARKET_ID,'MARKET_ID')); const outcome=req(process.env.OUTCOME,'OUTCOME').toUpperCase(); if(outcome!=='YES' && outcome!=='NO') throw new Error('OUTCOME must be YES or NO'); const recipient=process.env.ESCROW_ADDRESS ?? '0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F'; const token=process.env.TOKEN_ADDRESS ?? '0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc'; const amount=process.env.AMOUNT_WEI ?? process.env.BET_AMOUNT_WEI ?? '1000000000000000000'; const timestamp=Math.floor(Date.now()/1000); const domain={name:'CompliantPrivateTokenDemo',version:'0.0.1',chainId:11155111,verifyingContract:'0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13'}; const types={'Private Token Transfer':[ {name:'sender',type:'address'},{name:'recipient',type:'address'},{name:'token',type:'address'},{name:'amount',type:'uint256'},{name:'flags',type:'string[]'},{name:'timestamp',type:'uint256'} ]}; const message={sender:wallet.address,recipient,token,amount,flags:[],timestamp}; const auth=await wallet.signTypedData(domain,types,message); const payload={marketId,outcome,amount,account:wallet.address,recipient,tokenAddress:token,flags:[],timestamp,auth}; fs.writeFileSync(req(process.env.OUT_FILE,'OUT_FILE'),JSON.stringify(payload,null,2)); console.log(JSON.stringify(payload,null,2));"
}
```

Generate and broadcast:

```bash
# Generate payloads (replace <MID> with market ID)
generate_private_bet_payload <MID> YES ./prediction-market-demo/private-bet-payload-yes.json
generate_private_bet_payload <MID> NO ./prediction-market-demo/private-bet-payload-no.json

# Broadcast YES bet
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-yes.json" \
  --non-interactive \
  --broadcast

# Broadcast NO bet
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-no.json" \
  --non-interactive \
  --broadcast
```

## 3) Close Market

```bash
node --input-type=module -e "import { Wallet, JsonRpcProvider, Contract } from 'ethers'; const marketId=<MID>n; const provider=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const wallet=new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider); const market=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function closeMarket(uint256)'], wallet); const tx=await market.closeMarket(marketId); console.log('closeMarketTx=', tx.hash); await tx.wait();"
```

## 4) Request Settlement

```bash
node --input-type=module -e "import { Wallet, JsonRpcProvider, Contract } from 'ethers'; const marketId=<MID>n; const provider=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const wallet=new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider); const market=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function requestSettlement(uint256)'], wallet); const tx=await market.requestSettlement(marketId); console.log('requestSettlementTx=', tx.hash); await tx.wait();"
```

Save the `requestSettlementTx` hash.

## 5) Run Private Settlement Workflow

```bash
# Simulate (dry run)
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive

# Broadcast (execute)
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive \
  --broadcast
```

## 6) Verify

```bash
# On-chain state
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getMarket(uint256) view returns (string,uint256,uint256,uint8,uint8,uint256,string,uint16,uint256[2],uint256[2])'],p); const m=await c.getMarket(<MID>n); console.log('status:', ['Open','SettlementRequested','Settled','NeedsManual'][Number(m[3])]); console.log('outcome:', ['None','No','Yes','Inconclusive'][Number(m[4])]); console.log('confidence:', Number(m[7]));"

# Pool sizes
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getPoolSizes(uint256) view returns (uint256,uint256,uint256,uint256)'],p); const r=await c.getPoolSizes(<MID>n); console.log({noTotal:r[0].toString(),yesTotal:r[1].toString(),noCount:r[2].toString(),yesCount:r[3].toString()});"
```

## 7) Firebase Validation

```bash
curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY_VAR}" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken":true}'
```

Expected: JSON with `idToken`. If `CONFIGURATION_NOT_FOUND`, check Firebase setup.
