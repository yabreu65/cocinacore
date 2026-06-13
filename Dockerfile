# Multi-stage production-parity build for CocinaCore Next.js frontend
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies stage: install everything required to build and run
# ---------------------------------------------------------------------------
FROM base AS deps
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Builder stage: build the Next.js standalone output
# ---------------------------------------------------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
COPY db/migrations ./db/migrations

# Sentry source-map upload is disabled unless SENTRY_AUTH_TOKEN is provided.
# Build will succeed without Sentry credentials.
RUN npm run build

# ---------------------------------------------------------------------------
# Runner stage: minimal production image
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Ensure the uploads directory exists and is writable by the runtime user.
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app

# Copy built standalone application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy runtime node_modules so operational scripts (migrations, bootstrap) can run.
# The standalone output only bundles modules required by Next.js at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy operational scripts and migrations so migrations and owner bootstrap can run inside the container
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
