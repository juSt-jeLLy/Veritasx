import {
  consensusIdenticalAggregation,
  cre,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type {
  PrivateSettlementConfig,
  PrivateTransferRequest,
  PrivateTransferResponse,
  WinnerPayoutExecution,
  WinnerPayoutPlan,
} from "./privateSettlementTypes";

const PRIVATE_TRANSFER_DOMAIN = {
  name: "CompliantPrivateTokenDemo",
  version: "0.0.1",
  chainId: 11155111,
  verifyingContract: "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13" as `0x${string}`,
};

const PRIVATE_TRANSFER_TYPES = {
  "Private Token Transfer": [
    { name: "sender", type: "address" },
    { name: "recipient", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "flags", type: "string[]" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

export async function payoutWinnerPrivately(
  runtime: Runtime<PrivateSettlementConfig>,
  plan: WinnerPayoutPlan
): Promise<WinnerPayoutExecution> {
  const escrowPrivateKeySecret = runtime.getSecret({ id: "ESCROW_PRIVATE_KEY" }).result();
  const escrowPrivateKey = asPrivateKey(escrowPrivateKeySecret.value);
  const escrowAccount = privateKeyToAccount(escrowPrivateKey);
  const timestamp = Math.floor(Date.now() / 1000);

  const transferPayload: PrivateTransferRequest = {
    account: escrowAccount.address,
    recipient: plan.bettorAddress,
    token: plan.tokenAddress,
    amount: plan.payoutAmount.toString(),
    flags: [],
    timestamp,
    auth: "",
  };

  transferPayload.auth = await escrowAccount.signTypedData({
    domain: PRIVATE_TRANSFER_DOMAIN,
    types: PRIVATE_TRANSFER_TYPES,
    primaryType: "Private Token Transfer",
    message: {
      sender: transferPayload.account,
      recipient: transferPayload.recipient,
      token: transferPayload.token,
      amount: transferPayload.amount,
      flags: transferPayload.flags,
      timestamp: transferPayload.timestamp,
    },
  });

  const transferResponse = executePrivateTransfer(runtime, transferPayload);
  const transferId = (transferResponse.transaction_id as string | undefined) ??
    (transferResponse.id as string | undefined) ??
    "";

  return {
    ...plan,
    transferId,
    transferResponseJson: JSON.stringify(transferResponse),
  };
}

const executePrivateTransfer = (
  runtime: Runtime<PrivateSettlementConfig>,
  payload: PrivateTransferRequest
): PrivateTransferResponse => {
  const httpClient = new cre.capabilities.HTTPClient();
  return httpClient
    .sendRequest(
      runtime,
      postPrivateTransfer(payload),
      consensusIdenticalAggregation<PrivateTransferResponse>()
    )(runtime.config)
    .result();
};

const postPrivateTransfer =
  (payload: PrivateTransferRequest) =>
  (sendRequester: HTTPSendRequester, config: PrivateSettlementConfig): PrivateTransferResponse => {
    const baseUrl = config.aceApiBaseUrl.replace(/\/+$/u, "");
    const requestBody = {
      account: payload.account,
      recipient: payload.recipient,
      token: payload.token,
      amount: payload.amount,
      flags: payload.flags,
      timestamp: payload.timestamp,
      auth: payload.auth,
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(requestBody));
    const body = Buffer.from(bodyBytes).toString("base64");

    const req = {
      url: `${baseUrl}/private-transfer`,
      method: "POST" as const,
      body,
      headers: {
        "Content-Type": "application/json",
      },
      cacheSettings: {
        readFromCache: false,
        maxAgeMs: 0,
      },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);
    if (!ok(resp)) {
      throw new Error(`Private payout transfer failed with status ${resp.statusCode}: ${bodyText}`);
    }
    return JSON.parse(bodyText) as PrivateTransferResponse;
  };

const asPrivateKey = (value: string): `0x${string}` => {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/u.test(trimmed)) {
    throw new Error("ESCROW_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  return trimmed as `0x${string}`;
};
