#!/usr/bin/env bash
# refresh-proxy.sh
# Called automatically at the start of each Claude Code session.
# Updates the proxy URL in .env and restarts PM2 processes with the new value.

set -euo pipefail

ENV_FILE="/home/vaultadmin/residualvault/.env"
LOG="/home/vaultadmin/residualvault/logs/refresh-proxy.log"
PM2="/opt/node22/bin/pm2"

PROXY="${GLOBAL_AGENT_HTTP_PROXY:-${HTTPS_PROXY:-${HTTP_PROXY:-}}}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG"; }

if [ -z "$PROXY" ]; then
  log "No proxy env var found — skipping proxy refresh"
  exit 0
fi

log "Refreshing proxy in $ENV_FILE"

# Update or insert each proxy var in .env
for VAR in GLOBAL_AGENT_HTTP_PROXY HTTPS_PROXY HTTP_PROXY; do
  if grep -q "^${VAR}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${VAR}=.*|${VAR}=${PROXY}|" "$ENV_FILE"
  else
    echo "${VAR}=${PROXY}" >> "$ENV_FILE"
  fi
done

log "Proxy written to .env"

# If PM2 is already running, restart processes with updated env
if $PM2 list 2>/dev/null | grep -q "online"; then
  log "Restarting PM2 processes with updated proxy..."
  PROXY_ARGS="HTTPS_PROXY=$PROXY HTTP_PROXY=$PROXY GLOBAL_AGENT_HTTP_PROXY=$PROXY"
  $PM2 restart rv-scheduler --update-env 2>/dev/null && log "rv-scheduler restarted" || true
  $PM2 restart rv-control   --update-env 2>/dev/null && log "rv-control restarted"   || true
  $PM2 save 2>/dev/null
  log "Done"
else
  # PM2 not running — start it fresh with env -i to avoid E2BIG
  log "PM2 not running — starting fresh..."
  env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/node22/bin \
    GLOBAL_AGENT_HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" \
    $PM2 start "$ENV_FILE" --no-daemon 2>/dev/null || \
  env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/node22/bin \
    GLOBAL_AGENT_HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY" HTTP_PROXY="$PROXY" \
    $PM2 start /home/vaultadmin/residualvault/ecosystem.config.js
  $PM2 save 2>/dev/null
  log "PM2 started"
fi
