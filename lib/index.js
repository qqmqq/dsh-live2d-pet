// dsh-live2d-pet —— 宿主侧: 提供模型/库/余额/配置 路由, 并把 widget 脚本注入界面
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const name = 'dsh-live2d-pet';
const inject = ['webServer', 'credentials'];

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(PACKAGE_ROOT, 'assets');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STATE_FILE = path.join(DSH_HOME, '.dsh-live2d-pet.json');
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

const MIME = {
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.moc3': 'application/octet-stream',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(obj) {
  try { fs.mkdirSync(DSH_HOME, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 1)); return true; } catch { return false; }
}

function apply(ctx) {
  const disposers = [];
  const log = (...a) => { try { console.log('[dsh-live2d-pet]', ...a); } catch {} };

  const json = (res, obj, code = 200, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra });
    res.end(JSON.stringify(obj));
  };

  // ---- 静态文件: 库 / 模型 / 贴图 ----
  function serveFile(res, rel, fallbackMime) {
    const p = path.join(ASSETS, rel);
    if (!p.startsWith(ASSETS) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || fallbackMime || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  }

  // ---- 余额: key 从 DSH 凭据读, 25s 缓存 + 重试 + 瞬时失败回退 ----
  let cache = { at: 0, data: null };
  let inflight = null;
  // key 来源(按顺序试): 显式 key 文件 -> DSH 凭据服务(多种可能的 API 形状) -> .credentials.yaml -> 环境变量
  function keyFromFile() {
    for (const f of [path.join(DSH_HOME, '.dsh-live2d-pet.key'), path.join(PACKAGE_ROOT, 'key.txt')]) {
      try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v; } catch {}
    }
    return null;
  }
  function keyFromYaml() {
    try {
      const txt = fs.readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8');
      const m = txt.match(/DEEPSEEK_API_KEY[\s\S]{0,800}?secret:\s*("?'?)([^"'\n\r]+)\1/);
      // 只认真正的 DeepSeek key 形状; 库里那条是 kind:grant 的不透明 secret, 抓出来只会换来 401
      if (m && m[2] && /^sk-[A-Za-z0-9_-]{8,}$/.test(m[2].trim())) return m[2].trim();
    } catch {}
    return null;
  }
  function unwrap(v) {
    if (!v) return null;
    if (typeof v === 'string') return v.trim() || null;
    for (const k of ['secret', 'value', 'key', 'token', 'payload']) {
      if (v[k] && typeof v[k] === 'string') return v[k].trim() || null;
    }
    return null;
  }
  let lastKeySource = 'none';
  async function pickKey() {
    const fromFile = keyFromFile();
    if (fromFile) { lastKeySource = 'key-file'; return fromFile; }
    const names = ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY'];
    const cred = ctx && ctx.credentials;
    if (cred) {
      for (const n of names) {
        for (const m of ['get', 'read', 'resolve', 'load', 'getSecret', 'fetch']) {
          try {
            if (typeof cred[m] === 'function') {
              const v = unwrap(await cred[m](n));
              if (v) { lastKeySource = 'credentials.' + m + '(' + n + ')'; return v; }
            }
          } catch {}
        }
        try { const v = unwrap(cred[n]); if (v) return v; } catch {}
      }
    }
    const fromYaml = keyFromYaml();
    if (fromYaml) { lastKeySource = 'credentials.yaml'; return fromYaml; }
    const env = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;
    if (env) { lastKeySource = 'env'; return env; }
    lastKeySource = 'none';
    return null;
  }

  async function fetchBalanceOnce(key) {
    const r = await fetch(BALANCE_URL, { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { ok: false, httpStatus: r.status };
    const d = await r.json();
    const infos = Array.isArray(d.balance_infos) ? d.balance_infos : [];
    const num = (s) => { const n = Number.parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
    // 多币种顺序不固定: 优先 CNY 且余额>0 -> 任意非零 -> CNY -> 第一项
    const pick = infos.find(i => (i.currency === 'CNY') && num(i.total_balance) > 0)
      || infos.find(i => num(i.total_balance) > 0)
      || infos.find(i => i.currency === 'CNY')
      || infos[0] || null;
    return {
      ok: true,
      isAvailable: d.is_available !== false,
      currency: pick ? pick.currency : 'CNY',
      totalBalance: pick ? num(pick.total_balance) : 0,
      grantedBalance: pick ? num(pick.granted_balance) : 0,
      toppedUpBalance: pick ? num(pick.topped_up_balance) : 0,
      updatedAt: Date.now(),
    };
  }
  async function balance() {
    const now = Date.now();
    if (cache.data && now - cache.at < 25000) return cache.data;
    if (inflight) return inflight;
    inflight = (async () => {
      const key = await pickKey();
      if (!key) return { ok: false, code: 'NO_KEY', error: '未找到 DEEPSEEK_API_KEY(试过 凭据服务/环境变量/key 文件)' };
      log('balance key source: ' + lastKeySource);
      let last = null;
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fetchBalanceOnce(key);
          if (r.ok) { cache = { at: Date.now(), data: r }; return r; }
          last = r;
          if (r.httpStatus && r.httpStatus >= 400 && r.httpStatus < 500) {
            return { ok: false, code: 'HTTP_' + r.httpStatus, error: '余额接口返回 ' + r.httpStatus };
          }
        } catch (e) { last = { ok: false, code: 'NETWORK', error: String(e && e.message || e) }; }
        if (i === 0) await new Promise(r2 => setTimeout(r2, 500));
      }
      if (cache.data) return { ...cache.data, stale: true };
      return { ok: false, code: 'UPSTREAM', error: (last && last.error) || '余额获取失败', transient: true };
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  // ---- 路由注册 ----
  const routes = [
    ['/dsh-live2d-pet/widget.js', (req, res) => serveFile(res, 'widget.js')],
    ['/dsh-live2d-pet/model/kouzhaomei.model3.json', (req, res) => serveFile(res, 'model/kouzhaomei.model3.json')],
    ['/dsh-live2d-pet/model/kouzhaomei.moc3', (req, res) => serveFile(res, 'model/kouzhaomei.moc3')],
    ['/dsh-live2d-pet/model/texture_00.png', (req, res) => serveFile(res, 'model/texture_00.png')],
    ['/dsh-live2d-pet/model/texture_01.png', (req, res) => serveFile(res, 'model/texture_01.png')],
    ['/dsh-live2d-pet/lib/pixi.min.js', (req, res) => serveFile(res, 'lib/pixi.min.js')],
    ['/dsh-live2d-pet/lib/live2d.js', (req, res) => serveFile(res, 'lib/live2d.js')],
    ['/dsh-live2d-pet/lib/live2dcubismcore.js', (req, res) => serveFile(res, 'lib/live2dcubismcore.js')],
    ['/dsh-live2d-pet/lib/live2d-display.min.js', (req, res) => serveFile(res, 'lib/live2d-display.min.js')],
    ['/dsh-live2d-pet/status.json', (req, res) => json(res, { ok: true, plugin: name, routes: routes.length, model: fs.existsSync(path.join(ASSETS, 'model', 'kouzhaomei.moc3')), keySource: lastKeySource, webServerApi: 'object-form WebRoute' })],
    ['/dsh-live2d-pet/balance.json', async (req, res) => json(res, await balance())],
    ['/dsh-live2d-pet/state.json', async (req, res) => {
      if (req.method === 'PUT' || req.method === 'POST') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 65536) break; }
        let obj = {};
        try { obj = JSON.parse(body || '{}'); } catch {}
        const cur = readState();
        const next = { ...cur, ...(obj && typeof obj === 'object' ? obj : {}) };
        if (obj && obj.reset) { delete next.x; delete next.y; delete next.scale; delete next.opacity; }
        delete next.reset;
        writeState(next);
        return json(res, { ok: true, state: next });
      }
      json(res, { ok: true, state: readState() });
    }],
  ];

  // 正式签名: register({ kind, path, handler })  (dsh-host-webserver WebRoute)
  // 兜底再试两参数旧形式, 任何一个版本都能装上; 失败必须打出来, 不能再被吞
  for (const [route, handler] of routes) {
    let d = null;
    try {
      d = ctx.webServer.register({ kind: 'exact', path: route, handler });
      log('route ok (object form)', route);
    } catch (e1) {
      try {
        d = ctx.webServer.register(route, handler);
        log('route ok (legacy 2-arg form)', route);
      } catch (e2) {
        console.error('[dsh-live2d-pet] register FAILED', route, String(e2 && e2.message || e2));
      }
    }
    if (typeof d === 'function') disposers.push(d);
  }

  // ---- 注入页面脚本 ----
  // 首选结构化注入行(官方推荐, 静态部署也能带走); 没有该事件时退回 raw tapIndex
  const WIDGET_SRC = '/dsh-live2d-pet/widget.js';
  let injected = false;
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('webserver/index-inject', (table) => {
        if (!Array.isArray(table)) return;
        if (table.some((r) => r && r.src === WIDGET_SRC)) return;
        table.push({ kind: 'script-src', placement: 'body', src: WIDGET_SRC });
        injected = true;
      });
      log('index injection: structured row');
    }
  } catch (e) { console.error('[dsh-live2d-pet] index-inject subscribe failed', String(e && e.message || e)); }
  try {
    if (!injected && typeof ctx.webServer.tapIndex === 'function') {
      const d = ctx.webServer.tapIndex((html) => {
        if (typeof html !== 'string' || html.includes(WIDGET_SRC)) return html;
        const tag = '<script defer src="' + WIDGET_SRC + '"></script>';
        return html.includes('</body>') ? html.replace('</body>', tag + '\n</body>') : html + tag;
      });
      if (typeof d === 'function') disposers.push(d);
      log('index injection: tapIndex');
    }
  } catch (e) { console.error('[dsh-live2d-pet] tapIndex failed', String(e && e.message || e)); }

  ctx.effect(() => () => { for (const d of disposers) { try { d(); } catch {} } });
  log('ready · 模型 ' + (fs.existsSync(path.join(ASSETS, 'model', 'kouzhaomei.moc3')) ? 'ok' : '缺失') + ' · 路由 ' + routes.length);
}

export { name, inject, apply };
