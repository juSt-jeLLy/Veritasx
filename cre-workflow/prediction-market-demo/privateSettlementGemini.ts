import {
  consensusIdenticalAggregation,
  cre,
  ok,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import type {
  GeminiResolutionResponse,
  PrivateSettlementConfig,
} from "./privateSettlementTypes";

type GeminiApiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  responseId: string;
};

const systemPrompt = `
You are a fact-checking and event resolution system that determines the real-world outcome of prediction markets.

OUTPUT FORMAT (CRITICAL):
- Return a single minified JSON object with keys in this order:
  {"result":"YES"|"NO"|"INCONCLUSIVE","confidence":<integer 0..10000>}
- If uncertain, return INCONCLUSIVE.
- No markdown, no explanation, no extra keys.
`;

const userPrompt = `Determine the outcome of this market and return strict JSON:\n`;

export function askGeminiForSettlement(
  runtime: Runtime<PrivateSettlementConfig>,
  marketId: string,
  question: string
): GeminiResolutionResponse {
  const geminiApiKey = runtime.getSecret({ id: "GEMINI_API_KEY" }).result();
  const httpClient = new cre.capabilities.HTTPClient();

  return httpClient
    .sendRequest(
      runtime,
      postGeminiRequest({ marketId, question }, geminiApiKey.value),
      consensusIdenticalAggregation<GeminiResolutionResponse>()
    )(runtime.config)
    .result();
}

const postGeminiRequest =
  (details: { marketId: string; question: string }, geminiApiKey: string) =>
  (sendRequester: HTTPSendRequester, config: PrivateSettlementConfig): GeminiResolutionResponse => {
    const dataToSend = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      tools: [{ google_search: {} }],
      contents: [
        {
          parts: [
            {
              text: `${userPrompt}${details.question}`,
            },
          ],
        },
      ],
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(dataToSend));
    const body = Buffer.from(bodyBytes).toString("base64");

    const req = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
      method: "POST" as const,
      body,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      cacheSettings: {
        readFromCache: true,
        maxAgeMs: 60_000,
      },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);

    if (!ok(resp)) {
      throw new Error(`Gemini request failed with status ${resp.statusCode}: ${bodyText}`);
    }

    const parsed = JSON.parse(bodyText) as GeminiApiResponse;
    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Gemini response missing candidates[0].content.parts[0].text");
    }

    return {
      statusCode: resp.statusCode,
      geminiResponse: text,
      responseId: parsed.responseId,
      rawJsonString: bodyText,
    };
  };
