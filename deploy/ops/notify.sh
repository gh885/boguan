#!/usr/bin/env bash
# webhook 沿用系统 Python；云监控显式使用隔离的官方 SDK 环境。
set -euo pipefail
OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PYTHON=/usr/bin/python3
if [[ ${BOGUAN_ALERT_FORMAT:-generic} == cloudmonitor ]]; then
  PYTHON=/home/xun/ops-python/bin/python
  [[ -x $PYTHON ]] || { echo '云监控 SDK 环境缺失；告警未发送' >&2; exit 1; }
fi
exec "$PYTHON" "$OPS_DIR/notify.py" "$@"
