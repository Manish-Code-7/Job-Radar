FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @job-radar/web...
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @job-radar/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
