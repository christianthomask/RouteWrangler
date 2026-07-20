# Production image for the NestJS API (@routewrangler/api), built from the
# monorepo root so the workspace packages it depends on (contracts, simulator)
# are available. Used by Cloudflare Containers (apps/api/wrangler.jsonc) — and by
# any container host (Fly/Render) as a fallback. ADR-019.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Install deps against the committed lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/simulator/package.json packages/simulator/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @routewrangler/api... --filter @routewrangler/contracts --filter @routewrangler/simulator

# Build the API and its workspace deps.
COPY packages/contracts packages/contracts
COPY packages/simulator packages/simulator
COPY apps/api apps/api
RUN pnpm --filter @routewrangler/contracts build \
 && pnpm --filter @routewrangler/simulator build \
 && pnpm --filter @routewrangler/api build

FROM node:22-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# The container reads its config from env/secrets (DATABASE_URL, STORAGE_*,
# AUTH_PROVIDER=oidc + Clerk issuer). See docs/runbook.md.
CMD ["node", "dist/main.js"]
