#!/usr/bin/env python3
"""只读校验线上库或恢复副本；不打印正文或配置。"""
import json
from pathlib import Path
import sqlite3
import sys


def verify(path: Path) -> dict:
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        checks = db.execute("PRAGMA quick_check").fetchall()
        if checks != [("ok",)]:
            raise RuntimeError(f"SQLite quick_check 未通过: {checks[:3]}")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("外键校验未通过")
        posts = db.execute("SELECT count(*) FROM posts").fetchone()[0]
        if posts == 0:
            raise RuntimeError("数据库中没有文章，拒绝当作有效备份或发布数据")
        missing = db.execute(
            "SELECT id FROM posts EXCEPT SELECT rowid FROM posts_fts LIMIT 1"
        ).fetchone()
        orphan = db.execute(
            "SELECT rowid FROM posts_fts EXCEPT SELECT id FROM posts LIMIT 1"
        ).fetchone()
        if missing or orphan:
            raise RuntimeError("posts 与 FTS 行不一致")
        matches = db.execute(
            "SELECT count(*) FROM posts_fts WHERE posts_fts MATCH ?", ('"mysql"',)
        ).fetchone()[0]
        return {"quick_check": "ok", "posts": posts, "fts_mysql_matches": matches}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法: verify-db.py <database>")
    try:
        print(json.dumps(verify(Path(sys.argv[1])), ensure_ascii=False))
    except (OSError, sqlite3.Error, RuntimeError) as error:
        sys.exit(f"数据库校验失败: {error}")
