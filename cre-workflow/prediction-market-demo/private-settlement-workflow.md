# Private Settlement Workflow

Event-triggered settlement workflow for private prediction markets with AI-powered resolution and privacy-preserving payouts.

## Entry Point

`privateSettlementWorkflow.ts` — EVM log trigger on `SettlementRequested(uint256 indexed marketId, string question)`

## Architecture

```
SimpleMarket Contract
    │
    ▼ emit SettlementRequested(marketId, question)
    │
CRE Workflow (privateSettlementWorkflow.ts)
    │
    ├── 1. Decode event log → extract marketId + question
    │
    ├── 2. Query Gemini AI → {result: "YES"|"NO"|"INCONCLUSIVE", confidence: 0-10000}
    │       Uses Google Search grounding for factual verification
    │
    ├── 3. Load private bets from Firestore (privateBets collection)
    │       Paginated query for all bets matching marketId
    │
    ├── 4. Calculate winner payouts
    │       YES wins → YES bettors split NO pool proportionally
    │       NO wins  → NO bettors split YES pool proportionally
    │       INCONCLUSIVE → all bettors refunded
    │
    ├── 5. Settle market on-chain
    │       settleMarketWithAggregates(outcome, confidence, totals, counts)
    │
    ├── 6. Execute private payouts (per winner)
    │       EIP-712 signed POST /private-transfer (escrow → winner)
    │       Uses pure BigInt secp256k1 for WASM compatibility
    │
    └── 7. Write settlement audit to Firestore (privateSettlements)
```

## What Stays Private

| Data | Where It Lives | On-Chain? |
|---|---|---|
| Individual bet amounts | Firestore `privateBets` | No |
| Bettor addresses | Firestore `privateBets` | No |
| Which side each user bet on | Firestore `privateBets` | No |
| Winner payout amounts | ACE API private transfers | No |
| Payout recipient addresses | ACE API private transfers | No |
| API credentials (Gemini, Firebase, escrow key) | CRE secrets | No |
| Aggregate YES/NO pool totals | SimpleMarket contract | Yes |
| Aggregate YES/NO bet counts | SimpleMarket contract | Yes |
| Settlement outcome + confidence | SimpleMarket contract | Yes |
| Gemini response ID (evidence) | SimpleMarket contract | Yes |

## CRE Capabilities Used

- **EVM Log Trigger**: Listen for `SettlementRequested` events
- **HTTP Capability**: Gemini AI, Firestore REST API, ACE Private Transfer API
- **EVM Write (Report)**: Submit signed settlement report to contract
- **Secrets**: Gemini API key, Firebase credentials, escrow private key
- **Consensus Aggregation**: All CRE nodes must agree on Gemini response

## Requirements

- `ESCROW_PRIVATE_KEY` secret — private key for the escrow wallet that holds bettor deposits
- Firestore rules must allow authenticated reads from `privateBets` and writes to `privateSettlements`
- ACE API must be accessible at the configured `aceApiBaseUrl`
- Market must have been created, bets placed, closed, and settlement requested

## Running

From `cre-workflow/`:

```bash
# Simulate
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive

# Broadcast
cre workflow simulate ./prediction-market-demo \
  --target staging \
  --evm-tx-hash <REQUEST_SETTLEMENT_TX_HASH> \
  --evm-event-index 0 \
  --trigger-index 0 \
  --non-interactive \
  --broadcast
```

## Technical Notes

- The payout module uses **pure BigInt secp256k1** instead of `@noble/curves` to avoid WASM traps caused by module-level curve precomputation in the Javy/QuickJS runtime
- CRE simulation has a limit of 5 HTTP calls per workflow — the audit write (step 7) may fail gracefully if this limit is hit. Core functionality (settlement + payouts) is unaffected.
- All HTTP calls use `consensusIdenticalAggregation` to ensure CRE node agreement
- EIP-712 domain: `CompliantPrivateTokenDemo` v0.0.1 on chain 11155111 (Sepolia)
