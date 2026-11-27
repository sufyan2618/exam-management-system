#!/bin/sh
set -eu

if [ -z "${SITE_HOST:-}" ]; then
  echo "SITE_HOST is required (the public EC2 IPv4 address)." >&2
  exit 1
fi

cert_dir="/etc/letsencrypt/live/${SITE_HOST}"
certbot="/opt/certbot/bin/certbot"

if [ ! -s "${cert_dir}/fullchain.pem" ] || [ ! -s "${cert_dir}/privkey.pem" ]; then
  cp /etc/nginx/bootstrap.conf /etc/nginx/nginx.conf
  nginx
  "$certbot" certonly \
    --webroot --webroot-path /var/www/certbot \
    --ip-address "$SITE_HOST" \
    --cert-name "$SITE_HOST" \
    --preferred-profile shortlived \
    --non-interactive --agree-tos --register-unsafely-without-email
  nginx -s quit
  while [ -f /var/run/nginx.pid ]; do sleep 1; done
fi

sed "s/__SITE_HOST__/${SITE_HOST}/g" /etc/nginx/nginx-production.conf.template > /etc/nginx/nginx.conf
nginx -t

(
  while :; do
    sleep 8h
    "$certbot" renew --quiet --deploy-hook 'nginx -s reload'
  done
) &

exec nginx -g 'daemon off;'
