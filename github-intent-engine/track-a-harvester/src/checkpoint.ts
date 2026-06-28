import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheckpointStore, RepoHarvestData } from "./harvest.js";

export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly checkpointDir: string) {}

  async read(fullName: string): Promise<RepoHarvestData | null> {
    try {
      const content = await readFile(this.pathFor(fullName), "utf8");
      return JSON.parse(content) as RepoHarvestData;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async write(fullName: string, data: RepoHarvestData): Promise<void> {
    await mkdir(this.checkpointDir, { recursive: true });
    await writeFile(this.pathFor(fullName), `${JSON.stringify(data)}\n`);
  }

  private pathFor(fullName: string): string {
    return join(this.checkpointDir, `${fullName.replace(/[^A-Za-z0-9_.-]+/g, "__")}.json`);
  }
}
