import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const REPO_ROOT = resolve(new URL("../../..", import.meta.url).pathname);

function isPackaged(): boolean {
  return process.env["KSHANA_PACKAGED"] === "1" || process.env["KSHANA_PACKAGED"] === "true";
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

export function getProjectsDir(): string {
  const override = process.env["KSHANA_PROJECTS_DIR"];
  if (override) return resolve(expandTilde(override));
  if (isPackaged()) {
    return resolve(homedir(), "Kshana");
  }
  return REPO_ROOT;
}

export function getKshanaConfigDir(): string {
  const override = process.env["KSHANA_CONFIG_DIR"];
  if (override) return resolve(expandTilde(override));
  return resolve(homedir(), ".kshana");
}

export function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  return path;
}

export { REPO_ROOT };
