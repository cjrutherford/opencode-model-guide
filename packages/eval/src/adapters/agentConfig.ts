import type { EvalModel } from "@omg/shared";

const FALLBACK_CONTEXT = 32_768;
const FALLBACK_OUTPUT = 8_192;
const MAX_OUTPUT = 32_768;
const REQUEST_TIMEOUT_MS = 300_000;

export interface AgentModelMetadata {
  output?: number;
  reasoning?: boolean;
  attachment?: boolean;
  toolCall?: boolean;
  releaseDate?: string;
}

export interface AgentConfigOptions {
  model: EvalModel;
  metadata?: AgentModelMetadata;
  /**
   * Test-only: point a custom OpenAI-compatible provider at a local fake
   * server. Production attempts use the built-in `opencode` provider so the
   * free-tier client gate sees a native OpenCode request.
   */
  providerBaseUrl?: string;
  /** Test-only custom-provider key. Production reads OPENCODE_API_KEY from env. */
  apiKey?: string;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function commonConfig(): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    snapshot: false,
    share: "disabled",
    autoupdate: false,
    lsp: false,
    formatter: false,
    permission: {
      edit: "allow",
      bash: "allow",
      webfetch: "deny",
      external_directory: "deny",
    },
    tools: {
      webfetch: false,
      websearch: false,
      task: false,
    },
  };
}

/**
 * Build a minimal OpenCode config for one eval attempt. The config lives
 * outside `/workspace`, so it never appears in the captured patch.
 *
 * Production uses the built-in `opencode` provider. The free tier rejects raw
 * OpenAI-compatible requests even with a valid key, so the request must come
 * from OpenCode itself. The key is supplied to the agent container through
 * `OPENCODE_API_KEY`; it is referenced here as an environment placeholder and
 * never written into the config file.
 */
export function buildAgentConfig(
  options: AgentConfigOptions,
): Record<string, unknown> {
  const { model, metadata, providerBaseUrl, apiKey } = options;
  const modelID = `opencode/${model.id}`;

  if (providerBaseUrl) {
    const context = positiveLimit(model.context, FALLBACK_CONTEXT);
    const output = Math.min(
      MAX_OUTPUT,
      positiveLimit(metadata?.output, FALLBACK_OUTPUT),
    );

    return {
      ...commonConfig(),
      enabled_providers: ["eval"],
      model: `eval/${model.id}`,
      small_model: `eval/${model.id}`,
      provider: {
        eval: {
          npm: "@ai-sdk/openai-compatible",
          name: "Eval",
          options: {
            baseURL: providerBaseUrl,
            apiKey: apiKey ?? "eval-dummy-key",
            timeout: REQUEST_TIMEOUT_MS,
          },
          models: {
            [model.id]: {
              name: model.name,
              release_date: metadata?.releaseDate,
              attachment: metadata?.attachment ?? false,
              reasoning: metadata?.reasoning ?? false,
              tool_call: metadata?.toolCall ?? true,
              cost: { input: 0, output: 0 },
              limit: { context, output },
            },
          },
        },
      },
    };
  }

  return {
    ...commonConfig(),
    enabled_providers: ["opencode"],
    model: modelID,
    small_model: modelID,
    provider: {
      opencode: {
        options: {
          apiKey: "{env:OPENCODE_API_KEY}",
          timeout: REQUEST_TIMEOUT_MS,
        },
      },
    },
  };
}
