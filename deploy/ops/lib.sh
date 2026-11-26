#!/usr/bin/env bash
# 被运维脚本 source；配置由 systemd EnvironmentFile 注入，不执行配置文件。
OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP=${BOGUAN_APP:-/home/xun/boguan}
PUBLIC_URL=${BOGUAN_PUBLIC_URL:-https://boguan.org.cn}
LOCAL_URL=${BOGUAN_LOCAL_URL:-http://127.0.0.1:4321}
SEARCH_PATH='/search?q=MySQL'
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH

log() { echo "[$(date -Is)] $*"; }

http_code() {
  local code
  if code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 3 --max-time "${BOGUAN_PROBE_TIMEOUT:-8}" "$1" 2>/dev/null); then
    printf '%s' "$code"
  else
    printf '000'
  fi
}

probe_site() {
  local base=$1 home search
  home=$(http_code "${base%/}/")
  search=$(http_code "${base%/}$SEARCH_PATH")
  log "probe $base home=$home search=$search"
  [[ $home == 200 && $search == 200 ]]
}

probe_all() {
  local failed=0
  probe_site "$LOCAL_URL" || failed=1
  probe_site "$PUBLIC_URL" || failed=1
  return "$failed"
}

wait_ready() {
  local attempt
  for ((attempt = 1; attempt <= ${BOGUAN_READY_ATTEMPTS:-3}; attempt++)); do
    if probe_all; then return 0; fi
    if (( attempt < ${BOGUAN_READY_ATTEMPTS:-3} )); then
      sleep "${BOGUAN_READY_DELAY:-3}"
    fi
  done
  return 1
}

restart_web() {
  # 故障版本可能触发启动速率限制；回滚旧版本前必须解除该限制。
  sudo -n /usr/bin/systemctl reset-failed boguan-web
  sudo -n /usr/bin/systemctl restart boguan-web
}

lock_deploy() {
  mkdir -p "$APP/.ops"
  exec 9>"$APP/.ops/deploy.lock"
  flock -n 9 || { log '已有发布或探活正在执行，请稍后重试'; return 1; }
}

verify_database() {
  python3 "$OPS_DIR/verify-db.py" "$1"
}
