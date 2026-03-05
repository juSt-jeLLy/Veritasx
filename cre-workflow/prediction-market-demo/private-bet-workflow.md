# Private Bet Workflow

This workflow keeps private transfer details offchain while updating aggregate pool totals onchain.

## Entry Point

- `privatebetworkflow.ts` (HTTP trigger)

## Flow

1. Accept HTTP JSON payload for a private bet.
2. Call private API `POST /private-transfer` using signed request fields.
3. If private transfer succeeds, submit a CRE report to `SimpleMarket` with prefix `0x02` and payload:
   - `marketId`
   - `outcomeIndex` (`0 = NO`, `1 = YES`)
   - `amount`
4. Write audit data to Firestore collection `privateBets`.

## Payload Example

See `private-bet-payload.json`.

Required fields:

- `marketId`
- `amount` (wei string)
- `outcome` (`YES`/`NO`) or `outcomeIndex` (`0`/`1`)
- `bettorAddress` or `account`
- `escrowAddress` or `recipient`
- `timestamp`
- `auth` (EIP-712 signature for private transfer message)

Optional fields:

- `tokenAddress` (falls back to `config.json` token)
- `flags` (e.g. `["hide-sender"]`)

## Simulate

From `cre-workflow` directory:

```bash
cre workflow simulate ./prediction-market-demo \
  --target private-bet-local-simulation \
  --trigger-index 0 \
  --http-payload @./private-bet-payload.json \
  --non-interactive
```

Add `--broadcast` to execute the aggregate update onchain.
