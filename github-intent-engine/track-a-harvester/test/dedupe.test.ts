import { describe, expect, test } from "vitest";
import { dedupeBy } from "../src/dedupe.js";

describe("dedupeBy", () => {
  test("keeps the first record for a stable key and reports duplicates", () => {
    const result = dedupeBy(
      [
        { id: 1, value: "first" },
        { id: 2, value: "second" },
        { id: 1, value: "duplicate" }
      ],
      (record) => String(record.id)
    );

    expect(result.records).toEqual([
      { id: 1, value: "first" },
      { id: 2, value: "second" }
    ]);
    expect(result.duplicateKeys).toEqual(["1"]);
  });
});
