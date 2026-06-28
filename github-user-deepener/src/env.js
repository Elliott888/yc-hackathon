import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadEnvFiles({
  cwd = process.cwd(),
  env = process.env,
  files = [".env.local", ".env"]
} = {}) {
  const loadedFiles = [];
  const loadedKeys = [];

  for (const file of files) {
    const filePath = path.resolve(cwd, file);
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    loadedFiles.push(filePath);
    for (const [key, value] of parseEnvContent(content)) {
      if (Object.hasOwn(env, key)) continue;
      env[key] = value;
      loadedKeys.push(key);
    }
  }

  return {
    loaded_files: loadedFiles,
    loaded_keys: loadedKeys
  };
}

function parseEnvContent(content) {
  const entries = [];
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    entries.push([match[1], unquote(match[2].trim())]);
  }
  return entries;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
