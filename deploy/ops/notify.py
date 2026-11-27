#!/usr/bin/env python3
"""systemd OnFailure 通知；实例角色认证或环境中的 webhook，不记录凭证。"""
import datetime
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


def publish_cloudmonitor(unit: str, message: str) -> None:
    """显式使用 IMDSv2 实例角色；禁止默认凭证链回退到长期 AK。"""
    group = os.environ.get("BOGUAN_CMS_GROUP_ID", "")
    region = os.environ.get("BOGUAN_CMS_REGION", "cn-beijing")
    role = os.environ.get("BOGUAN_RAM_ROLE", "")
    if not group.isascii() or not group.isdigit() or not re.fullmatch(r"[a-z]{2}-[a-z0-9-]+", region) \
            or not re.fullmatch(r"[a-zA-Z0-9@_.-]{1,64}", role):
        sys.exit("请配置云监控应用分组、地域和实例角色；未上报事件")
    try:
        from alibabacloud_cms20190101.client import Client, RuntimeOptions
        from alibabacloud_cms20190101.models import PutCustomEventRequest, PutCustomEventRequestEventInfo
        from alibabacloud_credentials.client import Client as Credentials
        from alibabacloud_credentials.models import Config as CredentialsConfig
        from alibabacloud_tea_openapi.models import Config

        credentials = Credentials(CredentialsConfig(
            type="ecs_ram_role", role_name=role, enable_imds_v2=True, disable_imds_v1=True,
            timeout=3000, connect_timeout=1000,
        ))
        client = Client(Config(
            credential=credentials, region_id=region, endpoint=f"metrics.{region}.aliyuncs.com",
            protocol="HTTPS", connect_timeout=3000, read_timeout=10000,
        ))
        request = PutCustomEventRequest(event_info=[PutCustomEventRequestEventInfo(
            event_name="BoguanTaskFailed", group_id=group,
            time=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.000+0000"),
            content=json.dumps({"service": "boguan", "unit": unit, "text": message}, ensure_ascii=False),
        )])
        response = client.put_custom_event_with_options(request, RuntimeOptions(
            autoretry=False, connect_timeout=3000, read_timeout=10000,
        ))
        if response.status_code != 200 or response.body is None or response.body.code != "200":
            sys.exit("云监控未确认接收；未记录成功")
    except Exception:
        # SDK 异常可能含签名请求或临时凭证，不能输出异常对象或 traceback。
        sys.exit("云监控上报失败；请检查 SDK 安装、实例角色权限和网络（未输出签名请求）")


def main() -> None:
    unit = sys.argv[1] if len(sys.argv) == 2 else "boguan-unknown.service"
    if not re.fullmatch(r"boguan-[a-zA-Z0-9@_.-]+", unit):
        sys.exit("非法 unit 名称")
    kind = os.environ.get("BOGUAN_ALERT_FORMAT", "generic")
    endpoint = os.environ.get("BOGUAN_ALERT_WEBHOOK", "")
    if kind != "cloudmonitor" and not endpoint.startswith("https://"):
        sys.exit("未配置 HTTPS BOGUAN_ALERT_WEBHOOK；告警尚未接通")
    state = Path(os.environ.get("BOGUAN_APP", "/home/xun/boguan")) / ".ops" / "alerts"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = state / unit
    if marker.exists() and time.time() - marker.stat().st_mtime < 3600:
        print(f"{unit}: 一小时内通知平台已接收，抑制重复告警")
        return
    details = subprocess.run(
        ["systemctl", "show", unit, "-p", "Result", "-p", "ExecMainStatus", "-p", "ActiveState"],
        capture_output=True, text=True, timeout=10, check=True,
    ).stdout.strip()
    message = f"博观运维告警\n主机: {socket.gethostname()}\n单元: {unit}\n{details}\n请检查 journalctl -u {unit}"
    if kind == "cloudmonitor":
        publish_cloudmonitor(unit, message)
        marker.touch(mode=0o600)
        print(f"{unit}: 云监控已接收自定义事件；通知送达需查报警历史并由接收人确认")
        return
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
