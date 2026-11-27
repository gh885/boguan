#!/usr/bin/env bash
# Actions 经 SSH 传完整 SHA 与 Git bundle；服务器不主动联网拉取代码。
set -euo pipefail
umask 022
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
if [[ ${1:-} == --ssh ]]; then
  [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]] || { log '只接受 deploy <完整 SHA>'; exit 1; }
  TARGET=${BASH_REMATCH[1]}
  UNIT="boguan-deploy@$TARGET.service"
  mkdir -p "$APP/.ops/incoming"
  chmod 700 "$APP/.ops/incoming"
  # 先完整接收并核对 bundle，断线或超限不启动发布。
  UPLOAD=$(mktemp "$APP/.ops/incoming/upload-XXXXXX")
  trap 'rm -f -- "$UPLOAD"' EXIT
  timeout 120 head -c 52428801 > "$UPLOAD"
  [[ $(stat -c %s "$UPLOAD") -le 52428800 ]] || { log '代码包超过 50 MiB'; exit 1; }
  cd "$APP"
  git bundle verify "$UPLOAD" >/dev/null 2>&1
  [[ $(git bundle list-heads "$UPLOAD" HEAD) == "$TARGET HEAD" ]] || { log '代码包与提交不符'; exit 1; }
  mv "$UPLOAD" "$APP/.ops/incoming/$TARGET.bundle"
  # systemd 独立管理发布；接收完成后 SSH 断开不会打断切换或回滚。
  if systemctl is-failed --quiet "$UNIT"; then
    sudo -n /usr/bin/systemctl reset-failed "$UNIT"
  fi
  sudo -n /usr/bin/systemctl start "$UNIT"
  systemctl show "$UNIT" -p Result -p ExecMainStatus
  [[ -r $APP/dist/REVISION && $(<"$APP/dist/REVISION") == "$TARGET" ]]
  log "Actions deploy verified: $TARGET"
  exit 0
fi
TARGET=${1:-}
[[ $TARGET =~ ^[0-9a-f]{40}$ ]] || { log '必须提供完整提交 SHA'; exit 1; }
cd "$APP"
mkdir -p .ops
exec 9>"$APP/.ops/deploy.lock"
flock -w 300 9 || { log '等待抓取/发布锁超时'; exit 1; }
[[ -z $(git status --porcelain) ]] || { log '工作区存在改动，拒绝部署'; exit 1; }
BUNDLE="$APP/.ops/incoming/$TARGET.bundle"
[[ -f $BUNDLE ]] || { log '缺少 Actions 代码包'; exit 1; }
git bundle verify "$BUNDLE" >/dev/null 2>&1
[[ $(git bundle list-heads "$BUNDLE" HEAD) == "$TARGET HEAD" ]] || { log '代码包与提交不符'; exit 1; }
git fetch --quiet "$BUNDLE" HEAD
[[ $(git rev-parse FETCH_HEAD) == "$TARGET" ]] || exit 1
rm -f -- "$BUNDLE"
PREVIOUS=$(git rev-parse HEAD)
git merge-base --is-ancestor "$PREVIOUS" "$TARGET" || { log '拒绝自动降级或分叉'; exit 1; }
# 共享依赖、数据库结构及有权限的配置无法随产物回滚，必须人工升级。
if ! git diff --quiet "$PREVIOUS" "$TARGET" -- package.json bun.lock bun.lockb bunfig.toml .npmrc patches/ drizzle/ src/lib/db/schema.ts deploy/ops/ deploy/systemd/ deploy/Caddyfile deploy/ops.env.example deploy/ossutilconfig.example; then
  log '依赖、迁移或运维配置变化，需要人工升级；运行版本未改变'
  exit 1
fi
if [[ $PREVIOUS == "$TARGET" && -r dist/REVISION && $(<dist/REVISION) == "$TARGET" ]]; then
  wait_ready
  log "已运行 $TARGET"
  exit 0
fi
bash "$OPS_DIR/backup.sh"
SOURCE_CHANGED=0
restore_source_on_exit() {
  local status=$?
  trap - EXIT
  if (( status != 0 && SOURCE_CHANGED == 1 )); then
    if git checkout --quiet --detach "$PREVIOUS"; then
      log "源码已恢复到 $PREVIOUS；产物回滚由 publish.sh 校验"
    else
      log 'CRITICAL: 源码回退失败，需要人工处理'
    fi
  fi
  exit "$status"
}
trap restore_source_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SOURCE_CHANGED=1
git checkout --quiet --detach "$TARGET"
bash "$OPS_DIR/publish.sh" --locked
[[ $(<dist/REVISION) == "$TARGET" ]] || { log '发布版本不匹配'; exit 1; }
SOURCE_CHANGED=0
log "deploy verified: $TARGET"
