# 部署与运维

单台阿里云 ECS（Ubuntu 24.04，2C2G，华北2）+ systemd + Caddy。域名 `boguan.org.cn`。
静态页与唯一的 SSR 搜索由 Node 服务；不引入容器、任务队列或多实例。

```text
公网 80/443 -> Caddy（自动 HTTPS、访问日志轮转）-> 127.0.0.1:4321
                                                   Node（boguan-web 账号）
                                                   /srv/boguan 只读视图
每日 timer -> crawler -> 校验 -> release -> 切换 -> 重启 -> HTTP 验证
```

## 平台操作与服务器连接

### 阿里云控制台

入口：<https://home.console.aliyun.com/>。用户提出本项目的阿里云平台操作需求时，AI 助手可以在请求范围内通过浏览器查看资源、调整配置并执行运维操作；已明确授权的步骤无需重复确认。购买、付费开通、删除资源等操作仍需有对应的明确授权。

优先使用 ego-browser，先读取其 skill 并运行 `ego-browser skill`，按当前版本指引连接浏览器，复用用户已有登录态。同一任务复用 task space，不把历史 space ID 当成固定入口；需要交还用户查看的结果页应按指引保留。登录失效、验证码或 MFA 时交给用户完成，不导出 Cookie 或索取长期凭证。

本次会话已通过 ego-browser 打开控制台首页，页面没有跳转到登录页。登录态会变化，后续操作以实时页面为准。常用入口为 ECS 实例、云监控、ARMS 用户体验监控、日志服务 SLS；能进入控制台不代表这些产品已全部开通或完成接入。

### 日常 SSH 登录

本机已配置 SSH 别名，直接连接：

```bash
ssh aliyun
```

配置位于本机 `C:/Users/xun/.ssh/config`（其他工作站需自行配置），对应信息：

| 项目         | 值                                                    |
| :----------- | :---------------------------------------------------- |
| Host 别名    | `aliyun`                                              |
| HostName     | `47.93.255.237`                                       |
| User         | `xun`                                                 |
| Port         | `22`（默认）                                          |
| IdentityFile | `~/.ssh/aliyun-ecs-key`（本机私钥路径，不是仓库文件） |
| 登录后主目录 | `/home/xun`                                           |
| 项目目录     | `/home/xun/boguan`                                    |

不使用别名时的等效命令：

```bash
ssh -i ~/.ssh/aliyun-ecs-key -p 22 xun@47.93.255.237
```

本次会话使用 `ssh -o BatchMode=yes -o ConnectTimeout=10 aliyun 'hostname; id -un; pwd'` 实际连接成功，返回用户 `xun`、目录 `/home/xun`。这验证了本机当前的免交互连接能力，不保证其他工作站或未来的网络、密钥状态。

GitHub Actions 使用下文的专用受限部署密钥，只允许 `deploy <完整 SHA>`，不能用作日常交互式 SSH。日常管理使用上面的本机密钥。私钥内容、密码、Cookie、临时令牌和完整私有环境配置不得写入仓库或日志。

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
| `/etc/boguan/ossutilconfig`   | OSS 实例角色配置，无长期密钥，root:xun 0640     |
| `/home/xun/ops-python`        | 云监控官方 Python SDK 的独立虚拟环境            |
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
BOGUAN_OUT_DIR="$OUT" bun run --cwd apps/web build
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

### GitHub Actions 自动部署

`CI` 工作流的部署 job 依赖完整检查，只有 `main` push 且仓库变量 `BOGUAN_DEPLOY_ENABLED=true` 才执行。
PR 只检查。main 的运行和生产部署均不取消进行中的发布，避免中断回滚。

仓库需配置变量 `BOGUAN_DEPLOY_HOST`、`BOGUAN_DEPLOY_USER=xun`、`BOGUAN_DEPLOY_PORT=22`，
以及 secrets `BOGUAN_DEPLOY_KEY`、`BOGUAN_DEPLOY_KNOWN_HOSTS`。专用 Ed25519 私钥只进入 GitHub secret；
known_hosts 由已有可信 SSH 通道取得，工作流严格校验主机密钥，不使用 `StrictHostKeyChecking=no`。
服务器 authorized_keys 对此公钥设置 `restrict,command="/bin/bash /home/xun/ops/deploy-ref.sh --ssh"`，
只接受 `deploy <完整 SHA>`，不允许任意 SSH 命令、转发或交互式 shell。

Actions 检出完整历史，确认 main 仍指向该 SHA，生成 Git bundle 并通过 SSH 标准输入传送。
`deploy-ref.sh` 限时接收至私有目录（最多 50 MiB），用 Git 校验 bundle 完整性和 SHA，
再将固定 SHA 交给 `boguan-deploy@<SHA>.service`，服务独立于 SSH 会话，服务器不联网拉取 GitHub。
它最多等待发布锁 5 分钟，拒绝脏工作区和非当前版本后继；在检出前备份，
然后复用 `publish.sh` 的构建、切换、HTTP 验证和失败回滚。失败恢复源码，并通过 `OnFailure` 通知云监控。
GitHub 不使用 fixture 产物部署，服务器按真实数据库构建，避免 CI 的四条样例数据覆盖线上页面。

常规页面、组件、业务逻辑与文档改动可自动上线。依赖清单、锁文件、数据库 schema/迁移、
运维脚本、systemd 或 Caddy/私有配置模板变化会明确停止，需按上方人工升级步骤处理后再启用发布；
不会自动执行数据库迁移。升级期间可设 `BOGUAN_DEPLOY_ENABLED=false` 暂停新的部署 job。
SSH 连接故障时应先检查服务日志和 `dist/REVISION`，因为服务器上的发布仍可能继续执行。
ECS 到 GitHub 的 Git 拉取已实测不稳定，因此部署不依赖该链路；提交历史随 bundle 一同传输。
自动化仍需 GitHub runner 能通过 SSH 连接 ECS，连接失败时工作流明确失败。

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
当前采用云监控自定义事件，沿用阿里云现有的“报警”联系人组。服务器设置：

```ini
BOGUAN_ALERT_FORMAT=cloudmonitor
BOGUAN_CMS_GROUP_ID=247878023
BOGUAN_CMS_REGION=cn-beijing
BOGUAN_RAM_ROLE=boguan-ops
```

在 `/home/xun/ops-python` 创建 Python 虚拟环境，并安装锁定的直接依赖：

```bash
python3 -m venv /home/xun/ops-python
/home/xun/ops-python/bin/pip install -r /home/xun/ops/requirements.txt
```

Ubuntu 缺少 venv 时先安装 `python3-venv`。`bootstrap.sh` 只安装脚本和依赖清单，不隐式联网安装 SDK。
通知脚本显式使用实例角色、强制 IMDSv2，不使用长期 AK，也不回退默认凭证链。Web 单元通过
`IPAddressDeny=100.100.100.200/32` 禁止访问实例元数据；需确认宿主机支持 systemd 的 cgroup/BPF IP 过滤。

云监控需先收到一次 `BoguanTaskFailed` 事件，再通过 `PutCustomEventRule` 创建规则：应用分组与配置一致、
事件名 `BoguanTaskFailed`、Period `60`、Threshold `1`、Level `WARN`、ContactGroups 为现有联系人组。
规则返回的真实 ID 以 `DescribeMetricRuleList(GroupId=...)` 为准（`EventFlow_...`），不等于传入的 RuleId。
检查规则启用、事件维度、联系人组和生效时间；API 接收事件、事件入库、规则触发及人收到通知分别验收。

保留 `generic`、飞书、钉钉、企业微信、Slack 文本 webhook 选项，通过 HTTPS `BOGUAN_ALERT_WEBHOOK` 配置；
需要签名校验的机器人需另行适配。只发送主机、单元名与退出状态，不携带日志、数据库内容或凭证。
只有平台确认接收才记录时间，按单元抑制重复一小时；这不等同于接收人已收到。

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

1. 当前 bucket `boguan-backups-20261126` 为北京地域、私有标准存储、本地冗余、阻止公共访问、
   OSS 托管 AES256 加密；`boguan-backups/` 最后修改 30 天后删除，生命周期规则已启用。
   未开启版本控制；即使不给删除权限，角色仍能覆盖同名备份。同地域副本不提供跨地域灾难保护。
2. ECS 绑定 `boguan-ops` 实例角色，只允许备份前缀读写和 `cms:PutCustomEvent`；不用主账号 AK。
3. 安装官方 ossutil v2（当前实测 2.4.1），复制无长期密钥的实例角色配置，再设置 bucket：

```bash
sudo install -m 640 -o root -g xun deploy/ossutilconfig.example /etc/boguan/ossutilconfig
# /etc/boguan/ops.env：BOGUAN_OSS_BUCKET=boguan-backups-20261126
```

实例角色 provider 的配置值为 `Ali-EcsRamRole`；北京内网 endpoint 只适用于同地域 ECS。
新实例恢复时先绑定并授权角色，再下载快照。角色信任 ECS，不授予角色管理或策略管理权限。 4. 手动执行并验证，再开启 timer：

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

实际检查、应用恢复演练结果和待完成依赖见 [验收记录](ACCEPTANCE.md)。2026-11-27 的控制台资源盘点、免费权益、收费边界及待决策项见 [阿里云配置与权益检查](CLOUD-REVIEW.md)。

- [ ] 已合并代码、外部探测工作流执行成功，配置了失败通知接收方式。
- [ ] 云监控事件触发通知，接收人确认；不能仅凭 API 200 判断人已收到。
- [x] OSS 上传、下载、SHA256 与恢复验证成功，异地 timer 已启用。
- [ ] 在新实例完成一次整机恢复并记录耗时，再承诺 RTO。
- [ ] 首个自然日的备份、异地同步、抓取发布均成功。
- [ ] 域名到期、ECS 续费、云监控告警联系人与规则在控制台确认。

备案号由 `src/lib/site.ts` 维护；canonical、RSS、sitemap 跟随 `astro.config.mjs` 的域名配置。
