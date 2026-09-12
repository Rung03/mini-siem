# Build context is the repository root, not backend/, because the image needs
# db/migrations alongside the compiled code — the service applies its own
# migrations at boot so that an appliance install is one command.
FROM node:24-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/tools ./tools
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY db/migrations ./db/migrations

# 8080 API, 514 syslog. Binding 514 needs root inside the container; the
# process holds no privileges on the host either way.
EXPOSE 8080 514/tcp 514/udp

CMD ["node", "dist/src/index.js"]
