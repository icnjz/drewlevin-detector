FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build

COPY package.json package-lock.json .npmrc ./
RUN npm ci --workspaces=false --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

FROM base AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/runtime-env.mjs ./scripts/runtime-env.mjs
COPY --from=build /app/scripts/start.mjs ./scripts/start.mjs

RUN mkdir -p /app/.wrangler/state /app/dist/server/.wrangler && chown -R node:node /app/.wrangler /app/dist/server/.wrangler

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/stats',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/start.mjs"]
