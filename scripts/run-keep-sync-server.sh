#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

mkdir -p logs
exec >> logs/keep-sync.log 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] starting Keep trade sync"

(
  flock -n 9 || {
    echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] another Keep sync is already running"
    exit 0
  }

  node scripts/sync-keep-trades.mjs \
    --headless \
    --channel chromium \
    --storageState data/keep-storage-state.json \
    --import \
    --output data/keep-trades-server-latest.json

  sudo -n systemctl restart zhaji-site
  echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] finished Keep trade sync"
) 9>/tmp/zhaji-keep-sync.lock
