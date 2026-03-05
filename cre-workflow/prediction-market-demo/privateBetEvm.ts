import {
  bytesToHex,
  cre,
  getNetwork,
  hexToBase64,
  TxStatus,
  type Runtime,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { PrivateBetConfig } from "./privateBetTypes";

const UPDATE_AGGREGATES_PARAMS = parseAbiParameters(
  "uint256 marketId, uint8 outcomeIndex, uint256 amount"
);

export function writePrivateBetAggregate(
  runtime: Runtime<PrivateBetConfig>,
  marketId: bigint,
  outcomeIndex: 0 | 1,
  amount: bigint
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

  const encodedPayload = encodeAbiParameters(UPDATE_AGGREGATES_PARAMS, [
    marketId,
    outcomeIndex,
    amount,
  ]);
  // Prefix 0x02 so SimpleMarket routes report to aggregate update logic.
  const reportData = (`0x02${encodedPayload.slice(2)}`) as `0x${string}`;

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
    throw new Error(`Aggregate update transaction failed with status: ${writeResult.txStatus}`);
  }

  return bytesToHex(writeResult.txHash || new Uint8Array(32));
}
