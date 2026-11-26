# 部署与运维

单台阿里云 ECS（Ubuntu 24.04，2C2G，华北2）+ systemd + Caddy。域名 `boguan.org.cn`。
静态页与唯一的 SSR 搜索由 Node 服务；不引入容器、任务队列或多实例。

```text
公网 80/443 -> Caddy（自动 HTTPS、访问日志轮转）-> 127.0.0.1:4321
                                                   Node（boguan-web 账号）
                                                   /srv/boguan 只读视图
每日 timer -> crawler -> 校验 -> release -> 切换 -> 重启 -> HTTP 验证
```

## 目录与权限

| 路径                          | 用途                                            |
| :---------------------------- | :---------------------------------------------- |
| `/home/xun/boguan`            | 仓库、依赖、数据库；管理员/抓取账号维护         |
| `releases/<时间戳>-<随机值>/` | 独立构建产物及 `REVISION`，保留三个版本         |
| `dist`                        | 指向当前 release 的软链                         |
| `.ops`                        | 发布锁、通知节流与异地备份成功时间；0700        |
| `/home/xun/backups`           | SQLite 压缩快照及 SHA256，保留 14 份；文件 0600 |
| `/home/xun/ops`               | 从当前仓库安装的运维脚本                        |
| `/etc/boguan/ops.env`         | 私有配置，root:xun 0640，不进 Git               |
| `/etc/boguan/ossutilconfig`   | OSS 专用凭证配置，root:xun 0640 或所有者 0600   |
| `/srv/boguan`                 | systemd 给 Web 的只读 bind 视图，不是第二份代码 |

Web 使用无登录账号 `boguan-web`，`ProtectHome=true`，只能通过 `/srv/boguan` 只读访问应用。
正文、`.git`、`.ops`、备份、运维配置不可访问，服务不具有 sudo 权限。SQLite 连接自身也只读。
Web 内存硬上限 512 MiB、V8 old space 256 MiB，避免搜索失控耗尽全机；需要随实际数据量观察调整。

## 安装与更新

系统依赖：Node 24、Bun 1.4、Caddy、sqlite3、Python 3、util-linux。原生依赖必须在 Linux 上安装。
`esbuild` 的安装脚本通过仓库的 `trustedDependencies` 显式允许，不在服务器临时改清单。

首次安装：先将经 CI 校验的代码检出到 `/home/xun/boguan`，使用锁文件安装依赖、应用数据库迁移、
准备数据并完成首构建。迁移和依赖变更是显式发布步骤；不要把它们放进每日任务。

```bash
cd /home/xun/boguan
bun install --frozen-lockfile
# 空数据库：执行 db:init、db:seed，再导入备份或进行首次合规抓取。
# 现有数据库的迁移前先备份，评估旧版本兼容性。
./node_modules/.bin/astro build
bash deploy/ops/bootstrap.sh

sudo install -d -m 750 -o caddy -g caddy /var/log/caddy
sudo caddy validate --config deploy/Caddyfile
sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`bootstrap.sh` 幂等安装脚本、systemd 单元、项目专用 sudo 白名单与账号；保留数据、私有配置，
将首次实体 `dist` 迁入 releases，并启动基础定时器。它不修改其它项目和管理员的 sudo 规则。

代码更新经 PR 与 CI 后，检出明确的提交，安装锁定依赖，再执行：

```bash
cd /home/xun/boguan
bun install --frozen-lockfile
bash deploy/ops/bootstrap.sh
bash /home/xun/ops/publish.sh
```

脚本路径、账号和 systemd 单元是当前单机的固定约定。更新期间避免手动运行第二个抓取或迁移。
`publish.sh` 和每日任务、探活使用同一把文件锁；它不会自动 `git pull` 或安装依赖。

## 调度与失败处理

时间以服务器 `Asia/Shanghai` 为准。

| 调度                        | 单元              | 行为                                                                        |
| :-------------------------- | :---------------- | :-------------------------------------------------------------------------- |
| 每 5 分钟                   | `boguan-health`   | 本地 + 公网首页和搜索；本地故障重启 Web，边缘故障重启 Caddy；全部恢复才成功 |
| 每天 03:30                  | `boguan-backup`   | SQLite 在线快照、完整性/外键/FTS 校验、gzip + SHA256                        |
| 每天 03:45（配置后启用）    | `boguan-offsite`  | 最新快照上传 OSS，再下载、校验并恢复验证                                    |
| 每天 04:30，最多抖动 5 分钟 | `boguan-daily`    | 抓取、对账清理、完整性检查、构建、切换、HTTP 校验                           |
| 每小时                      | `boguan-watchdog` | 磁盘低于 2 GiB/使用超过 85%、备份/抓取超过 36 小时、源被阻止等异常          |
| 每小时第 7/22/37/52 分钟    | GitHub Actions    | ECS 之外请求 HTTPS 首页和搜索，失败记录为工作流失败                         |

源站失败允许发布已有数据，但每日任务最终非零退出；数据库异常或构建失败不切换。
切换后本地与公网首页、搜索任一未通过，自动恢复上一软链、重启并再次验证；本次发布仍记失败。
超时用 SIGTERM 触发同样的回滚；主机断电、SIGKILL 无法保证执行回滚。

## 告警接通与验收

项目服务有 `OnFailure=boguan-alert@%n.service`。配置缺失时告警任务明确失败，不伪装已发送。
编辑 `/etc/boguan/ops.env` 的 `BOGUAN_ALERT_WEBHOOK`（HTTPS）和 `BOGUAN_ALERT_FORMAT`。
支持通用 JSON、飞书、钉钉、企业微信、Slack 文本 webhook；需要签名校验的机器人需另行适配。
只发送单元名与退出状态，不携带日志、数据库内容或凭证。成功通知按单元抑制重复一小时。

```bash
# 配置后发送一次真实测试通知；必须由接收人确认收到。
sudo systemctl start boguan-alert@boguan-health.service.service
sudo journalctl -u boguan-alert@boguan-health.service.service -n 20 --no-pager
```

更改 EnvironmentFile 不需要 daemon-reload，下一次服务启动会读取。
GitHub Actions 外部探测需要工作流合并到默认分支，并在仓库 Watch 的自定义设置启用 Actions 通知、
在 GitHub 通知设置选择接收方式；手动运行 `外部可用性检查` 验证。GitHub 调度可能延迟，
公共仓库长期无活动也可能暂停调度，不能当作严格的 15 分钟 SLA。云监控联系人和规则需控制台验收。

## 异地备份

1. 创建私有 OSS bucket，开启服务端加密；设置生命周期：`boguan-backups/` 保留至少 30 天。
   建议启用版本控制或保留策略，防止凭证泄露后覆盖备份。不要创建公开读 bucket。
2. 使用 bucket 限权的 RAM 身份，优先实例角色；不用主账号 AK。
3. 安装官方 ossutil v2，通过交互式 `ossutil config` 写入 `/etc/boguan/ossutilconfig`，权限 0600；
   不要把 AK 放进命令行、代码库或聊天。设置 `BOGUAN_OSS_BUCKET`。
4. 手动执行并验证，再开启 timer：

```bash
sudo systemctl start boguan-backup
sudo systemctl start boguan-offsite
sudo journalctl -u boguan-offsite -n 30 --no-pager
sudo systemctl enable --now boguan-offsite.timer
```

按脚本实际操作授予 `oss:PutObject`、`oss:PutObjectAcl`、`oss:GetObject` 到
`acs:oss:*:*:<bucket>/boguan-backups/*` 即可；清理由 bucket 生命周期承担，不授予删除权限。
异地脚本没有配置、没有凭证、没有近期快照、上传或下载校验失败都会非零退出。
只在成功回读后写 `.ops/offsite-success`；配置 bucket 后 watchdog 检查其是否超过 36 小时。

## 恢复与回滚

日备份的目标恢复点 RPO ≤24 小时，以最近一次验证成功的副本为准；故障时直接检查备份时间。
单机重建的 RTO 暂未承诺，需完整演练并计时后确定。数据库备份包含 FTS，可直接恢复搜索；
正文是派生数据，恢复后 crawler 会发现缺文件并合规补抓。历史源消失时正文可能无法重抓。

下载异地 `.db.gz` 与同名 `.sha256` 到临时目录，用下面的工具验证；绝不直接覆盖线上库：

```bash
bash /home/xun/ops/restore-check.sh /tmp/boguan-<时间戳>.db.gz /tmp/boguan-restore-<时间戳>
```

整机恢复顺序：安装系统与运行时 → 检出确定版本 → 从安全渠道恢复私有配置 → 临时目录恢复验证 →
把校验过的数据库部署到新实例的 `data/boguan.db` → 安装依赖、构建、bootstrap →
检查本地/公网搜索 → 恢复定时器与外部探测。只有明确停掉 Web 和所有写库任务后才能替换旧实例的库；
替换时不能遗留旧库的 `-wal`/`-shm` 文件。恢复前后保留原库，避免不可逆覆盖。

产物手动回滚（先确认没有发布任务运行）：

```bash
cd /home/xun/boguan
exec 9>.ops/deploy.lock
flock -n 9 || exit 1
ls -1dt releases/*/
ln -sfn releases/<上一版> dist.new
mv -Tf dist.new dist
sudo systemctl reset-failed boguan-web
sudo systemctl restart boguan-web
# 单独校验，避免探活因持锁跳过。
bash -c 'source /home/xun/ops/lib.sh; wait_ready'
```

产物回滚不回滚数据库或 node_modules。破坏性迁移、大版本依赖升级需要独立备份及兼容性方案。
保留旧的静态资源仅在原目录，当前版本切换后旧页面的资源请求可能短暂 404；此方案不是零停机发布。

## 日志与验证

Caddy 访问日志最多 5 个轮转文件、每个约 5 MiB、保留不超过 7 天；可能含 IP 与查询参数，仅供故障排查，
不对公网开放。服务输出进持久化 journal；journald 配额是整机设置，本仓库不全局覆盖其它项目的策略。

```bash
systemctl --failed
systemctl list-timers 'boguan-*' --all
journalctl -u boguan-health -u boguan-daily -u boguan-backup --since today
journalctl -u boguan-watchdog -u 'boguan-alert@*' --since today
shellcheck -x -P deploy/ops deploy/ops/*.sh
python3 deploy/ops/test_ops.py
```

测试在临时目录模拟 HTTP、重启、构建和回滚，不对线上故障注入。CI 同时执行 ShellCheck、运维回归、
原有类型/文案/单元测试、fixture 构建，任一失败则 required check 失败。

## 运维验收清单

- [ ] 已合并代码、外部探测工作流执行成功，配置了失败通知接收方式。
- [ ] 真实 webhook 通知送达，接收人确认；不能仅凭 HTTP 200 判断人已收到。
- [ ] OSS 上传、下载、SHA256 与恢复验证成功，异地 timer 已启用。
- [ ] 在新实例完成一次整机恢复并记录耗时，再承诺 RTO。
- [ ] 首个自然日的备份、异地同步、抓取发布均成功。
- [ ] 域名到期、ECS 续费、云监控告警联系人与规则在控制台确认。

备案号由 `src/lib/site.ts` 维护；canonical、RSS、sitemap 跟随 `astro.config.mjs` 的域名配置。
