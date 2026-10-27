import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOpencodeClient, type AssistantMessage } from "@opencode-ai/sdk";

import type { EvalModel } from "@omg/shared";

import {
  startAgentContainer,
  type AgentContainerHandle,
} from "../sandbox/agentContainer";
import { copyIntoContainer, uniqueName } from "../sandbox/docker";
import { emptyUsage, normalizeUsage, type NormalizedUsage } from "../usage";
import { buildAgentConfig, type AgentModelMetadata } from "./agentConfig";

const DEFAULT_API_KEY = "eval-dummy-key";
const SERVER_READY_TIMEOUT_MS = 60_000;
const MAX_ERROR_CHARS = 2_000;
const MAX_LOG_CHARS = 8_000;

export type AgentAttemptStatus = "completed" | "timeout" | "error" | "skipped";
export type AgentSkipReason = "model_not_found";

export interface AgentAttemptOptions {
  attemptId: string;
  model: EvalModel;
  prompt: string;
  workspaceDir: string;
  captureDir: string;
  image: string;
  network: string;
  controlNetwork: string;
  timeoutMs: number;
  /** Test-only custom provider URL. Production uses the built-in provider. */
  providerBaseUrl?: string;
  /** Dedicated eval key, passed only to the disposable agent container. */
  apiKey?: string;
  /** Allowlisted CONNECT proxy for OpenCode's HTTPS traffic. */
  egressProxyUrl?: string;
  modelMetadata?: AgentModelMetadata;
  workspaceBytes?: number;
  containerName?: string;
  forwarderName?: string;
}

export interface AgentAttemptResult {
  status: AgentAttemptStatus;
  skipReason: AgentSkipReason | null;
  usage: NormalizedUsage;
  error: string | null;
  logs: string;
  capturedWorkspace: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export class AgentAbortError extends Error {
  readonly code = "auth";

  constructor(message = "provider authentication failed") {
    super(message);
    this.name = "AgentAbortError";
  }
}

interface FailureClassification {
  kind: "auth" | "model_not_found" | "other";
  text: string;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function redactSecret(value: string, secret: string | undefined): string {
  if (!secret || secret.length < 8) return value;
  return value.split(secret).join("[REDACTED]");
}

function errorText(error: unknown): string {
  if (typeof error === "string") return truncate(error, MAX_ERROR_CHARS);
  if (error instanceof Error) return truncate(error.message, MAX_ERROR_CHARS);
  try {
    return truncate(JSON.stringify(error) ?? "unknown agent error", MAX_ERROR_CHARS);
  } catch {
    return "unknown agent error";
  }
}

function classify(status: number | undefined, text: string): FailureClassification {
  const lower = text.toLowerCase();
  if (status === 401 || status === 403) {
    return { kind: "auth", text: truncate(text, MAX_ERROR_CHARS) };
  }
  if (status === 404 && (lower.includes("model") || lower.includes("not found"))) {
    return { kind: "model_not_found", text: truncate(text, MAX_ERROR_CHARS) };
  }
  if (
    lower.includes("model not found") ||
    lower.includes("unknown model") ||
    lower.includes("model_not_found")
  ) {
    return { kind: "model_not_found", text: truncate(text, MAX_ERROR_CHARS) };
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication")
  ) {
    return { kind: "auth", text: truncate(text, MAX_ERROR_CHARS) };
  }
  return { kind: "other", text: truncate(text, MAX_ERROR_CHARS) };
}

function assistantFailure(info: AssistantMessage): FailureClassification | null {
  if (!info.error) return null;

  if (info.error.name === "ProviderAuthError") {
    return {
      kind: "auth",
      text: truncate(info.error.data.message, MAX_ERROR_CHARS),
    };
  }

  if (info.error.name === "APIError") {
    const data = info.error.data;
    const text = [
      data.message,
      data.statusCode ? `status ${data.statusCode}` : "",
      data.responseBody ? truncate(data.responseBody, 500) : "",
    ]
      .filter(Boolean)
      .join(": ");
    return classify(data.statusCode, text);
  }

  return {
    kind: "other",
    text: truncate(JSON.stringify(info.error), MAX_ERROR_CHARS),
  };
}

function resultErrorCode(classification: FailureClassification): string {
  if (classification.kind === "model_not_found") return "model_not_found";
  return classification.text;
}

function nowIso(started: number): string {
  return new Date(started).toISOString();
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError")
  );
}

/**
 * Run one real OpenCode agent attempt in a disposable sandbox.
 *
 * The model can only reach the allowlisted CONNECT tunnel (or a test fake
 * provider) on the internal network. Hidden tests and reference solutions are
 * never mounted into this container. The workspace is copied out before the
 * container is removed, including on timeout, so the caller can run the
 * separate host-side test stage.
 */
export async function runAgentAttempt(
  options: AgentAttemptOptions,
): Promise<AgentAttemptResult> {
  const started = Date.now();
  const startedAt = nowIso(started);
  const containerName = options.containerName ?? uniqueName("omg-eval-agent");
  const captureDir = options.captureDir;
  await mkdir(captureDir, { recursive: true });

  const configDir = await mkdtemp(join(tmpdir(), "omg-eval-config-"));
  const config = buildAgentConfig({
    model: options.model,
    metadata: options.modelMetadata,
    providerBaseUrl: options.providerBaseUrl,
    apiKey: options.providerBaseUrl
      ? (options.apiKey ?? DEFAULT_API_KEY)
      : undefined,
  });
  await writeFile(
    join(configDir, "opencode.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );

  let agent: AgentContainerHandle | null = null;
  let captured = false;
  let logs = "";
  let usage = emptyUsage();
  const resultHolder: { current: AgentAttemptResult | null } = {
    current: null,
  };

  const finish = (
    status: AgentAttemptStatus,
    details: {
      skipReason?: AgentSkipReason | null;
      error?: string | null;
      usage?: NormalizedUsage;
    } = {},
  ): AgentAttemptResult => {
    const finished = Date.now();
    const result: AgentAttemptResult = {
      status,
      skipReason: details.skipReason ?? null,
      usage: details.usage ?? usage,
      error: details.error
        ? redactSecret(details.error, options.apiKey)
        : null,
      logs,
      capturedWorkspace: captureDir,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
    };
    resultHolder.current = result;
    return result;
  };

  const captureWorkspace = async (): Promise<void> => {
    if (!agent || captured) return;
    try {
      await agent.copyOut(captureDir);
      captured = true;
    } catch (error) {
      logs = `${logs}\nworkspace capture failed: ${errorText(error)}`.trim();
    }
  };

  let agentEnv: Record<string, string> = {
    // Keep the config outside the task workspace so it never appears in the
    // captured patch.
    OPENCODE_CONFIG: "/home/eval/opencode.json",
  };
  if (options.egressProxyUrl) {
    agentEnv = {
      ...agentEnv,
      HTTP_PROXY: options.egressProxyUrl,
      HTTPS_PROXY: options.egressProxyUrl,
      http_proxy: options.egressProxyUrl,
      https_proxy: options.egressProxyUrl,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    };
  }
  if (options.apiKey) {
    // Deliberately limited to this one key. The test container and the egress
    // tunnel never receive it.
    agentEnv.OPENCODE_API_KEY = options.apiKey;
  }

  try {
    agent = await startAgentContainer({
      image: options.image,
      network: options.network,
      controlNetwork: options.controlNetwork,
      name: containerName,
      forwarderName: options.forwarderName,
      workspaceDir: options.workspaceDir,
      workspaceBytes: options.workspaceBytes,
      env: agentEnv,
      secretEnvAllowlist: ["OPENCODE_API_KEY"],
    });

    await copyIntoContainer(agent.name, configDir, "/home/eval");
    await agent.signalReady();
    await agent.waitForServer(SERVER_READY_TIMEOUT_MS);

    const client = createOpencodeClient({
      baseUrl: `http://${agent.host}:${agent.port}`,
    });

    const created = await client.session.create({
      body: { title: `eval ${options.attemptId}` },
    });
    if (created.error || !created.data) {
      const status = created.response?.status;
      const text = errorText(created.error ?? "session creation failed");
      const failure = classify(status, text);
      if (failure.kind === "auth") {
        throw new AgentAbortError(failure.text);
      }
      if (failure.kind === "model_not_found") {
        return finish("skipped", {
          skipReason: "model_not_found",
          error: resultErrorCode(failure),
        });
      }
      return finish("error", { error: resultErrorCode(failure) });
    }

    const sessionID = created.data.id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    let promptResult:
      | Awaited<ReturnType<typeof client.session.prompt>>
      | null = null;
    let timedOut = false;

    try {
      promptResult = await client.session.prompt({
        path: { id: sessionID },
        body: {
          model: {
            providerID: options.providerBaseUrl ? "eval" : "opencode",
            modelID: options.model.id,
          },
          parts: [{ type: "text", text: options.prompt }],
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        timedOut = true;
        await client.session.abort({ path: { id: sessionID } }).catch(() => {});
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (timedOut) {
      await captureWorkspace();
      return finish("timeout", { error: "attempt timed out" });
    }

    const promptError =
      promptResult && "error" in promptResult ? promptResult.error : undefined;
    if (!promptResult || promptError || !promptResult.data) {
      const status = promptResult?.response?.status;
      const text = errorText(promptError ?? "empty prompt response");
      const failure = classify(status, text);
      if (failure.kind === "auth") {
        throw new AgentAbortError(failure.text);
      }
      if (failure.kind === "model_not_found") {
        await captureWorkspace();
        return finish("skipped", {
          skipReason: "model_not_found",
          error: resultErrorCode(failure),
        });
      }
      await captureWorkspace();
      return finish("error", { error: resultErrorCode(failure) });
    }

    const infoFailure = assistantFailure(promptResult.data.info);
    if (infoFailure) {
      if (infoFailure.kind === "auth") {
        throw new AgentAbortError(infoFailure.text);
      }
      if (infoFailure.kind === "model_not_found") {
        await captureWorkspace();
        return finish("skipped", {
          skipReason: "model_not_found",
          error: resultErrorCode(infoFailure),
        });
      }
      await captureWorkspace();
      return finish("error", { error: resultErrorCode(infoFailure) });
    }

    const messages = await client.session.messages({
      path: { id: sessionID },
    });
    if (messages.error) {
      logs = `${logs}\nsession messages failed: ${errorText(messages.error)}`.trim();
      usage = normalizeUsage([
        { info: promptResult.data.info, parts: promptResult.data.parts },
      ]);
    } else {
      usage = messages.data
        ? normalizeUsage(messages.data)
        : normalizeUsage([
            { info: promptResult.data.info, parts: promptResult.data.parts },
          ]);
    }

    await captureWorkspace();
    return finish("completed", { usage });
  } catch (error) {
    if (error instanceof AgentAbortError) {
      throw error;
    }

    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
    const failure = classify(
      Number.isInteger(status) ? status : undefined,
      errorText(error),
    );
    if (failure.kind === "auth") {
      throw new AgentAbortError(failure.text);
    }
    await captureWorkspace();
    if (failure.kind === "model_not_found") {
      return finish("skipped", {
        skipReason: "model_not_found",
        error: resultErrorCode(failure),
      });
    }
    return finish("error", {
      error: resultErrorCode(failure),
    });
  } finally {
    try {
      if (agent) {
        const containerLogs = await agent.logs().catch(() => "");
        const serverLog = await readAgentServerLog(agent);
        logs = truncate(
          redactSecret([containerLogs, serverLog].filter(Boolean).join("\n\n"), options.apiKey),
          MAX_LOG_CHARS,
        );
      }
    } catch {
      // Logs are diagnostic only.
    }
    await captureWorkspace();
    if (resultHolder.current) resultHolder.current.logs = logs;
    await agent?.stop().catch(() => {});
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * OpenCode writes the failure detail (upstream error, aborted stream) to its own
 * log file rather than to the container's stdout, so keep that with the attempt.
 */
async function readAgentServerLog(
  agent: AgentContainerHandle,
): Promise<string> {
  try {
    const result = await agent.exec(
      [
        "bash",
        "-c",
        "tail -n 400 /home/eval/.local/share/opencode/log/opencode.log 2>/dev/null || true",
      ],
      { timeoutMs: 20_000 },
    );
    return result.output.trim();
  } catch {
    return "";
  }
}
