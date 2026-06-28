import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("research route asks for and accepts only two to three pain points", () => {
  const source = read("src/app/api/research/route.ts");

  assert.match(source, /Return 2 to 3 pain points/);
  assert.doesNotMatch(source, /Return 4 to 5 pain points/);
  assert.match(source, /parsed\.painPoints\.slice\(0, 3\)/);
  assert.match(source, /painPoint\.subpoints\.slice\(0, 3\)/);
});
