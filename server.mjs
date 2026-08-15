// info-feed —— 通用 RSS 信息流时间线。零依赖(Node 22+ 内置 http/fetch)。
// 职责: ① 服务端拉取并解析 config.env 里配置的 RSS/Atom 源(带内存缓存);
//        ② 托管单页时间线前端。前端不直连任何外部源, 全走 /api/timeline。
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const ROOT = dirname(fileURLToPath(import.meta.url));

// 极简 config.env 载入(KEY=VALUE, 不覆盖已存在的环境变量; 缺文件静默跳过)
const envPath = join(ROOT, "config.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT) || 8791;
// 铁律: 默认只监听 127.0.0.1, 对外走隧道 + Access; 本地调试可设 HOST=0.0.0.0
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_TTL = Number(process.env.CACHE_TTL_MS) || 10 * 60 * 1000;
const MAX_DEFAULT = Number(process.env.MAX_ITEMS) || 200;

// 源配置: FEEDS 里每行(或逗号分隔)一条 "名称|URL"
const FEEDS = (process.env.FEEDS || "")
  .split(/[\n,]/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const i = s.indexOf("|");
    return i > 0 ? { name: s.slice(0, i).trim(), url: s.slice(i + 1).trim() } : null;
  })
  .filter(Boolean);

if (!FEEDS.length) {
  console.error("未配置任何源: 请拷贝 config.env.example 为 config.env 并填写 FEEDS");
  process.exit(1);
}

// ── RSS/Atom 极简解析(正则级, 只取 title/link/time, 够时间线用) ──────
const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const decode = (s) =>
  unCdata(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "").trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function parseFeed(xml) {
  const items = [];
  // RSS 2.0 <item> 与 Atom <entry> 一起扫
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const b = m[0];
    const title = decode(tag(b, "title"));
    // Atom 的 link 在属性里; RSS 在标签体里
    const atomLink = b.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
    const link = decode(tag(b, "link")) || (atomLink ? atomLink[1] : "");
    const timeRaw = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const t = Date.parse(decode(timeRaw));
    const desc = decode(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 240);
    if (title && link) items.push({ title, link, desc, time: Number.isFinite(t) ? t : null });
  }
  return items;
}

// ── 内存缓存: 每源一格 {items, fetchedAt, error} ────────────────────
const cache = new Map();

async function refresh(feed) {
  const c = cache.get(feed.name);
  if (c && Date.now() - c.fetchedAt < CACHE_TTL) return c;
  try {
    const r = await fetch(feed.url, {
      headers: { "user-agent": "info-feed/0.1 (+awesome-agent sample)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = parseFeed(await r.text()).map((it) => ({ ...it, source: feed.name }));
    const next = { items, fetchedAt: Date.now(), error: null };
    cache.set(feed.name, next);
    return next;
  } catch (e) {
    // 诚实: 拉不到就记错误, 保留上次成功的数据(如有), 绝不编造
    const next = { items: c?.items || [], fetchedAt: Date.now(), error: String(e.message || e) };
    cache.set(feed.name, next);
    return next;
  }
}

async function timeline(sourceFilter, max) {
  const picked = sourceFilter ? FEEDS.filter((f) => f.name === sourceFilter) : FEEDS;
  const states = await Promise.all(picked.map(refresh));
  const items = states
    .flatMap((s) => s.items)
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .slice(0, max);
  const sources = FEEDS.map((f) => {
    const s = cache.get(f.name);
    return { name: f.name, count: s?.items.length || 0, error: s?.error || null, fetchedAt: s?.fetchedAt || null };
  });
  return { ok: true, items, sources, asOf: new Date().toISOString() };
}

// ── HTTP ────────────────────────────────────────────────────────────
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const json = (res, code, data) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/timeline") {
      const max = Math.min(Number(url.searchParams.get("max")) || MAX_DEFAULT, 1000);
      return json(res, 200, await timeline(url.searchParams.get("source"), max));
    }
    if (url.pathname === "/api/health") {
      return json(res, 200, { ok: true, feeds: FEEDS.map((f) => f.name), cacheTtlMs: CACHE_TTL });
    }
    // 静态托管(禁止路径穿越)
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = join(ROOT, "public", rel);
    if (!file.startsWith(join(ROOT, "public")) || !existsSync(file)) {
      return json(res, 404, { ok: false, error: "not found" });
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
}).listen(PORT, HOST, () => {
  console.log(`info-feed → http://${HOST}:${PORT} · ${FEEDS.length} 个源 · 缓存 ${CACHE_TTL / 60000} 分钟`);
});
