import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommand } from "./process";

export const DEFAULT_MAX_PATCH_BYTES = 1_000_000;
export const DEFAULT_PATCH_EXCLUDES = [
  "TASK.md",
  ".eval-ready",
  ".opencode/**",
  "node_modules/**",
] as const;

export type PatchErrorCode =
  | "too_large"
  | "binary"
  | "unsafe_path"
  | "quoted_path"
  | "unsupported"
  | "unsupported_file_mode"
  | "capture_failed";

export class PatchError extends Error {
  readonly code: PatchErrorCode;

  constructor(code: PatchErrorCode, message: string) {
    super(message);
    this.name = "PatchError";
    this.code = code;
  }
}

export interface PatchOptions {
  maxPatchBytes?: number;
}

export interface CapturedPatch {
  patch: string;
  sha256: string;
  bytes: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface PatchValidation {
  files: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface CaptureOptions extends PatchOptions {
  exclude?: readonly string[];
  timeoutMs?: number;
}

export interface ApplyPatchOptions extends PatchOptions {
  timeoutMs?: number;
}

export interface ApplyPatchResult {
  applied: boolean;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  validation: PatchValidation;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertSize(patch: string, maxPatchBytes: number): void {
  if (byteLength(patch) > maxPatchBytes) {
    throw new PatchError(
      "too_large",
      `patch is ${byteLength(patch)} bytes; limit is ${maxPatchBytes}`,
    );
  }
}

function assertNoBinary(patch: string): void {
  if (patch.includes("\0")) {
    throw new PatchError("binary", "patch contains NUL bytes");
  }
  const lines = patch.split("\n");
  for (const line of lines) {
    if (line === "GIT binary patch") {
      throw new PatchError("binary", "git binary patches are not supported");
    }
    if (/^Binary files .+ and .+ differ$/.test(line)) {
      throw new PatchError("binary", "binary file diffs are not supported");
    }
  }
}

function assertSupportedPath(raw: string, prefix?: "a" | "b"): string | null {
  if (raw === "/dev/null") return null;
  if (raw.startsWith('"')) {
    throw new PatchError("quoted_path", "quoted patch paths are not supported");
  }
  if (raw.includes("\\")) {
    throw new PatchError("unsafe_path", `backslash in patch path: ${raw}`);
  }

  let path = raw;
  if (prefix) {
    const expected = `${prefix}/`;
    if (!path.startsWith(expected)) {
      throw new PatchError(
        "unsafe_path",
        `patch path must start with ${expected}: ${raw}`,
      );
    }
    path = path.slice(expected.length);
  }

  if (
    path.length === 0 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new PatchError("unsafe_path", `absolute patch path: ${raw}`);
  }

  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new PatchError("unsafe_path", `path traversal in patch: ${raw}`);
  }
  if (segments[0] === ".git") {
    throw new PatchError("unsafe_path", `patch targets .git: ${raw}`);
  }

  return path;
}

function headerToken(line: string, prefix: string): string {
  const rest = line.slice(prefix.length);
  const tab = rest.indexOf("\t");
  const withoutTimestamp = tab >= 0 ? rest.slice(0, tab) : rest;
  const space = withoutTimestamp.indexOf(" ");
  return space >= 0 ? withoutTimestamp.slice(0, space) : withoutTimestamp;
}

function parseDiffGitPaths(line: string): [string, string] {
  const rest = line.slice("diff --git ".length).trimEnd();
  if (rest.startsWith('"') || rest.includes("\t")) {
    throw new PatchError("quoted_path", "quoted diff paths are not supported");
  }
  const parts = rest.split(" ");
  if (parts.length !== 2) {
    throw new PatchError(
      "unsupported",
      `unsupported diff header path format: ${line}`,
    );
  }
  return [parts[0]!, parts[1]!];
}

export function validatePatch(
  patch: string,
  options: PatchOptions = {},
): PatchValidation {
  const maxPatchBytes = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
  assertSize(patch, maxPatchBytes);
  assertNoBinary(patch);

  const files = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;
  let inHunk = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      const [left, right] = parseDiffGitPaths(line);
      const leftPath = assertSupportedPath(left, "a");
      const rightPath = assertSupportedPath(right, "b");
      if (leftPath) files.add(leftPath);
      if (rightPath) files.add(rightPath);
      continue;
    }

    if (line.startsWith("--- ")) {
      inHunk = false;
      const path = assertSupportedPath(headerToken(line, "--- "), "a");
      if (path) files.add(path);
      continue;
    }

    if (line.startsWith("+++ ")) {
      inHunk = false;
      const path = assertSupportedPath(headerToken(line, "+++ "), "b");
      if (path) files.add(path);
      continue;
    }

    if (
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("copy from ") ||
      line.startsWith("copy to ")
    ) {
      throw new PatchError(
        "unsupported",
        "rename and copy patches are not supported",
      );
    }

    if (
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("old mode ") ||
      line.startsWith("new mode ")
    ) {
      const mode = line.split(" ").at(-1);
      if (mode === "120000" || mode === "160000") {
        throw new PatchError(
          "unsupported_file_mode",
          `symlink or submodule mode is not supported: ${mode}`,
        );
      }
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;
    if (line.startsWith("+")) {
      linesAdded += 1;
    } else if (line.startsWith("-")) {
      linesRemoved += 1;
    }
  }

  return {
    files: [...files].sort(),
    linesAdded,
    linesRemoved,
  };
}

export function patchSha256(patch: string): string {
  return createHash("sha256").update(patch).digest("hex");
}

export async function capturePatch(
  workspaceDir: string,
  options: CaptureOptions = {},
): Promise<CapturedPatch> {
  const maxPatchBytes = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const excludes = options.exclude ?? DEFAULT_PATCH_EXCLUDES;
  const pathspecs = [
    ".",
    ...excludes.map((pattern) => `:(exclude,glob)${pattern}`),
  ];

  const addResult = await runCommand(
    "git",
    ["add", "-A", "--", ...pathspecs],
    {
      cwd: workspaceDir,
      timeoutMs,
      maxOutputChars: 16_000,
      keepOutput: "tail",
    },
  );

  if (addResult.timedOut) {
    throw new PatchError("capture_failed", "git add timed out");
  }
  if (addResult.exitCode !== 0) {
    throw new PatchError(
      "capture_failed",
      `git add failed: ${addResult.output.slice(-1_000)}`,
    );
  }

  try {
    const diffResult = await runCommand(
      "git",
      [
        "diff",
        "--cached",
        "--no-color",
        "--no-ext-diff",
        "--no-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        ...pathspecs,
      ],
      {
        cwd: workspaceDir,
        timeoutMs,
        maxOutputChars: maxPatchBytes + 1,
        keepOutput: "head",
      },
    );

    if (diffResult.timedOut) {
      throw new PatchError("capture_failed", "git diff timed out");
    }
    if (diffResult.exitCode !== 0) {
      throw new PatchError(
        "capture_failed",
        `git diff failed: ${diffResult.output.slice(-1_000)}`,
      );
    }
    if (diffResult.truncated) {
      throw new PatchError(
        "too_large",
        `patch exceeds the ${maxPatchBytes} byte limit`,
      );
    }

    const patch = diffResult.stdout;
    assertSize(patch, maxPatchBytes);
    const validation = validatePatch(patch, { maxPatchBytes });

    return {
      patch,
      sha256: patchSha256(patch),
      bytes: byteLength(patch),
      filesChanged: validation.files.length,
      linesAdded: validation.linesAdded,
      linesRemoved: validation.linesRemoved,
    };
  } finally {
    await runCommand("git", ["reset", "--quiet"], {
      cwd: workspaceDir,
      timeoutMs,
      maxOutputChars: 4_000,
      keepOutput: "tail",
    }).catch(() => undefined);
  }
}

export async function applyPatch(
  workspaceDir: string,
  patch: string,
  options: ApplyPatchOptions = {},
): Promise<ApplyPatchResult> {
  const validation = validatePatch(patch, options);
  if (patch.length === 0) {
    return {
      applied: true,
      exitCode: 0,
      output: "",
      timedOut: false,
      validation,
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "omg-eval-patch-"));
  try {
    const patchPath = join(tempDir, "change.patch");
    await writeFile(patchPath, patch, "utf8");
    const result = await runCommand(
      "patch",
      [
        "-p1",
        "--batch",
        "--forward",
        "--no-backup-if-mismatch",
        "-i",
        patchPath,
      ],
      {
        cwd: workspaceDir,
        timeoutMs: options.timeoutMs ?? 30_000,
        maxOutputChars: 16_000,
        keepOutput: "tail",
      },
    );

    return {
      applied: result.exitCode === 0,
      exitCode: result.exitCode,
      output: result.output,
      timedOut: result.timedOut,
      validation,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
