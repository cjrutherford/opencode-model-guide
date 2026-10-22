import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

import type { EvalModel, EvalStatus } from "@omg/shared";

import { sha256Hex } from "../corpus";
import {
  PatchError,
  patchSha256,
  validatePatch,
  type PatchValidation,
} from "../patch";
import {
  runTestStage,
  type TestCommandExecutor,
  type TestStageResult,
} from "../testRunner";
import {
  emptyUsage,
  normalizeOpenAIUsage,
  type NormalizedUsage,
} from "../usage";

const DEFAULT_MAX_REPO_BYTES = 48 * 1024;
const DEFAULT_MAX_PATCH_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const MAX_ERROR_CHARS = 2_000;

const SYSTEM_PROMPT = [
  "You are a precise coding assistant.",
  "Return only a unified diff. Do not include prose, explanations, or markdown fences.",
  "The diff must apply to the baseline repository with `git apply`.",
].join(" ");

const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".eval-ready"]);
const MAX_LISTED_FILES = 500;

export type DirectPatchErrorCode =
  | "empty"
  | "too_large"
  | "fenced"
  | "prose"
  | "invalid"
  | "unsafe_path"
  | "binary";

export class DirectPatchError extends Error {
  readonly code: DirectPatchErrorCode;

  constructor(code: DirectPatchErrorCode, message: string) {
    super(message);
    this.name = "DirectPatchError";
    this.code = code;
  }
}

export class DirectPatchAbortError extends Error {
  readonly code = "auth";

  constructor(message = "provider authentication failed") {
    super(message);
    this.name = "DirectPatchAbortError";
  }
}

export interface DirectPatchTask {
  prompt: string;
  repoDir: string;
  hiddenDir: string;
  hiddenTestCommand: string;
  timeoutMs: number;
}

export interface DirectPatchAttemptOptions {
  attemptId: string;
  model: EvalModel;
  task: DirectPatchTask;
  /** Base URL ending in `/v1`, usually the host-accessible proxy URL. */
  baseUrl: string;
  maxRepoBytes?: number;
  maxPatchBytes?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  testTimeoutMs?: number;
  testExecutor?: TestCommandExecutor;
  testEnv?: NodeJS.ProcessEnv;
}

export interface DirectPatchAttemptResult {
  status: EvalStatus;
  skipReason: "model_not_found" | null;
  usage: NormalizedUsage;
  error: string | null;
  patch: string | null;
  patchSha256: string | null;
  filesChanged: number | null;
  diffLinesAdded: number | null;
  diffLinesRemoved: number | null;
  test: TestStageResult | null;
  promptSha256: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface RepoView {
  text: string;
  bytes: number;
  files: number;
  truncated: boolean;
}

export interface DirectPatchPrompt {
  prompt: string;
  repoView: string;
  repoViewBytes: number;
  repoFiles: number;
  repoTruncated: boolean;
}

interface FailureClassification {
  kind: "auth" | "model_not_found" | "other";
  text: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: unknown;
  error?: unknown;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return truncate(error, MAX_ERROR_CHARS);
  if (error instanceof Error) return truncate(error.message, MAX_ERROR_CHARS);
  try {
    return truncate(JSON.stringify(error) ?? "unknown error", MAX_ERROR_CHARS);
  } catch {
    return "unknown error";
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;

  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
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

function mapPatchError(error: PatchError): DirectPatchError {
  switch (error.code) {
    case "too_large":
      return new DirectPatchError("too_large", error.message);
    case "binary":
      return new DirectPatchError("binary", error.message);
    case "unsafe_path":
    case "quoted_path":
      return new DirectPatchError("unsafe_path", error.message);
    default:
      return new DirectPatchError("invalid", error.message);
  }
}

async function collectRepoFiles(
  root: string,
  directory = root,
  relative = "",
  files: Array<{ relativePath: string; absolutePath: string }> = [],
): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  if (files.length >= MAX_LISTED_FILES) return files;

  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (files.length >= MAX_LISTED_FILES) break;
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    if (entry.name === ".DS_Store") continue;

    const nextRelative = relative
      ? posix.join(relative, entry.name)
      : entry.name;
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectRepoFiles(root, absolutePath, nextRelative, files);
    } else if (entry.isFile()) {
      files.push({ relativePath: nextRelative, absolutePath });
    }
  }

  return files;
}

/** Build a deterministic, text-only view of the baseline repository. */
export async function buildRepoView(
  repoDir: string,
  maxBytes = DEFAULT_MAX_REPO_BYTES,
): Promise<RepoView> {
  const files = await collectRepoFiles(repoDir);
  const sections: string[] = [];

  for (const file of files) {
    const data = await readFile(file.absolutePath);
    if (data.includes(0)) {
      sections.push(`--- FILE: ${file.relativePath} (binary omitted) ---\n`);
      continue;
    }

    const content = data.toString("utf8");
    sections.push(
      [
        `--- FILE: ${file.relativePath} ---`,
        content.endsWith("\n") ? content : `${content}\n`,
        "--- END FILE ---",
        "",
      ].join(""),
    );
  }

  const full = sections.join("\n");
  const bytes = Buffer.byteLength(full, "utf8");
  const truncated = bytes > maxBytes;
  const text = truncated ? truncateUtf8(full, maxBytes) : full;

  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    files: files.length,
    truncated,
  };
}

export async function buildDirectPatchPrompt(options: {
  taskPrompt: string;
  repoDir: string;
  maxRepoBytes?: number;
}): Promise<DirectPatchPrompt> {
  const repo = await buildRepoView(
    options.repoDir,
    options.maxRepoBytes ?? DEFAULT_MAX_REPO_BYTES,
  );
  const prompt = [
    "# Task",
    options.taskPrompt.trim(),
    "",
    "# Baseline repository",
    "This is a text view of the repository that the diff must apply to.",
    "",
    repo.text.trimEnd(),
    "",
    repo.truncated
      ? "# Note\nThe repository view above was truncated at the byte cap; only the shown files and content are available."
      : "",
    repo.truncated ? "" : null,
    "# Output contract",
    "Return only one unified diff that applies with `git apply`.",
    "Do not include prose, explanations, or markdown fences.",
    "Use `a/path` and `b/path` in file headers.",
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    prompt,
    repoView: repo.text,
    repoViewBytes: repo.bytes,
    repoFiles: repo.files,
    repoTruncated: repo.truncated,
  };
}

/**
 * Extract a unified diff. A single surrounding Markdown fence is stripped;
 * prose around a diff, multiple fences, and malformed patches are rejected.
 */
export function extractUnifiedDiff(
  raw: string,
  options: {
    maxPatchBytes?: number;
    maxResponseBytes?: number;
  } = {},
): { patch: string; validation: PatchValidation } {
  const maxPatchBytes = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  if (Buffer.byteLength(raw, "utf8") > maxResponseBytes) {
    throw new DirectPatchError(
      "too_large",
      `model response exceeds ${maxResponseBytes} bytes`,
    );
  }

  let text = raw.replaceAll("\r\n", "\n").trim();
  if (text.length === 0) {
    throw new DirectPatchError("empty", "model returned an empty response");
  }

  if (text.startsWith("```")) {
    const match = text.match(
      /^```(?:diff|patch)?[ \t]*\n([\s\S]*?)\n```[ \t]*$/,
    );
    if (!match) {
      throw new DirectPatchError(
        "fenced",
        "response must contain exactly one complete Markdown fence",
      );
    }
    text = match[1]!.trim();
  }

  if (text.includes("```")) {
    throw new DirectPatchError(
      "fenced",
      "Markdown fences are not allowed in the diff",
    );
  }

  const first = text.split("\n").find((line) => line.trim().length > 0)?.trim();
  if (
    !first ||
    (!first.startsWith("diff --git ") &&
      !first.startsWith("--- ") &&
      !first.startsWith("Index: "))
  ) {
    throw new DirectPatchError(
      "prose",
      "response must start with a unified diff, not prose",
    );
  }

  let validation: PatchValidation;
  text = `${text.trimEnd()}\n`;
  try {
    validation = validatePatch(text, { maxPatchBytes });
  } catch (error) {
    if (error instanceof PatchError) throw mapPatchError(error);
    throw error;
  }

  if (validation.files.length === 0) {
    throw new DirectPatchError("invalid", "diff does not touch any files");
  }

  return { patch: text, validation };
}

function responseContent(payload: ChatCompletionResponse): string | null {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

function result(
  options: DirectPatchAttemptOptions,
  promptSha256: string,
  started: number,
  details: Partial<DirectPatchAttemptResult> & { status: EvalStatus },
): DirectPatchAttemptResult {
  const finished = Date.now();
  return {
    status: details.status,
    skipReason: details.skipReason ?? null,
    usage: details.usage ?? emptyUsage(),
    error: details.error ?? null,
    patch: details.patch ?? null,
    patchSha256: details.patchSha256 ?? null,
    filesChanged: details.filesChanged ?? null,
    diffLinesAdded: details.diffLinesAdded ?? null,
    diffLinesRemoved: details.diffLinesRemoved ?? null,
    test: details.test ?? null,
    promptSha256,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
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

export async function runDirectPatchAttempt(
  options: DirectPatchAttemptOptions,
): Promise<DirectPatchAttemptResult> {
  const started = Date.now();
  const built = await buildDirectPatchPrompt({
    taskPrompt: options.task.prompt,
    repoDir: options.task.repoDir,
    maxRepoBytes: options.maxRepoBytes,
  });
  const promptSha256 = sha256Hex(built.prompt);
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eval-attempt": options.attemptId,
      },
      body: JSON.stringify({
        model: options.model.id,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: built.prompt },
        ],
        stream: false,
        temperature: 0,
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted || isAbortError(error)) {
      return result(options, promptSha256, started, {
        status: "timeout",
        error: "request timed out",
      });
    }
    return result(options, promptSha256, started, {
      status: "error",
      error: errorText(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = truncate(await response.text().catch(() => ""), MAX_ERROR_CHARS);
    const failure = classify(response.status, text);
    if (failure.kind === "auth") {
      throw new DirectPatchAbortError(failure.text);
    }
    if (failure.kind === "model_not_found") {
      return result(options, promptSha256, started, {
        status: "skipped",
        skipReason: "model_not_found",
        error: "model_not_found",
      });
    }
    return result(options, promptSha256, started, {
      status: "error",
      error: failure.text,
    });
  }

  let payload: ChatCompletionResponse;
  let rawResponse = "";
  try {
    rawResponse = await response.text();
  } catch (error) {
    return result(options, promptSha256, started, {
      status: "error",
      error: `could not read response: ${errorText(error)}`,
    });
  }

  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (Buffer.byteLength(rawResponse, "utf8") > maxResponseBytes) {
    return result(options, promptSha256, started, {
      status: "patch_failed",
      error: `too_large: model response exceeds ${maxResponseBytes} bytes`,
    });
  }

  try {
    payload = JSON.parse(rawResponse) as ChatCompletionResponse;
  } catch (error) {
    return result(options, promptSha256, started, {
      status: "error",
      error: `invalid JSON response: ${errorText(error)}`,
    });
  }

  const usage = normalizeOpenAIUsage(payload.usage);
  if (payload.error) {
    const failure = classify(response.status, errorText(payload.error));
    if (failure.kind === "auth") throw new DirectPatchAbortError(failure.text);
    if (failure.kind === "model_not_found") {
      return result(options, promptSha256, started, {
        status: "skipped",
        skipReason: "model_not_found",
        usage,
        error: "model_not_found",
      });
    }
    return result(options, promptSha256, started, {
      status: "error",
      usage,
      error: failure.text,
    });
  }

  const content = responseContent(payload);
  if (!content) {
    return result(options, promptSha256, started, {
      status: "error",
      usage,
      error: "model returned no diff content",
    });
  }

  let parsed: { patch: string; validation: PatchValidation };
  try {
    parsed = extractUnifiedDiff(content, {
      maxPatchBytes: options.maxPatchBytes,
      maxResponseBytes: options.maxResponseBytes,
    });
  } catch (error) {
    const code = error instanceof DirectPatchError ? error.code : "invalid";
    return result(options, promptSha256, started, {
      status: "patch_failed",
      usage,
      error: `${code}: ${errorText(error)}`,
    });
  }

  const test = await runTestStage({
    repoDir: options.task.repoDir,
    hiddenDir: options.task.hiddenDir,
    patch: parsed.patch,
    hiddenTestCommand: options.task.hiddenTestCommand,
    timeoutMs:
      options.testTimeoutMs ??
      Math.min(options.task.timeoutMs, DEFAULT_TEST_TIMEOUT_MS),
    executor: options.testExecutor,
    env: options.testEnv,
  });

  const base = {
    usage,
    patch: parsed.patch,
    patchSha256: patchSha256(parsed.patch),
    filesChanged: parsed.validation.files.length,
    diffLinesAdded: parsed.validation.linesAdded,
    diffLinesRemoved: parsed.validation.linesRemoved,
    test,
  };

  switch (test.status) {
    case "passed":
      return result(options, promptSha256, started, {
        ...base,
        status: "passed",
        error: null,
      });
    case "failed":
      return result(options, promptSha256, started, {
        ...base,
        status: "failed",
        error: null,
      });
    case "patch_failed":
      return result(options, promptSha256, started, {
        ...base,
        status: "patch_failed",
        error: test.error ?? "patch_failed",
      });
    case "timeout":
      return result(options, promptSha256, started, {
        ...base,
        status: "timeout",
        error: test.error ?? "timeout",
      });
    default:
      return result(options, promptSha256, started, {
        ...base,
        status: "error",
        error: test.error ?? "test_runner_error",
      });
  }
}
