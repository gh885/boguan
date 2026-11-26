#!/usr/bin/env bash
# GitHub Actions/任意外部主机执行；只探测，不在站点上触发抓取或重启。
set -euo pipefail
BASE=${BOGUAN_PUBLIC_URL:-https://boguan.org.cn}
for path in / '/search?q=MySQL'; do
  response=$(curl --silent --show-error --fail --retry 2 --retry-delay 3 \
    --connect-timeout 5 --max-time 15 "${BASE%/}$path")
  [[ $response == *'<html'* && $response == *'</html>'* ]] || { echo "页面不是完整 HTML: $path" >&2; exit 1; }
  echo "OK $path"
done
