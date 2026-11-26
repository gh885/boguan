#!/usr/bin/env bash
# 把最新有效快照上传到私有 OSS，再下载同一对象并验证，成功后才记录时间。
set -euo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
BUCKET=${BOGUAN_OSS_BUCKET:?请配置 BOGUAN_OSS_BUCKET，异地备份尚未启用}
CONF=${OSSUTIL_CONFIG:-/etc/boguan/ossutilconfig}
SRC=${BOGUAN_BACKUP_DIR:-/home/xun/backups}
[[ -r $CONF ]] || { log 'OSS 配置不可读，异地备份失败'; exit 1; }
command -v ossutil >/dev/null || { log '未安装 ossutil，异地备份失败'; exit 1; }
exec 8>"$SRC/.backup.lock"
flock -w 60 8 || { log '等待备份锁超时'; exit 1; }
BACKUP=$(python3 - "$SRC" <<'PY'
from pathlib import Path
import sys
files = sorted(Path(sys.argv[1]).glob('boguan-*.db.gz'), reverse=True)
if not files:
    sys.exit('没有可上传的备份')
print(files[0])
PY
)
[[ -f $BACKUP.sha256 ]] || { log '备份缺少 SHA256 清单'; exit 1; }
# 不能拿几天前的快照充当本轮异地备份。
[[ $(find "$BACKUP" -mmin -2160 -print) ]] || { log '最新备份超过 36 小时'; exit 1; }
(cd "$SRC" && sha256sum --check "$(basename "$BACKUP").sha256")
TEMP=$(mktemp -d)
trap 'rm -rf -- "$TEMP"' EXIT
REMOTE="oss://$BUCKET/boguan-backups/$(basename "$BACKUP")"
ossutil -c "$CONF" cp "$BACKUP" "$REMOTE" --acl private -f
ossutil -c "$CONF" cp "$BACKUP.sha256" "$REMOTE.sha256" --acl private -f
ossutil -c "$CONF" cp "$REMOTE" "$TEMP/$(basename "$BACKUP")" -f
ossutil -c "$CONF" cp "$REMOTE.sha256" "$TEMP/$(basename "$BACKUP").sha256" -f
bash "$OPS_DIR/restore-check.sh" "$TEMP/$(basename "$BACKUP")" "$TEMP/restored"
mkdir -p "$APP/.ops"
touch "$APP/.ops/offsite-success"
log 'offsite verified: 上传、下载、SHA256、SQLite 与 FTS 检查通过'
