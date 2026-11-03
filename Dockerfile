# Cloud Run image for Zynkup API.
# Compatible with:
#   - Source location = /backend  (Dockerfile: Dockerfile)
#   - Source location = /         (Dockerfile: backend/Dockerfile)
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY . .

# If Cloud Build used the monorepo root as context, flatten backend/ into /app.
RUN if [ -f backend/package.json ]; then \
      cp backend/package.json ./package.json; \
      if [ -f backend/package-lock.json ]; then cp backend/package-lock.json ./package-lock.json; fi; \
      cp backend/tsconfig.json ./tsconfig.json; \
      rm -rf src && cp -r backend/src ./src; \
    fi \
  && test -f package.json \
  && test -f tsconfig.json \
  && test -d src

# Prefer lockfile install; fall back when lock is missing/stale (old CI failure mode).
RUN if [ -f package-lock.json ]; then \
      npm ci || npm install; \
    else \
      npm install; \
    fi \
  && npm run build \
  && test -f dist/server.js \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

RUN useradd --system --uid 10001 --create-home zynkup
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER zynkup
EXPOSE 8080
CMD ["node", "dist/server.js"]
