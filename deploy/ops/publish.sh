#!/usr/bin/env bash
# 仅发布产物：不拉代码、不装依赖、不执行迁移。daily.sh 在同一把锁中调用。
set -euo pipefail
umask 022
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
cd "$APP"

if [[ ${1:-} != --locked ]]; then
  lock_deploy
elif ! flock -n 9; then
  log '未持有发布锁'
  exit 1
fi

[[ -L dist && -d dist/server && -d dist/client ]] || { log 'dist 必须指向完整 release'; exit 1; }
PREVIOUS=$(readlink dist)
verify_database "${BOGUAN_DB:-$APP/data/boguan.db}"
mkdir -p releases
OUT=$(mktemp -d releases/"$(date +%Y%m%d-%H%M%S)"-XXXXXX)
# mktemp 默认 0700；产物须允许独立 Web 账号读取、穿越。
chmod 755 "$OUT"
SWITCHED=0

rollback_on_exit() {
  local status=$?
  trap - EXIT
  if (( status != 0 && SWITCHED == 1 )); then
    log "发布失败，自动回滚 -> $PREVIOUS"
    if ln -sfn "$PREVIOUS" dist.new && mv -Tf dist.new dist \
      && restart_web && wait_ready; then
      log 'rollback verified: 旧版本已恢复；本次发布仍记失败'
    else
      log 'CRITICAL: 回滚校验失败，需要人工处理'
    fi
  fi
  # 新版本失败时保留产物与日志，后续成功发布再清理。
  exit "$status"
}
trap rollback_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "build -> $OUT"
./node_modules/.bin/astro build --outDir "$OUT"
[[ -s $OUT/server/entry.mjs && -s $OUT/client/index.html ]] || { log '构建产物不完整'; exit 1; }
printf '%s\n' "$(git rev-parse HEAD)" > "$OUT/REVISION"

# 先标记，确保中断恰好发生在切换前后时也能恢复旧软链。
SWITCHED=1
ln -sfn "$OUT" dist.new
mv -Tf dist.new dist
restart_web
wait_ready
SWITCHED=0
log "published and verified -> $OUT"

# 总共保留三个版本，同时保护当前版本与上一个已验证版本。
python3 - "$APP" "$PREVIOUS" <<'PY'
from pathlib import Path
import shutil
import sys
root = Path(sys.argv[1])
protected = {(root / 'dist').resolve(), (root / sys.argv[2]).resolve()}
releases = sorted((root / 'releases').iterdir(), key=lambda p: p.name, reverse=True)
kept = len(protected)
for release in releases:
    if not release.is_dir() or release.is_symlink() or release.resolve() in protected:
        continue
    if kept < 3:
        kept += 1
    else:
        shutil.rmtree(release)
PY
