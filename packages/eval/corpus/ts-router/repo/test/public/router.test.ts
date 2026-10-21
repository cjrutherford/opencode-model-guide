import test from "node:test";
import assert from "node:assert/strict";

import { Router } from "../../src/router.ts";

test("static routes win over dynamic routes", () => {
  const router = new Router();
  router.add("/users/:id", "user");
  router.add("/users/me", "me");

  assert.deepEqual(
    router.match("/users/me"),
    { handler: "me", params: {} },
    "router behavior is incomplete: static route did not win",
  );
});
