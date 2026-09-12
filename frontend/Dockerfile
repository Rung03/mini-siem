FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine

# openssl is only needed to mint the self-signed certificate on first boot.
RUN apk add --no-cache openssl

# Where the API lives from inside the compose network. Same image either way;
# only this value differs between deployments.
ARG API_HOST=backend:8080

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY siem-app.conf /etc/nginx/snippets/siem-app.conf
RUN sed -i "s|__API_HOST__|${API_HOST}|g" /etc/nginx/conf.d/default.conf

# nginx's own entrypoint runs every .sh in this directory before starting.
COPY tls-entrypoint.sh /docker-entrypoint.d/40-generate-cert.sh
RUN chmod +x /docker-entrypoint.d/40-generate-cert.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443
