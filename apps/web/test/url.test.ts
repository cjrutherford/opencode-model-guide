import { describe, expect, it } from "vitest";

import { url } from "../src/lib/url";

describe("url", () => {
  it("prefixes the base path once", () => {
    expect(url("/models", "/repo")).toBe("/repo/models");
    expect(url("/", "/repo")).toBe("/repo/");
  });

  it("handles root base", () => {
    expect(url("/models", "/")).toBe("/models");
    expect(url("/", "/")).toBe("/");
  });

  it("does not double-prefix", () => {
    expect(url("/repo/models", "/repo")).toBe("/repo/models");
    expect(url("/repo?free=limited-time", "/repo")).toBe(
      "/repo?free=limited-time",
    );
  });

  it("preserves query strings", () => {
    expect(url("/models?free=limited-time", "/repo")).toBe(
      "/repo/models?free=limited-time",
    );
  });

  it("normalizes a missing leading slash and trailing base slash", () => {
    expect(url("models", "/repo/")).toBe("/repo/models");
    expect(url("models", "/")).toBe("/models");
  });
});
