import { fileURLToPath } from "node:url";

import {
  copyIntoContainer,
  docker,
  dockerText,
  removeContainer,
  uniqueName,
} from "../src/sandbox/docker";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures", import.meta.url));
const DEFAULT_IMAGE = process.env.OMG_EVAL_IMAGE ?? "omg-eval-sandbox:local";

export type FakeOpenAIMode =
  | "edit"
  | "text"
  | "no_usage"
  | "auth"
  | "forbidden"
  | "model_not_found"
  | "timeout"
  | "error"
  | "diff"
  | "diff_no_usage"
  | "diff_fenced"
  | "diff_prose";

export interface FakeOpenAIOptions {
  image?: string;
  network: string;
  mode?: FakeOpenAIMode;
  delayMs?: number;
  name?: string;
}

export interface FakeOpenAIHandle {
  name: string;
  url: string;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

async function waitForHealth(name: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await docker(
      ["exec", name, "curl", "-fsS", "--max-time", "2", "http://127.0.0.1:4097/health"],
      { timeoutMs: 10_000 },
    );
    if (result.exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("fake OpenAI server did not become healthy");
}

export async function startFakeOpenAI(
  options: FakeOpenAIOptions,
): Promise<FakeOpenAIHandle> {
  const name = options.name ?? uniqueName("omg-eval-fake");
  const image = options.image ?? DEFAULT_IMAGE;
  const mode = options.mode ?? "edit";

  const run = await docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "--network",
      options.network,
      "--network-alias",
      "fake-llm",
      "--read-only",
      "--tmpfs",
      "/workspace:rw,size=16m,mode=1777",
      "--tmpfs",
      "/tmp:rw,size=16m,mode=1777",
      "--env",
      `FAKE_MODE=${mode}`,
      "--env",
      `FAKE_DELAY_MS=${options.delayMs ?? 0}`,
      "--entrypoint",
      "/bin/bash",
      image,
      "-lc",
      "while [ ! -f /workspace/fake-openai.mjs ]; do sleep 0.1; done; exec node /workspace/fake-openai.mjs",
    ],
    { timeoutMs: 60_000 },
  );

  if (run.exitCode !== 0) {
    throw new Error(`could not start fake OpenAI server: ${run.output.slice(-2_000)}`);
  }

  try {
    await copyIntoContainer(name, FIXTURE_DIR, "/workspace");
    await waitForHealth(name);
  } catch (error) {
    const logs = await dockerText(["logs", "--tail", "100", name], {
      timeoutMs: 30_000,
    }).catch(() => "");
    await removeContainer(name);
    throw new Error(
      `fake OpenAI server failed to start: ${
        error instanceof Error ? error.message : String(error)
      }\n${logs.slice(-2_000)}`,
    );
  }

  return {
    name,
    url: "http://fake-llm:4097/v1",
    async logs(): Promise<string> {
      return dockerText(["logs", "--tail", "200", name], {
        timeoutMs: 30_000,
      });
    },
    async stop(): Promise<void> {
      await removeContainer(name);
    },
  };
}
