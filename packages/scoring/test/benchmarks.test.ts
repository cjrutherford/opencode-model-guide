import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseAaPage, fetchAa } from "../src/benchmarks/aa";
import { parseAider } from "../src/benchmarks/aider";
import {
  LMARENA_CONFIGS,
  LMARENA_CONFIG_IDS,
  parseLmarena,
} from "../src/benchmarks/lmarena";
import { parseSweBench } from "../src/benchmarks/sweBench";
import { terminalBenchAdapter } from "../src/benchmarks/terminalBench";
import type { JsonFetcher } from "../src/benchmarks/types";
import aaFree from "./fixtures/aa-free.json";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("SWE-bench adapter", () => {
  it("parses verified and multilingual mini-SWE-agent runs", () => {
    const results = parseSweBench(fixture("swebench.html"));

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.harness === "mini-SWE-agent")).toBe(true);
    expect(
      results.every(
        (result) =>
          result.benchmark === "swe-bench-verified" ||
          result.benchmark === "swe-bench-multilingual",
      ),
    ).toBe(true);
    expect(results[0]?.benchmark).toBe("swe-bench-verified");
    expect(results[0]?.costPerTaskUsd).toBeGreaterThan(0);
  });

  it("keeps the newest run per model and benchmark", () => {
    const results = parseSweBench(fixture("swebench.html"));
    const verified = results.filter(
      (result) =>
        result.benchmark === "swe-bench-verified" &&
        result.modelNameRaw === "Claude 4.5 Opus",
    );

    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({ date: "2026-02-17", value: 76.8 });
  });

  it("rejects a page without the embedded leaderboard", () => {
    expect(() => parseSweBench("<html></html>")).toThrow(/leaderboard-data/i);
  });
});

describe("Aider adapter", () => {
  it("keeps the latest run per model", () => {
    const results = parseAider(fixture("aider.yml"));
    const gpt5 = results.filter((result) => result.modelNameRaw === "gpt-5");

    expect(gpt5).toHaveLength(1);
    expect(gpt5[0]).toMatchObject({
      benchmark: "aider-polyglot",
      metric: "percent",
      value: 57.6,
      date: "2025-02-14",
    });
  });
});

describe("LMArena adapter", () => {
  it("paginates until num_rows_total", async () => {
    const total = 150;
    const fetch: JsonFetcher = async (url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const count = Math.max(0, Math.min(100, total - offset));
      return {
        num_rows_total: total,
        rows: Array.from({ length: count }, (_, index) => ({
          row: {
            model_name: `Model ${offset + index}`,
            rating: 1500 + offset + index,
            leaderboard_publish_date: "2026-10-19",
          },
        })),
      };
    };

    const results = await parseLmarena({ fetch, config: "webdev" });
    expect(results).toHaveLength(150);
    expect(results[0]).toMatchObject({
      benchmark: "lmarena-webdev",
      metric: "elo",
      value: 1500,
    });
  });

  it("maps every config to its own benchmark and field", async () => {
    for (const config of LMARENA_CONFIG_IDS) {
      const info = LMARENA_CONFIGS[config];
      const fetch: JsonFetcher = async () => ({
        num_rows_total: 1,
        rows: [
          {
            row: {
              model_name: "Example",
              [info.field]: 123,
              leaderboard_publish_date: "2026-10-19",
            },
          },
        ],
      });

      const results = await parseLmarena({ fetch, config });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        benchmark: info.benchmark,
        metric: info.metric,
        value: 123,
      });
    }
  });

  it("keeps only the overall category", async () => {
    const fetch: JsonFetcher = async () => ({
      num_rows_total: 2,
      rows: [
        {
          row: {
            model_name: "Overall Model",
            rating: 1500,
            category: "overall",
            leaderboard_publish_date: "2026-10-19",
          },
        },
        {
          row: {
            model_name: "Coding Model",
            rating: 1600,
            category: "coding",
            leaderboard_publish_date: "2026-10-19",
          },
        },
      ],
    });

    const results = await parseLmarena({ fetch, config: "webdev" });
    expect(results.map((result) => result.modelNameRaw)).toEqual(["Overall Model"]);
  });

  it("keeps partial rows when a later page fails", async () => {
    let calls = 0;
    const failures: string[] = [];
    const fetch: JsonFetcher = async () => {
      calls += 1;
      if (calls === 2) throw new Error("HTTP 502");
      return {
        num_rows_total: 150,
        rows: Array.from({ length: 100 }, (_, index) => ({
          row: {
            model_name: `Model ${index}`,
            rating: 1500 + index,
            leaderboard_publish_date: "2026-10-19",
          },
        })),
      };
    };

    const results = await parseLmarena({
      fetch,
      config: "webdev",
      onPageError: (error, offset) => {
        failures.push(`${offset}: ${error instanceof Error ? error.message : String(error)}`);
      },
    });

    expect(results).toHaveLength(100);
    expect(failures).toEqual(["100: HTTP 502"]);
  });
});

describe("Artificial Analysis adapter", () => {
  it("maps coding index results and skips null coding scores", () => {
    const results = parseAaPage(aaFree, { date: "2026-10-20" });

    expect(results).toHaveLength(3);
    expect(
      results.every(
        (result) =>
          result.benchmark === "artificial-analysis" &&
          result.metric === "score" &&
          result.costPerTaskUsd === undefined,
      ),
    ).toBe(true);

    const sample = results.find((result) => result.modelNameRaw === "Gemini 3.5 Flash (High)");
    expect(sample).toMatchObject({
      value: 70.1,
      date: "2026-10-20",
      meta: {
        intelligence: 32.6,
        agentic: 26,
        coding: 70.1,
        intelligenceIndexVersion: 4.3,
        tier: "free",
      },
    });
  });

  it("returns skipped without a key", async () => {
    const result = await fetchAa({ apiKey: "" });
    expect(result.results).toEqual([]);
    expect(result.status).toMatchObject({ status: "skipped", ok: false });
  });

  it("paginates and returns a failed status instead of throwing", async () => {
    let calls = 0;
    const fetch: JsonFetcher = async () => {
      calls += 1;
      return {
        tier: "free",
        intelligence_index_version: 4.3,
        pagination: { has_more: calls === 1 },
        data: [
          {
            name: `Model ${calls}`,
            evaluations: {
              artificial_analysis_intelligence_index: 10,
              artificial_analysis_coding_index: 20,
              artificial_analysis_agentic_index: 30,
            },
          },
        ],
      };
    };

    const ok = await fetchAa({
      apiKey: "test",
      fetch,
      now: "2026-10-20T13:00:00.000Z",
    });
    expect(calls).toBe(2);
    expect(ok.results).toHaveLength(2);
    expect(ok.status).toMatchObject({ status: "ok", required: false });

    const failed = await fetchAa({
      apiKey: "test",
      fetch: async () => {
        throw new Error("boom");
      },
    });
    expect(failed.results).toEqual([]);
    expect(failed.status).toMatchObject({ status: "failed", ok: false });
  });
});

describe("Terminal-Bench adapter", () => {
  it("returns skipped in v1", () => {
    const result = terminalBenchAdapter("2026-10-20T13:00:00.000Z");
    expect(result.results).toEqual([]);
    expect(result.status).toMatchObject({
      status: "skipped",
      ok: false,
      required: false,
      reason: "no stable machine-readable leaderboard in v1",
    });
  });
});
