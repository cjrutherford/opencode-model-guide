import { describe, expect, it } from "vitest";

import { renderAgentPrompt } from "../src/prompt";

const task = {
  id: "ts-lru",
  language: "ts",
  prompt: "Fix the LRU cache in src/lru.ts.",
  publicTestCommand: "tsx --test test/public/*.test.ts",
};

describe("renderAgentPrompt", () => {
  it("renders the exact stable agent prompt", () => {
    const rendered = renderAgentPrompt(task);

    expect(rendered.prompt).toBe(
      [
        "# Task: ts-lru",
        "",
        "Fix the LRU cache in src/lru.ts.",
        "",
        "## Workspace",
        "The repository is in /workspace. You may read and edit files and run commands there.",
        "",
        "## Verification",
        "Run the public tests with:",
        "",
        "```sh",
        "tsx --test test/public/*.test.ts",
        "```",
        "",
        "Do not modify the public tests. Hidden tests are not available in this environment.",
        "Do not use the network.",
        "",
      ].join("\n"),
    );
    expect(rendered.taskMarkdown).toBe(rendered.prompt);
    expect(rendered.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes the exact prompt deterministically", () => {
    const first = renderAgentPrompt(task);
    const second = renderAgentPrompt(task);
    const changed = renderAgentPrompt({ ...task, prompt: "Fix something else." });

    expect(second.sha256).toBe(first.sha256);
    expect(changed.sha256).not.toBe(first.sha256);
  });

  it("normalizes line endings before hashing", () => {
    const unix = renderAgentPrompt(task);
    const windows = renderAgentPrompt({
      ...task,
      prompt: "Fix the LRU cache in src/lru.ts.\r\n",
    });

    expect(windows.prompt).toBe(unix.prompt);
    expect(windows.sha256).toBe(unix.sha256);
  });

  it("does not include hidden test or solution content", () => {
    const withPrivateFields = {
      ...task,
      hiddenTestCommand: "node --test hidden/secret.test.ts",
      referenceSolution: "solution.patch",
    };

    const rendered = renderAgentPrompt(withPrivateFields);

    expect(rendered.prompt).not.toContain("hidden/secret");
    expect(rendered.prompt).not.toContain("solution.patch");
    expect(rendered.prompt).not.toContain("referenceSolution");
  });
});
