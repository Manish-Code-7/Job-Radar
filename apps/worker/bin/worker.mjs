#!/usr/bin/env node
// `pnpm worker crawl --company Razorpay --dry`
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const r = spawnSync("npx", ["tsx", cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
