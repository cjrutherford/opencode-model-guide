import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runNotify } from "../src/run";

let previousExitCode: number | string | null | undefined;

beforeEach(() => {
  previousExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("notify cli", () => {
  it("warns and exits 0 in a normal run when NTFY_TOPIC is missing", async () => {
    vi.stubEnv("NTFY_TOPIC", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runNotify({ dryRun: false });

    expect(process.exitCode).toBe(0);
    expect(error.mock.calls.flat().join("\n")).toContain("NTFY_TOPIC is not set");
  });

  it("exits 1 in a dry run when NTFY_TOPIC is missing", async () => {
    vi.stubEnv("NTFY_TOPIC", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runNotify({ dryRun: true });

    expect(process.exitCode).toBe(1);
  });
});
