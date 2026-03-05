import { decodeJson, type HTTPPayload, type Runtime } from "@chainlink/cre-sdk";
import { isAddress } from "viem";
import { writePrivateBetAggregate } from "./privateBetEvm";
import { writePrivateBetToFirestore } from "./privateBetFirestore";
import { executePrivateTransfer } from "./privateTransferApi";
import type {
  PrivateBetConfig,
  PrivateTransferRequest,
} from "./privateBetTypes";

type PrivateBetInput = {
  marketId: string | number;
  amount: string;
  outcome?: string;
  outcomeIndex?: number | string;
  account?: string;
  bettorAddress?: string;
  recipient?: string;
  escrowAddress?: string;
  tokenAddress?: string;
  flags?: string[];
  timestamp: string | number;
  auth: string;
};

export function onPrivateBetHttpTrigger(
  runtime: Runtime<PrivateBetConfig>,
  payload: HTTPPayload
): string {
  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  runtime.log("CRE Workflow: HTTP Trigger - Private Bet");
  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (!payload.input || payload.input.length === 0) {
    throw new Error("Empty request payload");
  }

  const inputData = decodeJson(payload.input) as PrivateBetInput;

  const marketId = parseBigIntField(inputData.marketId, "marketId");
  const amount = parseBigIntField(inputData.amount, "amount");
  if (amount <= 0n) {
    throw new Error("amount must be greater than 0");
  }

  const bettorAddress = inputData.account ?? inputData.bettorAddress;
  if (!bettorAddress || !isAddress(bettorAddress)) {
    throw new Error("account (or bettorAddress) must be a valid EVM address");
  }

  const recipient = inputData.recipient ?? inputData.escrowAddress;
  if (!recipient || !isAddress(recipient)) {
    throw new Error("recipient (or escrowAddress) must be a valid EVM address");
  }

  const tokenAddress = inputData.tokenAddress ?? runtime.config.evms[0].tokenAddress;
  if (!tokenAddress || !isAddress(tokenAddress)) {
    throw new Error("tokenAddress must be provided in payload or config and be a valid EVM address");
  }

  const timestamp = parseTimestamp(inputData.timestamp);
  const auth = requiredString(inputData.auth, "auth");
  if (!auth.startsWith("0x")) {
    throw new Error("auth must be a 0x-prefixed signature string");
  }

  const flags = normalizeFlags(inputData.flags);
  const outcomeIndex = parseOutcomeIndex(inputData.outcomeIndex, inputData.outcome);
  const outcomeLabel: "YES" | "NO" = outcomeIndex === 1 ? "YES" : "NO";

  runtime.log(`[Step 1] Parsed private bet input for marketId=${marketId.toString()}`);
  runtime.log(`[Step 1] Bettor=${bettorAddress}, recipient=${recipient}, token=${tokenAddress}`);
  runtime.log(`[Step 1] amount=${amount.toString()}, outcome=${outcomeLabel}, flags=${JSON.stringify(flags)}`);

  const privateTransferRequest: PrivateTransferRequest = {
    account: bettorAddress,
    recipient,
    token: tokenAddress,
    amount: amount.toString(),
    flags,
    timestamp,
    auth,
  };

  runtime.log("[Step 2] Executing private transfer via API...");
  const privateTransferResponse = executePrivateTransfer(runtime, privateTransferRequest);

  const privateTransferId = (
    (privateTransferResponse.transaction_id as string | undefined) ??
    (privateTransferResponse.id as string | undefined) ??
    ""
  );
  runtime.log(
    `[Step 2] Private transfer completed. transaction_id=${privateTransferId || "unavailable"}`
  );

  runtime.log("[Step 3] Updating aggregate pool totals onchain...");
  const aggregateTxHash = writePrivateBetAggregate(runtime, marketId, outcomeIndex, amount);
  runtime.log(`[Step 3] Aggregate update tx hash: ${aggregateTxHash}`);

  runtime.log("[Step 4] Writing private bet audit document to Firestore...");
  const firestoreResult = writePrivateBetToFirestore(runtime, {
    marketId,
    outcome: outcomeLabel,
    outcomeIndex,
    amount: amount.toString(),
    bettorAddress,
    recipient,
    tokenAddress,
    flags,
    privateTransferId: privateTransferId || `private-transfer-${timestamp}`,
    privateTransferResponse: JSON.stringify(privateTransferResponse),
    aggregateTxHash,
    contractAddress: runtime.config.evms[0].marketAddress,
  });
  runtime.log(`[Step 4] Firestore document: ${firestoreResult.name}`);

  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return aggregateTxHash;
}

const parseBigIntField = (value: string | number, fieldName: string): bigint => {
  const valueAsString = typeof value === "number" ? value.toString() : requiredString(value, fieldName);
  if (!/^\d+$/u.test(valueAsString)) {
    throw new Error(`${fieldName} must be a positive integer string`);
  }
  return BigInt(valueAsString);
};

const parseTimestamp = (value: string | number): number => {
  const valueAsString = typeof value === "number" ? value.toString() : requiredString(value, "timestamp");
  if (!/^\d+$/u.test(valueAsString)) {
    throw new Error("timestamp must be a numeric value");
  }
  const parsed = Number(valueAsString);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("timestamp must be a valid positive number");
  }
  return parsed;
};

const normalizeFlags = (value: string[] | undefined): string[] => {
  if (!value) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
};

const parseOutcomeIndex = (
  explicitOutcomeIndex: number | string | undefined,
  outcome: string | undefined
): 0 | 1 => {
  if (explicitOutcomeIndex !== undefined) {
    if (explicitOutcomeIndex === 0 || explicitOutcomeIndex === "0") return 0;
    if (explicitOutcomeIndex === 1 || explicitOutcomeIndex === "1") return 1;
    throw new Error("outcomeIndex must be 0 (NO) or 1 (YES)");
  }

  const normalized = (outcome ?? "").trim().toUpperCase();
  if (normalized === "NO") return 0;
  if (normalized === "YES") return 1;

  throw new Error('Provide outcomeIndex (0/1) or outcome ("YES"/"NO")');
};

const requiredString = (value: string | undefined, fieldName: string): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
};
