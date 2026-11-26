#!/usr/bin/env bash
# 同时检查本地 /search（Node + SQLite）与公网链路，恢复后复查所有端点。
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

mkdir -p "$APP/.ops"
exec 9>"$APP/.ops/deploy.lock"
if ! flock -n 9; then
  log '发布中，跳过本轮自愈，交由发布脚本校验'
  exit 0
fi

if probe_all; then exit 0; fi

if probe_site "$LOCAL_URL"; then
  log '本地首页与搜索正常，重启 Caddy 后复查'
  sudo -n /usr/bin/systemctl restart caddy
else
  log '本地首页或搜索异常，重启 Web 后复查'
  restart_web
fi
sleep "${BOGUAN_READY_DELAY:-3}"
if probe_all; then
  log 'recovered: 本地与公网首页、搜索均正常'
  exit 0
fi

# 两层同时异常时只追加一次 Caddy 重启；搜索不正常绝不报恢复。
if probe_site "$LOCAL_URL"; then
  sudo -n /usr/bin/systemctl restart caddy
  sleep "${BOGUAN_READY_DELAY:-3}"
  if probe_all; then
    log 'recovered: 本地与公网首页、搜索均正常'
    exit 0
  fi
fi

log 'STILL DOWN: 探活失败，交由 OnFailure 告警'
exit 1
