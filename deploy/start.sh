#!/usr/bin/env bash
set -euo pipefail

log() { printf '[start-all] %s\n' "$*"; }

HTTP_PORT="${PORT:-80}"

# Render injects RENDER_EXTERNAL_URL (the public HTTPS URL of this service).
# Everything is same-origin, so both WEB_URL and PUBLIC_URL default to it.
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export PUBLIC_URL="${PUBLIC_URL:-$RENDER_EXTERNAL_URL}"
  export WEB_URL="${WEB_URL:-$RENDER_EXTERNAL_URL}"
fi

export STORAGE_URL="${STORAGE_URL:-http://127.0.0.1:4100}"
export COOKIE_SECURE="${COOKIE_SECURE:-true}"
mkdir -p /var/data

# Bind the HTTP port immediately so Render can detect it, then do the rest.
log "rendering nginx config for :${HTTP_PORT}"
export NGINX_PORT="$HTTP_PORT"
envsubst '$NGINX_PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
unset NGINX_PORT
nginx -t
nginx -g 'daemon off;' &
NGINX_PID=$!
trap 'kill "$NGINX_PID" 2>/dev/null || true' INT TERM

# Run migrations with the bundled CLI (no pnpm/corepack, no registry access).
log "applying database migrations"
node /repo/packages/database/node_modules/prisma/build/index.js migrate deploy \
  --schema /repo/packages/database/prisma/schema.prisma

# Each internal service runs in a restarting loop so one crash cannot take
# down the whole box. Render health-checks nginx, which proxies /api/health.
run_forever() {
  local name="$1"; shift
  (
    while true; do
      log "${name} starting"
      "$@" || log "${name} exited unexpectedly, restarting"
      sleep 1
    done
  ) &
}

run_forever storage bash -c 'cd /repo/apps/storage && PORT=4100 exec node --import tsx --enable-source-maps dist/server.js'
run_forever worker   bash -c 'cd /repo/apps/worker   && exec node --import tsx --enable-source-maps dist/worker.js'
run_forever api      bash -c 'cd /repo/apps/api      && PORT=4000 exec node --import tsx --enable-source-maps dist/server.js'

log "waiting for the API to become healthy"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:4000/api/health" >/dev/null 2>&1; then
    log "API healthy after ${i}s"
    break
  fi
  if [ "$i" -eq 60 ]; then
    log "WARNING: API not healthy within 60s"
  fi
  sleep 1
done

wait "$NGINX_PID"