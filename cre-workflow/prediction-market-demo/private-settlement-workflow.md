# Private Settlement Workflow

Event-triggered settlement workflow for private prediction bets.

## Entry Point

- `privateSettlementWorkflow.ts` (EVM log trigger on `MarketClosed(uint256)`)

## Flow

1. Trigger on `MarketClosed(marketId)`.
2. Read market question from `SimpleMarket.getMarket(marketId)`.
3. Resolve outcome with Gemini (`YES` / `NO` / `INCONCLUSIVE`).
4. Fetch all `privateBets` Firestore documents for `marketId`.
5. If needed, call `requestSettlement(marketId)` onchain.
6. Calculate winner payouts from Firestore bet records.
7. Execute private payouts from escrow account via `/private-transfer`.
8. Settle market onchain with final aggregates.
9. Write settlement audit to Firestore `privateSettlements`.

## Notes

- Keeps existing create, private-bet, and old settlement workflows unchanged.
- Requires `ESCROW_PRIVATE_KEY` secret for winner payouts.
- Firestore rules must allow authenticated writes to `privateSettlements`.
