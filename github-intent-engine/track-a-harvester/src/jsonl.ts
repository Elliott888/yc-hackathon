import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeJsonl<T>(path: string, records: T[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, content.length > 0 ? `${content}\n` : "");
}

export async function readJsonl<T = unknown>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf8");
  if (!content.trim()) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}
