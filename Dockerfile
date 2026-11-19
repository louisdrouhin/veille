# syntax=docker/dockerfile:1

# One image for both services:
#   app    → node dist/migrate.js && node server.js   (default CMD)
#   worker → node dist/worker.js                      (command override in compose)

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Builds Next (standalone) + bundles worker, migrate and create-user into dist/
RUN npm run build

# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/drizzle ./drizzle

USER app
EXPOSE 3000

# Migrations run before the server starts; the worker waits for the app to be healthy.
CMD ["sh", "-c", "node dist/migrate.js && exec node server.js"]
