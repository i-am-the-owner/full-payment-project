# AlmaPay backend: one image for the API, the job worker, migrations and (dev only) the seed.
# Build:  docker build -t almapay-backend ./backend
# Run:    API     node dist/main.js            (default)
#         worker  node dist/worker.js
#         migrate node dist/infrastructure/database/cli.js migrate
#         seed    node dist/seed.js            (refused in production)

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
COPY admin-console ./admin-console
# Not root: the app needs no privileges.
USER node
EXPOSE 3000
# Liveness for Docker/compose. The orchestrator should also use /readyz for traffic.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
