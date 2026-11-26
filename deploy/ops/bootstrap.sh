#!/usr/bin/env bash
# 一次性初始化：装 systemd 单元、给 xun 重启权限、把 dist 改成 releases 软链布局
set -euo pipefail

sudo cp /home/xun/ops/boguan-daily.service /home/xun/ops/boguan-daily.timer \
        /home/xun/ops/boguan-backup.service /home/xun/ops/boguan-backup.timer \
        /home/xun/ops/boguan-health.service /home/xun/ops/boguan-health.timer \
        /etc/systemd/system/

# 只允许重启 web 这一个单元，不是通用 sudo
echo 'xun ALL=(root) NOPASSWD: /usr/bin/systemctl restart boguan-web' | sudo tee /etc/sudoers.d/boguan-xun > /dev/null
sudo chmod 440 /etc/sudoers.d/boguan-xun
sudo visudo -cf /etc/sudoers.d/boguan-xun

cd /home/xun/boguan
mkdir -p releases
if [ ! -L dist ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  mv dist "releases/${STAMP}-initial"
  ln -sfn "releases/${STAMP}-initial" dist
  echo "dist -> releases/${STAMP}-initial"
fi
ls -la dist

sudo systemctl daemon-reload
sudo systemctl enable --now boguan-daily.timer boguan-backup.timer boguan-health.timer
sudo systemctl restart boguan-web
sleep 3
systemctl is-active boguan-web
echo "--- timers ---"
systemctl list-timers 'boguan-*' --no-pager