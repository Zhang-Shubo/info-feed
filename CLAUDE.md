# info-feed(通用 RSS 信息流时间线)

> 写给 AI 助手 / 新接手者的工程说明。先读这份,再动代码。面向用户的说明见 README.md。
> 本项目是 awesome-agent 的样例:刻意保持最小,演示脚手架约定,不堆功能。

## 三条铁律

1. **诚实**:源拉不到就记 error、保留上次数据并在前端如实提示,绝不编造条目。
2. **可溯源**:每条数据能回答「从哪来、何时取的」——条目带 source,回包带 asOf。
3. **只增不改**:历史记录只追加,不回改(本项目无持久层,此条约束未来扩展)。

## 技术栈与运行模型

- 技术栈:Node 22+ 零依赖(`node:http` + 内置 fetch),前端单文件原生 JS
- 运行位置:本地机 `node server.mjs`;常驻部署用用户级 systemd(见 awesome-agent templates)
- 监听:`127.0.0.1:8791`,对外经 `feed.<域名>` 隧道 + Access(样例默认不上线)

## 目录结构

```
server.mjs           # ★ 全部后端:config 载入 → RSS 解析 → 缓存 → 路由
public/index.html    # ★ 全部前端:时间线渲染 + 源筛选
public/favicon.svg   # 家族图标(紫渐变「流」)
config.env.example   # 配置模板
```

## 核心约定

- 源配置格式:`FEEDS` 每行(或逗号分隔)一条 `名称|URL`,名称即前端 chip 与 source 标识;
- RSS 解析是**正则级极简实现**,只取 title/link/time——够时间线用,不做全量 XML 解析;
- 缓存按源独立,TTL 内不重复请求源站;失败源保留旧数据 + error 并存。

## 常用命令

```bash
node server.mjs                                   # 启动
curl -s 127.0.0.1:8791/api/health                 # 健康检查
curl -s '127.0.0.1:8791/api/timeline?max=5'       # 取时间线
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEEDS` | 是 | 源列表,每行 `名称\|URL` |
| `PORT` | 否 | 默认 8791 |
| `HOST` | 否 | 默认 127.0.0.1(铁律,勿改为 0.0.0.0 上线) |
| `CACHE_TTL_MS` | 否 | 每源缓存时长,默认 600000(10 分钟) |
| `MAX_ITEMS` | 否 | 时间线默认返回上限,默认 200 |

真实值在部署机 `config.env`,仓库只有 `config.env.example`。

## 部署与运维

- 部署模式:git push(裸仓库钩子或 GitHub pull,见 awesome-agent docs/08 第 4 步)
- 重启:`systemctl --user restart info-feed`
- 健康检查:`curl -s 127.0.0.1:8791/api/health`

## 已知坑

- 部分源站对无 UA 请求返回 403——fetch 已带自定义 user-agent,新增源仍 403 时先用 curl 验证源站要求;
- 极个别 RSS 的 `<link>` 为空而链接在 `<guid>` 里,当前解析不覆盖,遇到再补。
