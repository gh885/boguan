#!/usr/bin/env python3
"""资源及任务新鲜度检查；告警只含统计信息，不包含正文或凭证。"""
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import time

app = Path(os.environ.get("BOGUAN_APP", "/home/xun/boguan"))
backup_dir = Path(os.environ.get("BOGUAN_BACKUP_DIR", "/home/xun/backups"))
issues = []
usage = shutil.disk_usage(app)
if usage.free < 2 * 1024 ** 3 or usage.used / usage.total > 0.85:
    issues.append(f"磁盘空间不足，可用 {usage.free // 1024 ** 2} MiB")
backups = sorted(backup_dir.glob("boguan-*.db.gz"), reverse=True)
if not backups or time.time() - backups[0].stat().st_mtime > 36 * 3600:
    issues.append("最近 36 小时没有本机备份")
with sqlite3.connect((app / "data/boguan.db").resolve().as_uri() + "?mode=ro", uri=True) as db:
    job = db.execute(
        "SELECT status, finished_at FROM crawl_jobs WHERE status = 'ok' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not job or not job[1] or (
        datetime.now(timezone.utc) - datetime.fromisoformat(job[1].replace("Z", "+00:00"))
    ).total_seconds() > 36 * 3600:
        issues.append("最近 36 小时没有成功抓取批次")
    for slug, last_run, blocked in db.execute(
        "SELECT slug, last_run_at, blocked_at FROM sources WHERE enabled = 1"
    ):
        if blocked:
            issues.append(f"数据源被阻止: {slug}")
        elif not last_run or (
            datetime.now(timezone.utc) - datetime.fromisoformat(last_run.replace("Z", "+00:00"))
        ).total_seconds() > 36 * 3600:
            issues.append(f"数据源超过 36 小时未运行: {slug}")
if os.environ.get("BOGUAN_OSS_BUCKET"):
    offsite = app / ".ops/offsite-success"
    if not offsite.exists() or time.time() - offsite.stat().st_mtime > 36 * 3600:
        issues.append("最近 36 小时没有验证成功的异地备份")
if issues:
    sys.exit("; ".join(issues))
print("watchdog OK: 磁盘、备份和抓取新鲜度正常")
