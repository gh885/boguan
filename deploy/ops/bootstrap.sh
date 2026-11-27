#!/usr/bin/env bash
# 从检出的仓库安装运维文件；不拉代码、不安装依赖、不覆盖数据和私有配置。
set -euo pipefail
DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -d $DEPLOY_DIR/systemd ]] || { echo '请从 deploy/ops/bootstrap.sh 执行' >&2; exit 1; }
APP=/home/xun/boguan
[[ -f $APP/package.json && -d $APP/dist/server ]] || { echo '缺少应用或首构建产物' >&2; exit 1; }

# 使用固定系统账号，避免复用管理员账号。ProtectHome + 只读 bind 隔离整个 home。
if ! id boguan-web >/dev/null 2>&1; then
  sudo useradd --system --user-group --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin boguan-web
fi
sudo install -d -m 755 /srv/boguan
sudo install -d -m 750 -o root -g xun /etc/boguan
if ! sudo test -e /etc/boguan/ops.env; then
  sudo install -m 640 -o root -g xun "$DEPLOY_DIR/ops.env.example" /etc/boguan/ops.env
fi
sudo install -d -m 755 /home/xun/ops
sudo install -m 755 "$DEPLOY_DIR"/ops/*.sh /home/xun/ops/
sudo install -m 644 "$DEPLOY_DIR"/ops/*.py "$DEPLOY_DIR"/ops/requirements.txt /home/xun/ops/
sudo install -m 644 "$DEPLOY_DIR"/systemd/*.service "$DEPLOY_DIR"/systemd/*.timer /etc/systemd/system/
# 只有本项目白名单；不改动服务器上其它项目或管理员的 sudo 规则。
TEMP=$(mktemp)
trap 'rm -f -- "$TEMP"' EXIT
printf '%s\n' 'xun ALL=(root) NOPASSWD: /usr/bin/systemctl restart boguan-web, /usr/bin/systemctl reset-failed boguan-web, /usr/bin/systemctl restart caddy' > "$TEMP"
sudo visudo -cf "$TEMP"
sudo install -m 440 "$TEMP" /etc/sudoers.d/boguan-xun

cd "$APP"
mkdir -p releases .ops
chmod 700 .ops
if [[ ! -L dist ]]; then
  INITIAL="releases/$(date +%Y%m%d-%H%M%S)-initial"
  mv dist "$INITIAL"
  ln -s "$INITIAL" dist
fi
sudo systemd-analyze verify /etc/systemd/system/boguan-*.service /etc/systemd/system/boguan-*.timer
sudo systemctl daemon-reload
sudo systemctl enable boguan-web.service
sudo systemctl enable --now boguan-health.timer boguan-backup.timer boguan-daily.timer boguan-watchdog.timer
sudo systemctl reset-failed boguan-web
sudo systemctl restart boguan-web
bash -c 'source /home/xun/ops/lib.sh; wait_ready'
systemctl list-timers 'boguan-*' --no-pager
echo '基础服务已安装；异地备份、通知与外部探测的验收步骤见 deploy/README.md'
