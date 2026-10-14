# Cloud Run image for the Zynkup realtime API
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Cloud Run provides PORT; bind all interfaces.
ENV HOST=0.0.0.0

RUN useradd --system --uid 10001 --create-home zynkup
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER zynkup
EXPOSE 8080
CMD ["node", "dist/server.js"]
