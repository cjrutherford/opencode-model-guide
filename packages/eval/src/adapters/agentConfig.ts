import type { EvalModel } from "@omg/shared";

const FALLBACK_CONTEXT = 32_768;
const FALLBACK_OUTPUT = 8_192;
const MAX_OUTPUT = 32_768;

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
  providerBaseUrl: string;
  apiKey: string;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

/**
 * Build a minimal OpenCode config for one eval attempt. The config lives
 * outside `/workspace`, so it never appears in the captured patch. Only the
 * custom `eval` provider is enabled; every other provider is ignored.
 */
export function buildAgentConfig(
  options: AgentConfigOptions,
): Record<string, unknown> {
  const { model, metadata, providerBaseUrl, apiKey } = options;
  const context = positiveLimit(model.context, FALLBACK_CONTEXT);
  const output = Math.min(
    MAX_OUTPUT,
    positiveLimit(metadata?.output, FALLBACK_OUTPUT),
  );
  const modelID = `eval/${model.id}`;

  return {
    $schema: "https://opencode.ai/config.json",
    enabled_providers: ["eval"],
    model: modelID,
    small_model: modelID,
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
    provider: {
      eval: {
        npm: "@ai-sdk/openai-compatible",
        name: "Eval",
        options: {
          baseURL: providerBaseUrl,
          apiKey,
          timeout: 300_000,
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
