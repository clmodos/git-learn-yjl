// ==UserScript==
// @name         [DVI]精通自动制造（精通助手伴随脚本）
// @namespace    local.dvi.mastery.automation
// @version      0.2.1
// @description  配合精通助手 1.2.10 及以上（含 1.2.12），自动补料制造，统计金币和精通收益。
// @match        https://deepveinidle.com/*
// @match        https://www.deepveinidle.com/*
// @match        https://cn.deepveinidle.com/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-mastery-auto.meta.js
// @downloadURL  https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-mastery-auto.user.js
// ==/UserScript==
(() => {
  'use strict';
  const KEY = '__DVI_MASTERY_AUTO__';
  const PREF = 'dvi.mastery.auto.settings.v1';
  const STATS = 'dvi.mastery.auto.stats.v1';
  if (window[KEY]) return;
  const priorities = [['follow', '跟随原助手'], ['default', '默认推荐'], ['inventory', '库存优先'], ['cost', '成本优先'], ['quality', '品质优先'], ['time', '耗时优先'], ['points', '低点优先'], ['high-points', '高点优先']];
  const defaults = { limitCost: false, costLimit: 1000, priority: 'follow', x: null, y: null };
  // 兼容层：只认版本下限，不锁死单一小版本，免得助手一更新就被卡住。
  const HELPER_MIN = [1, 2, 10];
  const helperPrefsKey = 'dvi.mastery.preferences.v1';
  const versionParts = value => {
    const parts = String(value ?? '').split('.').map(Number);
    return parts.length <= 4 && parts.every(Number.isSafeInteger) ? parts : null;
  };
  const helperReady = candidate => {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.handoff !== 'function' || candidate.catalogVerified !== true) return false;
    const parts = versionParts(candidate.version);
    if (!parts) return false;
    for (let index = 0; index < HELPER_MIN.length; index++) {
      const actual = parts[index] ?? 0, required = HELPER_MIN[index];
      if (actual !== required) return actual > required;
    }
    return true;
  };
  const helperCompat = candidate => `助手 ${candidate?.version || '未检测到'}，需要 ≥ ${HELPER_MIN.join('.')}`;
  // 后备活动（游戏里“计划结束后”那一项）：服务端只认这几个字段，多一个键都会被拒。
  const fallbackTask = task => {
    if (!task || typeof task !== 'object') return null;
    const valid = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
    if (task.kind === 'job') {
      if (!valid(task.siteId, 1) || !valid(task.jobId, 1) || (task.onFull !== 'bank' && task.onFull !== 'drop') || !valid(task.rarity)) return null;
      return { kind: 'job', siteId: task.siteId, jobId: task.jobId, onFull: task.onFull, rarity: task.rarity, ...(task.best === true ? { best: true } : {}) };
    }
    if (task.kind === 'zone' && valid(task.zoneId, 1)) return { kind: 'zone', zoneId: task.zoneId };
    return null;
  };
  let settings = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
    if (priorities.some(([id]) => id === saved.priority)) settings.priority = saved.priority;
    if (typeof saved.limitCost === 'boolean') settings.limitCost = saved.limitCost;
    if (Number.isFinite(saved.costLimit) && saved.costLimit >= 0) settings.costLimit = saved.costLimit;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) { settings.x = saved.x; settings.y = saved.y; }
  } catch { /* Storage may be unavailable; do not start automatically. */ }
  let running = false, starting = false, activeRun = false, epoch = 0, flight = false;
  let session, helper, catalog, person, goal, completed = 0;
  let savedFallback = null, fallbackResentAt = 0;
  let stats = { person: null, spent: 0, points: 0 }, meter = null, itemIndex;
  let visibilityLease = null, clockWorker = null;
  const sleepers = new Set();
  let status = '待开始：先在原助手筛选制造任务';
  const history = [];
  const finishedGoals = new Set();
  const deferredGoals = new Set();
  const life = new AbortController();
  const q = (selector, scope = document) => scope?.querySelector(selector) || null;
  const assistant = () => q('#dvi-mastery-helper')?.shadowRoot;
  const visible = el => !!el?.isConnected && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden' && !!el.getClientRects().length;
  const activeRoute = () => q('.routes[data-open="true"]');
  const identity = state => state?.id && state?.name ? `${state.id}:${state.name}` : null;
  const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  const pauseError = text => { throw new Error(text); };
  const sleep = ms => new Promise(resolve => {
    const entry = { due: Date.now() + ms, finish: () => { clearTimeout(entry.timer); sleepers.delete(entry); resolve(); } };
    entry.timer = setTimeout(entry.finish, ms);
    sleepers.add(entry);
  });
  function beginBackground() {
    if (visibilityLease) return;
    const saved = new Map(['hidden', 'visibilityState', 'hasFocus'].map(key => [key, Object.getOwnPropertyDescriptor(document, key)]));
    visibilityLease = saved;
    try {
      Object.defineProperties(document, {
        hidden: { configurable: true, get: () => false },
        visibilityState: { configurable: true, get: () => 'visible' },
        hasFocus: { configurable: true, value: () => true }
      });
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250)'], { type: 'text/javascript' }));
      try { clockWorker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      clockWorker.onmessage = () => {
        for (const entry of [...sleepers]) if (Date.now() >= entry.due) entry.finish();
        try { if (running && window.__DVI_MASTERY_HELPER__ === helper) helper.handoff(); }
        catch (error) { pause(`原助手同步失败：${error.message || error}`); }
        render();
      };
      clockWorker.onerror = event => { event.preventDefault(); pause('后台计时器不可用，请检查浏览器是否允许此脚本的 Worker'); };
      document.dispatchEvent(new Event('visibilitychange'));
    } catch (error) {
      endBackground();
      pauseError(`无法启用后台保持运行：${error.message || error}`);
    }
  }
  function endBackground() {
    clockWorker?.terminate(); clockWorker = null;
    if (!visibilityLease) return;
    for (const [key, descriptor] of visibilityLease) {
      if (descriptor) Object.defineProperty(document, key, descriptor);
      else delete document[key];
    }
    visibilityLease = null;
    document.dispatchEvent(new Event('visibilitychange'));
  }
  const log = text => {
    status = text;
    history.unshift(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${text}`);
    history.length = Math.min(history.length, 12);
    render();
  };
  function pause(text = '已暂停；已开始的有限次数制作会继续') {
    sampleStats();
    if (running || starting) { running = false; starting = false; epoch++; }
    if (meter && !flight && !ownsRoute()) meter.active = false;
    endBackground();
    restoreFallback();
    log(text);
  }
  function check(token) {
    if (!running || token !== epoch) pauseError('执行已取消');
    if (window.deepvein?.session !== session || identity(session.state) !== person) pauseError('角色或会话已变化');
    if (window.__DVI_MASTERY_HELPER__ !== helper || !helperReady(helper)) pauseError(`原助手已更新或任务数据尚未校验（${helperCompat(helper)}）`);
    if (!session.connection?.live || Date.now() - session.connection.lastHeard > 15000) pauseError('游戏连接中断或长时间未收到服务器消息');
    if (!assistant() || q('#dvi-mastery-helper')?.classList.contains('collapsed')) pauseError('请保持原助手展开');
    if (session.state.enhance || session.state.held) pauseError('游戏中有强化或搁置的任务，请先手动处理');
    if (!Array.isArray(session.state.queue) || session.state.queue.length) pauseError('游戏队列有其他任务，请先清空队列');
    if (Object.keys(session.state.overflow || {}).length) pauseError('溢出栏有物品，请先手动处理');
    // 有人在中途重新设定了后备活动时，按运行前的策略再清一次。
    if (session.state.fallback && Date.now() - fallbackResentAt > 3000) {
      fallbackResentAt = Date.now();
      setFallback(null);
    }
  }
  // 走 intent 才会立刻把本地 state 一起改掉，post 要等服务器回显。
  function setFallback(value) {
    const message = { t: 'setFallback', fallback: value };
    if (typeof session.intent === 'function') session.intent(message, state => { state.fallback = value; });
    else { session.post(message); session.state.fallback = value; }
  }
  async function clearFallback(token) {
    setFallback(null);
    await until(token, () => !session.state.fallback, '后备活动未能关闭，请手动在“计划结束后”里点清除');
    log('已临时关闭后备活动，暂停自动制造时还原');
  }
  function restoreFallback() {
    const saved = savedFallback;
    savedFallback = null;
    if (!saved || !session?.connection?.live) return;
    const task = fallbackTask(saved.task);
    if (!task) return;
    try { setFallback({ task, onStorageFull: saved.onStorageFull === true }); }
    catch { /* 页面正在关闭，下次再设 */ }
  }
  // 后备活动会在计划结束的瞬间抢走任务槽；发现不是本助手发起的任务就打断它，接着自动制造。
  async function interruptForeign(token) {
    if (!session.state.route) return false;
    if (goal?.jobId && session.state.route.jobId === goal.jobId) return false;
    log('打断游戏里的后备活动，继续自动制造');
    session.intent?.({ t: 'skip' }, () => {});
    if (typeof session.intent !== 'function') session.post({ t: 'skip' });
    await until(token, () => !session.state.route, '后备活动未能打断，请手动停止');
    return true;
  }
  // 1.2.12 的 craft()/market() 会先做一次角色同步与重算，12 秒不够用。
  async function until(token, fn, text, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      check(token);
      const result = fn();
      if (result) return result;
      const error = q('.toast.error:not([hidden])', assistant());
      if (error) pauseError(error.textContent.trim());
      await sleep(160);
    }
    pauseError(text);
  }
  function click(token, el) {
    check(token);
    if (!visible(el) || el.disabled) pauseError('目标按钮不可用，已停止操作');
    el.click();
  }
  function setValue(token, el, value) {
    check(token);
    if (!visible(el) || el.disabled) pauseError('目标输入框不可用');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function exactNumber(text) {
    const match = /^\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([KMB])?\s*$/i.exec(text || '');
    if (!match) return null;
    const number = Number(match[1].replaceAll(',', '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] || 1);
    return integer(number) ? number : null;
  }
  function stock(state, itemId) {
    const bank = state.bank?.[itemId] || 0;
    if (!integer(bank) || !Array.isArray(state.pack)) pauseError('库存数据不可用');
    return state.pack.reduce((total, row) => {
      if (row.itemId !== itemId) return total;
      if (!integer(row.qty)) pauseError('背包数量不可用');
      return total + row.qty;
    }, bank);
  }
  function progress() {
    const value = session.state.collections?.[goal.itemId] || 0;
    if (!integer(value)) pauseError('自产进度不可用');
    return value;
  }
  function ensureGoal() {
    const name = q('.task-head .task-name', assistant())?.textContent.trim();
    if (!name || name !== goal.name) pauseError('助手当前任务已变化，请重新开始');
  }
  function costPerPoint(row) {
    const raw = row.getAttribute('data-route-cost-per-point')?.trim();
    if (!raw) return null; // Unknown is not a free task.
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  function withinCost(row) {
    const value = costPerPoint(row);
    return !settings.limitCost || value !== null && value <= settings.costLimit;
  }
  function jobForGoal(id) {
    const match = /^collection:(\d+):(\d+):(.+)$/.exec(id || '');
    if (!match) return null;
    const source = catalog.collectionSources?.find(row => row.id === match[3]);
    if (source && (source.kind !== 'job' || source.sourceType !== 'output')) return null;
    const jobId = source?.jobId ?? (/^\d+$/.test(match[3]) ? Number(match[3]) : null);
    const job = catalog.jobs.find(row => row.id === jobId);
    const itemId = Number(match[1]);
    return job && catalog.skillGroups.craft.includes(job.skill) && job.skill !== 'enhancing' &&
      !job.grow && !job.retired && job.inputs?.length && integer(job.output.qty, 1) &&
      itemId < catalog.rules.encoding.plusStride &&
      job.output.itemId === itemId % catalog.rules.encoding.rarityStride ? job : null;
  }
  function collectionPoints(state) {
    const rule = catalog?.rules.collection;
    if (!rule || !itemIndex || !state.collections) return null;
    let points = 0;
    for (const [key, qty] of Object.entries(state.collections)) {
      const id = Number(key), base = id % catalog.rules.encoding.rarityStride;
      const rarity = Math.floor(id % catalog.rules.encoding.plusStride / catalog.rules.encoding.rarityStride);
      const item = itemIndex.get(base);
      if (!integer(id, 1) || !integer(qty)) return null;
      if (!qty || !item || id >= catalog.rules.encoding.plusStride || rule.excludedItemIds.includes(base) || rarity >= rule.rarityMultipliers.length || rarity && !item.rarityable) continue;
      if (item.pet) points += rule.petFirst;
      else for (let i = 0; i < rule.thresholds.length; i++) if (qty >= rule.thresholds[i]) points += rule.incrementPoints[i] * rule.rarityMultipliers[rarity];
    }
    return Number.isFinite(points) && points >= 0 ? points : null;
  }
  function loadStats(owner) {
    stats = { person: owner, spent: 0, points: 0 };
    try {
      const saved = JSON.parse(localStorage.getItem(`${STATS}:${encodeURIComponent(owner)}`) || '{}');
      if (saved.person === owner && integer(saved.spent) && Number.isFinite(saved.points) && saved.points >= 0) stats = saved;
    } catch { /* Start a new record when none is available. */ }
  }
  function ownsRoute() {
    return !!goal?.jobId && session?.state.route?.jobId === goal.jobId;
  }
  function sampleStats() {
    if (!meter || window.deepvein?.session !== session || identity(session.state) !== meter.person) return;
    const coins = session.state.coins, points = collectionPoints(session.state);
    if (!integer(coins) || points === null) return;
    const active = running || flight || ownsRoute();
    let changed = false;
    if (meter.active || active) {
      const spent = Math.max(0, meter.coins - coins), earned = Math.max(0, points - meter.points);
      stats.spent += spent; stats.points += earned;
      changed = spent > 0 || earned > 0;
    }
    meter = { person, coins, points, active };
    if (changed) {
      try { localStorage.setItem(`${STATS}:${encodeURIComponent(person)}`, JSON.stringify(stats)); } catch { /* Keep this page's totals if storage is full. */ }
    }
  }
  async function selectGoal(token, restoring = false) {
    const previousGoal = restoring ? goal : null;
    if (!restoring) goal = null;
    const back = q('[data-action="back-list"]', assistant());
    if (visible(back)) click(token, back);
    else {
      const routeTab = q('[data-action="tab"][data-tab="route"]', assistant());
      if (!routeTab) pauseError('请在原助手打开任务列表');
      click(token, routeTab);
    }
    const priority = q('select[data-action="route-priority"]', assistant());
    if (settings.priority !== 'follow') {
      if (!priority || ![...priority.options].some(option => option.value === settings.priority)) pauseError('原助手的排序控件不可用，请检查兼容性');
      if (priority.value !== settings.priority) {
        check(token);
        priority.value = settings.priority;
        priority.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const skillNames = new Set(catalog.skillGroups.craft.filter(skill => skill !== 'enhancing').map(skill => catalog.skillNamesZh[skill]));
    // Start at the first page of the existing filters, including after a previous
    // iteration ended on a later page. Do not change the user's skill/rarity filters.
    for (let index = 0; index < 200; index++) {
      const previous = [...assistant().querySelectorAll('[data-action="page"]')][0];
      if (!previous || previous.disabled) break;
      const old = q('[data-page-status]', assistant())?.textContent;
      click(token, previous);
      await until(token, () => q('[data-page-status]', assistant())?.textContent !== old, '返回任务首页未确认');
    }
    for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
      await until(token, () => q('.route-pagination', assistant()) && !/正在计算任务路线/.test(q('.route-scroll .empty', assistant())?.textContent || ''), '任务列表尚未算好');
      const rows = [...assistant().querySelectorAll('.route-row[data-id]')];
      const row = rows.find(el => {
        if (restoring) return el.dataset.id === previousGoal.id;
        const type = q('.task-type', el)?.textContent.trim();
        return skillNames.has(type) && jobForGoal(el.dataset.id) &&
          !finishedGoals.has(el.dataset.id) && !deferredGoals.has(el.dataset.id) && !el.hasAttribute('data-queue-status') && !/级解锁/.test(el.textContent) && withinCost(el);
      });
      if (row) {
        if (!withinCost(row)) pauseError('当前任务重新估价后超过成本上限或费用待确认，已暂停');
        const match = /^collection:(\d+):(\d+):(.+)$/.exec(row.dataset.id);
        const itemId = Number(match[1]), target = Number(match[2]);
        if (!integer(itemId, 1) || !integer(target, 1)) pauseError('任务目标格式不兼容');
        const name = q('.task-name', row)?.textContent.trim();
        if (!restoring) goal = { id: row.dataset.id, itemId, target, name, plannedJobId: jobForGoal(row.dataset.id).id, jobId: null };
        click(token, row);
        await until(token, () => q('.task-head .task-name', assistant())?.textContent.trim() === name, '任务详情未打开');
        if (!restoring) log(`当前目标：${name}，自产达到 ${target}${costPerPoint(row) === null ? '' : ` · ${costPerPoint(row).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 金/点`}`);
        return true;
      }
      const next = q('[data-action="page"][data-page]:last-child', assistant()) || [...assistant().querySelectorAll('[data-action="page"]')].at(-1);
      if (!next || next.disabled) return false;
      const previous = q('[data-page-status]', assistant()).textContent;
      click(token, next);
      await until(token, () => q('[data-page-status]', assistant())?.textContent !== previous, '任务翻页未确认');
    }
    pauseError('任务页数超过本次扫描上限，请缩小筛选范围');
  }
  async function refresh(token) {
    check(token);
    if (progress() >= goal.target) return;
    // Helper 1.2.10 returns to its list when it observes a running finite job.
    // Reopen the exact collection milestone only while the game is idle.
    if (q('.task-head .task-name', assistant())?.textContent.trim() !== goal.name) {
      if (session.state.route && !await interruptForeign(token)) pauseError('游戏仍在执行任务，暂不能重新选择目标');
      if (!await selectGoal(token, true)) pauseError('原任务暂不在助手列表中，请等待助手同步后重试');
    }
    ensureGoal();
    const button = q('[data-action="sync"]', assistant());
    if (button && !button.disabled) click(token, button);
    await sleep(1000);
    check(token);
    if (progress() < goal.target) ensureGoal();
  }
  function quote(trade, itemId) {
    if (!visible(trade) || !q('.trade-card.buy', trade) || q('[data-trade-price-in]', trade) || q('.trade-rest', trade)) pauseError('只允许有现货的快速购买，请检查市场页面');
    if (Number(q('[data-sheet-icon]')?.dataset.item) !== itemId) pauseError('市场物品或品质已变化');
    const qty = exactNumber(q('[data-trade-qty-in]', trade)?.value);
    const steps = q('.trade-steps', trade)?.textContent.trim().split(/\s*·\s*/);
    if (!integer(qty, 1) || !steps?.length) pauseError('无法确认购买数量和逐档报价');
    let count = 0, total = 0, maxPrice = 0;
    for (const step of steps) {
      const match = /^(\S+)\s+(?:个\s*@|at)\s*(\S+)$/.exec(step.trim());
      if (!match) pauseError('市场报价格式已变化');
      const amount = exactNumber(match[1]), price = exactNumber(match[2]);
      if (!integer(amount, 1) || !integer(price, 1)) pauseError('市场报价不是有效整数');
      count += amount; total += amount * price; maxPrice = Math.max(maxPrice, price);
    }
    const pay = q('.trade-pay b', trade);
    const shownTotal = exactNumber(q('[title]', pay)?.getAttribute('title') || pay?.textContent.trim());
    if (count !== qty || shownTotal !== total || !integer(total, 1) || !integer(qty * maxPrice, 1)) pauseError('购买金额和逐档报价不一致');
    return { qty, price: maxPrice, upper: qty * maxPrice };
  }
  async function openPurchase(token, itemId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      check(token); ensureGoal();
      const button = q(`[data-action="market"][data-item="${itemId}"]`, assistant());
      if (!button) return null; // Inventory synchronization may have resolved the gap.
      if (!button.disabled) click(token, button);
      log(`检测购买窗口：${goal.name}（${attempt}/3）`);
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        check(token);
        const box = q('[data-market-trade]');
        if (visible(box) && q('.trade-steps', box)) return box;
        await sleep(200);
      }
      // No purchase has been submitted here: reopening navigation is safe.
      const unfinished = q(`[data-action="market"][data-item="${itemId}"]`, assistant());
      if (unfinished?.disabled) pauseError('原助手购买导航长时间未结束，请检查助手状态');
      const close = q('[data-trade-close]');
      if (visible(close)) click(token, close);
      const marketClose = q('[data-market-close]');
      if (visible(marketClose)) click(token, marketClose);
      if (attempt < 3) {
        log(`购买窗口或现货未就绪，${attempt} 秒后自动重试（${attempt}/3）`);
        await sleep(attempt * 1000);
        await refresh(token);
      }
    }
    const error = new Error('现货或快速购买连续 3 次未就绪');
    error.deferGoal = true;
    throw error;
  }
  async function purchase(token) {
    if (session.state.ironman) pauseError('铁人角色无法购买材料');
    if (visible(q('[data-market-trade]'))) pauseError('已有市场确认窗口，请先关闭再开始');
    const maxAttempts = 3;
    flight = true;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        check(token);
        const currentButton = q('[data-action="market"]', assistant());
        if (!currentButton) return; // The previous attempt may have filled the last unit.
        const itemId = Number(currentButton.dataset.item);
        const material = currentButton.closest('[data-material]');
        const missing = /(?:^|\s)缺\s+(\d[\d,]*)\s*$/.exec(q('small', material)?.textContent.trim() || '');
        if (!integer(itemId, 1) || !missing || !integer(exactNumber(missing[1]), 1)) pauseError('材料缺口不可确认，请手动检查');
        const needed = exactNumber(missing[1]);
        const trade = await openPurchase(token, itemId);
        if (!trade) { await refresh(token); return; }
        await sleep(400);
        check(token); ensureGoal();
        const deal = quote(trade, itemId);
        if (deal.qty > needed) pauseError('购买量超过当前材料缺口');
        if (!integer(session.state.coins) || session.state.coins < deal.upper) pauseError('金币不足以支付本次补料');
        const before = stock(session.state, itemId), coinsBefore = session.state.coins;
        const ordersBefore = new Set(session.orders.map(order => order.id));
        if (session.state.route && !await interruptForeign(token)) pauseError('出现其他正在进行的游戏任务');
        sampleStats();
        log(`补料：${itemId} × ${deal.qty}，限价 ${deal.price}${attempt > 1 ? `（第 ${attempt} 次）` : ''}`);
        session.post({ t: 'marketBuy', itemId, qty: deal.qty, price: deal.price });
        let filled = false;
        for (let confirmation = 1; confirmation <= 3; confirmation++) {
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            if (window.deepvein?.session !== session || identity(session.state) !== person || !session.connection.live) pauseError('交易确认期间连接或角色变化，请在市场检查成交和挂单');
            if (stock(session.state, itemId) >= before + deal.qty) { filled = true; break; }
            if (session.orders.some(order => !ordersBefore.has(order.id) && order.itemId === itemId && order.side === 'buy')) break;
            await sleep(200);
          }
          if (filled || session.orders.some(order => !ordersBefore.has(order.id) && order.itemId === itemId && order.side === 'buy')) break;
          if (!running || token !== epoch) break;
          if (confirmation < 3) log(`到账确认重试 ${confirmation}/3：继续核对原交易，不重复购买`);
        }
        if (filled) {
          click(token, q('[data-trade-close]', trade));
          await refresh(token);
          return;
        }
        // Reconcile the original order first; resubmit only after its remainder
        // is confirmed gone. Unchanged balances alone do not prove rejection.
        const pending = session.orders.filter(order => !ordersBefore.has(order.id) && order.itemId === itemId && order.side === 'buy');
        if (pending.length) {
          for (const order of pending) session.post({ t: 'marketCancel', orderId: order.id });
          const end = Date.now() + 6000;
          while (Date.now() < end && pending.some(order => session.orders.some(current => current.id === order.id))) await sleep(200);
          if (pending.some(order => session.orders.some(current => current.id === order.id))) pauseError('余单撤销未确认，请检查市场挂单');
          if (stock(session.state, itemId) > before) {
            click(token, q('[data-trade-close]', trade));
            await refresh(token);
            return;
          }
        }
        if (!running || token !== epoch) return;
        if (!pending.length) pauseError('连续 3 轮仍无法确认原交易结果，请核对市场；未重复下单');
        if (session.state.coins !== coinsBefore) pauseError('交易结果不确定：金币已变化但材料未到账，请核对市场；未重复下单');
        click(token, q('[data-trade-close]', trade));
        if (attempt === maxAttempts) pauseError(`连续 ${maxAttempts} 次未确认到账；不会继续重试，请检查市场`);
        log(`余单已撤销，${attempt} 秒后重新补料（${attempt}/${maxAttempts}）`);
        await sleep(1000 * attempt);
        await refresh(token);
      }
    } finally { sampleStats(); flight = false; render(); }
  }
  async function manufacture(token) {
    ensureGoal();
    if (session.state.route && !await interruptForeign(token)) pauseError('游戏已有任务，请先停止再开始自动制造');
    const button = q('[data-action="craft"]', assistant());
    if (!button || button.disabled) pauseError('当前任务无法跳转制造，请检查原助手设置和材料');
    click(token, button);
    const scope = await until(token, () => {
      const route = activeRoute();
      const picked = q('.route[data-picked="true"][data-job]', route || document);
      return picked && q('[data-start]', route) && !q('[data-action="craft"]', assistant())?.disabled && route;
    }, '制造页面未就绪');
    ensureGoal();
    const jobId = Number(q('.route[data-picked="true"][data-job]', scope).dataset.job);
    const job = catalog.jobs.find(row => row.id === jobId);
    const stride = catalog.rules.encoding.rarityStride;
    const plusStride = catalog.rules.encoding.plusStride;
    const baseId = goal.itemId % stride, rarity = Math.floor((goal.itemId % plusStride) / stride);
    if (!job || job.id !== goal.plannedJobId || !catalog.skillGroups.craft.includes(job.skill) || job.skill === 'enhancing' || job.grow || job.retired || !job.inputs?.length || job.output.itemId !== baseId || !integer(job.output.qty, 1) || goal.itemId >= plusStride) pauseError('此任务不是受支持的普通制造产出（强化、升级、种植、战斗或额外掉落请手动处理）');
    const choice = q('[data-rarity-choices] [aria-pressed="true"][data-rarity]', scope);
    if (Number(choice?.dataset.rarity) !== rarity || q('[data-rarity-best][aria-pressed="true"]', scope)) pauseError('制作选中的品质与精通目标不一致');
    const amount = Math.min(1000000, Math.ceil((goal.target - progress()) / job.output.qty));
    if (!integer(amount, 1)) return;
    click(token, q('[data-stop-mode="count"]', scope));
    const field = await until(token, () => {
      const el = q('[data-amount-any]', scope);
      return visible(el) && el;
    }, '无法切换到有限次数制造');
    setValue(token, field, amount);
    await sleep(250);
    check(token); ensureGoal();
    if (session.state.route || Number(q('.route[data-picked="true"]', scope)?.dataset.job) !== jobId ||
      q('[data-stop-mode="count"]', scope)?.getAttribute('aria-selected') !== 'true' ||
      exactNumber(field.value) !== amount ||
      Number(q('[data-rarity-choices] [aria-pressed="true"][data-rarity]', scope)?.dataset.rarity) !== rarity) pauseError('制造参数已变化，已停止');
    goal.jobId = jobId;
    const before = progress();
    click(token, q('[data-start]', scope));
    await until(token, () => session.state.route?.jobId === jobId || progress() > before, '未确认制造开始；不会重复点击');
    log(`制造中：${goal.name}，本批最多 ${amount} 次`);
    const began = Date.now();
    let changed = Date.now(), lastProgress = progress();
    while (true) {
      check(token);
      const current = progress();
      if (current !== lastProgress) { changed = Date.now(); lastProgress = current; }
      if (current >= goal.target) {
        if (session.state.route) await stopOwned(token);
        return;
      }
      if (!session.state.route) {
        if (current === before) pauseError('本批未增加目标自产量，请核对材料、品质或失败原因');
        log('本批结束，重新计算剩余缺口');
        return;
      }
      if (session.state.route.jobId !== jobId) { log('本批被后备活动接管，打断后重来'); return; }
      // Allow travel and slow recipes, but never loop indefinitely on a stuck job.
      const idleLimit = Math.max(180000, Math.min(1800000, (job.baseTicks || 0) * catalog.rules.tickMs * 4));
      if (Date.now() - changed > idleLimit || Date.now() - began > 24 * 3600000) pauseError('长时间没有目标产出，请检查游戏任务');
      status = `制造中：${goal.name} · ${current} / ${goal.target}`; render();
      await sleep(1000);
    }
  }
  async function stopOwned(token) {
    check(token);
    if (!session.state.route) return;
    const owned = !!goal?.jobId && session.state.route.jobId === goal.jobId;
    if (!owned) log('游戏里是后备活动，先打断再继续');
    const skip = q('[data-plan-skip]');
    if (visible(skip)) click(token, skip);
    else if (typeof session.intent === 'function') session.intent({ t: 'skip' }, () => {});
    else session.post({ t: 'skip' });
    await until(token, () => !session.state.route, owned ? '未确认游戏任务停止，请手动检查' : '后备活动未能打断，请手动停止');
  }
  async function run(token) {
    let recoveryRound = 0;
    while (running && token === epoch) {
      check(token);
      if (!goal && !await selectGoal(token)) {
        if (deferredGoals.size && recoveryRound < 2) {
          recoveryRound++;
          log(`其他任务已扫描，${recoveryRound * 5} 秒后回查 ${deferredGoals.size} 个暂缺货目标（${recoveryRound}/2）`);
          await sleep(recoveryRound * 5000);
          check(token); deferredGoals.clear();
          continue;
        }
        pause(deferredGoals.size ? '暂缺货目标已完成 2 轮回查，仍无法补料；其余符合条件的任务已处理' : settings.limitCost ? '当前筛选列表没有符合成本上限的可制造任务' : '当前筛选列表没有可自动制造的任务');
        return;
      }
      if (progress() >= goal.target) {
        completed++;
        finishedGoals.add(goal.id);
        log(`已达标：${goal.name}；继续筛选列表下一项`);
        await sleep(800);
        goal = null;
        continue;
      }
      await refresh(token);
      if (progress() >= goal.target) continue;
      if (session.state.route && !await interruptForeign(token)) pauseError('游戏已有任务，请先手动处理');
      const material = q('[data-action="market"]', assistant());
      if (material) {
        try { await purchase(token); }
        catch (error) {
          check(token);
          if (!error.deferGoal) throw error;
          deferredGoals.add(goal.id);
          log(`${error.message}：暂跳过 ${goal.name}，继续下一项，稍后回查`);
          goal = null;
        }
      }
      else await manufacture(token);
    }
  }
  async function start() {
    if (running || starting || flight || activeRun) return;
    starting = true; activeRun = true; render();
    const token = ++epoch;
    try {
      session = window.deepvein?.session;
      helper = window.__DVI_MASTERY_HELPER__;
      person = identity(session?.state);
      if (!person || !session?.connection?.live || typeof session.post !== 'function' || !Array.isArray(session.orders)) pauseError('请先登录游戏并等连接就绪');
      if (!helper) pauseError(`需要同时启用精通助手 ${HELPER_MIN.join('.')} 及以上，并等它完成规则校验`);
      if (!helperReady(helper)) pauseError(`精通助手不兼容或尚未完成规则校验（${helperCompat(helper)}）`);
      catalog = helper.handoff().catalog;
      if (!catalog?.rules?.encoding || !catalog?.skillGroups?.craft || !catalog?.skillNamesZh || !catalog?.jobs) pauseError('原助手数据不完整');
      const collection = catalog.rules.collection;
      if (!Array.isArray(catalog.items) || !Array.isArray(collection?.thresholds) || !Array.isArray(collection.incrementPoints) || !Array.isArray(collection.rarityMultipliers) || !Array.isArray(collection.excludedItemIds)) pauseError('原助手缺少精通点数计算规则');
      itemIndex = new Map(catalog.items.map(item => [item.id, item]));
      // 1.2.12 起助手的跳转受“自动跳转”开关控制，关掉时 craft()/market() 会静默返回。
      let helperPrefs = {};
      try { helperPrefs = JSON.parse(localStorage.getItem(helperPrefsKey) || '{}'); } catch { /* 读不到就按默认开启处理 */ }
      if (helperPrefs.autoNavigate === false) pauseError('请在精通助手“设置”里开启“自动跳转”，否则助手不会带路');
      if (!navigator.locks?.request) pauseError('浏览器不支持标签页互斥，请使用新版 Chrome / Edge');
      settings.priority = q('[name="priority"]', ui).value;
      if (!priorities.some(([id]) => id === settings.priority)) pauseError('执行顺序无效');
      settings.limitCost = q('[name="limitCost"]', ui).checked;
      const costText = q('[name="costLimit"]', ui).value.trim();
      if (settings.limitCost && (!/^\d+(?:\.\d+)?$/.test(costText) || !Number.isFinite(Number(costText)))) pauseError('每点精通成本上限必须是大于等于 0 的数字，可填小数');
      if (/^\d+(?:\.\d+)?$/.test(costText) && Number.isFinite(Number(costText))) settings.costLimit = Number(costText);
      localStorage.setItem(PREF, JSON.stringify(settings));
      await navigator.locks.request(`dvi-mastery-auto:${person}`, { ifAvailable: true }, async lock => {
        if (!lock) pauseError('另一个标签页正在运行自动制造');
        if (token !== epoch) return;
        if (session.state.route) pauseError('已有游戏任务；请先手动停止，再开始自动制造');
        // 后备活动会在计划结束的瞬间自动开工、抢走任务槽：先记下再清掉，暂停时还原。
        const fallback = session.state.fallback;
        savedFallback = fallback?.task ? { task: fallback.task, onStorageFull: fallback.onStorageFull === true } : null;
        fallbackResentAt = 0;
        sampleStats(); loadStats(person);
        const points = collectionPoints(session.state);
        if (points === null || !integer(session.state.coins)) pauseError('金币或自产数据不可用，无法开始统计');
        meter = { person, coins: session.state.coins, points, active: true };
        running = true; starting = false; goal = null; completed = 0; finishedGoals.clear(); deferredGoals.clear();
        render();
        q('[data-auto="pause"]', ui).focus({ preventScroll: true });
        beginBackground();
        check(token);
        log(`已开始：${priorities.find(([id]) => id === settings.priority)[1]}，后台保持运行（助手 ${helper.version}）`);
        if (savedFallback) await clearFallback(token);
        await run(token);
      });
    } catch (error) {
      if (token === epoch) pause(error.message || String(error));
    } finally {
      // A cancelled old run must not alter a later run.
      if (token === epoch) { sampleStats(); running = false; starting = false; if (meter && !ownsRoute() && !flight) meter.active = false; endBackground(); }
      else if (!running && !starting) endBackground();
      activeRun = false;
      render();
    }
  }
  const host = document.createElement('div');
  host.id = 'dvi-mastery-auto';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483000;width:332px;max-width:calc(100% - 24px);color:#f3e8d4;font:13px/1.5 system-ui,sans-serif;color-scheme:dark}
    *{box-sizing:border-box}section{border:1px solid #94714a;border-radius:10px;background:#211b15;box-shadow:0 8px 30px #0008;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#34281c}[data-drag]{cursor:move;touch-action:none;user-select:none;-webkit-user-select:none}strong{font-size:14px}button,input{font:inherit}button{min-height:34px;padding:6px 11px;border:1px solid #8b7050;border-radius:5px;color:inherit;background:#3c3023;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #f4ce83;outline-offset:2px}header button{min-height:26px;padding:0 8px}main{padding:12px;max-height:64dvh;overflow:auto}p{margin:0 0 10px}.hint{font-size:12px;color:#c9bca8}.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}label{display:flex;flex-direction:column;gap:3px;color:#ddd0bb;font-size:12px}input[type=text]{width:100%;min-height:34px;border:1px solid #796447;background:#17130f;border-radius:4px;padding:5px 7px;color:#fff}.check{display:flex;flex-direction:row;align-items:center;gap:6px;margin:10px 0}input[type=checkbox]{width:17px;height:17px;accent-color:#e8bd72}.buttons{display:flex;flex-wrap:wrap;gap:6px}.primary{background:#e5b768;border-color:#f4ce83;color:#21180c;font-weight:700}.stop{background:#63372e;border-color:#b37662}.status{padding:9px 12px;border-top:1px solid #65513a;overflow-wrap:anywhere;background:#2b241a;color:#f4d89e}.stats{color:#c9bca8;font-size:12px;margin:10px 0 0}details{margin-top:10px;font-size:12px;color:#c9bca8}summary{cursor:pointer}ol{padding-left:20px;max-height:125px;overflow:auto}li{margin:4px 0;overflow-wrap:anywhere}[hidden]{display:none!important}
    main{max-height:min(52dvh,calc(100dvh - 300px))}.controls{padding:10px 12px;border-top:1px solid #65513a}select{width:100%;min-height:34px;border:1px solid #796447;background:#17130f;border-radius:4px;padding:5px 7px;color:#fff;font:inherit}.stats{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.stats div{min-width:0}.stats .average{grid-column:1/-1}.stats span{display:block}.stats b{color:#f4d89e;font-size:16px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  </style><section aria-label="精通自动制造"><header data-drag title="按住标题栏可拖动面板"><strong data-drag>精通自动制造</strong><button data-auto="collapse" aria-label="收起面板" aria-expanded="true">收起</button></header><main>
    <p class="hint">按原助手的技能、品质和搜索范围自动补料、制造，达标后继续下一项。运行期间会屏蔽其他点击和键盘操作（暂停键和拖动标题栏除外）；开始时临时关闭“计划结束后”的后备活动，暂停时还原。</p>
    <label>执行顺序<select name="priority" aria-label="执行顺序">${priorities.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="limitCost">按每点精通成本筛选（金/点）</label>
    <label>每点精通成本上限<input type="text" inputmode="decimal" name="costLimit"></label>
    <p class="hint" style="margin-top:6px">只做 ≤ 上限的任务；超限或费用待确认的跳过。缺料自动补买，顺序交给原助手计算。</p>
    <details><summary>运行记录与说明</summary><p>累计记录自动执行期间观察到的金币扣减和自产新增精通点。每点花费 = 已花金币 ÷ 获得点数；尚未获得点数时显示 —。统计按角色保存，暂停后已开始的制作仍计入。运行时屏蔽其他点击和键盘操作，点击“暂停助手”后恢复；切换标签页不会暂停。购买窗口未就绪自动重试 3 次，缺货先跳过，最后回查 2 轮。到账慢会自动核对最多 3 轮，每轮 15 秒；确认撤销余单后最多补买 3 次，部分到账按剩余缺口继续。仍无法确认原交易时暂停，避免重复购买。关闭网页或电脑休眠后无法继续。</p><ol data-history></ol></details>
  </main><div class="controls"><div class="buttons"><button class="primary" data-auto="start">开始自动制造</button><button data-auto="pause">暂停助手</button><button class="stop" data-auto="stop">停止当前制作</button></div><div class="stats" data-stats><div><span>已花金币</span><b data-spent>0</b></div><div><span>获得精通点</span><b data-points>0</b></div><div class="average"><span>当前每点花费（金/点）</span><b data-average>—</b></div></div></div><div class="status" role="status" aria-live="polite" data-status></div></section>`;
  q('[name="costLimit"]', ui).value = settings.costLimit;
  q('[name="priority"]', ui).value = settings.priority;
  q('[name="limitCost"]', ui).checked = settings.limitCost;
  function render() {
    sampleStats();
    q('[data-status]', ui).textContent = status;
    const current = stats.person === identity(window.deepvein?.session?.state) ? stats : { spent: 0, points: 0 };
    const format = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    q('[data-spent]', ui).textContent = format(current.spent);
    q('[data-points]', ui).textContent = format(current.points);
    const average = current.points > 0 ? current.spent / current.points : null;
    q('[data-average]', ui).textContent = average === null ? '—' : average > 0 && average < 0.01 ? '<0.01' : format(average);
    q('[data-auto="start"]', ui).disabled = running || starting || flight || activeRun;
    q('[data-auto="pause"]', ui).disabled = !running && !starting;
    q('[data-auto="stop"]', ui).disabled = running || starting || !goal?.jobId || flight;
    for (const input of ui.querySelectorAll('input,select')) input.disabled = running || starting || flight;
    const list = q('[data-history]', ui);
    list.replaceChildren(...history.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  }
  ui.addEventListener('click', async event => {
    const action = event.target.closest('[data-auto]')?.dataset.auto;
    if (action === 'start') void start();
    if (action === 'pause') pause();
    if (action === 'collapse') {
      const main = q('main', ui); main.hidden = !main.hidden;
      q('.controls', ui).hidden = main.hidden;
      const button = q('[data-auto="collapse"]', ui);
      button.textContent = main.hidden ? '展开' : '收起';
      button.setAttribute('aria-label', main.hidden ? '展开面板' : '收起面板');
      button.setAttribute('aria-expanded', String(!main.hidden));
    }
    if (action === 'stop' && !running && !starting && !flight) {
      const current = window.deepvein?.session;
      const owned = current === session && identity(current?.state) === person && goal?.jobId && current?.state?.route?.jobId === goal.jobId;
      pause('已暂停助手');
      if (!owned || !current.connection?.live || current.state.queue.length || !visible(q('[data-plan-skip]'))) { log('未找到本助手正在执行的任务，请手动检查游戏'); return; }
      q('[data-plan-skip]').click();
      await sleep(500);
      log(current.state.route ? '停止已请求；游戏尚未确认，请检查任务栏' : '当前制作已停止');
    }
  }, { signal: life.signal });
  // 拖动：只认标题栏本身（按钮不算），位置存进偏好，超出视口自动夹回。
  const header = q('header', ui);
  let drag = null;
  function applyPosition() {
    if (!Number.isFinite(settings.x) || !Number.isFinite(settings.y)) return;
    const rect = host.getBoundingClientRect();
    const left = Math.min(Math.max(8, settings.x), Math.max(8, innerWidth - rect.width - 8));
    const top = Math.min(Math.max(8, settings.y), Math.max(8, innerHeight - rect.height - 8));
    settings.x = left; settings.y = top;
    host.style.right = 'auto'; host.style.bottom = 'auto';
    host.style.left = `${left}px`; host.style.top = `${top}px`;
  }
  function savePosition() {
    try { localStorage.setItem(PREF, JSON.stringify(settings)); } catch { /* 存不下就只在本次会话生效 */ }
  }
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || !event.target.hasAttribute('data-drag')) return;
    const rect = host.getBoundingClientRect();
    drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    host.style.right = 'auto'; host.style.bottom = 'auto';
    event.preventDefault();
  }, { signal: life.signal });
  header.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const rect = host.getBoundingClientRect();
    settings.x = Math.min(Math.max(8, event.clientX - drag.dx), Math.max(8, innerWidth - rect.width - 8));
    settings.y = Math.min(Math.max(8, event.clientY - drag.dy), Math.max(8, innerHeight - rect.height - 8));
    host.style.left = `${settings.x}px`; host.style.top = `${settings.y}px`;
  }, { signal: life.signal });
  const endDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) savePosition();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(type, endDrag, { signal: life.signal });
  window.addEventListener('resize', () => { if (Number.isFinite(settings.x)) applyPosition(); }, { signal: life.signal });
  const isPauseControl = event => event.composedPath().some(node => node?.dataset?.auto === 'pause') &&
    (!event.type.startsWith('key') || ['Enter', ' ', 'Spacebar'].includes(event.key));
  // 运行期屏蔽输入，但暂停键与标题栏拖动要放行。
  const allowedControl = event => isPauseControl(event) ||
    (event.type.startsWith('pointer') && event.target?.hasAttribute?.('data-drag'));
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup', 'beforeinput', 'wheel', 'touchstart', 'touchmove']) {
    // Pause activation must reach its control without reaching game shortcuts.
    ui.addEventListener(type, event => {
      if (allowedControl(event)) event.stopPropagation();
    }, { signal: life.signal });
    window.addEventListener(type, event => {
      if ((running || starting) && event.isTrusted && !allowedControl(event)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true, passive: false, signal: life.signal });
  }
  window.addEventListener('pagehide', () => pause('页面已离开'), { signal: life.signal });
  window[KEY] = { version: '0.2.1', pause, get state() { sampleStats(); return { running, starting, flight, settling: activeRun && !running && !starting, spent: stats.spent, points: stats.points, average: stats.points > 0 ? stats.spent / stats.points : null, completed, backgroundActive: !!visibilityLease, status }; } };
  // 合并版在 document-start 运行，此时 body 还不存在。
  const mountHost = () => { (document.body || document.documentElement).append(host); applyPosition(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountHost, { once: true });
  else mountHost();
  loadStats(identity(window.deepvein?.session?.state));
  setInterval(() => render(), 500);
  render();
})();
