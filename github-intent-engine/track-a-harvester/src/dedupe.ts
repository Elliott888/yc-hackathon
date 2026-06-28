export type DedupeResult<T> = {
  records: T[];
  duplicateKeys: string[];
};

export function dedupeBy<T>(records: T[], keyFor: (record: T) => string): DedupeResult<T> {
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  const deduped: T[] = [];

  for (const record of records) {
    const key = keyFor(record);
    if (seen.has(key)) {
      duplicateKeys.push(key);
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return { records: deduped, duplicateKeys };
}
