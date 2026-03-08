# Private Bet Workflow

Privacy-preserving bet placement for prediction markets. Individual bet details stay off-chain while aggregate pool totals are updated on-chain.

## Entry Point

`privatebetworkflow.ts` — HTTP trigger

## Architecture

```
User (HTTP payload with EIP-712 signature)
    │
    ▼
CRE Workflow (privatebetworkflow.ts)
    │
    ├── 1. Validate payload (marketId, outcome, amount, auth signature)
    │
    ├── 2. Execute private transfer via ACE API
    │       POST /private-transfer (bettor → escrow)
    │       Authenticated with EIP-712 typed data signature
    │       Token transfer happens off-chain, never visible on-chain
    │
    ├── 3. Write bet record to Firestore (privateBets collection)
    │       Stores: marketId, outcome, amount, bettorAddress, tokenAddress, txHash
    │
    └── 4. Update on-chain aggregates via CRE report
            SimpleMarket receives: marketId, outcomeIndex, amount
            Only pool totals updated — no individual bet data on-chain
```

## What Stays Private

- Bettor's address (only in Firestore, not on-chain)
- Bet amount (only in Firestore, not on-chain)
- Which side the bettor chose (only in Firestore, not on-chain)
- The private token transfer between bettor and escrow

## What Goes On-Chain

- Aggregate YES pool total and count
- Aggregate NO pool total and count

## Payload

Required fields:

| Field | Type | Description |
|---|---|---|
| `marketId` | number | Market to bet on |
| `outcome` | `"YES"` or `"NO"` | Predicted outcome |
| `amount` | string (wei) | Bet amount |
| `account` | address | Bettor's address |
| `recipient` | address | Escrow address |
| `tokenAddress` | address | Token contract |
| `timestamp` | number | Unix timestamp |
| `auth` | hex string | EIP-712 signature |

Optional: `flags` (e.g. `["hide-sender"]`)

### EIP-712 Domain

```
name: "CompliantPrivateTokenDemo"
version: "0.0.1"
chainId: 11155111
verifyingContract: "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13"
```

### EIP-712 Type

```
"Private Token Transfer": [
  { name: "sender",    type: "address" },
  { name: "recipient", type: "address" },
  { name: "token",     type: "address" },
  { name: "amount",    type: "uint256" },
  { name: "flags",     type: "string[]" },
  { name: "timestamp", type: "uint256" }
]
```

## Running

From `cre-workflow/`:

```bash
# Generate payload with EIP-712 signature (see workflow-commands.md for generator)
generate_private_bet_payload <MARKET_ID> YES ./prediction-market-demo/private-bet-payload-yes.json

# Simulate
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-yes.json" \
  --non-interactive

# Broadcast
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload "@$(pwd)/prediction-market-demo/private-bet-payload-yes.json" \
  --non-interactive \
  --broadcast
```
