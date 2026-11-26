#!/usr/bin/env bash
# 每日 SQLite 一致性备份（.backup 走 SQLite 在线备份 API，WAL 下也安全）
set -euo pipefail

APP=/home/xun/boguan
DEST=/home/xun/backups
mkdir -p "$DEST"

STAMP=$(date +%Y%m%d-%H%M)
sqlite3 "$APP/data/boguan.db" ".backup '$DEST/boguan-$STAMP.db'"
gzip -f "$DEST/boguan-$STAMP.db"

# 只对刚生成的这份做校验：能读出表结构才算可用
gzip -dc "$DEST/boguan-$STAMP.db.gz" > "/tmp/boguan-check.db"
COUNT=$(sqlite3 "/tmp/boguan-check.db" "select count(*) from posts;")
rm -f /tmp/boguan-check.db
echo "[$(date -Is)] backup ok: $DEST/boguan-$STAMP.db.gz (posts=$COUNT)"

# 保留 14 份
ls -1t "$DEST"/boguan-*.db.gz | tail -n +15 | xargs -r rm -f