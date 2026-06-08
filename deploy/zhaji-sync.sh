#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/admin/zhaji-site"
LOG_DIR="/home/admin/zhaji-sync-logs"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

npm run sync:zhihu >> "$LOG_DIR/sync-$(date +%Y%m%d).log" 2>&1
npm run sync:zhihu:comments >> "$LOG_DIR/sync-$(date +%Y%m%d).log" 2>&1 || echo "Zhihu comment sync failed at $(date --iso-8601=seconds)" >> "$LOG_DIR/sync-$(date +%Y%m%d).log"
