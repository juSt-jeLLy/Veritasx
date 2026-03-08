# VeritasX Frontend

Next.js application for viewing prediction market settlement data from Firestore.

Displays the most recent market settlements written by the CRE settlement workflows, including AI resolution outcomes, confidence scores, and payout summaries.

## Prerequisites

- Node.js and pnpm installed
- A Firebase project with Firestore enabled (see [firebase-setup.md](../firebase-setup.md))

## Getting Started

1. **Navigate to the frontend directory:**

    ```bash
    cd frontend
    ```

2. **Install dependencies:**

    ```bash
    pnpm install
    ```

3. **Configure Firebase credentials:**

    ```bash
    cp .env.local.example .env.local
    ```

    Set your Firebase `apiKey`, `authDomain`, and `projectId` in `.env.local`.

4. **Set Firestore security rules:**

    Ensure rules allow read access to `demo`, `privateBets`, and `privateSettlements` collections. See [firebase-setup.md](../firebase-setup.md).

5. **Run the development server:**

    ```bash
    pnpm dev
    ```

6. **View the application:**

    Open [http://localhost:3000](http://localhost:3000). The app displays the 10 most recent settlement documents from Firestore.

## Firestore Collections

| Collection | Written By | Contains |
|---|---|---|
| `demo` | Standard settlement workflow (`main.ts`) | Gemini response, outcome, confidence, tx hash |
| `privateBets` | Private bet workflow (`privatebetworkflow.ts`) | Market ID, bettor, outcome, amount, token |
| `privateSettlements` | Private settlement workflow (`privateSettlementWorkflow.ts`) | Full audit: outcome, confidence, pool totals, payout summary |
