import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate } from "../src/github.js";

test("pagination keeps already fetched rows when a later GitHub page is rate limited", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const page = new URL(String(url)).searchParams.get("page");
    if (page === "1") {
      return Response.json(Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })));
    }
    return Response.json({ message: "secondary rate limit" }, { status: 403 });
  };

  try {
    const rows = await paginate("/repos/acme/widgets/issues/comments?per_page=100");
    assert.equal(rows.length, 100);
    assert.equal(rows[0].id, 1);
    assert.equal(rows.at(-1).id, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
