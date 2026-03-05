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

### 2.1 Generate signed payload (updates `private-bet-payload.json`)

```bash
set -a && source .env && set +a
node --input-type=module -e "import { Wallet } from 'ethers'; import fs from 'node:fs'; const wallet = new Wallet(process.env.CRE_ETH_PRIVATE_KEY); const recipient = process.env.ESCROW_ADDRESS ?? '0xdB772823f62c009E6EC805BC57A4aFc7B2701F1F'; const token = process.env.TOKEN_ADDRESS ?? '0xF5655184B6bfa977FbCcD9C77d308F2d261eddBc'; const amount = process.env.BET_AMOUNT_WEI ?? '1000000000000000000'; const marketId = Number(process.env.BET_MARKET_ID ?? '0'); const timestamp = Math.floor(Date.now()/1000); const domain = { name: 'CompliantPrivateTokenDemo', version: '0.0.1', chainId: 11155111, verifyingContract: '0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13' }; const types = { 'Private Token Transfer': [ { name: 'sender', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'flags', type: 'string[]' }, { name: 'timestamp', type: 'uint256' } ] }; const message = { sender: wallet.address, recipient, token, amount, flags: [], timestamp }; const auth = await wallet.signTypedData(domain, types, message); const payload = { marketId, outcome: 'YES', amount, account: wallet.address, recipient, tokenAddress: token, flags: [], timestamp, auth }; fs.writeFileSync('prediction-market-demo/private-bet-payload.json', JSON.stringify(payload, null, 2)); console.log(JSON.stringify(payload, null, 2));"
```

### 2.2 Simulate

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive
```

### 2.3 Broadcast onchain

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive \
  --broadcast
```

### 2.4 Verify aggregate pool update onchain

```bash
RPC_URL="https://eth-sepolia.g.alchemy.com/v2/HfydL6i5LTIMjZnHdDEDg"
MARKET="0x77a8ae9Fd960a6edF8263eC0966071d86529f23c"
cast call "$MARKET" "getPoolSizes(uint256)(uint256,uint256,uint256,uint256)" 0 --rpc-url "$RPC_URL"
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
