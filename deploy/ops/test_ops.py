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
from types import SimpleNamespace
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
bun() {
  if [[ $* == *"apps/web"* && $* == *"build"* ]]; then
    [[ ${SCENARIO:-} != build-fails ]] || return 1
    mkdir -p "$BOGUAN_OUT_DIR/server" "$BOGUAN_OUT_DIR/client"
    echo server > "$BOGUAN_OUT_DIR/server/entry.mjs"
    echo html > "$BOGUAN_OUT_DIR/client/index.html"
    return 0
  fi
  if [[ ${SCENARIO:-} == crawl-fails && $* == *crawler* ]]; then return 1; fi
  if [[ ${SCENARIO:-} == check-fails && $* == *check.ts* ]]; then return 1; fi
  return 0
}
export -f curl sudo sleep git bun
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

    def test_cloudmonitor_rejection_does_not_throttle_next_attempt(self):
        spec = importlib.util.spec_from_file_location('ops_notify', OPS / 'notify.py')
        notify = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(notify)
        environment = dict(self.env, BOGUAN_ALERT_FORMAT='cloudmonitor')
        with mock.patch.dict(os.environ, environment, clear=True), \
                mock.patch.object(notify.sys, 'argv', ['notify.py', 'boguan-health.service']), \
                mock.patch.object(notify.subprocess, 'run') as command, \
                mock.patch.object(notify, 'publish_cloudmonitor') as publish:
            command.return_value.stdout = 'Result=exit-code\nExecMainStatus=1'
            publish.side_effect = SystemExit('上报失败')
            with self.assertRaises(SystemExit):
                notify.main()
            marker = self.app / '.ops/alerts/boguan-health.service'
            self.assertFalse(marker.exists())
            publish.side_effect = None
            notify.main()
            self.assertTrue(marker.exists())
            notify.main()
            self.assertEqual(publish.call_count, 2)

    def test_cloudmonitor_validates_ack_and_never_leaks_sdk_exceptions(self):
        spec = importlib.util.spec_from_file_location('ops_notify', OPS / 'notify.py')
        notify = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(notify)
        client = mock.Mock()
        credentials = mock.Mock()
        model = mock.Mock(side_effect=lambda **kwargs: SimpleNamespace(**kwargs))
        modules = {
            'alibabacloud_cms20190101.client': SimpleNamespace(Client=client, RuntimeOptions=model),
            'alibabacloud_cms20190101.models': SimpleNamespace(
                PutCustomEventRequest=model, PutCustomEventRequestEventInfo=model),
            'alibabacloud_credentials.client': SimpleNamespace(Client=credentials),
            'alibabacloud_credentials.models': SimpleNamespace(Config=model),
            'alibabacloud_tea_openapi.models': SimpleNamespace(Config=model),
        }
        environment = dict(self.env, BOGUAN_CMS_GROUP_ID='247878023',
                           BOGUAN_CMS_REGION='cn-beijing', BOGUAN_RAM_ROLE='boguan-ops')
        with mock.patch.dict(os.environ, environment, clear=True), \
                mock.patch.dict(notify.sys.modules, modules):
            send = client.return_value.put_custom_event_with_options
            send.return_value = SimpleNamespace(status_code=200, body=SimpleNamespace(code='500'))
            with self.assertRaises(SystemExit):
                notify.publish_cloudmonitor('boguan-health.service', 'test message')
            send.return_value.body.code = '200'
            notify.publish_cloudmonitor('boguan-health.service', 'test message')
            request, runtime = send.call_args.args
            self.assertEqual(request.event_info[0].event_name, 'BoguanTaskFailed')
            self.assertEqual(request.event_info[0].group_id, '247878023')
            self.assertFalse(runtime.autoretry)
            config = credentials.call_args.args[0]
            self.assertTrue(config.enable_imds_v2)
            self.assertTrue(config.disable_imds_v1)
            send.side_effect = RuntimeError('SECRET-IN-SIGNED-REQUEST')
            with self.assertRaises(SystemExit) as error:
                notify.publish_cloudmonitor('boguan-health.service', 'test message')
            self.assertNotIn('SECRET-IN-SIGNED-REQUEST', str(error.exception))

    def test_first_ssh_deploy_does_not_reset_unloaded_unit(self):
        subprocess.run(['git', 'init', '-q', str(self.app)], check=True)
        subprocess.run(['git', '-C', str(self.app), '-c', 'user.name=Ops Test',
                        '-c', 'user.email=ops-test@example.invalid', 'commit', '-qm', 'fixture',
                        '--allow-empty'], check=True)
        revision = subprocess.check_output(['git', '-C', str(self.app), 'rev-parse', 'HEAD'], text=True).strip()
        bundle = self.root / 'fixture.bundle'
        subprocess.run(['git', '-C', str(self.app), 'bundle', 'create', str(bundle), 'HEAD'], check=True)
        (self.app / 'dist/REVISION').write_text(revision + '\n')
        self.env['SSH_ORIGINAL_COMMAND'] = 'deploy ' + revision
        mocks = self.root / 'ssh-mocks.sh'
        mocks.write_text(MOCKS + r'''
systemctl() {
  if [[ $1 == is-failed ]]; then return 1; fi
  printf 'Result=success\nExecMainStatus=0\n'
}
unset -f git
export -f systemctl
''')
        self.env['BASH_ENV'] = str(mocks)
        result = subprocess.run(['bash', str(OPS / 'deploy-ref.sh'), '--ssh'],
                                input=bundle.read_bytes(), env=self.env, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.app / f'.ops/incoming/{revision}.bundle').read_bytes(), bundle.read_bytes())
        self.assertIn('start boguan-deploy@' + revision + '.service', self.restarts())
        self.assertNotIn('reset-failed', self.restarts())

    def test_deploy_rejects_invalid_commands_and_rolls_back_source(self):
        old_revision, target = 'a' * 40, 'b' * 40
        (self.app / 'dist/REVISION').write_text(old_revision + '\n')
        ops = self.root / 'deploy-ops'
        ops.mkdir()
        for name in ['deploy-ref.sh', 'lib.sh']:
            shutil.copy2(OPS / name, ops / name)
        (ops / 'backup.sh').write_text('#!/usr/bin/env bash\necho backup >> "$BOGUAN_APP/.ops/steps"\n')
        (ops / 'publish.sh').write_text('''#!/usr/bin/env bash
set -eu
echo publish >> "$BOGUAN_APP/.ops/steps"
[[ ${SCENARIO:-} != publish-fails ]] || exit 1
printf '%s\\n' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb > "$BOGUAN_APP/dist/REVISION"
''')
        mocks = self.root / 'deploy-mocks.sh'
        mocks.write_text(MOCKS + r'''
git() {
  case "$1" in
    status|fetch|merge-base) return 0 ;;
    bundle)
      if [[ $2 == list-heads ]]; then printf '%s HEAD\n' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; fi ;;
    rev-parse)
      if [[ $2 == FETCH_HEAD ]]; then printf '%s\n' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
      else printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi ;;
    diff) [[ ${SCENARIO:-} != sensitive-change ]] ;;
    checkout) echo "${!#}" >> "$APP/.ops/checkouts" ;;
    *) return 1 ;;
  esac
}
export -f git
''')
        self.env['BASH_ENV'] = str(mocks)
        for invalid in ['', 'main', 'b' * 39, target + ';id']:
            result = self.run_script(ops / 'deploy-ref.sh', invalid)
            self.assertNotEqual(result.returncode, 0)
        self.env['SSH_ORIGINAL_COMMAND'] = 'deploy ' + target + ';id'
        result = self.run_script(ops / 'deploy-ref.sh', '--ssh')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.restarts(), '')
        result = self.run_script(ops / 'deploy-ref.sh', old_revision)
        self.assertNotEqual(result.returncode, 0)
        incoming = self.app / '.ops/incoming'
        incoming.mkdir()
        bundle = incoming / f'{target}.bundle'
        bundle.touch()
        result = self.run_script(ops / 'deploy-ref.sh', target, scenario='sensitive-change')
        self.assertNotEqual(result.returncode, 0)
        checkouts = self.app / '.ops/checkouts'
        self.assertFalse(checkouts.exists())
        bundle.touch()
        result = self.run_script(ops / 'deploy-ref.sh', target, scenario='publish-fails')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(checkouts.exists(), result.stdout + result.stderr)
        self.assertEqual(checkouts.read_text().splitlines(), [target, old_revision])
        self.assertEqual((self.app / 'dist/REVISION').read_text().strip(), old_revision)
        checkouts.unlink()
        bundle.touch()
        result = self.run_script(ops / 'deploy-ref.sh', target)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(checkouts.read_text().splitlines(), [target])
        self.assertEqual((self.app / 'dist/REVISION').read_text().strip(), target)

    def test_unconfigured_offsite_does_not_claim_success(self):
        self.env.pop("BOGUAN_OSS_BUCKET", None)
        result = self.run_script("offsite.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.app / ".ops/offsite-success").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
