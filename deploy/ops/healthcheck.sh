#!/usr/bin/env bash
# 站点探活：从公网域名走完整链路（DNS → Caddy → TLS → Node → SQLite SSR）
#
# 分层定位，重启正确的那一层：
#   - 公网失败但 127.0.0.1:4321 正常 → 问题在 Caddy/证书，重启 caddy
#   - 公网失败且本地也失败        → 问题在 Node/DB，重启 boguan-web
#   - 重启后仍失败               → 退出非零，systemd 记为 failed 留痕
set -uo pipefail

HOME_URL="https://boguan.org.cn/"
SEARCH_URL="https://boguan.org.cn/search?q=%E5%BE%AE%E6%9C%8D%E5%8A%A1"
LOCAL_URL="http://127.0.0.1:4321/"

check() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$1" 2>/dev/null || echo 000
}

log() { echo "[$(date -Is)] $*"; }

home=$(check "$HOME_URL")
search=$(check "$SEARCH_URL")

if [ "$home" = "200" ] && [ "$search" = "200" ]; then
  log "OK home=$home search=$search"
  exit 0
fi

local_code=$(check "$LOCAL_URL")
log "FAIL home=$home search=$search local=$local_code"

if [ "$local_code" = "200" ]; then
  log "Node 正常、公网不通 → 重启 caddy"
  sudo -n /usr/bin/systemctl restart caddy || log "caddy 重启失败"
else
  log "Node 不通 → 重启 boguan-web"
  sudo -n /usr/bin/systemctl restart boguan-web || log "web 重启失败"
fi

sleep 8
home2=$(check "$HOME_URL")
search2=$(check "$SEARCH_URL")
local2=$(check "$LOCAL_URL")

if [ "$home2" = "200" ] && [ "$search2" = "200" ]; then
  log "recovered home=$home2 search=$search2"
  exit 0
fi

# 兜底：Node 起来了但公网还不通，可能刚才是两层同时异常
if [ "$local2" = "200" ]; then
  log "仍不通但本地 200 → 再重启 caddy"
  sudo -n /usr/bin/systemctl restart caddy || true
  sleep 6
  home3=$(check "$HOME_URL")
  [ "$home3" = "200" ] && { log "recovered after caddy restart"; exit 0; }
fi

log "STILL DOWN home=$home2 search=$search2 local=$local2"
exit 1