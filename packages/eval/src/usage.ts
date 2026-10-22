import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk";

export interface SessionMessage {
  info: Message;
  parts: Part[];
}

export interface NormalizedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  turns: number | null;
  toolCalls: number | null;
}

function assistantMessages(
  messages: SessionMessage[],
): Array<AssistantMessage> {
  return messages
    .map((message) => message.info)
    .filter((info): info is AssistantMessage => info.role === "assistant");
}

function hasReportedTokens(message: AssistantMessage): boolean {
  const tokens = message.tokens;
  return (
    tokens.input > 0 ||
    tokens.output > 0 ||
    tokens.reasoning > 0 ||
    tokens.cache.read > 0 ||
    tokens.cache.write > 0
  );
}

/**
 * OpenCode always exposes numeric token fields, so an all-zero token block is
 * treated as "the provider did not report usage". Missing usage must stay null,
 * never become a zero that would make tokens-per-solved look better than it is.
 */
export function normalizeUsage(messages: SessionMessage[]): NormalizedUsage {
  const assistants = assistantMessages(messages);
  const toolCalls = messages.reduce(
    (count, message) =>
      count + message.parts.filter((part) => part.type === "tool").length,
    0,
  );

  if (assistants.length === 0) {
    return {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      costUsd: null,
      turns: 0,
      toolCalls,
    };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  let costUsd = 0;
  let usageReported = true;
  let costReported = true;

  for (const message of assistants) {
    if (!hasReportedTokens(message)) {
      usageReported = false;
      continue;
    }

    const tokens = message.tokens;
    inputTokens += tokens.input;
    outputTokens += tokens.output;
    cachedInputTokens += tokens.cache.read;
    reasoningTokens += tokens.reasoning;

    if (typeof message.cost === "number" && Number.isFinite(message.cost)) {
      costUsd += message.cost;
    } else {
      costReported = false;
    }
  }

  return {
    inputTokens: usageReported ? inputTokens : null,
    outputTokens: usageReported ? outputTokens : null,
    cachedInputTokens: usageReported ? cachedInputTokens : null,
    reasoningTokens: usageReported ? reasoningTokens : null,
    costUsd: usageReported && costReported ? costUsd : null,
    turns: assistants.length,
    toolCalls,
  };
}

export function emptyUsage(): NormalizedUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    costUsd: null,
    turns: null,
    toolCalls: null,
  };
}
