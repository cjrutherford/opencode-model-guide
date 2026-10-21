import test from "node:test";
import assert from "node:assert/strict";

import { LRU } from "../../src/lru.ts";

test("evicts the least recently used entry", () => {
  const cache = new LRU<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);

  assert.equal(
    cache.get("b"),
    undefined,
    "LRU behavior is incomplete: least recently used entry was not evicted",
  );
  assert.equal(cache.size, 2);
});
