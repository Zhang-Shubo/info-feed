# info-feed(信息流)

**通用 RSS 信息流时间线** —— 把 config.env 里配置的任意 RSS/Atom 源聚合成一条按时间倒序的时间线。[awesome-agent](https://github.com/Zhang-Shubo/awesome-agent) 的**样例项目**:演示 docs/08 项目创建流程(三要素 → 模板建仓 → 零依赖实现 → registry 登记)的完整产物。

- 技术栈:零依赖(Node 22+ 内置 `http`/`fetch`)+ 单文件原生前端。无框架、无构建、无 node_modules。
- 数据流:服务端拉源(带内存缓存)→ `/api/timeline` → 前端渲染。前端不直连任何外部源。

## 运行

```bash
cp config.env.example config.env   # 改 FEEDS(每行 "名称|URL")
npm start                          # 或 node server.mjs
# 打开 http://127.0.0.1:8791
```

## 结构

| 文件 | 作用 |
|---|---|
| `server.mjs` | 零依赖 HTTP 服务:拉取/解析/缓存 RSS 源 + `/api/timeline` + 托管前端 |
| `public/index.html` | 时间线单页(按日分组 + 源筛选 chips),原生 JS 零依赖 |
| `public/favicon.svg` | 家族风格图标(紫渐变底「流」) |
| `config.env.example` | 配置模板(`FEEDS` / `PORT` / `CACHE_TTL_MS`) |

## 接口

- `GET /` — 时间线页面
- `GET /api/timeline[?source=<源名>][&max=200]` — 聚合条目(`{ok, items, sources, asOf}`)
- `GET /api/health` — 健康检查(返回已配置的源名列表)

## 诚实备注

- 某个源拉不到时页面顶部如实提示「数据源暂不可用」,保留该源上次成功的数据,绝不编造条目;
- 条目标题、链接、时间均来自源站原文,可溯源;回包带 `asOf`(数据截至),前端如实显示。
