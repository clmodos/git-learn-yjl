// ==UserScript==
// @name         [DVI]自动喝药
// @namespace    local.dvi.autodrink
// @version      0.1.0
// @description  药水剩余时间低于设定的阈值时，自动按指定品质与瓶数喝药；类型、阈值、品质、瓶数全部可自定义，读的是游戏自己的增益数据。
// @match        https://deepveinidle.com/*
// @match        https://www.deepveinidle.com/*
// @match        https://cn.deepveinidle.com/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-auto-drink.meta.js
// @downloadURL  https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-auto-drink.user.js
// ==/UserScript==
(() => {
  'use strict';
  const KEY = '__DVI_AUTODRINK__';
  if (window[KEY]) return;
  const PREF = 'dvi.autodrink.settings.v1';
  // 游戏常量：稀有度步长 1000，每 tick 600ms，一瓶 6000 tick（= 1 小时），单次最多 10000 瓶。
  const RARITY_STRIDE = 1000, TICK_MS = 600, BOTTLE_TICKS = 6000, MAX_DRINK = 1e4, COOLDOWN = 4000;
  const RARITIES = ['普通', '罕见', '稀有', '史诗', '传说'];
  // 药水基础 id 与它作用的增益键，和游戏自己的药水表一一对应。
  const POTIONS = [
    { base: 220, kind: 'gatherer', name: '采集者药剂', effect: '采集经验 +5%' },
    { base: 221, kind: 'hunter', name: '猎人酿剂', effect: '稀有发现 +25%' },
    { base: 222, kind: 'warrior', name: '战士补剂', effect: '命中 +10、最大伤害 +10%' },
    { base: 223, kind: 'elixir', name: '矿脉灵药', effect: '全经验 +10%' },
    { base: 224, kind: 'abyssal', name: '深渊补剂', effect: '怪物金币 +25%' },
    { base: 225, kind: 'swift', name: '疾行药剂', effect: '移动速度 +20%' },
    { base: 226, kind: 'nourish', name: '滋养药剂', effect: '食物治疗 +25%' },
    { base: 227, kind: 'haste', name: '急速药剂', effect: '攻击速度 +20%' }
  ];
  const defaults = { potions: [223], rarity: 0, bottles: 1, threshold: 24, dry: true, x: null, y: null };
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
    if (Array.isArray(saved.potions)) settings.potions = saved.potions.filter(base => POTIONS.some(row => row.base === base));
    if (Number.isSafeInteger(saved.rarity) && saved.rarity >= 0 && saved.rarity < RARITIES.length) settings.rarity = saved.rarity;
    if (Number.isSafeInteger(saved.bottles) && saved.bottles >= 1 && saved.bottles <= MAX_DRINK) settings.bottles = saved.bottles;
    if (Number.isFinite(saved.threshold) && saved.threshold >= 0) settings.threshold = saved.threshold;
    if (typeof saved.dry === 'boolean') settings.dry = saved.dry;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) { settings.x = saved.x; settings.y = saved.y; }
  } catch { /* 没有存档就按默认值走 */ }
  let running = false, drank = 0, status = '待开始：勾选要维持的药水', lastNote = '';
  const sentAt = new Map();
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
  const remainHours = (current, kind) => {
    const expires = Number(current?.brews?.[kind]) || 0;
    const tick = Number(current?.lastTick) || 0;
    return Math.max(0, (expires - tick) * TICK_MS) / 3600000;
  };
  const carried = (current, itemId) => {
    const pack = Array.isArray(current?.pack) ? current.pack : [];
    return pack.reduce((sum, row) => row?.itemId === itemId ? sum + (Number.isSafeInteger(row.qty) ? row.qty : 0) : sum, 0);
  };
  const inBank = (current, itemId) => {
    const bank = current?.bank;
    return bank && typeof bank === 'object' ? Number(bank[itemId]) || 0 : 0;
  };
  function drink(potion, itemId, qty) {
    const s = session();
    if (!s) return false;
    const message = { t: 'drink', itemId, qty };
    const apply = current => {
      const row = current?.pack?.find(cell => cell.itemId === itemId);
      if (row) {
        row.qty -= qty;
        if (row.qty <= 0) current.pack = current.pack.filter(cell => cell !== row);
      }
      const base = Math.max(Number(current?.brews?.[potion.kind]) || 0, Number(current?.lastTick) || 0);
      current.brews ??= {};
      current.brews[potion.kind] = base + qty * BOTTLE_TICKS;
    };
    if (typeof s.intent === 'function') s.intent(message, apply);
    else { s.post(message); apply(s.state); }
    drank += qty;
    sentAt.set(potion.kind, Date.now());
    log(`已喝 ${potion.name}（${RARITIES[settings.rarity]}）× ${qty}，剩余约 ${remainHours(state(), potion.kind).toFixed(1)} 小时`);
    return true;
  }
  function check(force = false) {
    const current = state();
    const table = q('[data-table]', ui);
    if (!current) {
      if (table) table.replaceChildren(Object.assign(document.createElement('div'), { textContent: '未连接游戏' }));
      return;
    }
    const rows = POTIONS.filter(potion => settings.potions.includes(potion.base));
    if (table) table.replaceChildren(...rows.map(potion => {
      const hours = remainHours(current, potion.kind);
      const itemId = potion.base + settings.rarity * RARITY_STRIDE;
      const line = document.createElement('div');
      line.innerHTML = '<span></span><b></b>';
      line.firstChild.textContent = `${potion.name}（${RARITIES[settings.rarity]}）`;
      line.lastChild.textContent = hours >= 0.05 ? `${hours.toFixed(1)} 小时` : '未生效';
      line.lastChild.style.color = hours < settings.threshold ? '#f0a35e' : '#9ed36b';
      line.dataset.item = String(itemId);
      return line;
    }));
    if (!running) return;
    const notes = [];
    for (const potion of rows) {
      const hours = remainHours(current, potion.kind);
      if (hours >= settings.threshold) continue;
      const itemId = potion.base + settings.rarity * RARITY_STRIDE;
      const have = carried(current, itemId);
      if (!have) {
        const bank = inBank(current, itemId);
        notes.push(bank
          ? `${potion.name}：背包没有，仓库有 ${bank} 瓶（需到仓库附近才能喝）`
          : `${potion.name}：背包和仓库都没有${RARITIES[settings.rarity]}品`);
        continue;
      }
      const qty = Math.min(settings.bottles, have, MAX_DRINK);
      if (settings.dry) {
        notes.push(`试运行：将喝 ${potion.name} × ${qty}（剩余 ${hours.toFixed(1)} 小时 < ${settings.threshold}）`);
        continue;
      }
      if (!force && Date.now() - (sentAt.get(potion.kind) || 0) < COOLDOWN) continue;
      drink(potion, itemId, qty);
    }
    const note = notes.join('；');
    if (note && note !== lastNote) { lastNote = note; log(note); }
  }
  const host = document.createElement('div');
  host.id = 'dvi-autodrink';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{all:initial;position:fixed;left:12px;top:120px;z-index:2147483000;width:330px;max-width:calc(100% - 24px);color:#f3e8d4;font:13px/1.5 system-ui,sans-serif;color-scheme:dark}
    *{box-sizing:border-box}section{border:1px solid #94714a;border-radius:10px;background:#211b15;box-shadow:0 8px 30px #0008;overflow:hidden}
    header{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 12px;background:#34281c}[data-drag]{cursor:move;touch-action:none;user-select:none}
    strong{font-size:14px}button{font:inherit;min-height:30px;padding:4px 10px;border:1px solid #8b7050;border-radius:5px;color:inherit;background:#3c3023;cursor:pointer}
    button:disabled{opacity:.5;cursor:default}button.primary{background:#e5b768;border-color:#f4ce83;color:#21180c;font-weight:700}button.stop{background:#63372e;border-color:#b37662}
    main{padding:10px 12px;max-height:min(60dvh,540px);overflow:auto}p{margin:0 0 8px;font-size:12px;color:#c9bca8}
    .list{display:grid;grid-template-columns:1fr;gap:3px;margin:6px 0 10px}label{display:flex;align-items:center;gap:6px;font-size:12px;color:#ddd0bb}
    input[type=checkbox]{width:16px;height:16px;accent-color:#e8bd72}label small{margin-left:auto;color:#9d8d76;font-size:11px}
    .fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}label.field{flex-direction:column;align-items:stretch;gap:3px}
    input[type=number],select{width:100%;min-height:30px;border:1px solid #796447;background:#17130f;border-radius:4px;padding:4px 6px;color:#fff;font:inherit}
    .row{display:flex;gap:6px;margin:8px 0}.row button{flex:1}
    .table{margin:8px 0 0;border-top:1px solid #4d3a26;padding-top:6px;font-size:12px;color:#d8c8ac;max-height:140px;overflow:auto}
    .table div{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.table b{font-variant-numeric:tabular-nums}
    .status{padding:8px 12px;border-top:1px solid #65513a;background:#2b241a;color:#f4d89e;font-size:12px;overflow-wrap:anywhere}
    details{margin-top:8px;font-size:12px;color:#c9bca8}summary{cursor:pointer}ol{padding-left:18px;max-height:110px;overflow:auto}li{margin:3px 0;overflow-wrap:anywhere}
    [hidden]{display:none!important}
  </style><section aria-label="自动喝药">
    <header data-drag><strong data-drag>自动喝药</strong><button data-act="collapse" aria-expanded="true">收起</button></header>
    <main>
      <p>读的是游戏自己的增益数据：低于阈值就从<strong>背包</strong>喝下指定品质的瓶数。背包没有会在下面提示仓库存量。</p>
      <div class="list" data-potions></div>
      <div class="fields">
        <label class="field">低于多少小时<input type="number" min="0" step="1" data-act="threshold"></label>
        <label class="field">每次喝几瓶<input type="number" min="1" step="1" data-act="bottles"></label>
        <label class="field">喝哪个品质<select data-act="rarity"></select></label>
        <label class="field">&nbsp;<span style="font-size:11px;color:#9d8d76">每瓶约 1 小时</span></label>
      </div>
      <label><input type="checkbox" data-act="dry"> 试运行（只提示，不真的喝）</label>
      <div class="row"><button class="primary" data-act="start">开始自动喝药</button><button data-act="stop" disabled>停止</button></div>
      <div class="table" data-table></div>
      <details><summary>运行记录</summary><ol data-history></ol></details>
    </main>
    <div class="status" role="status" aria-live="polite" data-status></div>
  </section>`;
  const potionBox = q('[data-potions]', ui);
  for (const potion of POTIONS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.dataset.potion = String(potion.base);
    input.checked = settings.potions.includes(potion.base);
    const text = document.createElement('span');
    text.textContent = potion.name;
    const hint = document.createElement('small');
    hint.textContent = potion.effect;
    label.append(input, text, hint);
    potionBox.append(label);
  }
  const raritySelect = q('[data-act="rarity"]', ui);
  RARITIES.forEach((name, index) => {
    const option = document.createElement('option');
    option.value = String(index); option.textContent = `${name}（×${[1, 1.3, 1.6, 2.2, 3][index]} 效果）`;
    raritySelect.append(option);
  });
  raritySelect.value = String(settings.rarity);
  q('[data-act="threshold"]', ui).value = settings.threshold;
  q('[data-act="bottles"]', ui).value = settings.bottles;
  q('[data-act="dry"]', ui).checked = settings.dry;
  function save() {
    try { localStorage.setItem(PREF, JSON.stringify(settings)); } catch { /* 存不下只影响下次启动 */ }
  }
  function paint() {
    q('[data-status]', ui).textContent = status;
    q('[data-act="start"]', ui).disabled = running;
    q('[data-act="stop"]', ui).disabled = !running;
    q('[data-act="dry"]', ui).checked = settings.dry;
    for (const input of ui.querySelectorAll('[data-potion],[data-act="threshold"],[data-act="bottles"],[data-act="rarity"]')) input.disabled = running;
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
      if (!settings.potions.length) { log('请至少勾选一种药水'); return; }
      running = true; sentAt.clear(); lastNote = '';
      log(settings.dry ? '已开始试运行：只提示，不会喝' : `已开始：低于 ${settings.threshold} 小时就喝 ${RARITIES[settings.rarity]}`);
      paint(); check(); return;
    }
    if (action === 'stop') { running = false; log('已停止'); paint(); }
  }, { signal: life.signal });
  ui.addEventListener('change', event => {
    const el = event.target;
    if (el.dataset.potion) {
      settings.potions = [...ui.querySelectorAll('[data-potion]')].filter(box => box.checked).map(box => Number(box.dataset.potion));
      if (!running) save();
      check(); return;
    }
    if (el.dataset.act === 'rarity') { settings.rarity = Number(el.value); if (!running) save(); check(); return; }
    if (el.dataset.act === 'dry') { settings.dry = el.checked; save(); paint(); return; }
    if (el.dataset.act === 'threshold' || el.dataset.act === 'bottles') {
      const value = Number(el.value);
      if (!Number.isFinite(value) || value < 0) { el.value = String(settings.threshold); return; }
      if (el.dataset.act === 'threshold') settings.threshold = value;
      else settings.bottles = Math.max(1, Math.min(MAX_DRINK, Math.floor(value)));
      if (!running) save();
    }
  }, { signal: life.signal });
  window[KEY] = {
    version: '0.1.0',
    get state() { return { running, drank, dry: settings.dry, threshold: settings.threshold, rarity: settings.rarity, bottles: settings.bottles, potions: settings.potions, status }; },
    check, remainHours, pause: () => { running = false; paint(); }
  };
  window.addEventListener('pagehide', () => { running = false; }, { signal: life.signal });
  const mount = () => (document.body || document.documentElement).append(host);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  place();
  paint();
  check();
  setInterval(check, 2000);
})();
