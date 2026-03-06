import {
  consensusIdenticalAggregation,
  cre,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import type {
  FirestorePrivateBet,
  FirestoreSettlementAudit,
  PrivateSettlementConfig,
} from "./privateSettlementTypes";

type FirebaseAnonymousAuthResponse = {
  idToken: string;
};

type FirestoreListResponse = {
  documents?: Array<{
    name?: string;
    fields?: Record<string, FirestoreTypedValue>;
  }>;
  nextPageToken?: string;
};

type FirestoreWriteResponse = {
  name: string;
  createTime: string;
  updateTime: string;
};

type FirestoreTypedValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
};

export function listPrivateBetsByMarket(
  runtime: Runtime<PrivateSettlementConfig>,
  marketId: bigint
): FirestorePrivateBet[] {
  const firebaseApiKey = runtime.getSecret({ id: "FIREBASE_API_KEY" }).result();
  const firebaseProjectId = runtime.getSecret({ id: "FIREBASE_PROJECT_ID" }).result();

  const httpClient = new cre.capabilities.HTTPClient();
  const auth = httpClient
    .sendRequest(
      runtime,
      postFirebaseAnonymousSignIn(firebaseApiKey.value),
      consensusIdenticalAggregation<FirebaseAnonymousAuthResponse>()
    )(runtime.config)
    .result();

  const matched: FirestorePrivateBet[] = [];
  let nextPageToken: string | undefined;

  do {
    const page = httpClient
      .sendRequest(
        runtime,
        getPrivateBetPage(auth.idToken, firebaseProjectId.value, nextPageToken),
        consensusIdenticalAggregation<FirestoreListResponse>()
      )(runtime.config)
      .result();

    for (const doc of page.documents ?? []) {
      const parsed = parsePrivateBetDocument(doc);
      if (parsed && parsed.marketId === marketId) {
        matched.push(parsed);
      }
    }
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && nextPageToken.length > 0);

  return matched.sort((a, b) => a.createdAt - b.createdAt);
}

export function writePrivateSettlementAudit(
  runtime: Runtime<PrivateSettlementConfig>,
  audit: FirestoreSettlementAudit
): FirestoreWriteResponse {
  const firebaseApiKey = runtime.getSecret({ id: "FIREBASE_API_KEY" }).result();
  const firebaseProjectId = runtime.getSecret({ id: "FIREBASE_PROJECT_ID" }).result();

  const httpClient = new cre.capabilities.HTTPClient();
  const auth = httpClient
    .sendRequest(
      runtime,
      postFirebaseAnonymousSignIn(firebaseApiKey.value),
      consensusIdenticalAggregation<FirebaseAnonymousAuthResponse>()
    )(runtime.config)
    .result();

  return httpClient
    .sendRequest(
      runtime,
      postPrivateSettlementWrite(auth.idToken, firebaseProjectId.value, audit),
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

const getPrivateBetPage =
  (idToken: string, projectId: string, pageToken?: string) =>
  (sendRequester: HTTPSendRequester): FirestoreListResponse => {
    const tokenPart =
      pageToken && pageToken.length > 0 ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const req = {
      url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/privateBets?pageSize=200${tokenPart}`,
      method: "GET" as const,
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
      throw new Error(`Firestore list failed with status ${resp.statusCode}: ${bodyText}`);
    }
    return JSON.parse(bodyText) as FirestoreListResponse;
  };

const postPrivateSettlementWrite =
  (idToken: string, projectId: string, audit: FirestoreSettlementAudit) =>
  (sendRequester: HTTPSendRequester): FirestoreWriteResponse => {
    const documentId = `market-${audit.marketId.toString()}-${Date.now()}`;

    const payload = {
      fields: {
        marketId: { integerValue: audit.marketId.toString() },
        question: { stringValue: audit.question },
        outcome: { stringValue: audit.outcome },
        confidence: { integerValue: audit.confidence.toString() },
        geminiResponseId: { stringValue: audit.geminiResponseId },
        noTotal: { stringValue: audit.noTotal.toString() },
        yesTotal: { stringValue: audit.yesTotal.toString() },
        noCount: { integerValue: audit.noCount.toString() },
        yesCount: { integerValue: audit.yesCount.toString() },
        payoutCount: { integerValue: audit.payoutCount.toString() },
        payoutSummary: { stringValue: audit.payoutSummaryJson },
        requestSettlementTxHash: { stringValue: audit.requestSettlementTxHash },
        settlementTxHash: { stringValue: audit.settlementTxHash },
        createdAt: { integerValue: Date.now() },
      },
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));
    const body = Buffer.from(bodyBytes).toString("base64");

    const req = {
      url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/privateSettlements?documentId=${documentId}`,
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
      throw new Error(`Private settlement write failed with status ${resp.statusCode}: ${bodyText}`);
    }
    return JSON.parse(bodyText) as FirestoreWriteResponse;
  };

const parsePrivateBetDocument = (doc: {
  name?: string;
  fields?: Record<string, FirestoreTypedValue>;
}): FirestorePrivateBet | null => {
  const fields = doc.fields ?? {};
  const marketId = parseBigInt(fields.marketId?.integerValue);
  const outcome = normalizeOutcome(fields.outcome?.stringValue);
  const amount = parseBigInt(fields.amount?.stringValue);
  const bettorAddress = fields.bettorAddress?.stringValue;
  const tokenAddress = fields.tokenAddress?.stringValue;
  const aggregateTxHash = fields.aggregateTxHash?.stringValue ?? "";
  const createdAt = Number(fields.createdAt?.integerValue ?? "0");
  const documentId = doc.name?.split("/").pop() ?? "";

  if (!marketId || !outcome || !amount || !bettorAddress || !tokenAddress || !documentId) {
    return null;
  }

  return {
    documentId,
    marketId,
    outcome,
    amount,
    bettorAddress,
    tokenAddress,
    aggregateTxHash,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
};

const parseBigInt = (value: string | undefined): bigint | null => {
  if (!value || !/^\d+$/u.test(value)) return null;
  return BigInt(value);
};

const normalizeOutcome = (value: string | undefined): "YES" | "NO" | null => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized === "YES") return "YES";
  if (normalized === "NO") return "NO";
  return null;
};
