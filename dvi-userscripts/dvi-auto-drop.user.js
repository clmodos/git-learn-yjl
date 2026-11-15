// ==UserScript==
// @name         [DVI]自动丢弃资源
// @namespace    local.dvi.autodrop
// @version      0.1.0
// @description  只丢掉背包里指定稀有度的资源（矿石、木材、鱼、金属锭、作物），装备、贵重品、药水、食物永不触碰；默认试运行。
// @match        https://deepveinidle.com/*
// @match        https://www.deepveinidle.com/*
// @match        https://cn.deepveinidle.com/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-auto-drop.meta.js
// @downloadURL  https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-auto-drop.user.js
// ==/UserScript==
(() => {
  'use strict';
  const KEY = '__DVI_AUTODROP__';
  if (window[KEY]) return;
  const PREF = 'dvi.autodrop.settings.v1';
  const NAMES_KEY = 'dvi.autodrop.names.v1';
  // 游戏内编码：稀有度步长 1000，品质+强化步长 10000，单条丢弃上限 1e6。
  const RARITY_STRIDE = 1000, PLUS_STRIDE = 1e4, MAX_DROP = 1e6, BATCH = 20;
  const RARITIES = ['普通', '罕见', '稀有', '史诗', '传说'];
  // 基础物品 id 区间照抄游戏自己的市场家族表；只留资源类，装备/贵重品/药水/食物一律不在此列。
  const FAMILIES = [
    { id: 'ore', name: '矿石', ranges: [[1, 8]], on: true },
    { id: 'wood', name: '木材', ranges: [[10, 19]], on: true },
    { id: 'fish', name: '鱼', ranges: [[20, 27]], on: true },
    { id: 'bars', name: '金属锭', ranges: [[40, 44]], on: true },
    { id: 'crops', name: '作物', ranges: [[160, 179], [190, 199]], on: true },
    { id: 'materials', name: '材料', ranges: [[180, 180], [208, 208], [240, 252], [300, 303], [359, 359], [688, 689], [697, 697], [707, 707], [714, 714], [731, 740], [764, 764], [776, 776], [778, 779]], on: false },
    { id: 'gems', name: '宝石', ranges: [[293, 297]], on: false }
  ];
  const familyOf = base => FAMILIES.find(row => row.ranges.some(([from, to]) => base >= from && base <= to)) || null;
  const defaults = { families: FAMILIES.filter(row => row.on).map(row => row.id), rarities: [0], dry: true, x: null, y: null };
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
    if (Array.isArray(saved.families)) settings.families = saved.families.filter(id => FAMILIES.some(row => row.id === id));
    if (Array.isArray(saved.rarities)) settings.rarities = saved.rarities.filter(value => Number.isSafeInteger(value) && value >= 0 && value < RARITIES.length);
    if (typeof saved.dry === 'boolean') settings.dry = saved.dry;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) { settings.x = saved.x; settings.y = saved.y; }
  } catch { /* 没有存档就按默认值走 */ }
  let running = false, dropped = 0, names = {}, namesAt = 0, status = '待开始：勾选要丢的资源与品质', timer = null;
  const history = [];
  const life = new AbortController();
  const q = (selector, scope = document) => scope?.querySelector(selector) || null;
  const session = () => window.deepvein?.session;
  const state = () => { const s = session(); return s?.connection?.live === false ? null : s?.state || null; };
  const log = text => {
    status = text;
    history.unshift(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${text}`);
    history.length = Math.min(history.length, 12);
    paint();
  };
  const itemName = (base, rarity) => {
    for (let id = base; id < base + RARITIES.length * RARITY_STRIDE; id += RARITY_STRIDE) {
      const row = names[id];
      if (row) return row.n || `#${base}`;
    }
    return `#${base}`;
  };
  // 只认背包：仓库、身上装备都不在判断范围里，从根上避免丢错东西。
  function candidates() {
    const current = state();
    const pack = Array.isArray(current?.pack) ? current.pack : null;
    if (!pack) return [];
    const families = new Set(settings.families), rarities = new Set(settings.rarities);
    const rows = [];
    for (const row of pack) {
      const itemId = row?.itemId, qty = row?.qty;
      if (!Number.isSafeInteger(itemId) || itemId <= 0) continue;
      if (!Number.isSafeInteger(qty) || qty <= 0) continue;
      const base = itemId % RARITY_STRIDE;
      const rarity = Math.floor((itemId % PLUS_STRIDE) / RARITY_STRIDE);
      if (!rarities.has(rarity)) continue;
      const family = familyOf(base);
      if (!family || !families.has(family.id)) continue;
      rows.push({ itemId, qty: Math.min(qty, MAX_DROP), base, rarity, family: family.id, name: itemName(base, rarity) });
    }
    return rows;
  }
  function drop(row) {
    const s = session();
    if (!s) return false;
    const message = { t: 'dropItem', itemId: row.itemId, qty: row.qty };
    const apply = state => {
      const entry = state?.pack?.find(cell => cell.itemId === row.itemId);
      if (!entry) return;
      entry.qty -= row.qty;
      if (entry.qty <= 0) state.pack = state.pack.filter(cell => cell !== entry);
    };
    // 两条路径都要在本地扣减：否则没有回显时会同一件东西反复丢。
    if (typeof s.intent === 'function') s.intent(message, apply);
    else { s.post(message); apply(s.state); }
    dropped += row.qty;
    log(`已丢弃 ${row.name} × ${row.qty}`);
    return true;
  }
  function tick() {
    const current = state();
    if (!current) { if (running) log('未读取到游戏角色，等待登录'); return; }
    const rows = candidates();
    paintPreview(rows);
    if (!running || settings.dry || !rows.length) return;
    for (const row of rows.slice(0, BATCH)) drop(row);
  }
  async function loadNames() {
    try {
      const cached = JSON.parse(localStorage.getItem(NAMES_KEY) || 'null');
      if (cached && Number.isFinite(cached.at) && Date.now() - cached.at < 864e5 && cached.items && typeof cached.items === 'object') {
        names = cached.items; namesAt = cached.at; return;
      }
    } catch { /* 缓存坏了就重新拉 */ }
    try {
      const response = await fetch('/api/market/prices.json', { credentials: 'omit', cache: 'no-cache' });
      if (!response.ok) return;
      const data = await response.json();
      const items = {};
      for (const [key, value] of Object.entries(data?.items || {})) {
        if (!/^\d+$/.test(key) || !value || typeof value !== 'object') continue;
        items[key] = { n: String(value.name || ''), r: String(value.rarity || '') };
      }
      if (!Object.keys(items).length) return;
      names = items; namesAt = Date.now();
      try { localStorage.setItem(NAMES_KEY, JSON.stringify({ at: namesAt, items })); } catch { /* 存不下只影响名字显示 */ }
      paint();
    } catch { /* 名字只是显示用，拉不到就显示编号 */ }
  }
  const host = document.createElement('div');
  host.id = 'dvi-autodrop';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;top:120px;z-index:2147483000;width:320px;max-width:calc(100% - 24px);color:#f3e8d4;font:13px/1.5 system-ui,sans-serif;color-scheme:dark}
    *{box-sizing:border-box}section{border:1px solid #94714a;border-radius:10px;background:#211b15;box-shadow:0 8px 30px #0008;overflow:hidden}
    header{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 12px;background:#34281c}[data-drag]{cursor:move;touch-action:none;user-select:none}
    strong{font-size:14px}button{font:inherit;min-height:30px;padding:4px 10px;border:1px solid #8b7050;border-radius:5px;color:inherit;background:#3c3023;cursor:pointer}
    button:disabled{opacity:.5;cursor:default}button.primary{background:#e5b768;border-color:#f4ce83;color:#21180c;font-weight:700}button.stop{background:#63372e;border-color:#b37662}
    main{padding:10px 12px;max-height:min(58dvh,520px);overflow:auto}p{margin:0 0 8px;font-size:12px;color:#c9bca8}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin:6px 0 8px}label{display:flex;align-items:center;gap:6px;font-size:12px;color:#ddd0bb}
    input[type=checkbox]{width:16px;height:16px;accent-color:#e8bd72}.row{display:flex;gap:6px;margin:8px 0}.row button{flex:1}
    .status{padding:8px 12px;border-top:1px solid #65513a;background:#2b241a;color:#f4d89e;font-size:12px;overflow-wrap:anywhere}
    .preview{margin:8px 0 0;padding:8px;border:1px dashed #6b563d;border-radius:6px;font-size:12px;color:#d8c8ac;max-height:120px;overflow:auto}
    .preview div{display:flex;justify-content:space-between;gap:8px}.preview b{color:#f4d89e;font-variant-numeric:tabular-nums}
    details{margin-top:8px;font-size:12px;color:#c9bca8}summary{cursor:pointer}ol{padding-left:18px;max-height:110px;overflow:auto}li{margin:3px 0;overflow-wrap:anywhere}
    [hidden]{display:none!important}
  </style><section aria-label="自动丢弃资源">
    <header data-drag><strong data-drag>自动丢弃资源</strong><button data-act="collapse" aria-expanded="true">收起</button></header>
    <main>
      <p>只处理<strong>背包</strong>里的资源，仓库和身上的东西不会碰。默认试运行：只列出会丢什么，不动手。</p>
      <div data-families class="grid"></div>
      <div data-rarities class="grid"></div>
      <label><input type="checkbox" data-act="dry"> 试运行（只预览，不真的丢）</label>
      <div class="row"><button class="primary" data-act="start">开始自动丢弃</button><button data-act="stop" disabled>停止</button></div>
      <div class="preview" data-preview><div><span>将丢弃</span><b>—</b></div></div>
      <details><summary>运行记录</summary><ol data-history></ol></details>
    </main>
    <div class="status" role="status" aria-live="polite" data-status></div>
  </section>`;
  // 家族 / 品质勾选框
  const familyBox = q('[data-families]', ui);
  for (const family of FAMILIES) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.dataset.family = family.id;
    input.checked = settings.families.includes(family.id);
    label.append(input, document.createTextNode(family.name));
    familyBox.append(label);
  }
  const rarityBox = q('[data-rarities]', ui);
  RARITIES.forEach((name, index) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.dataset.rarity = String(index);
    input.checked = settings.rarities.includes(index);
    label.append(input, document.createTextNode(`${name}（${index}）`));
    rarityBox.append(label);
  });
  q('[data-act="dry"]', ui).checked = settings.dry;
  function save() {
    try { localStorage.setItem(PREF, JSON.stringify(settings)); } catch { /* 存不下只影响下次启动 */ }
  }
  function paintPreview(rows) {
    const box = q('[data-preview]', ui);
    if (!box) return;
    if (!rows) { box.replaceChildren(Object.assign(document.createElement('div'), { textContent: '未连接游戏' })); return; }
    if (!rows.length) { box.replaceChildren(Object.assign(document.createElement('div'), { textContent: '当前背包没有符合条件的资源' })); return; }
    const groups = new Map();
    for (const row of rows) groups.set(row.name, (groups.get(row.name) || 0) + row.qty);
    const head = document.createElement('div');
    head.innerHTML = `<span>将丢弃 ${groups.size} 种</span><b>${[...groups.values()].reduce((a, b) => a + b, 0).toLocaleString('zh-CN')} 个</b>`;
    box.replaceChildren(head, ...[...groups].map(([name, qty]) => {
      const line = document.createElement('div');
      line.innerHTML = `<span></span><b></b>`;
      line.firstChild.textContent = name;
      line.lastChild.textContent = `× ${qty.toLocaleString('zh-CN')}`;
      return line;
    }));
  }
  function paint() {
    q('[data-status]', ui).textContent = status;
    q('[data-act="start"]', ui).disabled = running;
    q('[data-act="stop"]', ui).disabled = !running;
    q('[data-act="dry"]', ui).checked = settings.dry;
    for (const input of ui.querySelectorAll('[data-family],[data-rarity]')) input.disabled = running;
    q('[data-history]', ui).replaceChildren(...history.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  }
  function place() {
    if (!Number.isFinite(settings.x) || !Number.isFinite(settings.y)) return;
    const rect = host.getBoundingClientRect();
    settings.x = Math.min(Math.max(8, settings.x), Math.max(8, innerWidth - rect.width - 8));
    settings.y = Math.min(Math.max(8, settings.y), Math.max(8, innerHeight - rect.height - 8));
    host.style.left = `${settings.x}px`; host.style.top = `${settings.y}px`;
    host.style.right = 'auto';
  }
  const header = q('header', ui);
  let dragState = null;
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.target.hasAttribute('data-drag')) return;
    const rect = host.getBoundingClientRect();
    dragState = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    host.style.right = 'auto';
    event.preventDefault();
  }, { signal: life.signal });
  header.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.id) return;
    const rect = host.getBoundingClientRect();
    settings.x = Math.min(Math.max(8, event.clientX - dragState.dx), Math.max(8, innerWidth - rect.width - 8));
    settings.y = Math.min(Math.max(8, event.clientY - dragState.dy), Math.max(8, innerHeight - rect.height - 8));
    host.style.left = `${settings.x}px`; host.style.top = `${settings.y}px`;
  }, { signal: life.signal });
  const endDrag = event => {
    if (!dragState || event.pointerId !== dragState.id) return;
    dragState = null;
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    if (Number.isFinite(settings.x)) save();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(type, endDrag, { signal: life.signal });
  window.addEventListener('resize', place, { signal: life.signal });
  ui.addEventListener('click', event => {
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (action === 'collapse') {
      const main = q('main', ui); main.hidden = !main.hidden;
      const button = q('[data-act="collapse"]', ui);
      button.textContent = main.hidden ? '展开' : '收起';
      button.setAttribute('aria-expanded', String(!main.hidden));
      return;
    }
    if (action === 'start') {
      if (!settings.families.length || !settings.rarities.length) { log('请至少勾选一种资源和一种品质'); return; }
      running = true;
      log(settings.dry ? '已开始试运行：只预览，不会丢东西' : '已开始自动丢弃（只动背包里的资源）');
      paint(); tick(); return;
    }
    if (action === 'stop') { running = false; log('已停止'); paint(); }
  }, { signal: life.signal });
  ui.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.family) {
      settings.families = [...ui.querySelectorAll('[data-family]')].filter(box => box.checked).map(box => box.dataset.family);
      if (!running) save();
      paintPreview(candidates());
      return;
    }
    if (input.dataset.rarity) {
      settings.rarities = [...ui.querySelectorAll('[data-rarity]')].filter(box => box.checked).map(box => Number(box.dataset.rarity));
      if (!running) save();
      paintPreview(candidates());
      return;
    }
    if (input.dataset.act === 'dry') { settings.dry = input.checked; save(); paint(); }
  }, { signal: life.signal });
  window[KEY] = {
    version: '0.1.0',
    get state() { return { running, dropped, dry: settings.dry, families: settings.families, rarities: settings.rarities, status }; },
    tick, candidates, pause: () => { running = false; paint(); }
  };
  window.addEventListener('pagehide', () => { running = false; }, { signal: life.signal });
  const mount = () => (document.body || document.documentElement).append(host);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  place();
  paint();
  paintPreview(null);
  void loadNames();
  timer = setInterval(tick, 1000);
  window.addEventListener('unload', () => clearInterval(timer), { once: true });
})();
