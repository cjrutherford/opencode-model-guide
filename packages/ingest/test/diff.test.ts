import { describe, expect, it } from "vitest";

import {
  SnapshotSchema,
  eventId,
  type ChangeEvent,
  type Snapshot,
} from "@omg/shared";

import {
  diffSnapshots,
  isFreeNow,
  isZeroMarginal,
} from "../src/diff";
import snapshotNextRaw from "./fixtures/snapshot.next.json";
import snapshotPrevRaw from "./fixtures/snapshot.prev.json";

const NOW = "2026-10-19T13:00:00.000Z";
const REQUIRED_SOURCES = [
  "models.dev",
  "opencode.models",
  "opencode.console-docs",
] as const;

const prev = SnapshotSchema.parse(snapshotPrevRaw);
const next = SnapshotSchema.parse(snapshotNextRaw);

function diff(
  before: Snapshot | null = prev,
  after: Snapshot = next,
  requiredSources: readonly string[] = REQUIRED_SOURCES,
): ChangeEvent[] {
  return diffSnapshots(before, after, { now: NOW, requiredSources });
}

function ofType(events: ChangeEvent[], type: ChangeEvent["type"]): ChangeEvent[] {
  return events.filter((event) => event.type === type);
}

describe("free helpers", () => {
  it("treats open-free, limited-time, and trial as free now", () => {
    for (const kind of ["open-free", "limited-time", "trial"] as const) {
      expect(isFreeNow({ free: { kind, flags: [] } })).toBe(true);
    }
    expect(isFreeNow({ free: { kind: "subscription-included", flags: [] } })).toBe(false);
    expect(isFreeNow({ free: { kind: "paid", flags: [] } })).toBe(false);
  });

  it("counts subscription-included as zero marginal cost but not free now", () => {
    const model = { free: { kind: "subscription-included" as const, flags: [] } };
    expect(isFreeNow(model)).toBe(false);
    expect(isZeroMarginal(model)).toBe(true);
  });
});

describe("diffSnapshots", () => {
  it("emits free_started when a paid model becomes limited-time free", () => {
    const events = diff();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "free_started",
        modelKey: "opencode/example-model",
        notify: true,
      }),
    );

    const started = ofType(events, "free_started").find(
      (event) => event.modelKey === "opencode/example-model",
    );
    expect(started?.summary).toBe("Example Model is now free (limited time).");
    expect(started?.data).toMatchObject({ from: "paid", to: "limited-time" });
  });

  it("emits free_ended when a free model becomes paid", () => {
    const events = diff();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "free_ended",
        modelKey: "opencode/old-free",
        notify: true,
      }),
    );
  });

  it("emits free_ended and deprecated when a free model becomes deprecated", () => {
    const events = diff();
    const ended = ofType(events, "free_ended").find(
      (event) => event.modelKey === "opencode/deprecating",
    );
    expect(ended).toMatchObject({ notify: true });
    expect(ended?.summary).toContain("no longer free (deprecated)");

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "deprecated",
        modelKey: "opencode/deprecating",
        notify: true,
      }),
    );
  });

  it("emits price_changed with before/after values", () => {
    const events = diff();
    const changed = ofType(events, "price_changed").find(
      (event) => event.modelKey === "opencode/pricey",
    );
    expect(changed?.notify).toBe(false);
    expect(changed?.data).toMatchObject({
      before: { input: 1 },
      after: { input: 0.8 },
    });
    expect(changed?.summary).toBe(
      "Pricey input price changed from $1.00 to $0.80 per 1M tokens.",
    );
  });

  it("does not emit model_added on bootstrap", () => {
    expect(diff(null, next)).toEqual([]);
  });

  it("does not emit events for an identical snapshot", () => {
    expect(diff(next, next)).toEqual([]);
  });

  it("emits model_added for new keys and notifies only for free models", () => {
    const events = diff();
    const added = ofType(events, "model_added");
    expect(added.find((event) => event.modelKey === "opencode/new-free")?.notify).toBe(true);
    expect(added.find((event) => event.modelKey === "opencode/new-paid")?.notify).toBe(false);
  });

  it("emits source_failed only for required sources", () => {
    const events = diff();
    const failed = ofType(events, "source_failed");
    expect(failed).toEqual([
      expect.objectContaining({
        modelKey: "system/models.dev",
        notify: true,
        data: { source: "models.dev", error: "HTTP 503" },
      }),
    ]);
    expect(failed.some((event) => event.modelKey === "system/opencode-go.models")).toBe(false);
  });

  it("treats a required source missing from the next snapshot as failed", () => {
    const withoutSources: Snapshot = { ...prev, sources: [] };
    const events = diff(prev, withoutSources);
    expect(ofType(events, "source_failed").map((event) => event.modelKey)).toEqual([
      "system/models.dev",
      "system/opencode.console-docs",
      "system/opencode.models",
    ]);
  });

  it("does not emit source_failed again when the source was already down", () => {
    expect(diff(next, next)).toEqual([]);
  });

  it("does not emit free_started for paid to subscription-included", () => {
    const events = diff();
    expect(
      events.some(
        (event) =>
          event.type === "free_started" && event.modelKey === "opencode-go/plan-model",
      ),
    ).toBe(false);
  });

  it("does not emit a free transition when one free kind changes to another", () => {
    const events = diff();
    expect(
      events.some(
        (event) =>
          event.modelKey === "opencode/free-to-free" &&
          (event.type === "free_started" || event.type === "free_ended"),
      ),
    ).toBe(false);
  });

  it("does not emit events for a model removed from the catalog", () => {
    expect(diff().some((event) => event.modelKey === "opencode/removed")).toBe(false);
  });

  it("builds deterministic, unique IDs and sorts events", () => {
    const events = diff();
    expect(events.length).toBeGreaterThan(0);

    const ids = events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const event of events) {
      expect(event.id).toBe(eventId(event.type, event.modelKey, NOW));
      expect(event.at).toBe(NOW);
    }

    const sorted = [...events].sort((left, right) => {
      if (left.at !== right.at) return left.at < right.at ? -1 : 1;
      if (left.type !== right.type) return left.type < right.type ? -1 : 1;
      return left.modelKey < right.modelKey ? -1 : left.modelKey > right.modelKey ? 1 : 0;
    });
    expect(events).toEqual(sorted);
  });

  it("ignores undefined optional price fields when comparing", () => {
    const left: Snapshot = structuredClone(prev);
    const right: Snapshot = structuredClone(prev);
    const leftModel = left.models.find((model) => model.key === "opencode/stable")!;
    const rightModel = right.models.find((model) => model.key === "opencode/stable")!;
    leftModel.pricing.cacheRead = undefined;
    delete rightModel.pricing.cacheRead;

    expect(diff(left, right)).toEqual([]);
  });
});
