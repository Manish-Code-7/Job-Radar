import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@job-radar/core", "@job-radar/db"],
  serverExternalPackages: ["pg", "pg-boss"],
  poweredByHeader: false,
};
export default config;
