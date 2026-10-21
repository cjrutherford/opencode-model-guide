import test from "node:test";
import assert from "node:assert/strict";

import { LRU } from "../../src/lru.ts";

test("updating a key refreshes recency without growing", () => {
  const cache = new LRU<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 3);
  cache.set("c", 4);

  assert.equal(cache.size, 2);
  assert.equal(cache.get("b"), undefined, "LRU behavior is incomplete: update did not refresh recency");
  assert.equal(cache.get("a"), 3);
  assert.equal(cache.get("c"), 4);
});

test("capacity one keeps only the newest entry", () => {
  const cache = new LRU<string, number>(1);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), undefined, "LRU behavior is incomplete: capacity one did not evict");
  assert.equal(cache.size, 1, "LRU behavior is incomplete: capacity one kept too many entries");
  assert.equal(cache.get("b"), 2);
});

test("missing gets do not create entries", () => {
  const cache = new LRU<string, number>(2);
  assert.equal(cache.get("missing"), undefined);
  assert.equal(cache.size, 0);
});
