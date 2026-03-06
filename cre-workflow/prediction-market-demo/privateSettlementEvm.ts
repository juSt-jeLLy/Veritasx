import {
  TxStatus,
  bytesToHex,
  cre,
  getNetwork,
  hexToBase64,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
} from "viem";
import type { PrivateSettlementConfig } from "./privateSettlementTypes";

type MarketRead = {
  question: string;
  tokenAddress: string;
  closed: boolean;
  status: number;
};

type SettlementWriteInput = {
  marketId: bigint;
  outcome: "YES" | "NO" | "INCONCLUSIVE";
  confidence: number;
  responseId: string;
  noTotal: bigint;
  yesTotal: bigint;
  noCount: bigint;
  yesCount: bigint;
};

export function readMarket(runtime: Runtime<PrivateSettlementConfig>, marketId: bigint): MarketRead {
  const evmConfig = runtime.config.evms[0];
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmConfig.chainSelectorName,
    isTestnet: true,
  });
  if (!network) {
    throw new Error(`Unknown chain: ${evmConfig.chainSelectorName}`);
  }

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const marketAbi = getMarketAbi();
  const callData = encodeFunctionData({
    abi: marketAbi,
    functionName: "getMarket",
    args: [marketId],
  });

  const contractCall = evmClient
    .callContract(runtime, {
      call: {
        from: hexToBase64(zeroAddress),
        to: hexToBase64(evmConfig.marketAddress as `0x${string}`),
        data: hexToBase64(callData),
      },
    })
    .result();

  const decoded = decodeFunctionResult({
    abi: marketAbi,
    functionName: "getMarket",
    data: bytesToHex(contractCall.data),
  }) as {
    question: string;
    tokenAddress: string;
    closed: boolean;
    status: number | bigint;
  };

  return {
    question: decoded.question,
    tokenAddress: decoded.tokenAddress,
    closed: decoded.closed,
    status: Number(decoded.status),
  };
}

export function requestSettlement(runtime: Runtime<PrivateSettlementConfig>, marketId: bigint): string {
  const evmConfig = runtime.config.evms[0];
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmConfig.chainSelectorName,
    isTestnet: true,
  });
  if (!network) {
    throw new Error(`Unknown chain: ${evmConfig.chainSelectorName}`);
  }

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const marketAbi = getMarketAbi();
  const callData = encodeFunctionData({
    abi: marketAbi,
    functionName: "requestSettlement",
    args: [marketId],
  });

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: evmConfig.marketAddress,
      report: { rawReport: callData } as unknown as any,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`requestSettlement failed with status: ${writeResult.txStatus}`);
  }

  return bytesToHex(writeResult.txHash || new Uint8Array(32));
}

export function settleMarketWithAggregates(
  runtime: Runtime<PrivateSettlementConfig>,
  input: SettlementWriteInput
): string {
  const evmConfig = runtime.config.evms[0];
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmConfig.chainSelectorName,
    isTestnet: true,
  });
  if (!network) {
    throw new Error(`Unknown chain: ${evmConfig.chainSelectorName}`);
  }

  const outcomeUint = mapOutcomeToUint(input.outcome);
  const settleParams = parseAbiParameters(
    "uint256 marketId, uint8 outcome, uint16 confidenceBp, string responseId, uint256 noTotal, uint256 yesTotal, uint256 noCount, uint256 yesCount"
  );
  const encodedPayload = encodeAbiParameters(settleParams, [
    input.marketId,
    outcomeUint,
    input.confidence,
    input.responseId,
    input.noTotal,
    input.yesTotal,
    input.noCount,
    input.yesCount,
  ]);
  const reportData = (`0x01${encodedPayload.slice(2)}`) as `0x${string}`;

  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: evmConfig.marketAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`settleMarket failed with status: ${writeResult.txStatus}`);
  }

  return bytesToHex(writeResult.txHash || new Uint8Array(32));
}

const mapOutcomeToUint = (result: SettlementWriteInput["outcome"]): 1 | 2 | 3 => {
  if (result === "NO") return 1;
  if (result === "YES") return 2;
  return 3;
};

const getMarketAbi = () =>
  parseAbi([
    "function getMarket(uint256 marketId) view returns ((string question,address escrowShieldedAddress,address tokenAddress,uint256 marketOpen,uint256 closedAt,bool closed,uint8 status,uint8 outcome,uint256 settledAt,string evidenceURI,uint16 confidenceBps,uint256[2] predTotals,uint256[2] predCounts))",
    "function requestSettlement(uint256 marketId)",
  ]);
