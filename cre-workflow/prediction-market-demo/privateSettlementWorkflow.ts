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
import {
  privateSettlementConfigSchema,
  settlementGeminiResponseSchema,
  type PrivateSettlementConfig,
} from "./privateSettlementTypes";

const settlementRequestedAbi = parseAbi([
  "event SettlementRequested(uint256 indexed marketId, string question)",
]);
const settlementRequestedEventSignature = "SettlementRequested(uint256,string)";

const onSettlementRequestedLog = async (
  runtime: Runtime<PrivateSettlementConfig>,
  log: EVMLog
): Promise<string> => {
  const topics = log.topics.map((topic) => bytesToHex(topic)) as [
    `0x${string}`,
    ...`0x${string}`[],
  ];
  const data = bytesToHex(log.data);
  const decoded = decodeEventLog({ abi: settlementRequestedAbi, data, topics });
  const marketId = decoded.args.marketId as bigint;
  const question = decoded.args.question as string;

  runtime.log(`Private settlement trigger received: marketId=${marketId.toString()}`);
  runtime.log(`Question: ${question}`);

  const geminiResult = askGeminiForSettlement(runtime, marketId.toString(), question);
  const parsedGemini = settlementGeminiResponseSchema.parse(
    JSON.parse(geminiResult.geminiResponse)
  );
  runtime.log(
    `Gemini result: ${parsedGemini.result}, confidence=${parsedGemini.confidence.toString()}`
  );

  const bets = listPrivateBetsByMarket(runtime, marketId);
  runtime.log(`Matched private bets in Firestore: ${bets.length}`);

  const yesBets = bets.filter((bet) => bet.outcome === "YES");
  const noBets = bets.filter((bet) => bet.outcome === "NO");
  const yesTotal = yesBets.reduce((acc, bet) => acc + bet.amount, 0n);
  const noTotal = noBets.reduce((acc, bet) => acc + bet.amount, 0n);
  const payoutCount = parsedGemini.result === "INCONCLUSIVE" ? 0 : (parsedGemini.result === "YES" ? yesBets.length : noBets.length);
  runtime.log(`Winner payouts planned: ${payoutCount} (execution disabled in CRE runtime)`); 

  const settlementTxHash = settleMarketWithAggregates(runtime, {
    marketId,
    outcome: parsedGemini.result,
    confidence: parsedGemini.confidence,
    responseId: geminiResult.responseId,
    noTotal,
    yesTotal,
    noCount: BigInt(noBets.length),
    yesCount: BigInt(yesBets.length),
  });
  runtime.log(`settleMarketWithAggregates tx: ${settlementTxHash}`);

  try {
    const audit = writePrivateSettlementAudit(runtime, {
      marketId,
      question,
      outcome: parsedGemini.result,
      confidence: parsedGemini.confidence,
      geminiResponseId: geminiResult.responseId,
      noTotal,
      yesTotal,
      noCount: noBets.length,
      yesCount: yesBets.length,
      payoutCount,
      payoutSummaryJson: "[]",
      requestSettlementTxHash: bytesToHex(log.txHash),
      settlementTxHash,
    });
    runtime.log(`privateSettlements document: ${audit.name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runtime.log(`Skipping privateSettlements audit write: ${message}`);
  }

  return "private settlement trigger ok";
};

const initWorkflow = (config: PrivateSettlementConfig) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evms[0].chainSelectorName,
    isTestnet: true,
  });
  if (!network) {
    throw new Error(`Network not found for chain selector name: ${config.evms[0].chainSelectorName}`);
  }

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const settlementRequestedTopic = keccak256(toHex(settlementRequestedEventSignature));

  return [
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.evms[0].marketAddress],
        topics: [{ values: [settlementRequestedTopic] }],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onSettlementRequestedLog
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<PrivateSettlementConfig>({
    configSchema: privateSettlementConfigSchema,
  });
  await runner.run(initWorkflow);
}

main();
