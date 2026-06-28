import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readJsonl, writeJsonl } from "../src/jsonl.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-intent-jsonl-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JSONL helpers", () => {
  test("writes one JSON object per line and reads it back", async () => {
    const file = join(dir, "records.jsonl");

    await writeJsonl(file, [{ id: 1 }, { id: 2, value: "two" }]);

    await expect(readFile(file, "utf8")).resolves.toBe(
      '{"id":1}\n{"id":2,"value":"two"}\n'
    );
    await expect(readJsonl(file)).resolves.toEqual([{ id: 1 }, { id: 2, value: "two" }]);
  });
});
