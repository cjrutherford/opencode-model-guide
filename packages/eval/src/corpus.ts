import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { EvalLanguageSchema } from "@omg/shared";
import { z } from "zod";

export const CORPUS_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CORPUS_ROOT = fileURLToPath(
  new URL("../corpus", import.meta.url),
);

const CorpusFileSchema = z.strictObject({
  schemaVersion: z.literal(CORPUS_SCHEMA_VERSION),
  corpusVersion: z.string().min(1),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks: z.array(z.string().min(1)).min(1),
});
export type CorpusFile = z.infer<typeof CorpusFileSchema>;

export const TaskManifestSchema = z.strictObject({
  id: z.string().min(1),
  language: EvalLanguageSchema,
  version: z.number().int().positive(),
  prompt: z.string().min(1),
  publicTestCommand: z.string().min(1),
  hiddenTestCommand: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  expectedBaselineFailure: z.string().min(1),
  referenceSolution: z.string().min(1),
});
export type TaskManifest = z.infer<typeof TaskManifestSchema>;

export interface LoadedCorpusTask {
  manifest: TaskManifest;
  dir: string;
  repoDir: string;
  hiddenDir: string;
  solutionPath: string;
  promptSha256: string;
  repoSha256: string;
}

export interface LoadedCorpus {
  corpusVersion: string;
  createdAt: string;
  tasks: LoadedCorpusTask[];
}

export class CorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusError";
  }
}

function describeZod(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid value";
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

function readJson(path: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new CorpusError(`${label} not found at ${path}`);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new CorpusError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertDir(path: string, label: string): void {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new CorpusError(`${label} is missing: ${path}`);
  }
}

function assertFile(path: string, label: string): void {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new CorpusError(`${label} is missing: ${path}`);
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function collectRepoFiles(
  root: string,
  dir: string,
  files: Array<{ relativePath: string; absolutePath: string }>,
): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const absolutePath = join(dir, entry.name);
    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");

    if (entry.isSymbolicLink()) {
      throw new CorpusError(`symlink not allowed in repo: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      collectRepoFiles(root, absolutePath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push({ relativePath, absolutePath });
    }
  }
}

export function hashRepoTree(root: string): string {
  const files: Array<{ relativePath: string; absolutePath: string }> = [];
  collectRepoFiles(root, root, files);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  const hash = createHash("sha256");
  for (const file of files) {
    const content = readFileSync(file.absolutePath);
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listedTaskDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(root, name, "task.json")));
}

export function loadCorpus(root = DEFAULT_CORPUS_ROOT): LoadedCorpus {
  const manifestPath = join(root, "corpus.json");
  const parsedFile = CorpusFileSchema.safeParse(
    readJson(manifestPath, "corpus.json"),
  );
  if (!parsedFile.success) {
    throw new CorpusError(
      `invalid corpus.json: ${describeZod(parsedFile.error)}`,
    );
  }
  const corpus = parsedFile.data;

  const seenIds = new Set<string>();
  for (const id of corpus.tasks) {
    if (seenIds.has(id)) {
      throw new CorpusError(`duplicate task id in corpus.json: ${id}`);
    }
    seenIds.add(id);
  }

  const onDisk = listedTaskDirs(root);
  for (const id of onDisk) {
    if (!seenIds.has(id)) {
      throw new CorpusError(`task directory is not listed in corpus.json: ${id}`);
    }
  }

  const tasks = corpus.tasks.map((id) => {
    const dir = join(root, id);
    const repoDir = join(dir, "repo");
    const hiddenDir = join(dir, "hidden");
    const solutionPath = join(dir, "solution.patch");

    const parsedTask = TaskManifestSchema.safeParse(
      readJson(join(dir, "task.json"), `task.json for ${id}`),
    );
    if (!parsedTask.success) {
      throw new CorpusError(
        `invalid task.json for ${id}: ${describeZod(parsedTask.error)}`,
      );
    }
    const manifest = parsedTask.data;

    if (manifest.id !== id) {
      throw new CorpusError(
        `task id mismatch: manifest ${manifest.id} does not match directory ${id}`,
      );
    }

    assertDir(repoDir, `repo directory for ${id}`);
    assertDir(hiddenDir, `hidden directory for ${id}`);
    assertFile(solutionPath, `reference solution for ${id}`);

    if (existsSync(join(repoDir, "hidden"))) {
      throw new CorpusError(`hidden tests found inside repo for ${id}`);
    }
    if (existsSync(join(repoDir, "solution.patch"))) {
      throw new CorpusError(`reference solution found inside repo for ${id}`);
    }

    return {
      manifest,
      dir,
      repoDir,
      hiddenDir,
      solutionPath,
      promptSha256: sha256Hex(manifest.prompt),
      repoSha256: hashRepoTree(repoDir),
    } satisfies LoadedCorpusTask;
  });

  return {
    corpusVersion: corpus.corpusVersion,
    createdAt: corpus.createdAt,
    tasks,
  };
}
