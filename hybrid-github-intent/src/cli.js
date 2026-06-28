#!/usr/bin/env node
import { searchHybrid, DEFAULT_NEURAL_LEADS, DEFAULT_STRUCTURED_ROOT } from "./engine.js";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (command !== "search") {
  console.error("Usage: node src/cli.js search --query <query> [--limit 10]");
  process.exit(1);
}

try {
  const result = await searchHybrid({
    query: requiredArg(args.query, "--query"),
    structuredRoot: args["structured-root"] ?? DEFAULT_STRUCTURED_ROOT,
    neuralLeadsPath: args["neural-leads"] ?? DEFAULT_NEURAL_LEADS,
    limit: Number(args.limit ?? 10),
    requireProfile: args["allow-empty-profile"] !== "true"
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : "true";
  }
  return parsed;
}

function requiredArg(value, name) {
  if (!value) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}
