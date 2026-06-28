import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCliError } from "../src/errors.js";

test("formats GitHub 403 errors with token guidance", () => {
  const error = new Error("GitHub request failed 403 for /repos/acme/widgets");
  error.status = 403;

  assert.match(formatCliError(error), /GitHub returned 403/);
  assert.match(formatCliError(error), /GITHUB_TOKEN/);
});
