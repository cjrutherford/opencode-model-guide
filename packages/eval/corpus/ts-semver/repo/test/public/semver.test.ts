import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions } from "../../src/semver.ts";

test("orders prereleases before the release", () => {
  assert.equal(
    compareVersions("1.0.0-alpha", "1.0.0"),
    -1,
    "semver behavior is incomplete: prerelease was not ordered before release",
  );
});
