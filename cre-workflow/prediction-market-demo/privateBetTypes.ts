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
    .regex(/^\d+$/, "gasLimit must be a numeric string")
    .refine((value) => Number(value) > 0, { message: "gasLimit must be greater than 0" }),
});

export const privateBetConfigSchema = z.object({
  geminiModel: z.string().optional(),
  aceApiBaseUrl: z.string().url("aceApiBaseUrl must be a valid URL"),
  evms: z.array(evmConfigSchema).min(1, "At least one EVM config is required"),
});

export type PrivateBetConfig = z.infer<typeof privateBetConfigSchema>;

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

export type PrivateBetFirestoreRecord = {
  marketId: bigint;
  outcome: "YES" | "NO";
  outcomeIndex: 0 | 1;
  amount: string;
  bettorAddress: string;
  recipient: string;
  tokenAddress: string;
  flags: string[];
  privateTransferId: string;
  privateTransferResponse: string;
  aggregateTxHash: string;
  contractAddress: string;
};
