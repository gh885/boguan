#!/usr/bin/env bash
# 在线一致性快照 -> 完整性/索引校验 -> gzip + SHA256 -> 原子发布；只清理已完成备份。
set -euo pipefail
umask 077
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"
DEST=${BOGUAN_BACKUP_DIR:-/home/xun/backups}
mkdir -p "$DEST"
chmod 700 "$DEST"
find "$DEST" -maxdepth 1 -type f \( -name 'boguan-*.db.gz' -o -name 'boguan-*.db.gz.sha256' \) -exec chmod 600 {} +
exec 8>"$DEST/.backup.lock"
flock -n 8 || { log '已有备份正在执行'; exit 1; }
TEMP=$(mktemp -d "$DEST/.backup-XXXXXX")
trap 'rm -rf -- "$TEMP"' EXIT
NAME="boguan-$(date +%Y%m%d-%H%M%S).db.gz"

sqlite3 -cmd '.timeout 10000' "${BOGUAN_DB:-$APP/data/boguan.db}" ".backup '$TEMP/database.db'"
verify_database "$TEMP/database.db"
gzip -c "$TEMP/database.db" > "$TEMP/$NAME"
(cd "$TEMP" && sha256sum "$NAME" > "$NAME.sha256")
mv "$TEMP/$NAME.sha256" "$DEST/$NAME.sha256"
mv "$TEMP/$NAME" "$DEST/$NAME"
log "backup verified: $DEST/$NAME"

python3 - "$DEST" <<'PY'
from pathlib import Path
import sys
backups = sorted(Path(sys.argv[1]).glob('boguan-*.db.gz'), reverse=True)
for old in backups[14:]:
    old.unlink()
    old.with_name(old.name + '.sha256').unlink(missing_ok=True)
PY
