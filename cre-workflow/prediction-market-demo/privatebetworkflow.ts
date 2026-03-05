import { cre, Runner } from "@chainlink/cre-sdk";
import { onPrivateBetHttpTrigger } from "./privateBetHttpCallback";
import { type PrivateBetConfig } from "./privateBetTypes";

const initWorkflow = (config: PrivateBetConfig) => {
  const httpCapability = new cre.capabilities.HTTPCapability();
  const httpTrigger = httpCapability.trigger({});

  return [cre.handler(httpTrigger, onPrivateBetHttpTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<PrivateBetConfig>();
  await runner.run(initWorkflow);
}

main();
