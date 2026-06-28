import { Command } from "commander";
import { rawDataDir } from "./paths.js";
import { validateRawData } from "./validator.js";

const program = new Command()
  .name("validate:raw")
  .option("--raw-dir <path>", "raw data directory", rawDataDir);

program.parse(process.argv);

const options = program.opts<{ rawDir: string }>();
const result = await validateRawData(options.rawDir);

if (result.warnings.length > 0) {
  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }
}

if (!result.ok) {
  for (const error of result.errors) {
    console.error(`error: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Raw data validation passed for ${options.rawDir}`);
}
