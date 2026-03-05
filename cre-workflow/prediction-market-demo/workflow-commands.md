# Workflow Commands

This file lists command snippets to run the existing and new workflows.

## 0) Setup

```bash
cd "/Users/yagnesh/Desktop/2026 HACKATHONS/cre-gcp-prediction-market-demo/cre-workflow"
```

## 1) Create Market Workflow (HTTP trigger)

### Simulate

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload @./create-market-payload.json \
  --non-interactive
```

### Broadcast onchain

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload @./create-market-payload.json \
  --non-interactive \
  --broadcast
```

## 2) Private Bet Workflow (HTTP trigger + private transfer API + onchain aggregate update)

### 2.1 Generate EIP-712 signature + payload command (reusable)

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

### 2.2 Generate YES payload (example)

```bash
generate_private_bet_payload 1 YES ./prediction-market-demo/private-bet-payload-yes.json
```

### 2.3 Generate NO payload (example)

```bash
generate_private_bet_payload 1 NO ./prediction-market-demo/private-bet-payload-no.json
```

### 2.4 Generate default payload file used by workflow (`private-bet-payload.json`)

```bash
generate_private_bet_payload 1 YES ./prediction-market-demo/private-bet-payload.json
```

### 2.5 Simulate

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive
```

### 2.6 Broadcast onchain

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive \
  --broadcast
```

### 2.7 Broadcast YES and NO payloads

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

### 2.8 Verify aggregate pool update onchain (Node RPC check)

```bash
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getPoolSizes(uint256) view returns (uint256,uint256,uint256,uint256)'],p); const r=await c.getPoolSizes(1n); console.log(JSON.stringify({marketId:1,noTotal:r[0].toString(),yesTotal:r[1].toString(),noCount:r[2].toString(),yesCount:r[3].toString()},null,2));"
```

## 3) Settlement Workflow (EVM log trigger)

Use the transaction hash where `SettlementRequested` was emitted.

```bash
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <TX_HASH_WITH_SETTLEMENT_REQUESTED_EVENT> \
  --evm-event-index 0
```

Broadcast settlement onchain:

```bash
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <TX_HASH_WITH_SETTLEMENT_REQUESTED_EVENT> \
  --evm-event-index 0 \
  --broadcast
```

## 4) Firebase Checks (required for Firestore write)

### 4.1 Validate API key can mint anonymous token

```bash
set -a && source .env && set +a
curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY_VAR}" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken":true}'
```

Expected: JSON containing `idToken`.
If you get `CONFIGURATION_NOT_FOUND`, fix Firebase setup:
- Use the Web API key from the same Firebase project as `FIREBASE_PROJECT_ID_VAR`.
- Enable Firebase Authentication for that project.
- Enable **Anonymous** sign-in provider.

### 4.2 Firestore rules

Current workflows write to:
- settlement docs in `/demo/{doc}`
- private bet docs in `/privateBets/{doc}`

Rules must allow authenticated reads/writes for both paths.

Use the repo rules file:

```bash
cat ../firestore.rules
```

Then paste in Firebase Console:
- Firestore Database -> Rules

## 5) End-to-end smoke test (new market + YES + NO)

### 5.1 Create market payload

```bash
TS=$(date +%s)
cat > /tmp/create-market-e2e.json <<EOF
{
  "question": "E2E Test Market ${TS}: Will BTC close above \$120,000 by Dec 31, 2026?",
  "stakingAddress": "0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F",
  "tokenAddress": "0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc"
}
EOF
```

### 5.2 Broadcast create-market tx

```bash
cre workflow simulate ./prediction-market-demo \
  --target local-simulation \
  --trigger-index 0 \
  --http-payload @/tmp/create-market-e2e.json \
  --non-interactive \
  --broadcast
```

### 5.3 Get latest market id

```bash
node --input-type=module -e "import { JsonRpcProvider, Contract } from 'ethers'; const p=new JsonRpcProvider('https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg'); const c=new Contract('0x77a8ae9Fd960a6edF8263eC0966071d86529f23c',['function getMarketCount() view returns (uint256)'],p); const n=await c.getMarketCount(); console.log('newMarketId=',(Number(n)-1));"
```

### 5.4 Generate YES + NO payloads for that market id

```bash
generate_private_bet_payload <NEW_MARKET_ID> YES ./prediction-market-demo/private-bet-payload-yes.json
generate_private_bet_payload <NEW_MARKET_ID> NO ./prediction-market-demo/private-bet-payload-no.json
```

### 5.5 Broadcast both sides

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
