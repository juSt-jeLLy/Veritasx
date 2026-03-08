// Private settlement workflow — pure BigInt secp256k1 (no @noble/curves)
import {
  EVMLog,
  Runner,
  bytesToHex,
  cre,
  getNetwork,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeEventLog, keccak256, parseAbi, toHex } from "viem";
import { askGeminiForSettlement } from "./privateSettlementGemini";
import {
  listPrivateBetsByMarket,
  writePrivateSettlementAudit,
} from "./privateSettlementFirestore";
import { settleMarketWithAggregates } from "./privateSettlementEvm";
import { payoutWinnerPrivately } from "./privateSettlementPayout";
import {
  type FirestorePrivateBet,
  type PrivateSettlementConfig,
  type WinnerPayoutExecution,
  type WinnerPayoutPlan,
} from "./privateSettlementTypes";

const settlementRequestedAbi = parseAbi([
  "event SettlementRequested(uint256 indexed marketId, string question)",
]);
const settlementRequestedEventSignature = "SettlementRequested(uint256,string)";

const onSettlementRequestedLog = (
  runtime: Runtime<PrivateSettlementConfig>,
  log: EVMLog
): string => {
  // Step 1: Decode event
  const topics = log.topics.map((topic) => bytesToHex(topic)) as [
    `0x${string}`,
    ...`0x${string}`[],
  ];
  const data = bytesToHex(log.data);
  const decoded = decodeEventLog({ abi: settlementRequestedAbi, data, topics });
  const marketId = decoded.args.marketId as bigint;
  const question = decoded.args.question as string;
  runtime.log(`marketId=${marketId.toString()}`);

  // Step 2: Query Gemini
  const geminiResult = askGeminiForSettlement(runtime, marketId.toString(), question);
  const parsedGemini = JSON.parse(geminiResult.geminiResponse) as { result: string; confidence: number };
  if (parsedGemini.result !== "YES" && parsedGemini.result !== "NO" && parsedGemini.result !== "INCONCLUSIVE") {
    throw new Error(`Invalid Gemini result: ${parsedGemini.result}`);
  }
  const outcome = parsedGemini.result as "YES" | "NO" | "INCONCLUSIVE";
  const confidence = parsedGemini.confidence;
  runtime.log(`Gemini: ${outcome}, confidence=${confidence}`);

  // Step 3: Load bets from Firestore
  const bets = listPrivateBetsByMarket(runtime, marketId);
  runtime.log(`Bets: ${bets.length}`);

  const yesBets = bets.filter((b) => b.outcome === "YES");
  const noBets = bets.filter((b) => b.outcome === "NO");
  const yesTotal = yesBets.reduce((acc, b) => acc + b.amount, 0n);
  const noTotal = noBets.reduce((acc, b) => acc + b.amount, 0n);
  runtime.log(`YES pool: ${yesTotal.toString()}, NO pool: ${noTotal.toString()}`);

  // Step 4: Settle on-chain
  const settlementTxHash = settleMarketWithAggregates(runtime, {
    marketId,
    outcome,
    confidence,
    responseId: geminiResult.responseId,
    noTotal,
    yesTotal,
    noCount: BigInt(noBets.length),
    yesCount: BigInt(yesBets.length),
  });
  runtime.log(`Settlement tx: ${settlementTxHash}`);

  // Step 5: Execute private payouts
  const payoutExecutions = executePayouts(runtime, outcome, yesBets, noBets, yesTotal, noTotal);
  runtime.log(`Payouts completed: ${payoutExecutions.length}`);

  // Step 6: Write settlement audit to Firestore
  const payoutSummaryJson = JSON.stringify(
    payoutExecutions.map((e) => ({
      bettorAddress: e.bettorAddress,
      originalAmount: e.originalAmount.toString(),
      payoutAmount: e.payoutAmount.toString(),
      transferId: e.transferId,
    }))
  );

  try {
    const audit = writePrivateSettlementAudit(runtime, {
      marketId,
      question,
      outcome,
      confidence,
      geminiResponseId: geminiResult.responseId,
      noTotal,
      yesTotal,
      noCount: noBets.length,
      yesCount: yesBets.length,
      payoutCount: payoutExecutions.length,
      payoutSummaryJson,
      requestSettlementTxHash: bytesToHex(log.txHash),
      settlementTxHash,
    });
    runtime.log(`Audit document: ${audit.name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime.log(`Audit write failed: ${msg}`);
  }

  return `settlement ok: ${outcome}, bets=${bets.length}, payouts=${payoutExecutions.length}`;
};

function executePayouts(
  runtime: Runtime<PrivateSettlementConfig>,
  outcome: "YES" | "NO" | "INCONCLUSIVE",
  yesBets: FirestorePrivateBet[],
  noBets: FirestorePrivateBet[],
  yesTotal: bigint,
  noTotal: bigint
): WinnerPayoutExecution[] {
  const isInconclusive = outcome === "INCONCLUSIVE";
  const winnerBets: FirestorePrivateBet[] = isInconclusive
    ? [...yesBets, ...noBets]
    : outcome === "YES"
    ? yesBets
    : noBets;

  if (winnerBets.length === 0) {
    runtime.log("No winners - skipping payouts.");
    return [];
  }

  const loserTotal = isInconclusive ? 0n : outcome === "YES" ? noTotal : yesTotal;
  const winnerTotal = isInconclusive
    ? yesTotal + noTotal
    : outcome === "YES"
    ? yesTotal
    : noTotal;

  const plans: WinnerPayoutPlan[] = winnerBets.map((bet) => ({
    documentId: bet.documentId,
    bettorAddress: bet.bettorAddress,
    tokenAddress: bet.tokenAddress,
    originalAmount: bet.amount,
    payoutAmount:
      isInconclusive || winnerTotal === 0n
        ? bet.amount
        : bet.amount + (bet.amount * loserTotal) / winnerTotal,
  }));

  const executions: WinnerPayoutExecution[] = [];
  for (const plan of plans) {
    try {
      runtime.log(`Paying ${plan.bettorAddress}: ${plan.payoutAmount.toString()} tokens`);
      const execution = payoutWinnerPrivately(runtime, plan);
      executions.push(execution);
      runtime.log(`Payout ok - transferId=${execution.transferId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtime.log(`Payout failed for ${plan.bettorAddress}: ${msg}`);
    }
  }

  return executions;
}

const initWorkflow = (config: PrivateSettlementConfig) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evms[0].chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error("Network not found");
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const topic = keccak256(toHex(settlementRequestedEventSignature));
  return [
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.evms[0].marketAddress],
        topics: [{ values: [topic] }],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onSettlementRequestedLog
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<PrivateSettlementConfig>();
  await runner.run(initWorkflow);
}

main();
