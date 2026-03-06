import { z } from "zod";

const evmConfigSchema = z.object({
  chainSelectorName: z.string().min(1),
  marketAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/u, "marketAddress must be a 0x-prefixed 20-byte hex"),
  tokenAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/u, "tokenAddress must be a 0x-prefixed 20-byte hex")
    .optional(),
  gasLimit: z
    .string()
    .regex(/^\d+$/u, "gasLimit must be a numeric string")
    .refine((value) => Number(value) > 0, { message: "gasLimit must be greater than 0" }),
});

export const privateSettlementConfigSchema = z.object({
  geminiModel: z.string(),
  aceApiBaseUrl: z.string().min(1, "aceApiBaseUrl is required"),
  evms: z.array(evmConfigSchema).min(1, "At least one EVM config is required"),
});

export type PrivateSettlementConfig = z.infer<typeof privateSettlementConfigSchema>;

export const settlementGeminiResponseSchema = z.object({
  result: z.enum(["YES", "NO", "INCONCLUSIVE"]),
  confidence: z.number().int().min(0).max(10_000, "confidence must be between 0 and 10000"),
});

export type SettlementGeminiParsed = z.infer<typeof settlementGeminiResponseSchema>;

export type GeminiResolutionResponse = {
  statusCode: number;
  geminiResponse: string;
  responseId: string;
  rawJsonString: string;
};

export type FirestorePrivateBet = {
  documentId: string;
  marketId: bigint;
  outcome: "YES" | "NO";
  amount: bigint;
  bettorAddress: string;
  tokenAddress: string;
  aggregateTxHash: string;
  createdAt: number;
};

export type FirestoreSettlementAudit = {
  marketId: bigint;
  question: string;
  outcome: "YES" | "NO" | "INCONCLUSIVE";
  confidence: number;
  geminiResponseId: string;
  noTotal: bigint;
  yesTotal: bigint;
  noCount: number;
  yesCount: number;
  payoutCount: number;
  payoutSummaryJson: string;
  requestSettlementTxHash: string;
  settlementTxHash: string;
};

export type PrivateTransferRequest = {
  account: string;
  recipient: string;
  token: string;
  amount: string;
  flags: string[];
  timestamp: number;
  auth: string;
};

export type PrivateTransferResponse = {
  transaction_id?: string;
  id?: string;
  [key: string]: unknown;
};

export type WinnerPayoutPlan = {
  documentId: string;
  bettorAddress: string;
  tokenAddress: string;
  originalAmount: bigint;
  payoutAmount: bigint;
};

export type WinnerPayoutExecution = WinnerPayoutPlan & {
  transferId: string;
  transferResponseJson: string;
};
