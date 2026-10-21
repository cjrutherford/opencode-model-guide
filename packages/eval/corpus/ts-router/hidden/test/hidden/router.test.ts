import test from "node:test";
import assert from "node:assert/strict";

import { Router } from "../../src/router.ts";

test("decodes path parameters", () => {
  const router = new Router();
  router.add("/users/:id", "user");
  assert.deepEqual(router.match("/users/hello%20world"), {
    handler: "user",
    params: { id: "hello world" },
  }, "router behavior is incomplete: parameter was not decoded");
});

test("static segments win even with more specific dynamic routes", () => {
  const router = new Router();
  router.add("/files/:name/edit", "dynamic");
  router.add("/files/new/edit", "static");
  assert.equal(
    router.match("/files/new/edit")?.handler,
    "static",
    "router behavior is incomplete: static segment did not win",
  );
});

test("returns null when no route matches", () => {
  const router = new Router();
  router.add("/users/:id", "user");
  assert.equal(router.match("/teams/1"), null);
});

test("collects multiple parameters", () => {
  const router = new Router();
  router.add("/orgs/:org/repos/:repo", "repo");
  assert.deepEqual(router.match("/orgs/acme/repos/guide"), {
    handler: "repo",
    params: { org: "acme", repo: "guide" },
  });
});
