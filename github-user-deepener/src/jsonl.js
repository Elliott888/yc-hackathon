import { readFile } from "node:fs/promises";

export async function readJsonl(filePath, { optional = false } = {}) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readJson(filePath, { optional = false } = {}) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(content);
}
