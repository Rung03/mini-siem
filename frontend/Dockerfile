FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

ARG API_HOST=backend:8080

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY siem-app.conf /etc/nginx/snippets/siem-app.conf
RUN sed -i "s|__API_HOST__|${API_HOST}|g" /etc/nginx/conf.d/default.conf

COPY tls-entrypoint.sh /docker-entrypoint.d/40-generate-cert.sh
RUN chmod +x /docker-entrypoint.d/40-generate-cert.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443
