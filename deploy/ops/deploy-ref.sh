#!/usr/bin/env bash
# Actions 只传提交 SHA；SSH 密钥被强制限制到本文件的 --ssh 入口。
set -euo pipefail
umask 022
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
if [[ ${1:-} == --ssh ]]; then
  [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]] || { log '只接受 deploy <完整 SHA>'; exit 1; }
  TARGET=${BASH_REMATCH[1]}
  UNIT="boguan-deploy@$TARGET.service"
  # systemd 独立管理发布；SSH 断开不会打断切换或回滚。
  sudo -n /usr/bin/systemctl reset-failed "$UNIT"
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
git fetch --quiet origin main
[[ $(git rev-parse refs/remotes/origin/main) == "$TARGET" ]] || { log '已被更新的 main 取代，拒绝过期发布'; exit 1; }
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
