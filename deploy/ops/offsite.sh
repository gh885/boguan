#!/usr/bin/env bash
# 每周把 ~/backups 同步到 OSS，作为磁盘损坏时的异地副本。
#
# 需要两样东西（见 deploy/README.md「异地备份」）：
#   1. ossutil（阿里云官方 CLI，单二进制）
#   2. ~/.ossutilconfig，内含一个**只对该 bucket 有权限**的 RAM 用户 AK
#
# 没配置就安静跳过并退出 0：定时任务不该因为可选功能未启用而反复失败。
set -euo pipefail

BUCKET=${BOGUAN_OSS_BUCKET:-}
CONF=${OSSUTIL_CONFIG:-/home/xun/.ossutilconfig}
SRC=${BOGUAN_BACKUP_DIR:-/home/xun/backups}

if [ -z "$BUCKET" ] || [ ! -f "$CONF" ]; then
  echo "[$(date -Is)] 未配置 OSS（BOGUAN_OSS_BUCKET / ${CONF}），跳过"
  exit 0
fi

if ! command -v ossutil > /dev/null; then
  echo "[$(date -Is)] 找不到 ossutil，跳过"
  exit 0
fi

ossutil sync "$SRC/" "oss://$BUCKET/boguan-backups/" --update -f
echo "[$(date -Is)] synced $(ls -1 "$SRC" | wc -l) 个备份 -> oss://$BUCKET/boguan-backups/"