import { readFile } from "node:fs/promises";

export async function readJsonl(path, { optional = false } = {}) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
