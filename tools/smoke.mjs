// 独立冒烟: 不依赖 dsh 运行时, 用假 ctx 把插件的路由挂到本地 http, 逐条验证
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL('C:/Users/bai/projects/dsh-live2d-pet/lib/index.js').href);
const routes = [];
let tap = null, effect = null, inj = null;
const ctx = {
  webServer: {
    // 真实契约: register({kind, path, handler}); 传两参数(旧写法)会抛错 -> 冒烟能抓出来
    register(route, handler) {
      if (typeof route === 'string' || !route || !route.path) {
        throw new TypeError('WebRoute required: { kind, path, handler }');
      }
      if (typeof route.handler !== 'function') throw new TypeError('handler required');
      routes.push([route.path, route.handler]);
      return () => {};
    },
    tapIndex(fn) { tap = fn; return () => {}; },
  },
  on(event, fn) { if (event === 'webserver/index-inject') inj = fn; return () => {}; },
  credentials: { async get() { return null; } },   // 模拟无 key
  effect(fn) { effect = fn; return () => {}; },
};
mod.apply(ctx);
console.log('registered routes:', routes.length);

const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const hit = routes.find(([r]) => r === url.pathname);
  if (!hit) { res.writeHead(404); return res.end('nope'); }
  try { await hit[1](req, res); } catch (e) { res.writeHead(500); res.end(String(e.message)); }
});
await new Promise(r => srv.listen(8799, '127.0.0.1', r));

const get = async (p, opts) => {
  const r = await fetch('http://127.0.0.1:8799' + p, opts);
  const len = r.headers.get('content-length') || (await r.clone().arrayBuffer()).byteLength;
  return [r.status, r.headers.get('content-type'), len];
};
for (const p of ['/dsh-live2d-pet/widget.js', '/dsh-live2d-pet/model/kouzhaomei.model3.json',
                 '/dsh-live2d-pet/model/kouzhaomei.moc3', '/dsh-live2d-pet/model/texture_00.png',
                 '/dsh-live2d-pet/lib/pixi.min.js', '/dsh-live2d-pet/lib/live2d-display.min.js',
                 '/dsh-live2d-pet/state.json', '/dsh-live2d-pet/balance.json']) {
  const [s, ct, n] = await get(p);
  console.log(String(s).padEnd(4), String(ct).slice(0, 34).padEnd(36), String(n).padStart(9), p);
}
const put = await fetch('http://127.0.0.1:8799/dsh-live2d-pet/state.json', { method: 'PUT', body: JSON.stringify({ x: 1200, y: 300, scale: 1.15 }) });
console.log('PUT state:', put.status, JSON.stringify(await put.json()).slice(0, 120));
const back = await (await fetch('http://127.0.0.1:8799/dsh-live2d-pet/state.json')).json();
console.log('GET state:', JSON.stringify(back));
console.log('balance:', JSON.stringify(await (await fetch('http://127.0.0.1:8799/dsh-live2d-pet/balance.json')).json()).slice(0, 160));
// index 注入: 结构化行(首选) + tapIndex(兜底)
let rowOk = 'FAIL';
if (inj) { const table = []; inj(table); rowOk = table.some(r => r && r.src === '/dsh-live2d-pet/widget.js') ? 'OK' : 'FAIL'; }
console.log('index 注入(结构化行):', rowOk);
const html = tap ? tap('<!doctype html><html><body>hi</body></html>') : '(no tapIndex)';
console.log('index 注入(tapIndex):', html.includes('/dsh-live2d-pet/widget.js') ? 'OK' : '(未使用, 结构化行优先)');
srv.close();
