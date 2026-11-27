FROM node:22-alpine AS frontend-build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM nginx:1.28-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && python3 -m venv /opt/certbot \
  && /opt/certbot/bin/pip install --no-cache-dir certbot==5.4.0 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx/bootstrap.conf /etc/nginx/bootstrap.conf
COPY nginx/nginx.conf /etc/nginx/nginx-production.conf.template
COPY deploy/start-nginx.sh /usr/local/bin/start-nginx
RUN chmod 0755 /usr/local/bin/start-nginx && mkdir -p /var/www/certbot

EXPOSE 80 443
ENTRYPOINT ["/usr/local/bin/start-nginx"]
