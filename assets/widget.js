/* dsh-live2d-pet —— 界面右下角的 Live2D 宠物挂件(原生 JS, 无构建)
   要点: ① 随意摆放(只在贴边时吸附) ② 逐像素命中, 人物以外的区域鼠标穿透, 不挡界面 */
(function () {
  if (window.__dshLive2dPet) return;
  window.__dshLive2dPet = true;

  const ROUTE = '/dsh-live2d-pet';
  const MODEL_URL = ROUTE + '/model/kouzhaomei.model3.json';
  const LIBS = [ROUTE + '/lib/pixi.min.js', ROUTE + '/lib/live2d.js', ROUTE + '/lib/live2dcubismcore.js', ROUTE + '/lib/live2d-display.min.js'];
  const VIEW = { canvas: [3520, 5706], rect: [428, -69, 2770, 3520] };   // 游戏相机取景
  const BOX = { w: 300, h: 380 };
  const SNAP = 40;                     // 距边缘 40px 内才吸附, 否则完全自由
  const state = { x: null, y: null, scale: 1, opacity: 1, hidden: false, passthrough: true };

  const el = (tag, css) => { const e = document.createElement(tag); if (css) Object.assign(e.style, css); return e; };

  const root = el('div', {
    position: 'fixed', zIndex: 900, right: '18px', bottom: '18px', width: BOX.w + 'px', height: BOX.h + 'px',
    touchAction: 'none', userSelect: 'none', pointerEvents: 'none',   // 默认穿透, 命中人物才接管
  });
  root.id = 'dsh-live2d-pet';
  const canvasHost = el('div', { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
  const bubble = el('div', {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '96%', minWidth: '120px', maxWidth: '220px',
    background: 'rgba(20,22,28,.92)', color: '#e9eaf0', border: '1px solid rgba(255,255,255,.14)', borderRadius: '12px',
    padding: '8px 10px', font: '12.5px/1.5 system-ui,"Microsoft YaHei",sans-serif', whiteSpace: 'pre-line',
    opacity: '0', transition: 'opacity .18s', pointerEvents: 'none', textAlign: 'center',
  });
  const menuBtn = el('button', {
    position: 'absolute', right: '0', top: '0', width: '24px', height: '20px', borderRadius: '6px', cursor: 'pointer',
    background: 'rgba(20,22,28,.55)', color: '#cfd3dc', border: '1px solid rgba(255,255,255,.12)',
    font: '11px system-ui', pointerEvents: 'auto', opacity: '.45', transition: 'opacity .15s',
  });
  menuBtn.textContent = '⚙';
  const menu = el('div', {
    position: 'absolute', right: '0', top: '24px', minWidth: '168px', background: 'rgba(20,22,28,.96)', color: '#e9eaf0',
    border: '1px solid rgba(255,255,255,.14)', borderRadius: '10px', padding: '6px', font: '12.5px system-ui,"Microsoft YaHei",sans-serif',
    display: 'none', pointerEvents: 'auto', boxShadow: '0 6px 24px rgba(0,0,0,.4)',
  });
  const showBtn = el('button', {
    position: 'fixed', right: '10px', bottom: '10px', zIndex: 899, width: '26px', height: '26px', borderRadius: '50%',
    background: 'rgba(20,22,28,.6)', color: '#9aa2b1', border: '1px solid rgba(255,255,255,.14)', cursor: 'pointer', display: 'none', font: '12px system-ui',
  });
  showBtn.textContent = '🐾';
  showBtn.onclick = () => hide(false);

  root.append(canvasHost, bubble, menuBtn, menu);
  document.body.append(root, showBtn);

  menuBtn.onmouseenter = () => { menuBtn.style.opacity = '1'; };
  menuBtn.onmouseleave = () => { if (menu.style.display !== 'block') menuBtn.style.opacity = '.45'; };
  menuBtn.onclick = (e) => { e.stopPropagation(); const on = menu.style.display !== 'block'; menu.style.display = on ? 'block' : 'none'; menuBtn.style.opacity = on ? '1' : '.45'; };
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('script failed: ' + src)); document.head.appendChild(s);
    });
  }

  // ---- 状态/布局 ----
  function setScale(v) { state.scale = Math.max(0.4, Math.min(2.4, Math.round(v * 100) / 100)); layout(); save(); }
  function setOpacity(v) { state.opacity = v; root.style.opacity = String(v); save(); }
  function hide(on) { state.hidden = !!on; root.style.display = on ? 'none' : ''; showBtn.style.display = on ? 'block' : 'none'; save(); }
  function layout() {
    const w = BOX.w * state.scale, h = BOX.h * state.scale;
    root.style.width = w + 'px'; root.style.height = h + 'px';
    if (state.x == null) { root.style.right = '18px'; root.style.left = 'auto'; } else { root.style.left = state.x + 'px'; root.style.right = 'auto'; }
    if (state.y == null) { root.style.bottom = '18px'; root.style.top = 'auto'; } else { root.style.top = state.y + 'px'; root.style.bottom = 'auto'; }
    if (model) fitModel();
  }
  function save() {
    try { fetch(ROUTE + '/state.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }); } catch (e) {}
  }
  let sayTimer = null;
  function say(text, ms) {
    bubble.textContent = text; bubble.style.opacity = '1';
    clearTimeout(sayTimer); sayTimer = setTimeout(() => { bubble.style.opacity = '0'; }, ms || 5200);
  }

  // ---- 逐像素命中: 只让人物本体接管鼠标, 其它区域穿透 ----
  const MW = 64, MH = 80;
  let maskCtx = null;   // 拿不到 2D 上下文时退化为"整块命中", 绝不因此崩掉挂件
  try {
    const maskCv = document.createElement('canvas'); maskCv.width = MW; maskCv.height = MH;
    maskCtx = maskCv.getContext('2d', { willReadFrequently: true });
  } catch (e) { console.warn('[dsh-live2d-pet] no 2d ctx for mask', e); }
  let mask = null, maskAt = 0;
  function refreshMask(force) {
    if (!app || !maskCtx) return;
    const now = performance.now();
    if (!force && now - maskAt < 150) return;
    maskAt = now;
    try {
      maskCtx.clearRect(0, 0, MW, MH);
      maskCtx.drawImage(app.view, 0, 0, MW, MH);
      const d = maskCtx.getImageData(0, 0, MW, MH).data;
      const out = new Uint8Array(MW * MH);
      for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = d[p] > 16 ? 1 : 0;
      mask = out;
    } catch (e) { mask = null; }
  }
  function overPet(clientX, clientY) {
    if (!state.passthrough) return true;                 // 穿透关闭 -> 整块都可操作
    const r = root.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    if (!mask) return true;         // 没有掩码时按"整块可操作"处理, 至少能用
    const mx = Math.min(MW - 1, Math.max(0, Math.floor((clientX - r.left) / r.width * MW)));
    const my = Math.min(MH - 1, Math.max(0, Math.floor((clientY - r.top) / r.height * MH)));
    return mask[my * MW + mx] === 1;
  }
  window.addEventListener('pointermove', (e) => {
    if (dragging) { root.style.pointerEvents = 'auto'; return; }
    if (menu.style.display === 'block') { root.style.pointerEvents = 'auto'; return; }
    refreshMask(false);
    const over = overPet(e.clientX, e.clientY);
    root.style.pointerEvents = over ? 'auto' : 'none';
    canvasHost.style.cursor = over ? 'grab' : '';
  }, { passive: true });

  let app = null, model = null;
  function fitModel() {
    if (!model || !app) return;
    const [rx, ry, rw, rh] = VIEW.rect;
    const W = app.screen.width, H = app.screen.height;
    const s = Math.max(W / rw, H / rh);
    model.anchor.set(0, 0);
    model.scale.set(s);
    model.position.set(W / 2 - (rx + rw / 2) * s, H / 2 - (ry + rh / 2) * s);
  }

  // ---- 余额 ----
  let balanceBusy = false;
  async function fetchBalance(show) {
    if (balanceBusy) return; balanceBusy = true;
    try {
      const d = await (await fetch(ROUTE + '/balance.json', { cache: 'no-store' })).json();
      if (!d.ok) { say('余额获取失败\n' + (d.code || '') + (d.error ? ' · ' + d.error : ''), 8000); return; }
      const t = new Date(d.updatedAt || Date.now());
      const hh = String(t.getHours()).padStart(2, '0'), mm = String(t.getMinutes()).padStart(2, '0');
      say((d.currency === 'CNY' ? '¥' : d.currency + ' ') + Number(d.totalBalance).toFixed(2) + (d.stale ? '（旧数据）' : '') + '\n更新 ' + hh + ':' + mm, 8000);
    } catch (e) { if (show) say('余额请求失败: ' + e.message, 8000); }
    finally { balanceBusy = false; }
  }

  // ---- 菜单 ----
  const rows = [];
  const addRow = (pair) => rows.push(pair);
  [['余额', () => { say('查询余额…'); fetchBalance(true); }],
   ['大小 +', () => setScale(state.scale + 0.15)],
   ['大小 −', () => setScale(state.scale - 0.15)],
   ['透明度', () => setOpacity(state.opacity > 0.7 ? 0.55 : 1)],
   ['穿透: 开(默认) → 关', () => { state.passthrough = !state.passthrough; save(); root.style.pointerEvents = 'auto'; say(state.passthrough ? '穿透已开: 只有人物接鼠标' : '穿透已关: 整块可拖', 3000); renderMenu(); }],
   ['归位右下角', () => { state.x = null; state.y = null; layout(); save(); }],
   ['隐藏(右下角 🐾 恢复)', () => hide(true)],
  ].forEach(addRow);
  function renderMenu() {
    try {
      menu.textContent = '';
      for (const [labelRaw, fn] of rows) {
        const label = labelRaw.startsWith('穿透')
          ? (state.passthrough ? '穿透: 开 (只响应人物)' : '穿透: 关 (整块可操作)')
          : labelRaw;
        const b = el('div', { padding: '5px 8px', borderRadius: '7px', cursor: 'pointer' });
        b.textContent = label;
        b.onmouseenter = () => { b.style.background = 'rgba(255,255,255,.08)'; };
        b.onmouseleave = () => { b.style.background = 'transparent'; };
        b.onclick = (e) => { e.stopPropagation(); fn(); if (!labelRaw.startsWith('穿透')) menu.style.display = 'none'; };
        menu.appendChild(b);
      }
    } catch (err) { console.error('[dsh-live2d-pet] menu render failed', err); }
  }

  // ---- 拖拽: 自由摆放, 只在贴近边缘时吸附 ----
  let dragging = false, moved = false, ox = 0, oy = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.target === menuBtn || menu.contains(e.target)) return;
    dragging = true; moved = false;
    const r = root.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
    try { root.setPointerCapture(e.pointerId); } catch (err) {}
    root.style.pointerEvents = 'auto';
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = true;
    const w = root.getBoundingClientRect().width, h = root.getBoundingClientRect().height;
    state.x = Math.round(Math.min(window.innerWidth - w - 2, Math.max(2, e.clientX - ox)));
    state.y = Math.round(Math.min(window.innerHeight - h - 2, Math.max(2, e.clientY - oy)));
    layout();
  });
  root.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const r = root.getBoundingClientRect(), w = window.innerWidth;
    // 只在 40px 内吸附左右边缘(上下同理), 否则保持你放的位置
    if (r.left < SNAP) state.x = 10;
    else if (w - r.right < SNAP) state.x = Math.round(w - r.width - 10);
    if (r.top < SNAP) state.y = 10;
    else if (window.innerHeight - r.bottom < SNAP) state.y = Math.round(window.innerHeight - r.height - 10);
    layout(); save(); refreshMask(true);
    if (!moved) fetchBalance(true);
  });
  window.addEventListener('wheel', (e) => {
    const r = root.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    if (!overPet(e.clientX, e.clientY)) return;
    e.preventDefault(); setScale(state.scale + (e.deltaY > 0 ? -0.08 : 0.08));
  }, { passive: false });
  window.addEventListener('resize', layout);
  renderMenu();

  async function boot() {
    try {
      try { const d = await (await fetch(ROUTE + '/state.json', { cache: 'no-store' })).json(); if (d && d.state) Object.assign(state, d.state); } catch (e) {}
      root.style.opacity = String(state.opacity);
      if (state.hidden) hide(true);
      layout();

      for (const l of LIBS) await loadScript(l);
      if (!(window.PIXI && PIXI.live2d && PIXI.live2d.Live2DModel)) { say('Live2D 库未就绪', 9000); return; }

      app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, resizeTo: canvasHost, preserveDrawingBuffer: true });
      canvasHost.appendChild(app.view);
      model = await PIXI.live2d.Live2DModel.from(MODEL_URL);
      app.stage.addChild(model);
      fitModel();
      refreshMask(true);
      setTimeout(() => refreshMask(true), 600);

      const core = model.internalModel.coreModel;
      const set = (id, v) => { try { core.setParameterValueById(id, v); } catch (e) {} };
      let t = 0, blinkAt = performance.now() + 2500, blinkT = -1;
      app.ticker.add(() => {
        const now = performance.now();
        t = (t + app.ticker.deltaMS) / 1000;
        set('ParamBreath', (Math.sin(t * 1.6) + 1) / 2 * 0.6 + 0.2);
        set('ParamAngleZ', Math.sin(t * 0.45) * 3.5);
        set('ParamAngleX', Math.sin(t * 0.31) * 2.0);
        if (blinkT >= 0) {
          const k = (now - blinkT) / 140, v = k >= 1 ? 1 : Math.abs(Math.cos(k * Math.PI));
          set('ParamEyeLOpen', v); set('ParamEyeROpen', v);
          if (k >= 1) { blinkT = -1; blinkAt = now + 1800 + Math.random() * 3200; }
        } else if (now > blinkAt) blinkT = now;
      });

      fetchBalance(false);
      setInterval(() => fetchBalance(false), 180000);
      console.log('[dsh-live2d-pet] ready · 穿透=' + state.passthrough);
    } catch (err) {
      say('挂件启动失败\n' + (err && err.message ? err.message : err), 12000);
      console.error('[dsh-live2d-pet]', err);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
