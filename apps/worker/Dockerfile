# Worker + migrations. Playwright's official image ships Chromium and its deps for linux/arm64 and amd64.
FROM mcr.microsoft.com/playwright:v1.65.0-noble
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NODE_ENV=production
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @job-radar/worker... --filter @job-radar/db... --prod=false
COPY packages ./packages
COPY apps/worker ./apps/worker
# Cache the local embedding model in the image layer's home so first start is fast.
ENV HF_HOME=/app/.cache/hf
USER pwuser
CMD ["pnpm", "--filter", "@job-radar/worker", "start"]
