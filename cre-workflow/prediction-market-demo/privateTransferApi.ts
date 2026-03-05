import {
  consensusIdenticalAggregation,
  cre,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import type {
  PrivateBetConfig,
  PrivateTransferRequest,
  PrivateTransferResponse,
} from "./privateBetTypes";

export function executePrivateTransfer(
  runtime: Runtime<PrivateBetConfig>,
  payload: PrivateTransferRequest
): PrivateTransferResponse {
  const httpClient = new cre.capabilities.HTTPClient();

  return httpClient
    .sendRequest(
      runtime,
      postPrivateTransfer(payload),
      consensusIdenticalAggregation<PrivateTransferResponse>()
    )(runtime.config)
    .result();
}

const postPrivateTransfer =
  (payload: PrivateTransferRequest) =>
  (sendRequester: HTTPSendRequester, config: PrivateBetConfig): PrivateTransferResponse => {
    const normalizedBaseUrl = config.aceApiBaseUrl.replace(/\/+$/u, "");

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
      url: `${normalizedBaseUrl}/private-transfer`,
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
      throw new Error(`Private transfer API failed with status ${resp.statusCode}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as PrivateTransferResponse;
  };
