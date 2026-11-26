#!/usr/bin/env python3
"""运维回归测试：所有重启、HTTP 和构建均在临时目录中模拟。"""
from pathlib import Path
import fcntl
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest import mock

OPS = Path(__file__).resolve().parent
MOCKS = r'''
curl() {
  local url=${!#}
  if [[ ${SCENARIO:-} == search-fails && $url == *'/search?'* ]]; then
    printf '500'
  elif [[ ${SCENARIO:-} == curl-fails ]]; then
    printf '000'; return 7
  elif [[ ${SCENARIO:-} == edge-fails && $url == https:* && ! -e $APP/.ops/restarted-caddy ]]; then
    printf '502'
  elif [[ ${SCENARIO:-} == rollback && $(readlink "$APP/dist") != releases/old ]]; then
    printf '500'
  else
    printf '200'
  fi
}
sudo() {
  echo "$*" >> "$APP/.ops/restarts"
  local unit=${!#}
  touch "$APP/.ops/restarted-$unit"
}
sleep() { :; }
git() { printf 'test-revision\n'; }
export -f curl sudo sleep git
'''


class OpsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="boguan-ops-test-")
        self.root = Path(self.temp.name)
        self.app = self.root / "app"
        self.app.mkdir()
        for directory in [".ops", "data", "releases/old/server", "releases/old/client", "node_modules/.bin"]:
            (self.app / directory).mkdir(parents=True, exist_ok=True)
        (self.app / "dist").symlink_to("releases/old", target_is_directory=True)
        self.mocks = self.root / "mocks.sh"
        self.mocks.write_text(MOCKS)
        self.env = dict(os.environ, BOGUAN_APP=str(self.app), BASH_ENV=str(self.mocks),
                        BOGUAN_READY_ATTEMPTS="1", BOGUAN_READY_DELAY="0")
        self.database = self.app / "data/boguan.db"
        with sqlite3.connect(self.database) as db:
            db.executescript("""
                CREATE TABLE posts(id INTEGER PRIMARY KEY);
                CREATE VIRTUAL TABLE posts_fts USING fts5(title_tokens, body_tokens, content='');
                INSERT INTO posts VALUES(1);
                INSERT INTO posts_fts(rowid,title_tokens,body_tokens) VALUES(1,'mysql','test');
                CREATE TABLE crawl_jobs(id INTEGER PRIMARY KEY, status TEXT);
                INSERT INTO crawl_jobs VALUES(1,'ok');
            """)
        builder = self.app / "node_modules/.bin/astro"
        builder.write_text('''#!/usr/bin/env bash
set -eu
[[ ${SCENARIO:-} != build-fails ]] || exit 1
mkdir -p "$3/server" "$3/client"
echo server > "$3/server/entry.mjs"
echo html > "$3/client/index.html"
''')
        builder.chmod(0o755)
        crawler = self.app / "node_modules/.bin/vpx"
        crawler.write_text('''#!/usr/bin/env bash
set -eu
if [[ ${SCENARIO:-} == crawl-fails && $1 == *crawler* ]]; then exit 1; fi
if [[ ${SCENARIO:-} == check-fails && $1 == *check.ts ]]; then exit 1; fi
''')
        crawler.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, name, *args, scenario=""):
        return subprocess.run(["bash", str(OPS / name), *map(str, args)],
                              env=dict(self.env, SCENARIO=scenario), capture_output=True,
                              text=True, timeout=30)

    def restarts(self):
        path = self.app / ".ops/restarts"
        return path.read_text() if path.exists() else ""

    def test_healthy_site_does_not_restart(self):
        result = self.run_script("healthcheck.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.restarts(), "")

    def test_search_failure_restarts_web_and_stays_failed(self):
        result = self.run_script("healthcheck.sh", scenario="search-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("restart boguan-web", self.restarts())
        self.assertNotIn("restart caddy", self.restarts())
        self.assertNotIn("recovered", result.stdout)

    def test_public_failure_restarts_proxy_and_verifies_search(self):
        result = self.run_script("healthcheck.sh", scenario="edge-fails")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("restart caddy", self.restarts())
        self.assertNotIn("restart boguan-web", self.restarts())

    def test_curl_failure_has_one_status_code_and_stays_failed(self):
        result = self.run_script("healthcheck.sh", scenario="curl-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("home=000 search=000", result.stdout)
        self.assertNotIn("000000", result.stdout)

    def test_successful_publish_switches_and_keeps_previous(self):
        result = self.run_script("publish.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotEqual(os.readlink(self.app / "dist"), "releases/old")
        self.assertTrue((self.app / "releases/old").is_dir())
        self.assertEqual((self.app / "dist").stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.app / "dist/REVISION").read_text(), "test-revision\n")

    def test_failed_build_never_switches(self):
        result = self.run_script("publish.sh", scenario="build-fails")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.app / "dist"), "releases/old")
        self.assertEqual(self.restarts(), "")

    def test_failed_new_release_rolls_back_but_returns_failure(self):
        result = self.run_script("publish.sh", scenario="rollback")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.app / "dist"), "releases/old")
        self.assertIn("rollback verified", result.stdout)
        self.assertEqual(self.restarts().count("restart boguan-web"), 2)
        self.assertEqual(self.restarts().count("reset-failed boguan-web"), 2)

    def test_inconsistent_database_blocks_publication(self):
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO posts VALUES(2)")
        result = self.run_script("publish.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.app / "dist"), "releases/old")
        self.assertEqual(self.restarts(), "")

    @unittest.skipUnless(shutil.which("sqlite3"), "需要 sqlite3 CLI")
    def test_backup_restore_and_tamper_detection(self):
        self.env["BOGUAN_BACKUP_DIR"] = str(self.root / "backups")
        result = self.run_script("backup.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        backup = next((self.root / "backups").glob("*.db.gz"))
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        restore = self.run_script("restore-check.sh", backup, self.root / "restore")
        self.assertEqual(restore.returncode, 0, restore.stdout + restore.stderr)
        with sqlite3.connect(self.root / "restore/boguan.db") as db:
            self.assertEqual(db.execute("SELECT count(*) FROM posts").fetchone()[0], 1)
        duplicate = self.run_script("restore-check.sh", backup, self.root / "restore")
        self.assertNotEqual(duplicate.returncode, 0)
        with backup.open("ab") as out:
            out.write(b"tampered")
        tampered = self.run_script("restore-check.sh", backup, self.root / "tampered")
        self.assertNotEqual(tampered.returncode, 0)
        self.assertFalse((self.root / "tampered").exists())

    def test_health_does_not_restart_during_publication(self):
        with (self.app / '.ops/deploy.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_script('healthcheck.sh', scenario='search-fails')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.restarts(), '')
        self.assertIn('发布中', result.stdout)

    @unittest.skipUnless(shutil.which('sqlite3'), '需要 sqlite3 CLI')
    def test_crawl_failure_can_publish_but_task_stays_failed(self):
        result = self.run_script('daily.sh', scenario='crawl-fails')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('published and verified', result.stdout)
        self.assertNotEqual(os.readlink(self.app / 'dist'), 'releases/old')

    def test_failed_database_check_blocks_daily_publication(self):
        result = self.run_script('daily.sh', scenario='check-fails')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.app / 'dist'), 'releases/old')
        self.assertEqual(self.restarts(), '')

    @unittest.skipUnless(shutil.which('sqlite3'), '需要 sqlite3 CLI')
    def test_partial_crawl_is_not_reported_as_success(self):
        with sqlite3.connect(self.database) as db:
            db.execute("UPDATE crawl_jobs SET status='partial'")
        result = self.run_script('daily.sh')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('published and verified', result.stdout)

    def test_notification_requires_platform_confirmation(self):
        spec = importlib.util.spec_from_file_location('ops_notify', OPS / 'notify.py')
        notify = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(notify)
        environment = dict(self.env, BOGUAN_ALERT_WEBHOOK='https://example.invalid/webhook',
                           BOGUAN_ALERT_FORMAT='feishu')
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"code":1}'
        with mock.patch.dict(os.environ, environment, clear=True), \
                mock.patch.object(notify.sys, 'argv', ['notify.py', 'boguan-health.service']), \
                mock.patch.object(notify.subprocess, 'run') as command, \
                mock.patch.object(notify.urllib.request, 'urlopen', return_value=response) as request:
            command.return_value.stdout = 'Result=exit-code'
            with self.assertRaises(SystemExit):
                notify.main()
            self.assertFalse((self.app / '.ops/alerts/boguan-health.service').exists())
            response.__enter__.return_value.read.return_value = b'{"code":0}'
            notify.main()
            self.assertTrue((self.app / '.ops/alerts/boguan-health.service').exists())
            payload = json.loads(request.call_args.args[0].data)
            self.assertEqual(payload['msg_type'], 'text')
            self.assertIn('boguan-health.service', payload['content']['text'])
            notify.main()
            self.assertEqual(request.call_count, 2)

    def test_unconfigured_offsite_does_not_claim_success(self):
        self.env.pop("BOGUAN_OSS_BUCKET", None)
        result = self.run_script("offsite.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.app / ".ops/offsite-success").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
