#!/usr/bin/env tsx
/**
 * Phase 5 backfill CLI: reads existing manifest + executorState in a
 * project's <name>.kshana folder and writes the equivalent
 * scenes/shots/frames tree into project.json.
 *
 * Usage:
 *   pnpm backfill-schema <project-name>
 *   pnpm backfill-schema --all     # walk every *.kshana folder in cwd
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { backfillProjectSchema } from "../src/core/project/backfillProjectSchema.js";

function backfillOne(projectName: string): void {
  const dirName = projectName.endsWith(".kshana") ? projectName : `${projectName}.kshana`;
  const dir = resolve(dirName);
  const result = backfillProjectSchema(dir);
  console.log(
    `[${projectName}] scenes+${result.scenesAdded}, shots+${result.shotsAdded}, frames+${result.framesAdded}, videos+${result.videosAdded}, finalVideo=${result.finalVideoSet}`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log("Usage: pnpm backfill-schema <project-name>");
    console.log("       pnpm backfill-schema --all");
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  if (args.includes("--all")) {
    const cwd = process.cwd();
    const projects = readdirSync(cwd).filter((name) => {
      if (!name.endsWith(".kshana")) return false;
      try {
        return statSync(join(cwd, name)).isDirectory();
      } catch {
        return false;
      }
    });
    for (const dir of projects) {
      try {
        backfillOne(dir);
      } catch (err) {
        console.error(`  ERROR: ${(err as Error).message}`);
      }
    }
    return;
  }

  for (const arg of args) {
    try {
      backfillOne(arg);
    } catch (err) {
      console.error(`Failed to backfill ${arg}: ${(err as Error).message}`);
      process.exit(1);
    }
  }
}

main();
