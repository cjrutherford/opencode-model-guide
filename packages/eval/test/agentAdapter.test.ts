import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EvalModel } from "@omg/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AgentAbortError,
  runAgentAttempt,
  type AgentAttemptOptions,
} from "../src/adapters/agent";
import { buildAgentConfig } from "../src/adapters/agentConfig";
import {
  containerExists,
  ensureControlNetwork,
  ensureNetwork,
  inspectImage,
  removeNetwork,
  uniqueName,
} from "../src/sandbox/docker";
import {
  startFakeOpenAI,
  type FakeOpenAIHandle,
  type FakeOpenAIMode,
} from "./fakeOpenAI";

const IMAGE = process.env.OMG_EVAL_IMAGE ?? "omg-eval-sandbox:local";
const imageAvailable = (await inspectImage(IMAGE)) !== null;

const MODEL: EvalModel = {
  modelKey: "opencode/test-free",
  name: "Test Free",
  provider: "opencode",
  id: "test-free",
  freeKind: "limited-time",
  context: 200_000,
  inputPrice: 0,
  outputPrice: 0,
};

describe("buildAgentConfig", () => {
  it("builds one isolated eval provider and keeps the config out of the workspace", () => {
    const config = buildAgentConfig({
      model: MODEL,
      metadata: { output: 999_999, reasoning: true, toolCall: true },
      providerBaseUrl: "http://egress:8787/v1",
      apiKey: "dummy",
    });

    expect(config).toMatchObject({
      enabled_providers: ["eval"],
      model: "eval/test-free",
      small_model: "eval/test-free",
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
          options: {
            baseURL: "http://egress:8787/v1",
            apiKey: "dummy",
          },
          models: {
            "test-free": {
              limit: { context: 200_000, output: 32_768 },
              cost: { input: 0, output: 0 },
              tool_call: true,
              reasoning: true,
            },
          },
        },
      },
    });
  });

  it("uses the native opencode provider and an env placeholder in production", () => {
    const config = buildAgentConfig({
      model: MODEL,
      metadata: { output: 32_000, reasoning: true, toolCall: true },
    });

    expect(config).toMatchObject({
      enabled_providers: ["opencode"],
      model: "opencode/test-free",
      small_model: "opencode/test-free",
      provider: {
        opencode: {
          options: {
            apiKey: "{env:OPENCODE_API_KEY}",
          },
        },
      },
    });
    expect(config).not.toHaveProperty("provider.eval");
  });

  it("falls back for a zero context and caps output", () => {
    const config = buildAgentConfig({
      model: { ...MODEL, context: 0 },
      metadata: { output: 1_000 },
      providerBaseUrl: "http://fake-llm:4097/v1",
      apiKey: "dummy",
    });

    const model = (
      config.provider as {
        eval: { models: Record<string, { limit: { context: number; output: number } }> };
      }
    ).eval.models["test-free"];
    expect(model).toBeDefined();
    expect(model!.limit).toEqual({ context: 32_768, output: 1_000 });
  });
});

describe.skipIf(!imageAvailable)("agent adapter", { timeout: 30_000 }, () => {
  let root = "";
  let network = "";
  let controlNetwork = "";
  let fake: FakeOpenAIHandle | null = null;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "omg-agent-test-"));
    network = uniqueName("omg-agent-test-net");
    controlNetwork = uniqueName("omg-agent-test-control");
    await ensureNetwork(network);
    await ensureControlNetwork(controlNetwork);
  });

  afterEach(async () => {
    await fake?.stop();
    fake = null;
  });

  afterAll(async () => {
    await fake?.stop();
    await removeNetwork(network);
    await removeNetwork(controlNetwork);
    await rm(root, { recursive: true, force: true });
  });

  async function makeWorkspace(name: string): Promise<string> {
    const workspace = join(root, name);
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      '{"name":"agent-test","private":true,"type":"module"}\n',
    );
    await writeFile(join(workspace, "src/value.js"), "export const value = 1;\n");
    return workspace;
  }

  async function run(
    mode: FakeOpenAIMode,
    overrides: Partial<AgentAttemptOptions> = {},
  ) {
    fake = await startFakeOpenAI({ network, mode });
    const attemptId = uniqueName("attempt");
    const workspace = await makeWorkspace(attemptId);
    const captureDir = join(root, `${attemptId}-capture`);
    const containerName = uniqueName("omg-agent-test-container");
    const result = await runAgentAttempt({
      attemptId,
      model: MODEL,
      prompt:
        "Fix src/value.js so value is 2. Use the bash tool to edit it, then reply done.",
      workspaceDir: workspace,
      captureDir,
      image: IMAGE,
      network,
      controlNetwork,
      timeoutMs: 20_000,
      providerBaseUrl: fake.url,
      modelMetadata: { output: 32_000, reasoning: true, toolCall: true },
      containerName,
      ...overrides,
    });
    return { result, captureDir, containerName };
  }

  it("starts the server, creates a session, completes a prompt, and captures usage", async () => {
    const { result, captureDir } = await run("text");

    expect(result.status).toBe("completed");
    expect(result.error).toBeNull();
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.usage.costUsd).toBe(0);
    expect(result.usage.turns).toBeGreaterThan(0);
    expect(result.usage.toolCalls).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(
      await readFile(join(captureDir, "src/value.js"), "utf8"),
    ).toBe("export const value = 1;\n");
    expect(
      await readFile(join(captureDir, "package.json"), "utf8"),
    ).toContain("agent-test");
  });

  it("executes a tool call from the model and captures the edited workspace", async () => {
    const { result, captureDir } = await run("edit");

    expect(result.status).toBe("completed");
    expect(result.usage.toolCalls).toBe(1);
    expect(result.usage.turns).toBeGreaterThanOrEqual(2);
    expect(
      await readFile(join(captureDir, "src/value.js"), "utf8"),
    ).toBe("export const value = 2;\n");
    await expect(
      readFile(join(captureDir, "opencode.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("keeps missing usage null", async () => {
    const { result } = await run("no_usage");

    expect(result.status).toBe("completed");
    expect(result.usage.inputTokens).toBeNull();
    expect(result.usage.outputTokens).toBeNull();
    expect(result.usage.costUsd).toBeNull();
  });

  it("copies the workspace out and records timeout when the attempt exceeds its deadline", async () => {
    const { result, captureDir, containerName } = await run("timeout", {
      timeoutMs: 2_000,
    });

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("timed out");
    expect(
      await readFile(join(captureDir, "src/value.js"), "utf8"),
    ).toBe("export const value = 1;\n");
    expect(await containerExists(containerName)).toBe(false);
  }, 20_000);

  it.each(["auth", "forbidden"] as const)(
    "aborts without a publishable result on %s",
    async (mode) => {
      fake = await startFakeOpenAI({ network, mode });
      const attemptId = uniqueName("attempt");
      const workspace = await makeWorkspace(attemptId);
      const containerName = uniqueName("omg-agent-test-container");

      await expect(
        runAgentAttempt({
          attemptId,
          model: MODEL,
          prompt: "Do the task.",
          workspaceDir: workspace,
          captureDir: join(root, `${attemptId}-capture`),
          image: IMAGE,
          network,
          controlNetwork,
          timeoutMs: 20_000,
          providerBaseUrl: fake.url,
          modelMetadata: { output: 8_000, toolCall: true },
          containerName,
        }),
      ).rejects.toBeInstanceOf(AgentAbortError);

      expect(await containerExists(containerName)).toBe(false);
    },
  );

  it("marks a model-not-found response skipped and keeps the baseline workspace", async () => {
    const { result, captureDir } = await run("model_not_found");

    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("model_not_found");
    expect(result.error).toBe("model_not_found");
    expect(
      await readFile(join(captureDir, "src/value.js"), "utf8"),
    ).toBe("export const value = 1;\n");
  });
});
