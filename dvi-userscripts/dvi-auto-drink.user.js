// ==UserScript==
// @name         [DVI]自动喝药
// @namespace    local.dvi.autodrink
// @version      0.2.1
// @description  药水剩余时间低于阈值时自动补：背包有就地喝，只有仓库就走到仓库喝，仓库也没有就自动去市场买指定品质瓶数再喝。
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
  const PRICES_KEY = 'dvi.autodrink.prices.v1';
  // 游戏常量：稀有度步长 1000、每 tick 600ms、一瓶 6000 tick（1 小时）、单次最多 10000 瓶、仓库 20 格内可取用。
  const RARITY_STRIDE = 1000, TICK_MS = 600, BOTTLE_TICKS = 6000, MAX_DRINK = 1e4, BANK_REACH = 20;
  const RARITIES = ['普通', '罕见', '稀有', '史诗', '传说'];
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
  const defaults = { potions: [223], rarity: 0, bottles: 1, threshold: 24, autoBuy: true, dry: true, x: null, y: null };
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
    if (Array.isArray(saved.potions)) settings.potions = saved.potions.filter(base => POTIONS.some(row => row.base === base));
    if (Number.isSafeInteger(saved.rarity) && saved.rarity >= 0 && saved.rarity < RARITIES.length) settings.rarity = saved.rarity;
    if (Number.isSafeInteger(saved.bottles) && saved.bottles >= 1 && saved.bottles <= MAX_DRINK) settings.bottles = saved.bottles;
    if (Number.isFinite(saved.threshold) && saved.threshold >= 0) settings.threshold = saved.threshold;
    if (typeof saved.autoBuy === 'boolean') settings.autoBuy = saved.autoBuy;
    if (typeof saved.dry === 'boolean') settings.dry = saved.dry;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) { settings.x = saved.x; settings.y = saved.y; }
  } catch { /* 没有存档就按默认值走 */ }
  let running = false, drank = 0, status = '待开始：勾选要维持的药水';
  let prices = null, pricesAt = 0, lastNote = '', awayNoted = false;
  const sentAt = new Map(), boughtAt = new Map();
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
  const packQty = (current, itemId) => (Array.isArray(current?.pack) ? current.pack : [])
    .reduce((sum, row) => row?.itemId === itemId ? sum + (Number.isSafeInteger(row.qty) ? row.qty : 0) : sum, 0);
  const bankQty = (current, itemId) => current?.bank && typeof current.bank === 'object' ? Number(current.bank[itemId]) || 0 : 0;
  const banks = () => {
    const list = window.deepvein?.banks;
    if (Array.isArray(list) && list.length) return list.filter(row => Number.isFinite(row?.x) && Number.isFinite(row?.y));
    return [{ id: 1, x: 200, y: 82 }, { id: 2, x: 110, y: 177 }];
  };
  const nearestBank = (current) => {
    const x = Number(current?.x) || 0, y = Number(current?.y) || 0;
    let best = null, distance = Infinity;
    for (const bank of banks()) {
      const span = Math.max(Math.abs(x - bank.x), Math.abs(y - bank.y));
      if (span < distance) { distance = span; best = bank; }
    }
    return best ? { ...best, distance } : null;
  };
  async function loadPrices() {
    if (prices && Date.now() - pricesAt < 300000) return prices;
    try {
      const response = await fetch('/api/market/prices.json', { credentials: 'omit', cache: 'no-cache' });
      if (!response.ok) return prices;
      const data = await response.json();
      if (data?.items && typeof data.items === 'object') { prices = data.items; pricesAt = Date.now(); }
    } catch { /* 拿不到行情就不买 */ }
    return prices;
  }
  function drink(potion, itemId, qty) {
    const s = session();
    if (!s) return false;
    const message = { t: 'drink', itemId, qty };
    const apply = current => {
      let left = qty;
      const row = current?.pack?.find(cell => cell.itemId === itemId);
      if (row) {
        const take = Math.min(left, row.qty);
        row.qty -= take; left -= take;
        if (row.qty <= 0) current.pack = current.pack.filter(cell => cell !== row);
      }
      if (left > 0 && current?.bank) {
        const next = Math.max(0, (Number(current.bank[itemId]) || 0) - left);
        if (next === 0) delete current.bank[itemId]; else current.bank[itemId] = next;
      }
      const base = Math.max(Number(current?.brews?.[potion.kind]) || 0, Number(current?.lastTick) || 0);
      current.brews ??= {};
      current.brews[potion.kind] = base + qty * BOTTLE_TICKS;
    };
    if (typeof s.intent === 'function') s.intent(message, apply);
    else { s.post(message); apply(s.state); }
    drank += qty;
    sentAt.set(potion.kind, Date.now());
    log(`已喝 ${potion.name}（${RARITIES[settings.rarity]}）× ${qty}`);
    return true;
  }
  function buy(potion, itemId, qty) {
    const s = session();
    const quote = prices?.[itemId] || prices?.[String(itemId)];
    const price = Number(quote?.lowestSell);
    const stock = Number(quote?.sellQty);
    if (!Number.isFinite(price) || price <= 0) return '报价缺失';
    if (Number.isFinite(stock) && stock < qty) return `市场只有 ${stock} 瓶`;
    const message = { t: 'marketBuy', itemId, qty, price };
    if (typeof s.intent === 'function') s.intent(message, () => {});
    else s.post(message);
    boughtAt.set(itemId, Date.now());
    log(`下单购买 ${potion.name}（${RARITIES[settings.rarity]}）× ${qty}，限价 ${price}`);
    return null;
  }
  function cancelStaleBuys(itemId) {
    const s = session(), since = boughtAt.get(itemId);
    if (!s || !since || Date.now() - since < 6000) return;
    const orders = Array.isArray(s.orders) ? s.orders : [];
    for (const order of orders) {
      if (order?.side === 'buy' && order.itemId === itemId && order.qtyRemaining > 0) {
        if (typeof s.intent === 'function') s.intent({ t: 'marketCancel', orderId: order.id }, () => {});
        else s.post({ t: 'marketCancel', orderId: order.id });
        log('购买没成交，已撤单（价格可能刚变）');
      }
    }
    boughtAt.delete(itemId);
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
      line.firstChild.textContent = `${potion.name}（${RARITIES[settings.rarity]}）· 仓 ${bankQty(current, itemId)} / 身 ${packQty(current, itemId)}`;
      line.lastChild.textContent = hours >= 0.05 ? `${hours.toFixed(1)} 小时` : '未生效';
      line.lastChild.style.color = hours < settings.threshold ? '#f0a35e' : '#9ed36b';
      return line;
    }));
    if (!running) return;
    const notes = [];
    for (const potion of rows) {
      const hours = remainHours(current, potion.kind);
      if (hours >= settings.threshold) continue;
      const itemId = potion.base + settings.rarity * RARITY_STRIDE;
      const want = settings.bottles;
      const carried = packQty(current, itemId), stored = bankQty(current, itemId);
      if (!force && Date.now() - (sentAt.get(potion.kind) || 0) < 4000) continue;
      if (carried > 0) {
        const qty = Math.min(want, carried, MAX_DRINK);
        if (settings.dry) notes.push(`试运行：将喝 ${potion.name} × ${qty}（身上）`);
        else drink(potion, itemId, qty);
        continue;
      }
      if (stored > 0) {
        // 仓库里的药只能在仓库/家附近喝；不在就安静等着，绝不为了喝药去走路打断工作。
        const bank = nearestBank(current);
        if (!bank || bank.distance > BANK_REACH) {
          if (!awayNoted) { awayNoted = true; notes.push(`${potion.name}：仓库有 ${stored} 瓶，等角色回家/到仓库时自动喝`); }
          continue;
        }
        awayNoted = false;
        const qty = Math.min(want, stored, MAX_DRINK);
        if (settings.dry) notes.push(`试运行：将从仓库喝 ${potion.name} × ${qty}`);
        else drink(potion, itemId, qty);
        continue;
      }
      cancelStaleBuys(itemId);
      if (!settings.autoBuy) { notes.push(`${potion.name}：仓库和身上都没有，自动购买已关`); continue; }
      if (boughtAt.get(itemId) && Date.now() - boughtAt.get(itemId) < 20000) { notes.push(`${potion.name}：已下单，等到货`); continue; }
      const issue = buy(potion, itemId, Math.min(want, MAX_DRINK));
      if (issue) notes.push(`${potion.name}：${issue}`);
    }
    const note = notes.join('；');
    if (note && note !== lastNote) { lastNote = note; log(note); }
  }
  const host = document.createElement('div');
  host.id = 'dvi-autodrink';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{all:initial;position:fixed;left:12px;top:120px;z-index:2147483000;width:348px;max-width:calc(100% - 24px);color:#f3e8d4;font:13px/1.5 system-ui,sans-serif;color-scheme:dark}
    *{box-sizing:border-box}section{border:1px solid #94714a;border-radius:10px;background:#211b15;box-shadow:0 8px 30px #0008;overflow:hidden}
    header{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:9px 12px;background:#34281c}[data-drag]{cursor:move;touch-action:none;user-select:none}
    strong{font-size:14px}button{font:inherit;min-height:30px;padding:4px 10px;border:1px solid #8b7050;border-radius:5px;color:inherit;background:#3c3023;cursor:pointer}
    button:disabled{opacity:.5;cursor:default}button.primary{background:#e5b768;border-color:#f4ce83;color:#21180c;font-weight:700}button.stop{background:#63372e;border-color:#b37662}
    main{padding:10px 12px;max-height:min(62dvh,560px);overflow:auto}p{margin:0 0 8px;font-size:12px;color:#c9bca8}
    .list{display:grid;grid-template-columns:1fr;gap:3px;margin:6px 0 10px}label{display:flex;align-items:center;gap:6px;font-size:12px;color:#ddd0bb}
    input[type=checkbox]{width:16px;height:16px;accent-color:#e8bd72}label small{margin-left:auto;color:#9d8d76;font-size:11px}
    .fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}label.field{flex-direction:column;align-items:stretch;gap:3px}
    input[type=number],select{width:100%;min-height:30px;border:1px solid #796447;background:#17130f;border-radius:4px;padding:4px 6px;color:#fff;font:inherit}
    .row{display:flex;gap:6px;margin:8px 0}.row button{flex:1}
    .table{margin:8px 0 0;border-top:1px solid #4d3a26;padding-top:6px;font-size:12px;color:#d8c8ac;max-height:150px;overflow:auto}
    .table div{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.table b{font-variant-numeric:tabular-nums}
    .status{padding:8px 12px;border-top:1px solid #65513a;background:#2b241a;color:#f4d89e;font-size:12px;overflow-wrap:anywhere}
    details{margin-top:8px;font-size:12px;color:#c9bca8}summary{cursor:pointer}ol{padding-left:18px;max-height:110px;overflow:auto}li{margin:3px 0;overflow-wrap:anywhere}
    [hidden]{display:none!important}
  </style><section aria-label="自动喝药">
    <header data-drag><strong data-drag>自动喝药</strong><button data-act="collapse" aria-expanded="true">收起</button></header>
    <main>
      <p>读游戏自己的增益数据。低于阈值时：<b>身上有就地喝</b>；只有仓库就走到仓库喝；都没有就按市场最低价自动买够再喝。</p>
      <div class="list" data-potions></div>
      <div class="fields">
        <label class="field">低于多少小时<input type="number" min="0" step="1" data-act="threshold"></label>
        <label class="field">每次喝几瓶<input type="number" min="1" step="1" data-act="bottles"></label>
        <label class="field">喝哪个品质<select data-act="rarity"></select></label>
        <label class="field">&nbsp;<span style="font-size:11px;color:#9d8d76">每瓶约 1 小时，库存不足就有多少喝多少</span></label>
      </div>
      <label><input type="checkbox" data-act="autoBuy"> 仓库没有时自动去市场买</label>
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
  q('[data-act="autoBuy"]', ui).checked = settings.autoBuy;
  q('[data-act="dry"]', ui).checked = settings.dry;
  function save() {
    try { localStorage.setItem(PREF, JSON.stringify(settings)); } catch { /* 存不下只影响下次启动 */ }
  }
  function paint() {
    q('[data-status]', ui).textContent = status;
    q('[data-act="start"]', ui).disabled = running;
    q('[data-act="stop"]', ui).disabled = !running;
    q('[data-act="dry"]', ui).checked = settings.dry;
    q('[data-act="autoBuy"]', ui).checked = settings.autoBuy;
    for (const input of ui.querySelectorAll('[data-potion],[data-act="threshold"],[data-act="bottles"],[data-act="rarity"],[data-act="autoBuy"]')) input.disabled = running;
    q('[data-history]', ui).replaceChildren(...history.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  }
  function place() {
    if (!Number.isFinite(settings.x) || !Number.isFinite(settings.y)) return;
    const rect = host.getBoundingClientRect();
    settings.x = Math.min(Math.max(8, settings.x), Math.max(8, innerWidth - rect.width - 8));
    settings.y = Math.min(Math.max(8, settings.y), Math.max(8, innerHeight - rect.height - 8));
    host.style.left = `${settings.x}px`; host.style.top = `${settings.y}px`;
  }
  const header = q('header', ui);
  let dragState = null;
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.target.hasAttribute('data-drag')) return;
    const rect = host.getBoundingClientRect();
    dragState = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
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
      running = true; sentAt.clear(); boughtAt.clear(); lastNote = ''; awayNoted = false;
      log(settings.dry ? '已开始试运行：只提示，不会喝' : `已开始：低于 ${settings.threshold} 小时就补 ${RARITIES[settings.rarity]}`);
      paint(); check(true); void loadPrices().then(() => check(true)); return;
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
    if (el.dataset.act === 'autoBuy') { settings.autoBuy = el.checked; save(); paint(); return; }
    if (el.dataset.act === 'threshold' || el.dataset.act === 'bottles') {
      const value = Number(el.value);
      if (!Number.isFinite(value) || value < 0) { el.value = String(settings.threshold); return; }
      if (el.dataset.act === 'threshold') settings.threshold = value;
      else settings.bottles = Math.max(1, Math.min(MAX_DRINK, Math.floor(value)));
      if (!running) save();
    }
  }, { signal: life.signal });
  window[KEY] = {
    version: '0.2.0',
    get state() { return { running, drank, dry: settings.dry, autoBuy: settings.autoBuy, threshold: settings.threshold, rarity: settings.rarity, bottles: settings.bottles, potions: settings.potions, status }; },
    check, remainHours, nearestBank, pause: () => { running = false; paint(); }
  };
  window.addEventListener('pagehide', () => { running = false; }, { signal: life.signal });
  document.body.append(host);
  place();
  paint();
  check();
  setInterval(check, 2000);
})();
