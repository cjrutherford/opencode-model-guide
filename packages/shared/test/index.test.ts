import { describe, expect, it } from "vitest";

import { SHARED_PACKAGE } from "../src/index";

describe("shared package", () => {
  it("exports its package name", () => {
    expect(SHARED_PACKAGE).toBe("@omg/shared");
  });
});
