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

EXPOSE 8080 514/tcp 514/udp

CMD ["node", "dist/src/index.js"]
