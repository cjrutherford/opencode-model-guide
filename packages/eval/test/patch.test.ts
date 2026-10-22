import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PatchError,
  applyPatch,
  capturePatch,
  patchSha256,
  validatePatch,
} from "../src/patch";
import { runCommand } from "../src/process";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omg-patch-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function patchFor(path: string, before: string, after: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
    "",
  ].join("\n");
}

function expectPatchCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PatchError);
    expect((error as PatchError).code).toBe(code);
    return;
  }
  throw new Error(`expected PatchError with code ${code}`);
}

describe("capturePatch", () => {
  it("captures tracked and untracked changes and ignores .git", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/value.js"), "export const value = 1;\n");
    expect(
      (
        await runCommand("git", ["init", "-q"], {
          cwd: root,
          timeoutMs: 10_000,
        })
      ).exitCode,
    ).toBe(0);
    expect(
      (
        await runCommand("git", ["add", "-A"], {
          cwd: root,
          timeoutMs: 10_000,
        })
      ).exitCode,
    ).toBe(0);
    expect(
      (
        await runCommand(
          "git",
          [
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-q",
            "-m",
            "baseline",
          ],
          { cwd: root, timeoutMs: 10_000 },
        )
      ).exitCode,
    ).toBe(0);

    await writeFile(join(root, "src/value.js"), "export const value = 2;\n");
    await writeFile(join(root, "src/new.js"), "export const extra = 3;\n");

    const captured = await capturePatch(root);

    expect(captured.patch).toContain("src/value.js");
    expect(captured.patch).toContain("src/new.js");
    expect(captured.patch).toContain("new file mode");
    expect(captured.patch).not.toContain(".git/");
    expect(captured.filesChanged).toBe(2);
    expect(captured.linesAdded).toBe(2);
    expect(captured.linesRemoved).toBe(1);
    expect(captured.sha256).toBe(patchSha256(captured.patch));
  });
});

describe("validatePatch", () => {
  it("rejects path traversal and absolute paths", () => {
    expectPatchCode(
      () =>
        validatePatch(
          [
            "diff --git a/../evil b/../evil",
            "--- a/../evil",
            "+++ b/../evil",
            "@@ -1 +1 @@",
            "-old",
            "+new",
          ].join("\n"),
        ),
      "unsafe_path",
    );

    expectPatchCode(
      () =>
        validatePatch(
          [
            "diff --git a//etc/passwd b//etc/passwd",
            "--- a//etc/passwd",
            "+++ b//etc/passwd",
            "@@ -1 +1 @@",
            "-old",
            "+new",
          ].join("\n"),
        ),
      "unsafe_path",
    );
  });

  it("rejects patches that target .git", () => {
    expectPatchCode(
      () =>
        validatePatch(
          [
            "diff --git a/.git/config b/.git/config",
            "--- a/.git/config",
            "+++ b/.git/config",
            "@@ -1 +1 @@",
            "-old",
            "+new",
          ].join("\n"),
        ),
      "unsafe_path",
    );
  });

  it("rejects binary patches", () => {
    expectPatchCode(
      () => validatePatch("GIT binary patch\nliteral 1\nabc\n"),
      "binary",
    );
    expectPatchCode(
      () => validatePatch("Binary files a/image.png and b/image.png differ\n"),
      "binary",
    );
  });

  it("rejects oversized patches", () => {
    expectPatchCode(
      () => validatePatch("x".repeat(101), { maxPatchBytes: 100 }),
      "too_large",
    );
  });

  it("rejects quoted paths and symlink modes", () => {
    expectPatchCode(
      () =>
        validatePatch(
          'diff --git "a/name with space" "b/name with space"\n',
        ),
      "quoted_path",
    );

    expectPatchCode(
      () =>
        validatePatch(
          [
            "diff --git a/link b/link",
            "new file mode 120000",
            "--- /dev/null",
            "+++ b/link",
            "@@ -0,0 +1 @@",
            "+target",
          ].join("\n"),
        ),
      "unsupported_file_mode",
    );
  });

  it("counts added and removed hunk lines", () => {
    const validation = validatePatch(
      [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,2 +1,2 @@",
        "-one",
        "+ONE",
        " two",
      ].join("\n"),
    );

    expect(validation).toEqual({
      files: ["a.txt"],
      linesAdded: 1,
      linesRemoved: 1,
    });
  });
});

describe("applyPatch", () => {
  it("applies a valid patch", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "value.txt"), "old\n");

    const result = await applyPatch(
      root,
      patchFor("value.txt", "old", "new"),
    );

    expect(result.applied).toBe(true);
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("new\n");
  });

  it("treats an empty patch as applied with no changes", async () => {
    const root = await makeRoot();
    const result = await applyPatch(root, "");

    expect(result.applied).toBe(true);
    expect(result.validation.files).toEqual([]);
  });

  it("rejects malformed patches", async () => {
    const root = await makeRoot();
    const result = await applyPatch(root, "this is not a patch\n");

    expect(result.applied).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("rejects unsafe patches before running patch", async () => {
    const root = await makeRoot();
    await expect(
      applyPatch(root, "diff --git a/../outside b/../outside\n"),
    ).rejects.toBeInstanceOf(PatchError);
  });
});
