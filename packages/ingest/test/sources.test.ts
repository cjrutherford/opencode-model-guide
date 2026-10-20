import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fetchDocs, fetchSources, parseArgs } from "../src/run";
import { parseModelsDev } from "../src/sources/modelsDev";
import { parseLiveIds } from "../src/sources/opencodeModels";
import rawModelsDev from "./fixtures/models-dev.sample.json";
import rawLive from "./fixtures/opencode-models.sample.json";
import rawGoLive from "./fixtures/opencode-go-models.sample.json";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("parseModelsDev", () => {
  it("selects opencode then opencode-go", () => {
    const providers = parseModelsDev(rawModelsDev);
    expect(providers.map((provider) => provider.id)).toEqual([
      "opencode",
      "opencode-go",
    ]);
    expect(Object.keys(providers[0]!.models)).toHaveLength(5);
    expect(Object.keys(providers[1]!.models)).toHaveLength(1);
  });

  it("does not filter deprecated models", () => {
    const providers = parseModelsDev(rawModelsDev);
    expect(providers[0]!.models["old-model"]?.status).toBe("deprecated");
  });

  it("throws when a required provider is missing", () => {
    expect(() => parseModelsDev({ opencode: { models: {} } })).toThrow(
      /opencode-go/,
    );
  });
});

describe("parseLiveIds", () => {
  it("returns the id set", () => {
    const ids = parseLiveIds(rawLive);
    expect([...ids].sort()).toEqual([
      "deepseek-v4.1-flash-free",
      "kimi-k3",
      "old-model",
    ]);
    expect(parseLiveIds(rawGoLive).has("glm-5.3")).toBe(true);
  });

  it("throws on a payload without a data array", () => {
    expect(() => parseLiveIds({ object: "list" })).toThrow(/data/i);
  });
});

describe("fetchSources (fixtures)", () => {
  it("reads the three fixtures without the network", async () => {
    const fetched = await fetchSources(fixturesDir);
    expect(fetched.providers).toHaveLength(2);
    expect(fetched.live.has("kimi-k3")).toBe(true);
    expect(fetched.goLive.has("glm-5.3")).toBe(true);
    expect(fetched.sources.map((source) => source.id)).toEqual([
      "models.dev",
      "opencode.models",
      "opencode-go.models",
    ]);
    expect(fetched.sources.every((source) => source.ok)).toBe(true);
    expect(fetched.sources[0]!.itemCount).toBe(6);
  });
});

describe("fetchDocs (fixtures)", () => {
  it("reads both docs pages without the network", async () => {
    const docs = await fetchDocs(fixturesDir);
    expect(docs.available).toEqual({ console: true, go: true });
    expect(docs.evidence.freeModels).toHaveLength(17);
    expect(docs.evidence.planPrices).toEqual({ go: 10, goPlus: 40 });
    expect(docs.sources.map((source) => source.id)).toEqual([
      "opencode.console-docs",
      "opencode.go-docs",
    ]);
    expect(docs.refs.map((ref) => ref.id)).toEqual([
      "opencode.console-docs",
      "opencode.go-docs",
    ]);
    expect(docs.sources.every((source) => source.ok)).toBe(true);
    expect(
      docs.sources.find((source) => source.id === "opencode.console-docs")?.required,
    ).toBe(true);
    expect(
      docs.sources.find((source) => source.id === "opencode.go-docs")?.required,
    ).toBe(false);
  });
});

describe("parseArgs", () => {
  it("parses --fixtures and --dry-run", () => {
    expect(parseArgs(["--fixtures", "some/dir", "--dry-run"])).toEqual({
      fixtures: "some/dir",
      dryRun: true,
    });
    expect(parseArgs(["--fixtures=some/dir"])).toEqual({
      fixtures: "some/dir",
      dryRun: false,
    });
    expect(parseArgs([])).toEqual({ fixtures: null, dryRun: false });
  });

  it("rejects unknown arguments and a missing fixtures value", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/i);
    expect(() => parseArgs(["--fixtures"])).toThrow(/requires a directory/i);
  });
});
