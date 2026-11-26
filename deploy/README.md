# 部署与运维

单台阿里云 ECS（Ubuntu 24.04，2C2G，华北2）+ systemd + Caddy。不引入 Docker：
机器只有 1.6G 内存，Docker 常驻那 200–300MB 换不来收益，Caddy 单二进制已能自动签发与续期证书。

```
公网 80/443 ── Caddy（自动 HTTPS，HSTS）── 127.0.0.1:4321 ── node dist/server/entry.mjs
                                                              ├── dist/client（1098 个静态页）
                                                              └── /search（唯一 SSR 页，读 SQLite）
```

## 目录约定

| 路径                          | 内容                                             |
| :---------------------------- | :----------------------------------------------- |
| `~/boguan`                    | 代码 + `node_modules` + `data/boguan.db`         |
| `~/boguan/releases/<时间戳>/` | 每次构建的产物（`dist` 是软链，指向最新的一个）  |
| `~/backups/`                  | 每日 SQLite 备份，保留 14 份                     |
| `~/ops/`                      | 本目录 `ops/` 的副本（systemd 单元调用的是这里） |

`dist` 必须是**符号链接**，`ops/bootstrap.sh` 会把原来的实体目录搬进 `releases/` 并建好软链。
这样每次发布只需 `mv -T` 原子替换软链，不用清空正在被服务的目录。

## 首次部署

```bash
# 1. 系统依赖
sudo apt-get install -y caddy sqlite3 unzip
sudo npm i -g bun                       # bun.sh 的脚本在国内常被打断，走 npm 更稳
sudo ln -sf /usr/local/lib/node-v24.22.3-linux-x64/bin/bun /usr/local/bin/bun

# 2. 代码与数据（本地执行；scp 大文件偶发断连，用 tar over ssh 更稳）
tar -czf - --exclude=node_modules --exclude=dist --exclude=.tmp --exclude=data . \
  | ssh aliyun 'mkdir -p ~/boguan && tar -xzf - -C ~/boguan'
tar -czf - data | ssh aliyun 'tar -xzf - -C ~/boguan'
ssh aliyun 'cd ~/boguan && bun install && bun pm trust esbuild @esbuild-kit/core-utils'

# 3. 首构建 + 服务
ssh aliyun 'cd ~/boguan && ./node_modules/.bin/astro build'
# 把 deploy/systemd/ 与 deploy/ops/ 传上去后：
ssh aliyun 'bash ~/ops/bootstrap.sh'

# 4. 反代
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl restart caddy
```

`bootstrap.sh` 做的事：装 systemd 单元、给 `xun` 一条**只允许重启 `boguan-web`** 的 sudo 白名单、
把 `dist` 改成 `releases/` 软链、启用三个定时器。它不会覆盖 `~/boguan/data`。

## 定时任务

| 时间       | 单元            | 做什么                                                                            |
| :--------- | :-------------- | :-------------------------------------------------------------------------------- |
| 每 5 分钟  | `boguan-health` | 探 `/`、`/search?q=`、`/tags`；任一非 200 就重启 web，仍失败则记 failed           |
| 每天 03:30 | `boguan-backup` | `.backup` 一致性备份 → gzip → 回读校验 `posts` 数 → 留 14 份                      |
| 每天 04:30 | `boguan-daily`  | 增量抓取 → `db:check --prune` → WAL checkpoint → 构建到新 release → 切软链 → 重启 |

为什么探活要查 `/search`：它走 Node + SQLite，能顺带验证进程与数据库；只查首页时，
即使 Node 挂了，Caddy 仍可能返回缓存或静态 200，探不出问题。

## 回滚

```bash
cd ~/boguan && ls -1dt releases/*/ | head -3
ln -sfn releases/<上一版> dist.new && mv -T dist.new dist && sudo systemctl restart boguan-web
```

## 注意事项

- 部署机上的 `node_modules` 必须**在服务器上装**：`better-sqlite3`、`@node-rs/jieba` 是原生模块，
  在 Windows/macOS 上装好的产物不能跨平台拷。
- 每次发布保留 3 个 release（约 24MB/个），备份保留 14 份（约 5.7MB/份），磁盘占用可控。
- 站点合规相关：页脚固定展示 ICP 备案号（`src/lib/site.ts` 的 `icp`），域名切到
  `boguan.org.cn` 后 canonical / sitemap / RSS 全部跟随 `astro.config.mjs` 的 `site`。
- 备案期间（公安联网备案审核中）不要换 IP、换域名或长时间停站：审核单位会实际访问站点。
