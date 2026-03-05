import {
  consensusIdenticalAggregation,
  cre,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import type {
  PrivateBetConfig,
  PrivateBetFirestoreRecord,
} from "./privateBetTypes";

type FirebaseAnonymousAuthResponse = {
  idToken: string;
};

type FirestoreWriteResponse = {
  name: string;
  createTime: string;
  updateTime: string;
};

export function writePrivateBetToFirestore(
  runtime: Runtime<PrivateBetConfig>,
  record: PrivateBetFirestoreRecord
): FirestoreWriteResponse {
  const firebaseApiKey = runtime.getSecret({ id: "FIREBASE_API_KEY" }).result();
  const firebaseProjectId = runtime.getSecret({ id: "FIREBASE_PROJECT_ID" }).result();

  const httpClient = new cre.capabilities.HTTPClient();

  const authToken = httpClient
    .sendRequest(
      runtime,
      postFirebaseAnonymousSignIn(firebaseApiKey.value),
      consensusIdenticalAggregation<FirebaseAnonymousAuthResponse>()
    )(runtime.config)
    .result();

  return httpClient
    .sendRequest(
      runtime,
      postFirestorePrivateBetWrite(authToken.idToken, firebaseProjectId.value, record),
      consensusIdenticalAggregation<FirestoreWriteResponse>()
    )(runtime.config)
    .result();
}

const postFirebaseAnonymousSignIn =
  (firebaseApiKey: string) =>
  (sendRequester: HTTPSendRequester): FirebaseAnonymousAuthResponse => {
    const payload = {
      returnSecureToken: true,
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));
    const body = Buffer.from(bodyBytes).toString("base64");

    const req = {
      url: `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseApiKey}`,
      method: "POST" as const,
      body,
      headers: {
        "Content-Type": "application/json",
      },
      cacheSettings: {
        readFromCache: true,
        maxAgeMs: 60_000,
      },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);

    if (!ok(resp)) {
      throw new Error(`Firebase sign-in failed with status ${resp.statusCode}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as FirebaseAnonymousAuthResponse;
  };

const postFirestorePrivateBetWrite =
  (idToken: string, projectId: string, record: PrivateBetFirestoreRecord) =>
  (sendRequester: HTTPSendRequester): FirestoreWriteResponse => {
    const documentId = makeSafeDocId(
      record.privateTransferId || `${record.marketId.toString()}-${Date.now()}`
    );

    const payload = {
      fields: {
        marketId: { integerValue: record.marketId.toString() },
        outcome: { stringValue: record.outcome },
        outcomeIndex: { integerValue: record.outcomeIndex.toString() },
        amount: { stringValue: record.amount },
        bettorAddress: { stringValue: record.bettorAddress },
        recipient: { stringValue: record.recipient },
        tokenAddress: { stringValue: record.tokenAddress },
        flags: { stringValue: JSON.stringify(record.flags) },
        privateTransferId: { stringValue: record.privateTransferId },
        privateTransferResponse: { stringValue: record.privateTransferResponse },
        aggregateTxHash: { stringValue: record.aggregateTxHash },
        contractAddress: { stringValue: record.contractAddress },
        createdAt: { integerValue: Date.now() },
      },
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));
    const body = Buffer.from(bodyBytes).toString("base64");

    const req = {
      url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/privateBets?documentId=${documentId}`,
      method: "POST" as const,
      body,
      headers: {
        Authorization: `Bearer ${idToken}`,
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
      throw new Error(`Firestore write failed with status ${resp.statusCode}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as FirestoreWriteResponse;
  };

const makeSafeDocId = (value: string): string => {
  if (!value) return `private-bet-${Date.now()}`;
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 120);
};
