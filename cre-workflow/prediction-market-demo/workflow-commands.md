# Workflow Commands — Complete Reference

All commands run from the `cre-workflow/` directory.

## 0) Setup

```bash
cd cre-workflow
set -a && source .env && set +a
```

## 1) Create Market Workflow (HTTP trigger)

### Simulate

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/create-market-payload.json" \
  --non-interactive
```

### Broadcast on-chain

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/create-market-payload.json" \
  --non-interactive \
  --broadcast
```

### Payload format

```json
{
  "question": "Will BTC close above $120,000 by Dec 31, 2026?",
  "stakingAddress": "0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F",
  "tokenAddress": "0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc"
}
```

### Get latest market ID

```bash
node --input-type=module -e "
import { JsonRpcProvider, Contract } from 'ethers';
const p = new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg');
const c = new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',
  ['function getMarketCount() view returns (uint256)'], p);
const n = await c.getMarketCount();
console.log('newMarketId=', Number(n) - 1);
"
```

## 2) Private Bet Workflow (HTTP trigger + ACE private transfer + on-chain aggregate)

### 2.1 EIP-712 payload generator (paste into terminal)

```bash
generate_private_bet_payload() {
  local market_id="$1"
  local outcome="$2"   # YES or NO
  local out_file="$3"
  local amount_wei="${4:-1000000000000000000}"

  set -a && source .env && set +a

  MARKET_ID="$market_id" OUTCOME="$outcome" OUT_FILE="$out_file" AMOUNT_WEI="$amount_wei" \
  node --input-type=module <<'NODE'
import fs from "node:fs";
import { Wallet } from "ethers";

const required = (value, key) => {
  if (!value || String(value).trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return String(value).trim();
};

const wallet = new Wallet(required(process.env.CRE_ETH_PRIVATE_KEY, "CRE_ETH_PRIVATE_KEY"));
const marketId = Number(required(process.env.MARKET_ID, "MARKET_ID"));
const outcome = required(process.env.OUTCOME, "OUTCOME").toUpperCase();
if (outcome !== "YES" && outcome !== "NO") {
  throw new Error("OUTCOME must be YES or NO");
}

const recipient = process.env.ESCROW_ADDRESS ?? "0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F";
const token = process.env.TOKEN_ADDRESS ?? "0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc";
const amount = process.env.AMOUNT_WEI ?? process.env.BET_AMOUNT_WEI ?? "1000000000000000000";
const timestamp = Math.floor(Date.now() / 1000);

const domain = {
  name: "CompliantPrivateTokenDemo",
  version: "0.0.1",
  chainId: 11155111,
  verifyingContract: "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13",
};

const types = {
  "Private Token Transfer": [
    { name: "sender", type: "address" },
    { name: "recipient", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "flags", type: "string[]" },
    { name: "timestamp", type: "uint256" },
  ],
};

const message = {
  sender: wallet.address,
  recipient,
  token,
  amount,
  flags: [],
  timestamp,
};

const auth = await wallet.signTypedData(domain, types, message);
const payload = {
  marketId,
  outcome,
  amount,
  account: wallet.address,
  recipient,
  tokenAddress: token,
  flags: [],
  timestamp,
  auth,
};

const outFile = required(process.env.OUT_FILE, "OUT_FILE");
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
console.log(`Wrote ${outFile}`);
console.log(JSON.stringify(payload, null, 2));
NODE
}
```

### 2.2 Generate YES payload

```bash
generate_private_bet_payload <MARKET_ID> YES ./prediction-market-demo/private-bet-payload-yes.json
```

### 2.3 Generate NO payload

```bash
generate_private_bet_payload <MARKET_ID> NO ./prediction-market-demo/private-bet-payload-no.json
```

### 2.4 Simulate

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-yes.json" \
  --non-interactive
```

### 2.5 Broadcast YES and NO bets

```bash
# Broadcast YES bet (private transfer + Firestore write + on-chain aggregate)
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

### 2.6 Verify aggregate pool update on-chain

```bash
node --input-type=module -e "
import { JsonRpcProvider, Contract } from 'ethers';
const p = new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg');
const c = new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',
  ['function getPoolSizes(uint256) view returns (uint256,uint256,uint256,uint256)'], p);
const r = await c.getPoolSizes(<MARKET_ID>n);
console.log(JSON.stringify({
  marketId: <MARKET_ID>,
  noTotal: r[0].toString(),
  yesTotal: r[1].toString(),
  noCount: r[2].toString(),
  yesCount: r[3].toString()
}, null, 2));
"
```

## 3) Close Market

Close the market so no more bets can be placed.

```bash
node --input-type=module -e "
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
const marketId = <MARKET_ID>n;
const provider = new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg');
const wallet = new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider);
const market = new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',
  ['function closeMarket(uint256)'], wallet);
const tx = await market.closeMarket(marketId);
console.log('closeMarketTx=', tx.hash);
await tx.wait();
console.log('Market closed.');
"
```

## 4) Request Settlement

Emits the `SettlementRequested(uint256,string)` event that triggers the CRE settlement workflow.

```bash
node --input-type=module -e "
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
const marketId = <MARKET_ID>n;
const provider = new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg');
const wallet = new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider);
const market = new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',
  ['function requestSettlement(uint256)'], wallet);
const tx = await market.requestSettlement(marketId);
console.log('requestSettlementTx=', tx.hash);
await tx.wait();
console.log('Settlement requested. Use tx hash for CRE workflow.');
"
```

**Save the `requestSettlementTx` hash** for Step 5.

## 5) Private Settlement Workflow (EVM log trigger)

The settlement workflow:
- Decodes `SettlementRequested(marketId, question)` from the event
- Queries Gemini AI to resolve the market question
- Loads all private bets from Firestore
- Settles market on-chain with aggregate totals
- Executes private payouts to winners via ACE API
- Writes settlement audit to Firestore

### Simulate (dry run)

```bash
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive
```

### Broadcast (execute for real)

```bash
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive \
  --broadcast
```

## 6) Verify Settlement

### Check on-chain market state

```bash
node --input-type=module -e "
import { JsonRpcProvider, Contract } from 'ethers';
const p = new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg');
const c = new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',
  ['function getMarket(uint256) view returns (string,uint256,uint256,uint8,uint8,uint256,string,uint16,uint256[2],uint256[2])'], p);
const m = await c.getMarket(<MARKET_ID>n);
console.log('question:', m[0]);
console.log('status:', ['Open','SettlementRequested','Settled','NeedsManual'][Number(m[3])]);
console.log('outcome:', ['None','No','Yes','Inconclusive'][Number(m[4])]);
console.log('confidence:', Number(m[7]));

const c2 = new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',
  ['function getPoolSizes(uint256) view returns (uint256,uint256,uint256,uint256)'], p);
const pools = await c2.getPoolSizes(<MARKET_ID>n);
console.log('noTotal:', pools[0].toString(), 'yesTotal:', pools[1].toString());
console.log('noCount:', pools[2].toString(), 'yesCount:', pools[3].toString());
"
```

## 7) Firebase Validation

### Anonymous auth check

```bash
curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY_VAR}" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken":true}'
```

Expected: JSON containing `idToken`. If `CONFIGURATION_NOT_FOUND`, check:
- Web API key matches Firebase project
- Firebase Authentication enabled
- Anonymous sign-in provider enabled

### Firestore rules

Workflows write to:
- `/demo/{doc}` — Standard settlement docs
- `/privateBets/{doc}` — Private bet records
- `/privateSettlements/{doc}` — Settlement audit docs

Rules must allow authenticated reads/writes. Use rules from `../firestore.rules`.

## 8) Full E2E Flow (New Market)

```bash
# 1. Create market
TS=$(date +%s)
cat > /tmp/create-market-e2e.json <<EOF
{
  "question": "Did the United States land astronauts on the Moon in July 1969?",
  "stakingAddress": "0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F",
  "tokenAddress": "0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc"
}
EOF

cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload "@/tmp/create-market-e2e.json" \
  --non-interactive \
  --broadcast

# 2. Get market ID
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getMarketCount() view returns (uint256)'],p); const n=await c.getMarketCount(); console.log('newMarketId=',(Number(n)-1));"

# 3. Generate YES + NO payloads (replace <MARKET_ID>)
generate_private_bet_payload <MARKET_ID> YES ./prediction-market-demo/private-bet-payload-yes.json
generate_private_bet_payload <MARKET_ID> NO ./prediction-market-demo/private-bet-payload-no.json

# 4. Broadcast YES bet
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-yes.json" \
  --non-interactive \
  --broadcast

# 5. Broadcast NO bet
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-no.json" \
  --non-interactive \
  --broadcast

# 6. Close market (replace <MARKET_ID>)
node --input-type=module -e "import { Wallet, JsonRpcProvider, Contract } from 'ethers'; const marketId=<MARKET_ID>n; const provider=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const wallet=new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider); const market=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function closeMarket(uint256)'], wallet); const tx=await market.closeMarket(marketId); console.log('closeMarketTx=', tx.hash); await tx.wait();"

# 7. Request settlement (replace <MARKET_ID>)
node --input-type=module -e "import { Wallet, JsonRpcProvider, Contract } from 'ethers'; const marketId=<MARKET_ID>n; const provider=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const wallet=new Wallet(process.env.CRE_ETH_PRIVATE_KEY, provider); const market=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function requestSettlement(uint256)'], wallet); const tx=await market.requestSettlement(marketId); console.log('requestSettlementTx=', tx.hash); await tx.wait();"

# 8. Run settlement workflow (replace <REQUEST_SETTLEMENT_TX_HASH>)
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive \
  --broadcast

# 9. Verify on-chain state
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getMarket(uint256) view returns (string,uint256,uint256,uint8,uint8,uint256,string,uint16,uint256[2],uint256[2])'],p); const m=await c.getMarket(<MARKET_ID>n); console.log('status:', ['Open','SettlementRequested','Settled','NeedsManual'][Number(m[3])]); console.log('outcome:', ['None','No','Yes','Inconclusive'][Number(m[4])]); console.log('confidence:', Number(m[7]));"
```
