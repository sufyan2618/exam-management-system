#!/bin/bash
set -euo pipefail

if [[ -z "${MONGO_APP_USER:-}" || -z "${MONGO_APP_PASSWORD:-}" ]]; then
  echo "MONGO_APP_USER or MONGO_APP_PASSWORD is empty; skipping least-privilege app user creation."
  exit 0
fi

if [[ "$MONGO_APP_USER" == "$MONGO_INITDB_ROOT_USERNAME" ]]; then
  echo "Application MongoDB user must differ from the MongoDB root user."
  exit 1
fi

mongosh --quiet \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  "$MONGO_INITDB_DATABASE" \
  --eval 'db.createUser({user: process.env.MONGO_APP_USER, pwd: process.env.MONGO_APP_PASSWORD, roles: [{role: "readWrite", db: process.env.MONGO_INITDB_DATABASE}]})'
