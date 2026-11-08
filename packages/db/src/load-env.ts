import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the repo-root .env (written by `neon deploy` / `neon env pull`) for CLI processes.
 * Variables already set in the environment win, so Docker/CI/Neon Functions are unaffected.
 */
export function loadRootEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const f = join(dir, ".env");
    if (existsSync(f) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      try {
        process.loadEnvFile(f);
      } catch {
        /* unreadable .env: rely on the real environment */
      }
      return f;
    }
    dir = dirname(dir);
  }
  return null;
}
