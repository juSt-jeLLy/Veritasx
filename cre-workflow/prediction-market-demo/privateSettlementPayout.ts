import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  consensusIdenticalAggregation,
  cre,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { hashTypedData, hexToBytes, bytesToHex as viemBytesToHex } from "viem";
import type {
  PrivateSettlementConfig,
  PrivateTransferRequest,
  PrivateTransferResponse,
  WinnerPayoutExecution,
  WinnerPayoutPlan,
} from "./privateSettlementTypes";

// ─────────────────────────────────────────────────────────────────────────────
// secp256k1 curve parameters (pure BigInt — no @noble/curves import needed)
// ─────────────────────────────────────────────────────────────────────────────
const P = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const Gx = BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240");
const Gy = BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424");

type Point = { x: bigint; y: bigint } | null;

function modP(n: bigint): bigint { return ((n % P) + P) % P; }
function modN(n: bigint): bigint { return ((n % N) + N) % N; }

function invMod(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % m) + m) % m;
}

function pointAdd(p1: Point, p2: Point): Point {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x) {
    if (p1.y !== p2.y) return null;
    const lam = modP(3n * p1.x * p1.x * invMod(2n * p1.y, P));
    const x3 = modP(lam * lam - 2n * p1.x);
    return { x: x3, y: modP(lam * (p1.x - x3) - p1.y) };
  }
  const lam = modP((p2.y - p1.y) * invMod(modP(p2.x - p1.x), P));
  const x3 = modP(lam * lam - p1.x - p2.x);
  return { x: x3, y: modP(lam * (p1.x - x3) - p1.y) };
}

function scalarMul(k: bigint, point: { x: bigint; y: bigint }): Point {
  let result: Point = null;
  let addend: Point = point;
  let n = k;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

/** Deterministic k via HMAC-SHA256 (simplified RFC6979-like) */
function deterministicK(privKey: Uint8Array, msgHash: Uint8Array): bigint {
  const v = new Uint8Array(32).fill(1);
  let k = new Uint8Array(32).fill(0);
  const concat = (...arrs: Uint8Array[]) => {
    const len = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
  };
  const hmac = (key: Uint8Array, ...data: Uint8Array[]) => {
    const blockSize = 64;
    let keyPad = key.length > blockSize ? sha256(key) : key;
    if (keyPad.length < blockSize) {
      const tmp = new Uint8Array(blockSize);
      tmp.set(keyPad);
      keyPad = tmp;
    }
    const opad = new Uint8Array(blockSize).map((_, i) => keyPad[i] ^ 0x5c);
    const ipad = new Uint8Array(blockSize).map((_, i) => keyPad[i] ^ 0x36);
    return sha256(concat(opad, sha256(concat(ipad, ...data))));
  };
  k = hmac(k, v, new Uint8Array([0]), privKey, msgHash);
  const vv = hmac(k, v);
  k = hmac(k, vv, new Uint8Array([1]), privKey, msgHash);
  let candidate = hmac(k, hmac(k, vv));
  for (let attempt = 0; attempt < 10; attempt++) {
    const kInt = BigInt("0x" + Array.from(candidate).map(b => b.toString(16).padStart(2, "0")).join(""));
    if (kInt > 0n && kInt < N) return kInt;
    k = hmac(k, candidate, new Uint8Array([0]));
    candidate = hmac(k, hmac(k, candidate));
  }
  throw new Error("Failed to generate deterministic k");
}

/** Derive Ethereum address from raw private key bytes — pure BigInt */
function deriveAddress(privateKeyHex: `0x${string}`): `0x${string}` {
  const privBytes = hexToBytes(privateKeyHex);
  const privKeyInt = BigInt("0x" + Array.from(privBytes).map(b => b.toString(16).padStart(2, "0")).join(""));
  const pub = scalarMul(privKeyInt, { x: Gx, y: Gy });
  if (!pub) throw new Error("Invalid private key");
  const xBytes = bigIntTo32Bytes(pub.x);
  const yBytes = bigIntTo32Bytes(pub.y);
  const pubKeyBody = new Uint8Array(64);
  pubKeyBody.set(xBytes, 0);
  pubKeyBody.set(yBytes, 32);
  const hash = keccak_256(pubKeyBody);
  const addrHex = Array.from(hash.slice(12)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `0x${addrHex}` as `0x${string}`;
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const PRIVATE_TRANSFER_DOMAIN = {
  name: "CompliantPrivateTokenDemo",
  version: "0.0.1",
  chainId: 11155111,
  verifyingContract: "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13" as `0x${string}`,
} as const;

const PRIVATE_TRANSFER_TYPES = {
  "Private Token Transfer": [
    { name: "sender",    type: "address" },
    { name: "recipient", type: "address" },
    { name: "token",     type: "address" },
    { name: "amount",    type: "uint256" },
    { name: "flags",     type: "string[]" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

/** Signs EIP-712 payload using pure BigInt secp256k1 — no @noble/curves */
function signEip712Sync(
  privateKeyHex: `0x${string}`,
  sender: `0x${string}`,
  recipient: `0x${string}`,
  token: `0x${string}`,
  amount: string,
  flags: string[],
  timestamp: number
): `0x${string}` {
  const typedDataHash = hashTypedData({
    domain: PRIVATE_TRANSFER_DOMAIN,
    types: PRIVATE_TRANSFER_TYPES,
    primaryType: "Private Token Transfer",
    message: { sender, recipient, token, amount, flags, timestamp },
  });

  const msgHash = hexToBytes(typedDataHash);
  const privBytes = hexToBytes(privateKeyHex);
  const privKeyInt = BigInt("0x" + Array.from(privBytes).map(b => b.toString(16).padStart(2, "0")).join(""));
  const z = BigInt("0x" + Array.from(msgHash).map(b => b.toString(16).padStart(2, "0")).join(""));

  const k = deterministicK(privBytes, msgHash);
  const R = scalarMul(k, { x: Gx, y: Gy });
  if (!R) throw new Error("ECDSA: R is null");

  const r = modN(R.x);
  const s = modN(invMod(k, N) * (z + r * privKeyInt));

  const rHex = r.toString(16).padStart(64, "0");
  const sHex = s.toString(16).padStart(64, "0");
  const v = R.y % 2n === 0n ? "1b" : "1c";
  return `0x${rHex}${sHex}${v}` as `0x${string}`;
}

/**
 * Executes a single private payout from the escrow to a winner.
 * Uses pure BigInt secp256k1 — no @noble/curves module-level init.
 */
export function payoutWinnerPrivately(
  runtime: Runtime<PrivateSettlementConfig>,
  plan: WinnerPayoutPlan
): WinnerPayoutExecution {
  const escrowPrivateKeySecret = runtime.getSecret({ id: "ESCROW_PRIVATE_KEY" }).result();
  const escrowPrivateKey = asPrivateKey(escrowPrivateKeySecret.value);

  const escrowAddress = deriveAddress(escrowPrivateKey);
  const timestamp = Math.floor(Date.now() / 1000);

  const auth = signEip712Sync(
    escrowPrivateKey,
    escrowAddress,
    plan.bettorAddress as `0x${string}`,
    plan.tokenAddress as `0x${string}`,
    plan.payoutAmount.toString(),
    [],
    timestamp
  );

  const transferPayload: PrivateTransferRequest = {
    account: escrowAddress,
    recipient: plan.bettorAddress,
    token: plan.tokenAddress,
    amount: plan.payoutAmount.toString(),
    flags: [],
    timestamp,
    auth,
  };

  const transferResponse = executePrivateTransfer(runtime, transferPayload);
  const transferId =
    (transferResponse.transaction_id as string | undefined) ??
    (transferResponse.id as string | undefined) ??
    "";

  return {
    ...plan,
    transferId,
    transferResponseJson: JSON.stringify(transferResponse),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

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
      headers: { "Content-Type": "application/json" },
      cacheSettings: { readFromCache: false, maxAgeMs: 0 },
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
