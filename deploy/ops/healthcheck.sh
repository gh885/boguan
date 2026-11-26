#!/usr/bin/env bash
# 站点探活：从公网域名走完整链路（DNS → Caddy → TLS → Node → SQLite SSR）
# 任一失败即尝试自愈重启，并把结果写进 journal（journalctl -u boguan-health）
set -uo pipefail

HOME_URL="https://boguan.org.cn/"
SEARCH_URL="https://boguan.org.cn/search?q=%E5%BE%AE%E6%9C%8D%E5%8A%A1"
WEB_URL="https://boguan.org.cn/tags"

check() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$1" 2>/dev/null || echo 000
}

log() { echo "[$(date -Is)] $*"; }

home=$(check "$HOME_URL")
search=$(check "$SEARCH_URL")
tags=$(check "$WEB_URL")

if [ "$home" = "200" ] && [ "$search" = "200" ] && [ "$tags" = "200" ]; then
  log "OK home=$home search=$search tags=$tags"
  exit 0
fi

log "FAIL home=$home search=$search tags=$tags → restart boguan-web"
sudo -n /usr/bin/systemctl restart boguan-web || log "restart 失败"
sleep 6

home2=$(check "$HOME_URL")
search2=$(check "$SEARCH_URL")
if [ "$home2" = "200" ] && [ "$search2" = "200" ]; then
  log "recovered home=$home2 search=$search2"
  exit 0
fi

log "STILL DOWN home=$home2 search=$search2"
exit 1