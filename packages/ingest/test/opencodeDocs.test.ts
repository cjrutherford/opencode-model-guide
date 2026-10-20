import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CONSOLE_DOCS_URL,
  GO_DOCS_URL,
  mergeDocsEvidence,
  parseConsoleDocs,
  parseGoDocs,
} from "../src/sources/opencodeDocs";

const NOW = "2026-10-19T13:00:00.000Z";

const consoleHtml = readFileSync(
  new URL("./fixtures/console-docs.html", import.meta.url),
  "utf8",
);
const goHtml = readFileSync(
  new URL("./fixtures/go-docs.html", import.meta.url),
  "utf8",
);

const consoleSource = {
  id: "opencode.console-docs" as const,
  url: CONSOLE_DOCS_URL,
  fetchedAt: NOW,
};

const goSource = {
  id: "opencode.go-docs" as const,
  url: GO_DOCS_URL,
  fetchedAt: NOW,
};

describe("parseConsoleDocs", () => {
  it("parses the free list with terms", () => {
    const evidence = parseConsoleDocs(consoleHtml, consoleSource);
    expect(evidence.freeModels).toHaveLength(14);
    expect(evidence.freeModels).toContainEqual(
      expect.objectContaining({
        name: "DeepSeek V4.1 Flash Free",
        limitedTime: true,
        training: "none",
        retentionDays: 0,
      }),
    );
    expect(evidence.freeModels).toContainEqual(
      expect.objectContaining({
        name: "Big Pickle",
        stealth: true,
        training: "may-train",
      }),
    );
  });

  it("merges privacy exceptions into free-list entries", () => {
    const evidence = parseConsoleDocs(consoleHtml, consoleSource);
    const nemotron = evidence.freeModels.find(
      (entry) => entry.name === "Nemotron 3 Ultra Free",
    );
    expect(nemotron).toMatchObject({
      training: "may-train",
      trialOnly: true,
    });

    const beam = evidence.freeModels.find((entry) => entry.name === "Beam Free");
    expect(beam).toMatchObject({ training: "none", retentionDays: 30 });
    expect(beam?.regionsExcluded).toContain("Angola");
    expect(beam?.regionsExcluded).toContain("Venezuela");
    expect(beam?.regionsExcluded?.length).toBeGreaterThan(10);

    const jev = evidence.freeModels.find((entry) => entry.name === "Jev 1.13 Free");
    expect(jev).toMatchObject({ limitedTime: true, training: "unknown" });
    expect(jev?.retentionDays).toBeUndefined();
  });

  it("parses console prices including Free rows", () => {
    const evidence = parseConsoleDocs(consoleHtml, consoleSource);
    expect(evidence.prices).toHaveLength(103);
    expect(
      evidence.prices.find((entry) => entry.name === "DeepSeek V4.1 Flash Free"),
    ).toMatchObject({ free: true, input: 0, output: 0 });
    expect(
      evidence.prices.find((entry) => entry.name === "Jev 1.13"),
    ).toMatchObject({ free: false, input: 0.042, output: 0 });
    expect(
      evidence.prices.find((entry) => entry.name === "Beam Free"),
    ).toMatchObject({ free: true, input: 0, output: 0 });
  });

  it("parses endpoint ids", () => {
    const evidence = parseConsoleDocs(consoleHtml, consoleSource);
    expect(evidence.endpoints).toHaveLength(88);
    expect(evidence.endpoints).toContainEqual({
      name: "Jev 1.13 Free",
      id: "jev-1.13-free",
      group: "console",
    });
    expect(evidence.endpoints).toContainEqual({
      name: "Jev 1.13",
      id: "jev-1.13",
      group: "console",
    });
  });

  it("returns a source ref and no plan prices", () => {
    const evidence = parseConsoleDocs(consoleHtml, consoleSource);
    expect(evidence.sources).toEqual([consoleSource]);
    expect(evidence.sourceRefs).toEqual([consoleSource]);
    expect(evidence.planPrices).toEqual({ go: 0, goPlus: 0 });
  });

  it("throws when none of the expected sections exist", () => {
    expect(() => parseConsoleDocs("<html><body><p>blocked</p></body></html>")).toThrow(
      /none of the expected sections/i,
    );
  });
});

describe("parseGoDocs", () => {
  it("parses plan prices", () => {
    const evidence = parseGoDocs(goHtml, goSource);
    expect(evidence.planPrices).toEqual({ go: 10, goPlus: 40 });
  });

  it("parses per-model prices and monthly limits", () => {
    const evidence = parseGoDocs(goHtml, goSource);
    expect(evidence.prices).toHaveLength(36);
    expect(
      evidence.prices.find((entry) => entry.name === "GLM-5.3"),
    ).toMatchObject({
      input: 1.4,
      output: 4.4,
      cacheRead: 0.26,
      monthlyLimitUsd: 15,
      free: false,
      unlimited: false,
    });
    expect(
      evidence.prices.find((entry) => entry.name === "Beam Free"),
    ).toMatchObject({
      free: true,
      unlimited: true,
      limitedTime: true,
    });
  });

  it("parses the privacy table", () => {
    const evidence = parseGoDocs(goHtml, goSource);
    expect(evidence.goPrivacy).toHaveLength(29);
    expect(
      evidence.goPrivacy.find((entry) => entry.name === "GLM-5.3"),
    ).toMatchObject({ training: "none", retentionDays: 0 });
    expect(
      evidence.goPrivacy.find(
        (entry) => entry.name === "Gemini 4 Argon Contributor",
      ),
    ).toMatchObject({ training: "may-train", notes: "Not ZDR" });
  });

  it("derives Go free entries from Free and Unlimited rows", () => {
    const evidence = parseGoDocs(goHtml, goSource);
    expect(evidence.freeModels).toHaveLength(3);
    expect(evidence.freeModels).toContainEqual(
      expect.objectContaining({
        name: "Beam Free",
        group: "go",
        limitedTime: true,
        training: "none",
        retentionDays: 30,
      }),
    );
    expect(
      evidence.freeModels.find(
        (entry) => entry.name === "LongCat 2.5 Preview Free",
      ),
    ).toMatchObject({ training: "none", retentionDays: 0 });
  });

  it("parses endpoint ids", () => {
    const evidence = parseGoDocs(goHtml, goSource);
    expect(evidence.endpoints).toHaveLength(29);
    expect(evidence.endpoints).toContainEqual({
      name: "Beam Free",
      id: "beam-free",
      group: "go",
    });
  });

  it("throws when none of the expected sections exist", () => {
    expect(() => parseGoDocs("<html><body><p>blocked</p></body></html>")).toThrow(
      /none of the expected sections/i,
    );
  });
});

describe("mergeDocsEvidence", () => {
  it("merges both pages and dedupes sources", () => {
    const merged = mergeDocsEvidence(
      parseConsoleDocs(consoleHtml, consoleSource),
      parseGoDocs(goHtml, goSource),
    );

    expect(merged.freeModels).toHaveLength(17);
    expect(merged.prices).toHaveLength(139);
    expect(merged.endpoints).toHaveLength(117);
    expect(merged.planPrices).toEqual({ go: 10, goPlus: 40 });
    expect(merged.sources.map((source) => source.id)).toEqual([
      "opencode.console-docs",
      "opencode.go-docs",
    ]);
    expect(merged.sourceRefs).toEqual(merged.sources);
  });
});
