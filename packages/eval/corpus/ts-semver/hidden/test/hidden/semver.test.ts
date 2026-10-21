import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions } from "../../src/semver.ts";

test("compares numeric prerelease identifiers numerically", () => {
  assert.equal(
    compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10"),
    -1,
    "semver behavior is incomplete: numeric prerelease comparison",
  );
});

test("a shorter prerelease is lower when the prefix is equal", () => {
  assert.equal(
    compareVersions("1.0.0-alpha", "1.0.0-alpha.1"),
    -1,
    "semver behavior is incomplete: short prerelease comparison",
  );
});

test("ignores build metadata", () => {
  assert.equal(compareVersions("1.0.0+build.1", "1.0.0+build.2"), 0);
});

test("compares major and minor releases", () => {
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
});
