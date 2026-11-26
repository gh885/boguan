#!/usr/bin/env python3
"""systemd OnFailure 通知；webhook 凭证只从环境读取，不写日志。"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main() -> None:
    unit = sys.argv[1] if len(sys.argv) == 2 else "boguan-unknown.service"
    if not re.fullmatch(r"boguan-[a-zA-Z0-9@_.-]+", unit):
        sys.exit("非法 unit 名称")
    endpoint = os.environ.get("BOGUAN_ALERT_WEBHOOK", "")
    if not endpoint.startswith("https://"):
        sys.exit("未配置 HTTPS BOGUAN_ALERT_WEBHOOK；告警尚未接通")
    state = Path(os.environ.get("BOGUAN_APP", "/home/xun/boguan")) / ".ops" / "alerts"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = state / unit
    if marker.exists() and time.time() - marker.stat().st_mtime < 3600:
        print(f"{unit}: 一小时内已送达通知，抑制重复告警")
        return
    details = subprocess.run(
        ["systemctl", "show", unit, "-p", "Result", "-p", "ExecMainStatus", "-p", "ActiveState"],
        capture_output=True, text=True, timeout=10, check=True,
    ).stdout.strip()
    message = f"博观运维告警\n主机: {socket.gethostname()}\n单元: {unit}\n{details}\n请检查 journalctl -u {unit}"
    kind = os.environ.get("BOGUAN_ALERT_FORMAT", "generic")
    if kind == "feishu":
        payload = {"msg_type": "text", "content": {"text": message}}
    elif kind in ("dingtalk", "wecom"):
        payload = {"msgtype": "text", "text": {"content": message}}
    elif kind == "slack":
        payload = {"text": message}
    elif kind == "generic":
        payload = {"service": "boguan", "unit": unit, "text": message}
    else:
        sys.exit("不支持的 BOGUAN_ALERT_FORMAT")
    request = urllib.request.Request(
        endpoint, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "boguan-ops/1"}, method="POST",
    )
    # 不自动重试 POST；HTTP 或服务端业务错误保留失败状态，下一次故障可以重试。
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = response.read(65536)
        if kind in ("feishu", "dingtalk", "wecom"):
            result = json.loads(data)
            code = result.get("code", result.get("errcode", -1))
            if code != 0:
                sys.exit("通知平台返回业务错误；未记录送达")
        elif kind == "slack" and data.strip() != b"ok":
            sys.exit("Slack 未确认送达")
    except (urllib.error.URLError, TimeoutError, ValueError):
        sys.exit("通知请求失败；请检查网络和 webhook 配置")
    marker.touch(mode=0o600)
    print(f"{unit}: 通知平台已确认接收")


if __name__ == "__main__":
    main()
