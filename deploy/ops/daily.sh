#!/usr/bin/env bash
# 每日：抓取 → 对账清理 → 收敛 WAL → 构建到 releases/<ts> → 原子切换 dist → 重启 web
#
# 为什么构建到 releases/ 而不是原地 dist/：Astro 构建前会清空 outDir，
# 直接写 dist/ 会让站点 404 十几秒。构建到新目录再原子替换符号链接，中断窗口 ≤2 秒。
set -euo pipefail

APP=${BOGUAN_APP:-/home/xun/boguan}
export PATH=/usr/local/bin:$PATH
export BOGUAN_DB="$APP/data/boguan.db"

cd "$APP"

log() { echo "[$(date -Is)] $*"; }

log "crawl start"
# 抓取失败（源站 5xx / 网络抖动）不阻断重建：库里已有内容照样发布
./node_modules/.bin/vpx scripts/crawler/cli.ts --mode=incremental || log "crawl 返回非零，继续重建"

log "db check --prune"
# 清掉孤正文文件、过期 http_cache 与抓取日志：正文是派生数据，删了不影响站点
./node_modules/.bin/vpx scripts/db/check.ts --fix --prune || log "db:check 返回非零，继续重建"

log "wal checkpoint"
sqlite3 "$APP/data/boguan.db" "PRAGMA wal_checkpoint(TRUNCATE);" || true

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="releases/$STAMP"
log "build -> $OUT"
rm -rf "$OUT"
./node_modules/.bin/astro build --outDir "$OUT"

log "switch dist -> $OUT"
ln -sfn "$OUT" dist.new
mv -T dist.new dist

log "restart boguan-web"
sudo -n /usr/bin/systemctl restart boguan-web
sleep 2
systemctl is-active boguan-web

# 只保留最近 3 个版本，回滚用 ln -sfn 指回去即可
ls -1dt releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

log "done (bodies: $(du -sh data/bodies 2>/dev/null | cut -f1))"