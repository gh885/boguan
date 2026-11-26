#!/usr/bin/env bash
# 在新目录恢复并检查，拒绝覆盖现有路径或线上库。源文件必须带 SHA256 清单。
set -euo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
if [[ $# != 2 ]]; then
  echo '用法: restore-check.sh <backup.db.gz> <新的恢复目录>' >&2
  exit 2
fi
BACKUP=$(realpath "$1")
DEST=$2
[[ -f $BACKUP && -f $BACKUP.sha256 ]] || { log '备份或 SHA256 清单不存在'; exit 1; }
[[ ! -e $DEST ]] || { log '恢复目录已存在，拒绝覆盖'; exit 1; }
(cd "$(dirname "$BACKUP")" && sha256sum --check "$(basename "$BACKUP").sha256")
mkdir -m 700 "$DEST"
gzip -dc "$BACKUP" > "$DEST/boguan.db"
verify_database "$DEST/boguan.db"
log "restore verified: $DEST/boguan.db（未修改线上库）"
