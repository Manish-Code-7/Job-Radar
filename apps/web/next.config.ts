import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Single source of env: the repo-root .env written by `neon deploy`. Real env vars win.
const rootEnv = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@job-radar/core", "@job-radar/db"],
  serverExternalPackages: ["pg", "pg-boss"],
  poweredByHeader: false,
};
export default config;
