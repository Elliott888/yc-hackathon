import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJsonl(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}

export async function readJsonl(filePath) {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}
