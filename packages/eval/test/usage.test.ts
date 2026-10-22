import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";

import { normalizeOpenAIUsage, normalizeUsage, type SessionMessage } from "../src/usage";

function assistant(
  tokens: AssistantMessage["tokens"] = {
    input: 10,
    output: 5,
    reasoning: 0,
    cache: { read: 2, write: 1 },
  },
  cost = 0,
): AssistantMessage {
  return {
    id: "msg",
    sessionID: "ses",
    role: "assistant",
    time: { created: 0, completed: 1 },
    parentID: "parent",
    modelID: "model",
    providerID: "eval",
    mode: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost,
    tokens,
  } as unknown as AssistantMessage;
}

function toolPart(): Part {
  return {
    id: "part",
    sessionID: "ses",
    messageID: "msg",
    type: "tool",
    callID: "call",
    tool: "bash",
    state: {
      status: "completed",
      input: {},
      output: "ok",
      title: "bash",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  } as unknown as Part;
}

function sessionMessage(info: Message, parts: Part[] = []): SessionMessage {
  return { info, parts };
}

describe("normalizeUsage", () => {
  it("sums assistant usage and counts turns and tool calls", () => {
    const usage = normalizeUsage([
      sessionMessage(assistant(), [toolPart()]),
      sessionMessage(assistant({
        input: 20,
        output: 7,
        reasoning: 3,
        cache: { read: 4, write: 2 },
      }, 0)),
      sessionMessage({
        id: "user",
        sessionID: "ses",
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: { providerID: "eval", modelID: "model" },
      } as Message),
    ]);

    expect(usage).toEqual({
      inputTokens: 30,
      outputTokens: 12,
      cachedInputTokens: 6,
      reasoningTokens: 3,
      costUsd: 0,
      turns: 2,
      toolCalls: 1,
    });
  });

  it("keeps missing usage null instead of turning it into zero", () => {
    const usage = normalizeUsage([
      sessionMessage(assistant({
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      })),
    ]);

    expect(usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      costUsd: null,
      turns: 1,
      toolCalls: 0,
    });
  });

  it("returns null usage when no assistant message was recorded", () => {
    const usage = normalizeUsage([]);
    expect(usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      costUsd: null,
      turns: 0,
      toolCalls: 0,
    });
  });
});

describe("normalizeOpenAIUsage", () => {
  it("normalizes a chat completion usage block", () => {
    expect(
      normalizeOpenAIUsage({
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 20,
      reasoningTokens: 5,
      costUsd: 0,
      turns: 1,
      toolCalls: 0,
    });
  });

  it("keeps a missing or all-zero usage block null", () => {
    const missing = {
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      costUsd: null,
      turns: 1,
      toolCalls: 0,
    };
    expect(normalizeOpenAIUsage(undefined)).toEqual(missing);
    expect(
      normalizeOpenAIUsage({ prompt_tokens: 0, completion_tokens: 0 }),
    ).toEqual(missing);
  });
});
