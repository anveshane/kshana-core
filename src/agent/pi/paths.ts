import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up from `metaUrl` (typically `import.meta.url`) until we find
 * the kshana-core package's own `package.json`. Robust against being
 * called from either `src/...` (vitest, tsx) or `dist/server/manager.js`
 * (bundled CJS/ESM output) — the depth differs but the package
 * boundary is unambiguous via `name === "kshana-core"`.
 *
 * Used to resolve repo-relative resources (orchestrator prompt,
 * subagent prompts, prompt-skill markdown). The previous hardcoded
 * `../../..` worked from source but pointed one level too high
 * when bundled, ENOENT'ing on the orchestrator prompt.
 */
export function findKshanaCoreRoot(metaUrl: string): string {
  let dir = dirname(fileURLToPath(metaUrl));
  // Cap the walk at filesystem root — defensive guard, not a real loop bound.
  for (let i = 0; i < 64; i += 1) {
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: unknown };
        if (pkg.name === "kshana-core") {
          return resolve(dir);
        }
      } catch {
        // ignore unreadable / non-JSON package.json — keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `findKshanaCoreRoot: could not locate kshana-core package.json walking up from ${metaUrl}`,
  );
}

const REPO_ROOT = findKshanaCoreRoot(import.meta.url);

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
