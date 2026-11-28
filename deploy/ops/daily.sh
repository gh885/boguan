#!/usr/bin/env bash
# 抓取与发布共享锁；源站失败不丢旧数据，但任务必须保留失败状态。
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
export BOGUAN_DB="${BOGUAN_DB:-$APP/data/boguan.db}"
cd "$APP"
lock_deploy
trap 'exit 130' INT
trap 'exit 143' TERM

CRAWL_FAILED=0
log 'crawl start'
if ! bun apps/crawler/src/cli.ts --mode=incremental; then
  CRAWL_FAILED=1
  log '抓取失败：继续校验已有数据，本次任务最终返回失败供告警'
fi

log 'db check --fix --prune'
bun apps/ops/src/check.ts --fix --prune
verify_database "$BOGUAN_DB"
# PARTIAL/FAILED 不能因 CLI 返回 0 而被日常任务吞掉。
if ! python3 - "$BOGUAN_DB" <<'PY'
from pathlib import Path
import sqlite3
import sys
with sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True) as db:
    row = db.execute('SELECT status FROM crawl_jobs ORDER BY id DESC LIMIT 1').fetchone()
    if not row or row[0] != 'ok':
        sys.exit('最近抓取批次不是 ok')
PY
then
  CRAWL_FAILED=1
fi

sqlite3 -cmd '.timeout 5000' "$BOGUAN_DB" 'PRAGMA wal_checkpoint(PASSIVE);'
bash "$OPS_DIR/publish.sh" --locked
log 'daily update finished'
exit "$CRAWL_FAILED"
