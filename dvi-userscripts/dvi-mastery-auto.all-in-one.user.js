// ==UserScript==
// @name         [DVI]精通自动制造（内置精通助手 1.2.12）
// @namespace    local.dvi.mastery.automation
// @version      0.2.2
// @description  单文件版：内置 [DVI]精通助手 1.2.12 数据适配层（作者 SHIIN，CC-BY-ND），自动补料制造并统计金币与精通收益。
// @match        https://deepveinidle.com/*
// @match        https://www.deepveinidle.com/*
// @match        https://cn.deepveinidle.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// @license      CC-BY-ND
// @updateURL    https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-mastery-auto.all-in-one.meta.js
// @downloadURL  https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-mastery-auto.all-in-one.user.js
// ==/UserScript==
/* 内置部分：[DVI]精通助手 1.2.12（https://greasyfork.org/scripts/601366），作者 SHIIN，许可证 CC-BY-ND。 */
/* 末段为本地自动制造层，版本 0.2.0。 */
(function () {
"use strict";
const PLUGIN_VERSION = '1.2.12';
const module = { exports: {} };
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.DVIPlannerCore = api; root.DVIMasteryCore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const MAX = 1e12;
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
    const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const integer = (v, min = 0, max = MAX) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
    const number = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
    const rarityCount = data => Array.isArray(data?.rules?.rarityNames) ? data.rules.rarityNames.length : 0;
    const capabilityEnabled = (data,key) => !object(data?.capabilities) || data.capabilities[key]?.available === true;
    const featureAvailable = (data,key) => capabilityEnabled(data,key) && (!['work','farming','combat'].includes(key) || capabilityEnabled(data,'quality'));
    const taskAvailable = (task,data,character=null) => {
        if (!task || !data) return false;
        const kind = task.sourceKind || task.kind;
        if (task.kind === 'forge' || kind === 'enhance') return featureAvailable(data,'enhancing');
        if (task.kind === 'upgrade' || kind === 'upgrade') return featureAvailable(data,'upgrades');
        if (task.kind === 'combat' || kind === 'combat') return featureAvailable(data,'combat');
        const job = task.kind === 'job' || task.jobId != null ? jobMap(data).map.get(task.jobId) : null;
        if(job&&task.sourceType!=='bonus'&&data.rules?.collection?.unplannableItemIds?.includes(job.output.itemId))return false;
        return featureAvailable(data,task.kind === 'farm' || job?.grow || task.grow ? 'farming' : 'work');
    };
    const conservativeWorkMaterials = (job,character,data) => {
        const freeTools=data.rules?.workTiming?.freeInputToolSkills;
        if(!job?.inputs.length||job.grow||!object(freeTools)||!Object.keys(freeTools).length)return false;
        const slot=data.rules.workTiming.skillToolSlots[job.skill],equipment=character.equipment;
        if(!own(equipment,slot))return true;
        const id=equipment[slot],base=id===null?null:decodeItem(id,data)?.baseItemId;
        return id!==null&&(!base||freeTools[base]===job.skill);
    };
    const finiteRule = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const numberRules = value => Array.isArray(value) && value.length > 0 && value.every(finiteRule);
    const baseRulesReady = data => {
        const rule = data?.rules, count = rarityCount(data), collection = rule?.collection;
        const finite = finiteRule, array = numberRules;
        return count > 0 && object(data.masteryNames) && Array.isArray(data.skills) && object(data.skillGroups) && Array.isArray(data.skillGroups.gather) && Array.isArray(data.skillGroups.craft)
            && integer(rule.encoding?.rarityStride,1) && integer(rule.encoding?.plusStride,1) && rule.encoding.plusStride >= rule.encoding.rarityStride * count
            && array(collection?.thresholds) && collection.thresholds.every((value,index,rows)=>integer(value,1) && (!index || value > rows[index-1]))
            && array(collection.incrementPoints) && collection.thresholds.length === collection.incrementPoints.length && array(collection.rarityMultipliers) && collection.rarityMultipliers.length === count && finite(collection.petFirst) && Array.isArray(collection.excludedItemIds)
            && array(rule.xp?.levelThresholds) && rule.xp.levelThresholds.length > 1 && rule.xp.levelThresholds.every((value,index,rows)=>!index || value >= rows[index-1]) && finite(rule.tickMs) && rule.tickMs > 0
            && object(rule.workTiming);
    };
    const rulesReady = data => {
        if (!baseRulesReady(data)) return false;
        const rule = data.rules, count = rarityCount(data), timing = rule.workTiming, forge = rule.forge, quality = rule.qualityModifiers;
        const finite = finiteRule, array = numberRules;
        const toolRules = () => array(timing.toolRarityMultipliers) && timing.toolRarityMultipliers.length === count && finite(timing.toolPlusPerLevel);
        const roomRules = () => finite(timing.housePerLevel) && object(timing.skillRooms) && object(timing.skillRoomRates);
        if (featureAvailable(data,'quality')) {
            if (!(array(rule.qualityCumulative) && rule.qualityCumulative.length === count+1 && rule.qualityCumulative[0] === 1 && rule.qualityCumulative.at(-1) === 0 && rule.qualityCumulative.every((value,index,rows)=>value <= 1 && (!index || value <= rows[index-1])))) return false;
            if (!toolRules() || !roomRules() || !object(timing.luckToolSlots) || !array(timing.toolLuckByRarity) || timing.toolLuckByRarity.length !== count || !object(quality)) return false;
            if (!['hunterPerTier','masteryPerRank'].every(key=>finite(quality[key])) || !['blessingMultiplier','eventRarityMultiplier'].every(key=>finite(quality[key]) && quality[key]>0) || !integer(quality.eventTicks,1) || !integer(quality.eventSeed,1) || !array(quality.brewMultipliers) || quality.brewMultipliers.length !== count) return false;
            if (!['eventSkills','eventRaritySkills','combatSkills','rareRooms'].every(key=>Array.isArray(quality[key])) || !quality.eventSkills.length || quality.rareRooms.some(room=>!object(room) || typeof room.id !== 'string' || !finite(room.rate))) return false;
        }
        if (featureAvailable(data,'work') && !(toolRules() && roomRules() && finite(rule.xp.speedPerLevelAboveRequirement) && ['quickPerkPerRank','masterySpeedPerRank','handsPerRank'].every(key=>finite(timing[key])) && integer(timing.maxHandsRank) && object(timing.skillToolSlots) && object(timing.skillMasteries))) return false;
        if (featureAvailable(data,'farming') && !(toolRules() && roomRules() && (timing.farmYield === undefined ? integer(timing.farmMinYield,1) && integer(timing.farmMaxYield,timing.farmMinYield) && finite(timing.farmYieldLevelDivisor) && timing.farmYieldLevelDivisor > 0 : object(timing.farmYield) && integer(timing.farmYield.base,1) && array(timing.farmYield.levelThresholds) && timing.farmYield.levelThresholds.every((value,index,rows)=>integer(value,1) && (!index || value > rows[index-1])) && finite(timing.farmYield.toolMultiplier)))) return false;
        if (featureAvailable(data,'enhancing') && !(finite(timing.forgeMasteryPerRank) && (!forge?.houseBonusEnabled || roomRules()) && object(forge) && ['divisor','minPoints','baseSuccessReductionPerPlus','minBaseSuccess','attemptTicks','successBonusPerSkillLevel','maxMasteryMultiplier'].every(key=>finite(forge[key]))
            && integer(forge.loggedMaxPlus,1,52) && integer(forge.maxPlus,1,forge.loggedMaxPlus) && integer(forge.maxPlusScored,1,forge.maxPlus) && integer(forge.shardItemId,1)
            && forge.divisor > 0 && forge.attemptTicks > 0 && forge.minBaseSuccess >= 0 && forge.minBaseSuccess <= 1 && forge.baseSuccessReductionPerPlus <= 1 && forge.maxMasteryMultiplier >= 1
            && array(forge.tierWeights) && array(forge.rarityWeights) && forge.rarityWeights.length === count && array(forge.stepWeights) && forge.stepWeights.length >= forge.maxPlusScored
            && typeof forge.houseBonusEnabled === 'boolean' && (forge.successTail === null ? forge.minBaseSuccess > 0 : forge.minBaseSuccess === 0 && !forge.houseBonusEnabled && object(forge.successTail) && integer(forge.successTail.start,1,forge.maxPlus) && finite(forge.successTail.base) && forge.successTail.base > 0 && forge.successTail.base <= 1 && finite(forge.successTail.decay) && forge.successTail.decay > 0 && forge.successTail.decay <= 1 && Math.abs(forge.successTail.base-(1-forge.successTail.start*forge.baseSuccessReductionPerPlus)) < 1e-12)
            && array(forge.shardsPerPlus) && forge.shardsPerPlus.length === forge.tierWeights.length && forge.shardsPerPlus.every(value=>integer(value,1))
            && integer(forge.defaultTier,1,forge.tierWeights.length) && array(forge.goldTierWeights) && forge.goldTierWeights.length === forge.tierWeights.length && array(forge.goldRarityWeights) && forge.goldRarityWeights.length === count)) return false;
        return true;
    };
    const catalogs = new WeakMap(), jobIndexes = new WeakMap(), rowIndexes = new WeakMap();
    const indexById = rows => {
        if (!Array.isArray(rows)) return new Map();
        let index = rowIndexes.get(rows);
        if (!index || index.length !== rows.length) {
            index = {length:rows.length,map:new Map(rows.map(row => [row.id,row]))};
            rowIndexes.set(rows,index);
        }
        return index.map;
    };
    const catalog = data => {
        const rows = data.items;
        if (!Array.isArray(rows)) return { items:new Map(), forge:new Map() };
        let index = catalogs.get(rows);
        if (!index || index.length !== rows.length) {
            index = { length:rows.length, items:new Map(), forge:new Map() };
            for (const item of rows) {
                index.items.set(item.id,item);
                if (item.enhanceable && item.enhanceTier) {
                    if (!index.forge.has(item.enhanceTier)) index.forge.set(item.enhanceTier,[[],[]]);
                    const group = index.forge.get(item.enhanceTier);
                    group[0].push(item);
                    if (item.rarityable) group[1].push(item);
                }
            }
            catalogs.set(rows,index);
        }
        return index;
    };
    const itemMap = data => catalog(data).items;
    const jobMap = data => {
        const rows = data.jobs;
        let index = jobIndexes.get(rows);
        if (!index || index.length !== rows.length) {
            const map = indexById(rows);
            index = {length:rows.length,map,grow:[...map.values()].filter(job => job.grow)};
            jobIndexes.set(rows,index);
        }
        return index;
    };
    const collectionRule = data => data?.rules?.collection;
    const forgeHasStep = (mask,plus) => integer(mask,0,Number.MAX_SAFE_INTEGER) && integer(plus,1,52) && Math.floor(mask/2**(plus-1))%2 === 1;
    const mergeForgeMask = (a,b) => Number(BigInt(a || 0) | BigInt(b || 0));
    function decodeItem(id, data = {}) {
        const enc = data?.rules?.encoding, count = rarityCount(data);
        if (!integer(id, 1, 1e9) || !integer(enc?.rarityStride,1) || !integer(enc?.plusStride,1) || !count) return null;
        const remainder = id % enc.plusStride;
        const rarity = Math.floor(remainder / enc.rarityStride);
        if (rarity >= count || remainder % enc.rarityStride === 0) return null;
        return { baseItemId: remainder % enc.rarityStride, rarity, plus: Math.floor(id / enc.plusStride) };
    }
    function encodeItem(base, rarity, plus = 0, data = {}) {
        const enc = data?.rules?.encoding;
        if (!integer(enc?.rarityStride,1) || !integer(enc?.plusStride,1) || !integer(base,1,enc.rarityStride-1) || !integer(rarity,0,rarityCount(data)-1) || !integer(plus)) return null;
        return base + rarity * enc.rarityStride + plus * enc.plusStride;
    }
    function levelFromXp(xp, data = {}) {
        const thresholds = ((data.rules || {}).xp || {}).levelThresholds;
        if (!Array.isArray(thresholds) || thresholds.length < 2) return null;
        let low = 1, high = thresholds.length - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (thresholds[middle] <= xp) low = middle;
            else high = middle - 1;
        }
        return low;
    }
    function unwrap(raw) {
        if (Array.isArray(raw) && raw.length === 2 && object(raw[1])) return unwrap(raw[1]);
        if (!object(raw)) return null;
        if (own(raw, 'collections') || (raw.game === 'Deep Vein Idle' && Array.isArray(raw.collection))) return raw;
        for (const key of ['YOU', 'you', 'player', 'character', 'data', 'payload']) {
            if (object(raw[key])) {
                const found = unwrap(raw[key]);
                if (found) return found;
            }
        }
        return raw;
    }
    const eventCycles = new WeakMap();
    function eventHash(slot, salt, seed) {
        let value = (slot^2654435769)>>>0;
        value = Math.imul(value^(salt>>>0),2246822507)>>>0;
        value = (value^value>>>13)>>>0;
        value = Math.imul(value^(seed>>>0),3266489909)>>>0;
        return (value^value>>>16)>>>0;
    }
    function eventBonus(tick, skill, rule, hypothetical) {
        if (hypothetical) return 0;
        const slot = Math.floor(tick/rule.eventTicks), count = rule.eventSkills.length;
        let event = eventCycles.get(rule);
        if (event?.slot !== slot) {
            const raw = index => eventHash(index,1,rule.eventSeed)%count;
            let start = slot;
            for (; start > 0; start--) {
                const previous = raw(start-1), value = raw(start);
                if (value !== previous && value !== (previous+1)%count) break;
            }
            let selected = raw(start);
            for (let index = start+1; index <= slot; index++) {
                const value = raw(index); selected = value === selected ? (value+1)%count : value;
            }
            const target = rule.eventSkills[selected];
            event = {slot,skill:target,bonus:rule.eventRaritySkills.includes(target) && eventHash(slot,2,rule.eventSeed)%3 === 0 ? rule.eventRarityMultiplier-1 : 0};
            eventCycles.set(rule,event);
        }
        return event.skill === skill || event.skill === 'combat' && rule.combatSkills.includes(skill) ? event.bonus : 0;
    }
    function brewStrength(state, id, rule) {
        const tick = state.lastTick;
        if (!(state.brews?.[id] > tick)) return 0;
        let tier = state.brewTier?.[id] ?? 0;
        const buckets = state.brewBuckets?.[id];
        if (Array.isArray(buckets) && buckets.length) {
            const total = buckets.reduce((sum,value)=>sum+value,0), elapsed = Math.max(0,tick-(state.brews[id]-total));
            let consumed = 0;
            for (let index = buckets.length-1; index >= 0; index--) if ((consumed += buckets[index]) > elapsed) { tier = index; break; }
        }
        return rule.brewMultipliers[Math.max(0,Math.min(rule.brewMultipliers.length-1,tier))] || 0;
    }
    function qualityMultipliers(state, context, data, masteries) {
        const rule = data.rules.qualityModifiers;
        if (!featureAvailable(data,'quality') || !rule) return {known:false,multipliers:{},combatBaseMultiplier:null};
        const tick = integer(state.lastTick,0,Number.MAX_SAFE_INTEGER) ? state.lastTick : null;
        const windowsKnown = tick !== null && Array.isArray(context?.windows);
        let windows = 0, house = 0;
        if (windowsKnown) for (const window of context.windows) if (tick >= window.fromTick && tick <= window.toTick) windows += (window.rarityMult ?? 1)-1;
        for (const room of rule.rareRooms) if (state.houseFurniture?.[room.id] !== undefined) house += number(state.house?.[room.id])*data.rules.workTiming.housePerLevel*room.rate;
        const personal = tick === null ? 0 : rule.hunterPerTier*brewStrength(state,'hunter',rule)+(state.brews?.blessing > tick ? rule.blessingMultiplier-1 : 0);
        const base = skill => 1+windows+personal+number(masteries.rare)*rule.masteryPerRank+(tick === null ? 0 : eventBonus(tick,skill,rule,context?.hypothetical === true));
        const multipliers = Object.fromEntries([...data.skills,'combat'].map(skill=>[skill,base(skill)+house]));
        return {known:windowsKnown && object(state.brews) && object(state.house) && object(state.houseFurniture),multipliers,combatBaseMultiplier:rule.combatBonusIncludesHouse ? multipliers.combat : base('combat')};
    }
    function normalizeCharacter(raw, data = {}, context = null) {
        const input = unwrap(raw), errors = [];
        if (!object(input)) return { ok: false, errors: ['人物数据不是有效对象。'], character: null };
        if (!rulesReady(data)) return { ok:false, errors:['游戏规则尚未完整读取，请等待游戏数据就绪。'], character:null };
        const exported = input.game === 'Deep Vein Idle' || (Array.isArray(input.collection) && Array.isArray(input.storage));
        const collectionsInput = exported ? input.collection : input.collections;
        const readCounts = (source, label, arrays = false, allowZeroId = false, maxQty = MAX) => {
            const out = {};
            if (!(arrays ? Array.isArray(source) : object(source))) {
                errors.push(`${label}数据缺失或格式不正确。`);
                return out;
            }
            if (exported && arrays) for (const row of source) {
                const decoded = decodeItem(row?.id ?? row?.itemId, data);
                if (decoded && ((typeof row.rarity === 'string' && row.rarity !== data.rules?.rarityNames?.[decoded.rarity]) || (row.plus !== undefined && row.plus !== decoded.plus))) errors.push(`${label}的品质或强化与物品编号不一致。`);
            }
            const entries = arrays ? source.map(row => [row && (row.itemId ?? row.id), row && row.qty]) : Object.entries(source);
            for (const [key, qty] of entries) {
                const id = typeof key === 'number' ? key : /^\d+$/.test(key) ? Number(key) : NaN;
                if (!integer(id, allowZeroId ? 0 : 1, 1e9) || (!allowZeroId && !decodeItem(id, data)) || !integer(qty,0,maxQty)) {
                    errors.push(`${label}包含无效物品编号或数量。`);
                    continue;
                }
                if (qty > 0) {
                    if (!integer((out[id] || 0) + qty,0,maxQty)) errors.push(`${label}累计数量超出支持范围。`);
                    else out[id] = (out[id] || 0) + qty;
                }
            }
            return out;
        };
        const collections = readCounts(collectionsInput, '自产收藏', exported);
        const bank = readCounts(exported ? input.storage : input.bank, '仓库', exported);
        const pack = readCounts(exported ? input.inventory : input.pack, '背包', true);
        const skills = {};
        if (!object(input.skills)) errors.push('技能数据缺失。');
        else for (const [key, value] of Object.entries(input.skills)) {
            const xp = object(value) ? value.xp : value;
            const level = object(value) && integer(value.level, 1, 10000) ? value.level : levelFromXp(xp, data);
            if (typeof xp !== 'number' || !Number.isFinite(xp) || xp < 0 || xp > Number.MAX_SAFE_INTEGER || !integer(level, 1, 10000)) {
                errors.push(`技能 ${key} 的经验或等级无效。`);
                continue;
            }
            skills[key] = { xp, level };
        }
        let hasForge = featureAvailable(data,'enhancing') && object(data.rules.forge) && object(input.forgeLog), forgeLog = null;
        if (hasForge) {
            const beforeErrors = errors.length;
            forgeLog = readCounts(input.forgeLog,'强化日志',false,true,2 ** data.rules.forge.loggedMaxPlus-1);
            if (errors.length > beforeErrors || Object.entries(forgeLog).some(([key,mask])=>!integer(Number(key),0,data.rules.forge.tierWeights.length*rarityCount(data)-1) || !integer(mask,0,2 ** data.rules.forge.loggedMaxPlus-1))) { hasForge = false; forgeLog = null; errors.length = beforeErrors; }
        }
        const hasLocks = Array.isArray(input.bankLocked);
        const bankLocked = hasLocks ? input.bankLocked.filter(id => integer(id, 1, 1e9) && decodeItem(id, data)) : [];
        if (hasLocks && bankLocked.length !== input.bankLocked.length) errors.push('仓库锁定列表包含无效物品编号。');
        const sourceCharacter = exported ? input.character || {} : input;
        const masteries = {};
        const rawMasteries = exported ? (input.masteries || {}).ranks : input.masteries;
        const masteriesKnown = object(rawMasteries) && Object.values(rawMasteries).every(value => integer(value,0,1e6));
        if (object(rawMasteries)) for (const [key, value] of Object.entries(rawMasteries)) if (integer(value, 0, 1e6)) masteries[data.masteryNames[key] || key] = value;
        const equipment = {}; let equipmentKnown = object(input.equipment);
        if (object(input.equipment)) for (const [slot, value] of Object.entries(input.equipment)) {
            if (value === null) { equipment[slot] = null; continue; }
            const id = object(value) ? value.id : value;
            const decoded = decodeItem(id,data), item = itemMap(data).get(decoded?.baseItemId);
            if (decoded && item?.slot === slot && (!object(value) || (value.rarity === undefined || value.rarity === data.rules?.rarityNames?.[decoded.rarity]) && (value.plus === undefined || value.plus === decoded.plus))) equipment[slot] = id;
            else equipmentKnown = false;
        }
        const speedBonus = {};
        if (object(input.speedBonus)) for (const skill of data.skills || Object.keys(skills)) {
            if (!own(input.speedBonus, skill)) continue;
            const multiplier = object(input.speedBonus[skill]) ? input.speedBonus[skill].multiplier : null;
            if (typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0 && multiplier <= 1e6) speedBonus[skill] = { multiplier };
        }
        const timingRules = data.rules.workTiming, houseKnown = !exported && object(input.house) && object(input.houseFurniture);
        const offhandBonus=skill=>{
            if(!timingRules.offhandEnabled)return 0;
            if(!own(equipment,'shield'))return null;
            if(equipment.shield===null)return 0;
            const decoded=decodeItem(equipment.shield,data),offhand=itemMap(data).get(decoded?.baseItemId)?.offhand;
            return offhand?.skill===skill?number(offhand.lift)*timingRules.toolRarityMultipliers[decoded.rarity]*(1+timingRules.toolPlusPerLevel*decoded.plus):0;
        };
        const roomBonus = skill => {
            const room = timingRules.skillRooms?.[skill], rate = timingRules.skillRoomRates?.[skill];
            return !houseKnown || !Number.isFinite(timingRules.housePerLevel) || typeof room !== 'string' || !Number.isFinite(rate) ? null : own(input.houseFurniture,room) ? number(input.house[room]) * timingRules.housePerLevel * rate : 0;
        };
        const perksKnown = !exported && object(input.perks);
        const farmBonus = roomBonus('farming');
        const timing = {source:exported ? 'export' : 'snapshot',hands:featureAvailable(data,'work') && perksKnown ? Math.min(timingRules.maxHandsRank,number(input.perks.hands)) : null,forgeHouseBonus:!featureAvailable(data,'enhancing') || !data.rules.forge ? null : data.rules.forge.houseBonusEnabled ? roomBonus('enhancing') : 0,farmGrowthMultiplier:farmBonus === null||offhandBonus('farming')===null ? null : (1+farmBonus)*(1+offhandBonus('farming')),speedBonusKnown:false};
        if (featureAvailable(data,'work') && houseKnown && perksKnown && masteriesKnown) {
            for (const [skill,slot] of Object.entries(timingRules.skillToolSlots)) {
                if (!own(equipment,slot)) continue;
                const id = equipment[slot], decoded = id === null ? null : decodeItem(id,data), item = itemMap(data).get(decoded?.baseItemId);
                if (id !== null && (item?.tool?.skill !== skill || !Number.isFinite(item.tool.baseBonus))) continue;
                const room = roomBonus(skill), mastery = timingRules.skillMasteries[skill];
                if (room === null || typeof mastery !== 'string' || offhandBonus(skill)===null) continue;
                const bonus = id === null ? 0 : item.tool.baseBonus * timingRules.toolRarityMultipliers[decoded.rarity] * (1+timingRules.toolPlusPerLevel*decoded.plus);
                const multiplier = (1+bonus) * (1+number(input.perks.quick)*timingRules.quickPerkPerRank+room) * (1+number(masteries[mastery])*timingRules.masterySpeedPerRank) * (1+offhandBonus(skill));
                if (Number.isFinite(multiplier) && multiplier > 0 && multiplier <= 1e6) speedBonus[skill] = {multiplier};
            }
            timing.speedBonusKnown = Object.keys(timingRules.skillToolSlots).every(skill => Number.isFinite(speedBonus[skill]?.multiplier));
        }
        const luckBonus = {};
        if (object(input.luckBonus)) for (const skill of [...(data.skills || Object.keys(skills)), 'elsewhere']) {
            const value = input.luckBonus[skill];
            if (!object(value)) continue;
            const bonus = Number.isFinite(value.amulet) && value.amulet >= 0 && Number.isFinite(value.tool) && value.tool >= 0 ? value.amulet + value.tool : Number.isFinite(value.percent) ? value.percent / 100 : NaN;
            if (typeof bonus === 'number' && Number.isFinite(bonus) && bonus >= 0 && bonus <= 1e6) luckBonus[skill] = { bonus };
        }
        const luckSlots = timingRules.luckToolSlots, toolLuck = timingRules.toolLuckByRarity;
        const nativeLuckKnown = featureAvailable(data,'quality') && !exported && equipmentKnown && object(luckSlots) && Array.isArray(toolLuck) && toolLuck.length === rarityCount(data) && toolLuck.every(value=>Number.isFinite(value) && value >= 0) && ['amulet',...Object.values(luckSlots)].every(slot=>own(equipment,slot));
        if (nativeLuckKnown) {
            const amulet = equipment.amulet && decodeItem(equipment.amulet,data), item = amulet && itemMap(data).get(amulet.baseItemId);
            const amuletLuck = amulet ? number(item?.baseLuck)*timingRules.toolRarityMultipliers[amulet.rarity]*(1+timingRules.toolPlusPerLevel*amulet.plus) : 0;
            luckBonus.elsewhere = {bonus:amuletLuck};
            for (const [skill,slot] of Object.entries(luckSlots)) {
                const decoded = equipment[slot] && decodeItem(equipment[slot],data);
                luckBonus[skill] = {bonus:amuletLuck+(decoded ? toolLuck[decoded.rarity]+number(timingRules.toolLuckBonuses?.[decoded.baseItemId]) : 0)};
            }
        }
        let enhance = null, enhanceKnown = !exported && own(input,'enhance') && input.enhance === null;
        if (featureAvailable(data,'enhancing') && data.rules.forge && !exported && object(input.enhance)) {
            const state = input.enhance, decoded = decodeItem(state.itemId,data), item = itemMap(data).get(decoded?.baseItemId);
            if (item?.enhanceable && item.enhanceTier && integer(state.toPlus,1,data.rules.forge.maxPlus) && (!state.worn || equipment[state.worn] === state.itemId)) {
                enhance = {itemId:state.itemId,toPlus:state.toPlus,once:state.once === true,worn:state.worn || null,contract:state.contract === true,order:state.order === true,protectFrom:integer(state.protectFrom,data.rules.forge.protectionMinPlus,data.rules.forge.maxPlus) ? state.protectFrom : null,useCore:state.useCore === true,stopNoScrolls:state.stopNoScrolls === true};
                enhanceKnown = true;
            }
        }
        const work = !exported && Array.isArray(input.queue) && own(input, 'route') ? normalizeWorkOrders(input, data) : { orders:[], known:false };
        const combatKillSeconds = {};
        if (object(input.combatKillSeconds)) for (const [id,seconds] of Object.entries(input.combatKillSeconds)) {
            if (/^\d+$/.test(id) && integer(Number(id),1) && typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 && seconds <= MAX) combatKillSeconds[id] = seconds;
        }
        if (!featureAvailable(data,'work')) for (const key of Object.keys(speedBonus)) delete speedBonus[key];
        if (!featureAvailable(data,'quality')) for (const key of Object.keys(luckBonus)) delete luckBonus[key];
        const quality = qualityMultipliers(input,context,data,masteries);
        const character = {
            source: exported ? 'export' : 'snapshot',
            skills, bank, pack, collections, forgeLog, bankLocked, masteries, equipment, speedBonus, luckBonus, timing, combatKillSeconds, qualityMultipliers:quality.multipliers,
            coins: number(sourceCharacter.coins), ironman: sourceCharacter.ironman === true, workOrders:work.orders, enhance,
            completeness: { collections: errors.every(e => !e.startsWith('自产收藏')), forgeLog: hasForge, masteries:masteriesKnown, inventory: errors.every(e => !e.startsWith('仓库') && !e.startsWith('背包')), skills: object(input.skills), equipment:equipmentKnown, locks: hasLocks, speedBonus: Object.keys(speedBonus).length > 0, luckBonus:nativeLuckKnown || Object.keys(luckBonus).length > 0 }
        };
        if (featureAvailable(data,'combat') && typeof input.combatLuckMultiplier === 'number' && Number.isFinite(input.combatLuckMultiplier) && input.combatLuckMultiplier > 0 && input.combatLuckMultiplier <= 1e6) character.combatLuckMultiplier = input.combatLuckMultiplier;
        character.completeness.qualityModifiers = !exported && masteriesKnown && quality.known;
        if (character.completeness.qualityModifiers && nativeLuckKnown) character.combatLuckMultiplier = (1+luckBonus.elsewhere.bonus)*quality.combatBaseMultiplier;
        character.completeness.workOrders = work.known;
        character.completeness.enhance = enhanceKnown;
        if (typeof sourceCharacter.id === 'string' && sourceCharacter.id.length <= 128) character.id = sourceCharacter.id;
        if (typeof sourceCharacter.name === 'string' && sourceCharacter.name.length <= 100) character.name = sourceCharacter.name;
        return { ok: errors.length === 0, errors: [...new Set(errors)], character: errors.length ? null : character };
    }
    function collectionThresholds(itemId, data) {
        const rule=collectionRule(data);
        return itemMap(data).get(itemId)?.pet || own(rule?.firstOnlyRewards,itemId) ? rule.thresholds.slice(0,1) : rule?.thresholds || [];
    }
    function collectionStepPoints(itemId, rarity, index, data) {
        const rule=collectionRule(data);
        if (rule.excludedItemIds.includes(itemId)) return 0;
        if (itemMap(data).get(itemId)?.pet) return index===0 ? rule.petFirst : 0;
        const first=rule.firstOnlyRewards?.[itemId],multiplier=rule.rarityMultipliers[Math.max(rarity,rule.minimumRarity?.[itemId] || 0)];
        return first ? index===0 ? first.points*(first.rarityScaled ? multiplier : 1) : 0 : (rule.incrementPoints[index] || 0)*multiplier;
    }
    function collectionGain(current, target, itemId, rarity, data) {
        return collectionThresholds(itemId,data).reduce((sum,value,index)=>sum+(value>current&&value<=target?collectionStepPoints(itemId,rarity,index,data):0),0);
    }
    function nextMilestone(count, data = {}, itemId = 0) {
        if (!integer(count)) return null;
        const rule = collectionRule(data), item = itemMap(data).get(itemId);
        if (!Array.isArray(rule?.thresholds) || !rule.thresholds.length) return null;
        const thresholds = collectionThresholds(itemId,data);
        const index = thresholds.findIndex(n => n > count);
        return index < 0 ? null : { target: thresholds[index], index, remaining: thresholds[index] - count };
    }
    function collectionPoints(collections, data = {}) {
        const rule = collectionRule(data), items = itemMap(data);
        if (!baseRulesReady(data)) return null;
        let points = 0;
        for (const [key, qty] of Object.entries(collections || {})) {
            const decoded = decodeItem(Number(key), data);
            if (!decoded || !integer(qty) || qty === 0) continue;
            const item = items.get(decoded.baseItemId);
            if (!item || rule.excludedItemIds.includes(decoded.baseItemId) || decoded.plus || (decoded.rarity && !item.rarityable)) continue;
            points += collectionGain(0,qty,decoded.baseItemId,decoded.rarity,data);
        }
        return points;
    }
    function forgeStepPoints(tier, rarity, plus, data) {
        const rule = data?.rules?.forge;
        if (!rulesReady(data) || !featureAvailable(data,'enhancing') || !rule) return null;
        if (!integer(plus, 1, rule.maxPlusScored) || !integer(tier, 1, rule.tierWeights.length) || !integer(rarity, 0, rule.rarityWeights.length - 1)) return 0;
        return forgeStepValue(tier, rarity, plus, rule);
    }
    function forgeStepValue(tier, rarity, plus, rule) {
        return Math.max(rule.minPoints, Math.round(rule.tierWeights[tier - 1] * rule.rarityWeights[rarity] * rule.stepWeights[plus - 1] / rule.divisor));
    }
    function forgePoints(log, data) {
        if (!object(log) || !rulesReady(data) || !featureAvailable(data,'enhancing') || !data.rules.forge) return null;
        const rule = data.rules.forge, count = rarityCount(data);
        let points = 0;
        for (const [key, mask] of Object.entries(log)) {
            const code = Number(key);
            if (!integer(code, 0, rule.tierWeights.length*count-1) || !integer(mask, 0, 2 ** rule.loggedMaxPlus - 1)) continue;
            for (let plus = 1; plus <= rule.maxPlusScored; plus++) if (forgeHasStep(mask,plus)) points += forgeStepValue(Math.floor(code / count) + 1, code % count, plus, rule);
        }
        return points;
    }
    function recipeInputs(job, rarity, data) {
        const quality = new Set(job.qualityInputs || []);
        return job.inputs.map(input => ({ itemId:quality.has(input.itemId) ? encodeItem(input.itemId, rarity, 0, data) : input.itemId, qty:input.qty }));
    }
    function normalizeWorkOrders(state, data) {
        if (!Array.isArray(data?.jobs) || !rulesReady(data)) return {orders:[],known:false};
        const index = jobMap(data), jobs = index.map, orders = [];
        let known = Array.isArray(state.queue) && own(state, 'route'), quests = null;
        const add = (task, running = false) => {
            if (!task) return;
            if (task.kind === 'zone' || task.zoneId != null) {
                if (running && task.limit === 0) return;
                if (integer(task.zoneId,1)) {
                    const zone = data.zones?.find(zone=>zone.id === task.zoneId);
                    orders.push({kind:'combat',zoneId:task.zoneId,monsterId:zone?.monsterId ?? null,limit:integer(task.limit,1) ? task.limit : null,timed:!!(task.ticks || task.until),running});
                }
                return;
            }
            if (task.errand) {
                for (const job of index.grow) orders.push({jobId:job.id,rarity:null,limit:null,reservationOnly:true});
                if (task.after) add(task.after);
                return;
            }
            if (running && task.limit === 0) return;
            const isQuest = task.kind === 'quest' || task.questId !== undefined;
            if (isQuest && !quests) {
                quests = new Map();
                for (const rows of [state.quests?.daily,state.quests?.weekly]) if (Array.isArray(rows)) for (const quest of rows) if (object(quest) && !quests.has(quest.id)) quests.set(quest.id,quest);
            }
            const quest = isQuest && task.questId === task.questId ? quests.get(task.questId) : null;
            if (quest?.kind === 'kill') return;
            const job = jobs.get(task.jobId ?? quest?.jobId);
            if (!job) { known = false; return; }
            if (isQuest) { orders.push({jobId:job.id,rarity:0,limit:null,running,known:false}); return; }
            const rarity = task.rarity ?? 0, limit = task.limit === 0 || task.limit == null ? null : task.limit;
            if (!integer(rarity, 0, rarityCount(data)-1) || (limit !== null && !integer(limit, 1, 1e6))) {
                orders.push({jobId:job.id,rarity:integer(rarity,0,rarityCount(data)-1) ? rarity : null,limit:null,best:task.best===true,running,known:false});
                return;
            }
            orders.push({ jobId:job.id, rarity, limit, timed:!!(task.ticks || task.until), best:task.best === true, running });
        };
        if (state.route) add({ ...state.route, rarity:state.workRarity ?? 0 }, true);
        if (Array.isArray(state.queue) && state.queue.length <= 1000) for (const task of state.queue) add(task);
        else known = false;
        return { orders, known };
    }
    function reserveMaterials(character, data) {
        const reserved = {}, finite = {}, uncertain = new Set(), uncertainCounts = {}, selfOrders = new Map(), ambiguousJobs = new Set(), jobs = jobMap(data).map;
        for (const order of character.workOrders || []) {
            const job = jobs.get(order.jobId);
            if (!job || order.rarity !== null && !integer(order.rarity, 0, rarityCount(data)-1)) continue;
            const inputs = new Map(), unbounded = order.limit === null || order.timed || order.best;
            for (const rarity of order.best || order.rarity === null ? Array.from({length:rarityCount(data)},(_,index)=>index) : [order.rarity]) for (const input of recipeInputs(job, rarity, data)) {
                if (unbounded || integer(order.limit,1,1e6)) inputs.set(input.itemId,(inputs.get(input.itemId) || 0)+input.qty*(unbounded ? 1 : order.limit));
            }
            for (const [itemId, qty] of inputs) {
                if (unbounded) { uncertain.add(itemId); uncertainCounts[itemId] = (uncertainCounts[itemId] || 0)+1; }
                else finite[itemId] = Math.min(MAX,(finite[itemId] || 0)+qty);
                reserved[itemId] = uncertain.has(itemId) ? MAX : finite[itemId];
            }
            if (order.best || order.rarity === null || order.reservationOnly) ambiguousJobs.add(job.id);
            const key = `${job.id}:${order.rarity}`;
            selfOrders.set(key,selfOrders.has(key) || order.timed || order.best || order.known === false || order.reservationOnly ? null : {inputs,unbounded});
        }
        if (character.completeness?.enhance === false) for (const key of new Set([...Object.keys(character.bank),...Object.keys(character.pack)])) {
            const id = Number(key);
            if (number(character.bank[id])+number(character.pack[id]) > 0) { uncertain.add(id); uncertainCounts[id] = MAX; reserved[id] = MAX; }
        }
        return { reserved, uncertain, finite, uncertainCounts, selfOrders, ambiguousJobs };
    }
    function scheduledWork(orders) {
        if (!orders?.length) return null;
        const jobs = new Map();
        const add = (summary, order) => {
            summary.count++;
            summary.running ||= !!order.running;
            summary.batches += number(order.limit);
            if(order.known!==false&&!order.timed&&!order.best&&integer(order.limit,1)){
                summary.finiteBatches+=order.limit;
                if(order.running)summary.runningBatches+=order.limit;
            }else summary.unbounded=true;
        };
        const summary=()=>({count:0,running:false,batches:0,finiteBatches:0,runningBatches:0,unbounded:false});
        for (const order of orders || []) {
            if (order.kind === 'combat' || order.reservationOnly) continue;
            if (!jobs.has(order.jobId)) jobs.set(order.jobId,{all:summary(),unknownQuality:summary(),rarities:new Map()});
            const job = jobs.get(order.jobId);
            if (order.best || order.rarity === null) { add(job.unknownQuality,order); continue; }
            if (!job.rarities.has(order.rarity)) job.rarities.set(order.rarity,summary());
            add(job.all,order);
            add(job.rarities.get(order.rarity),order);
        }
        return jobs;
    }
    function available(character, id) {
        return Math.max(0, Math.min(MAX, number(character.bank[id]) + number(character.pack[id])) - number(character.reservations?.reserved[id]));
    }
    function materialsFor(inputs, batches, character, data, selfOrder = null) {
        const summed = new Map();
        for (const input of inputs) {
            if (!integer(input.itemId, 1, 1e9) || !integer(input.qty, 1) || !integer(input.qty * batches)) return null;
            summed.set(input.itemId, (summed.get(input.itemId) || 0) + input.qty * batches);
        }
        return [...summed].map(([itemId, need]) => {
            const item = itemMap(data).get(decodeItem(itemId, data)?.baseItemId), reservations = character.reservations;
            let reservationUncertain = reservations?.uncertain.has(itemId) || false, reserved = number(reservations?.reserved[itemId]);
            if (selfOrder) {
                reservationUncertain = number(reservations.uncertainCounts[itemId]) > (selfOrder.unbounded && selfOrder.inputs.has(itemId) ? 1 : 0);
                reserved = number(reservations.finite[itemId]);
                if (!selfOrder.unbounded && reserved < MAX) reserved = Math.max(0,reserved-number(selfOrder.inputs.get(itemId)));
            }
            const owned = Math.max(0,Math.min(MAX,number(character.bank[itemId])+number(character.pack[itemId]))-(reservationUncertain ? MAX : reserved));
            if (reservationUncertain) reserved = null;
            return { itemId, need, perBatch:need / batches, owned, reserved, reservationUncertain, bankOwned:number(character.bank[itemId]), packOwned:number(character.pack[itemId]), bankLocked:(character.bankLocked || []).includes(itemId), missing: Math.max(0, need - owned), marketTradable: !!item && item.marketTradable !== false };
        });
    }
    function purchaseCost(materials, prices, fixed = 0, fullRecipe = false) {
        let cost = fixed;
        for (const material of materials) {
            const qty = fullRecipe ? material.need : material.missing;
            if (qty <= 0) continue;
            const quote = prices && prices[material.itemId];
            const price = object(quote) ? quote.lowestSell : quote;
            if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || !material.marketTradable) return null;
            cost += qty * price;
            if (!Number.isFinite(cost) || cost > Number.MAX_SAFE_INTEGER) return null;
        }
        return cost;
    }
    function marketStockIssue(itemId, missing, quote) {
        return missing > 0 && object(quote) && integer(quote.sellQty,0,Number.MAX_SAFE_INTEGER) && missing > quote.sellQty ? {itemId,missing,sellQty:quote.sellQty} : null;
    }
    const missingMarketStock = (materials, prices) => {
        for (const material of materials) {
            const issue = marketStockIssue(material.itemId,material.missing,prices?.[material.itemId]);
            if (issue) return issue;
        }
        return null;
    };
    function rankTask(task, options = {}) {
        if (task.kind === 'forge') return forgeDifficulty(task);
        const seconds = task.rankingSeconds ?? task.expectedSeconds ?? task.seconds;
        const duration = Number.isFinite(seconds) ? Math.log10(1 + seconds / Math.max(1,task.rankingGain ?? task.gain)) * 400 : 6000;
        const production = isManufacturing(task);
        const purchase = task.materials.some(m => m.missing > 0) ? 260 : 0;
        const value = production && options.materialCostSort !== false ? task.materialCost == null ? 1200 : Math.log10(1 + task.materialCost / Math.max(1, task.gain)) * 240 : 0;
        return Math.round((task.locked ? 1e8 : 0) + (task.randomOutput ? task.rarity * 120 : 0) + purchase + value + task.levelReq * 2 + task.rarity * 150 + duration);
    }
    const isManufacturing = task => task.kind === 'craft' || task.kind === 'upgrade';
    const isDeferredCollection = task => (task.kind === 'gather' || task.kind === 'combat') && (task.rarity >= 3 || task.rarity === 2 && task.target >= 100 || task.rarity === 1 && task.target >= 10);
    const queueRank = task => task.queued || task.relatedWork ? task.queueStatus === 'running' ? 0 : 1 : 2;
    function qualityProbability(rarity, luck, data, multiplier = 1) {
        const cumulative = data.rules.qualityCumulative;
        const threshold = index => index === 0 ? 1 : Math.min(1,cumulative[index] * (1 + luck) * multiplier);
        return Math.max(0,threshold(rarity) - threshold(rarity + 1));
    }
    function farmEstimate(remaining, level, job, character, data) {
        const rule = data.rules.workTiming, yieldRule = rule.farmYield;
        const hoe = decodeItem(character.equipment?.hoe,data), tool = itemMap(data).get(hoe?.baseItemId)?.tool;
        const base = yieldRule ? yieldRule.base+yieldRule.levelThresholds.filter(value=>(level || 1)>=value).length : null;
        const low = yieldRule ? base : rule.farmMinYield, high = yieldRule ? base : rule.farmMaxYield;
        const extra = yieldRule ? (tool?.skill === 'farming' ? tool.baseBonus*rule.toolRarityMultipliers[hoe.rarity]*(1+rule.toolPlusPerLevel*hoe.plus)*yieldRule.toolMultiplier : 0) : Math.max(1,level || 1)/rule.farmYieldLevelDivisor;
        const whole = Math.floor(extra), fraction = extra-whole, mean = (low+high)/2+extra;
        let harvests,conservative=false;
        const yields=[];
        for(let qty=low;qty<=high;qty++){
            yields.push({qty:qty+whole,probability:(1-fraction)/(high-low+1)});
            if(fraction)yields.push({qty:qty+whole+1,probability:fraction/(high-low+1)});
        }
        const maxYield=Math.max(...yields.map(row=>row.qty));
        if(yields.every(row=>row.qty>=remaining))harvests=1;
        else if(remaining<=1000){
            const expected=new Float64Array(remaining+1);
            for(let n=1;n<=remaining;n++){
                expected[n]=1;
                for(const row of yields)expected[n]+=row.probability*expected[Math.max(0,n-row.qty)];
            }
            harvests=expected[remaining];
        }else if(maxYield>64){
            // Renewal overshoot is at most maxYield-1, so this is a bounded upper estimate.
            harvests=(remaining+maxYield-1)/mean;conservative=true;
        }else{
            const key=yields.map(row=>row.qty+':'+row.probability).join(','),memo=character.farmHarvestCache??=new Map();
            let model=memo.get(key);
            if(!model){
                const expected=new Float64Array(maxYield+1);
                for(let n=1;n<=maxYield;n++){expected[n]=1;for(const row of yields)expected[n]+=row.probability*expected[Math.max(0,n-row.qty)];}
                const transition=Array.from({length:maxYield+1},()=>Array(maxYield+1).fill(0));
                for(const row of yields)transition[0][row.qty-1]+=row.probability;
                transition[0][maxYield]=1;
                for(let index=1;index<maxYield;index++)transition[index][index-1]=1;
                transition[maxYield][maxYield]=1;
                model={initial:[...Array.from({length:maxYield},(_,index)=>expected[maxYield-index]),1],powers:[transition]};memo.set(key,model);
            }
            let vector=model.initial.slice(),power=0;
            for(let count=remaining-maxYield;count>0;count=Math.floor(count/2),power++){
                if(!model.powers[power]){const previous=model.powers[power-1];model.powers.push(previous.map(row=>row.map((_,column)=>row.reduce((sum,value,index)=>sum+value*previous[index][column],0))));}
                if(count%2===1)vector=model.powers[power].map(row=>row.reduce((sum,value,index)=>sum+value*vector[index],0));
            }
            harvests=vector[0];
        }
        const growth = Math.round(job.grow/(character.timing?.farmGrowthMultiplier || 1));
        return {harvests,conservative,batches:Math.max(1,Math.ceil(harvests)),seconds:harvests*(growth+2)*data.rules.tickMs/1000,meanYield:mean,growthSeconds:growth*data.rules.tickMs/1000};
    }
    function forgeEstimate(current, target, character, data, strategy = null) {
        if (!featureAvailable(data,'enhancing') || !data?.rules?.forge) return null;
        if (current >= target) return {attempts:0,steps:0,shardSteps:0,cores:0,scrolls:0,successChance:1,targetSuccessChance:1,totalSuccessChance:1,averageSuccessChance:1};
        const rule = data.rules.forge, skill = character.skills.enhancing?.level || 1;
        const multiplier = (rule.houseBonusEnabled ? 1+number(character.timing?.forgeHouseBonus) : 1) * (1+rule.successBonusPerSkillLevel*(skill-1)) * Math.min(rule.maxMasteryMultiplier,1+data.rules.workTiming.forgeMasteryPerRank*number(character.masteries?.enhance));
        const chanceAt = plus => {
            const tail = rule.successTail, base = tail && plus > tail.start ? tail.base*tail.decay**(plus-tail.start) : Math.max(rule.minBaseSuccess,1-plus*rule.baseSuccessReductionPerPlus);
            return Math.min(1,base*multiplier);
        };
        const useCore = strategy?.useCore === true && number(character.bank?.[rule.coreItemId])+number(character.pack?.[rule.coreItemId]) > 0;
        const protectFrom = integer(strategy?.protectFrom,rule.protectionMinPlus,rule.maxPlus) ? strategy.protectFrom : null;
        const values = Array.from({length:5},()=>new Float64Array(target+1));
        let logSuccess = 0;
        for (let plus = 0; plus < target; plus++) {
            const chance = chanceAt(plus), guarded = protectFrom !== null && plus >= protectFrom, core = useCore && plus >= rule.coreMinPlus;
            const failTo = guarded ? plus-1 : 0, costs = [1,plus+1,core ? 0 : plus+1,core ? 1 : 0,guarded ? 1-chance : 0];
            for (let index = 0; index < values.length; index++) values[index][plus+1] = values[index][plus]+(costs[index]+(1-chance)*(values[index][plus]-values[index][failTo]))/chance;
            if (plus >= current) logSuccess += Math.log(chance);
        }
        const [attempts,steps,shardSteps,cores,scrolls] = values.map(row=>row[target]-row[current]);
        return {attempts,steps,shardSteps,cores,scrolls,successChance:chanceAt(current),targetSuccessChance:chanceAt(target-1),totalSuccessChance:Math.exp(logSuccess),averageSuccessChance:Math.exp(logSuccess/(target-current)),secondsNeedsScrolls:protectFrom !== null && (Array.from({length:target},(_,plus)=>plus).some(plus=>plus>=protectFrom && chanceAt(plus)<1) || number(character.bank?.[rule.protectionItemId])+number(character.pack?.[rule.protectionItemId]) === 0 && (strategy?.stopNoScrolls === true || target > protectFrom))};
    }
    function forgeCostEstimate(task, prices) {
        const seeds = (task.materials || []).filter(material=>material.forgeSeed);
        const seedCost = purchaseCost(seeds,prices), cost = task.expectedGold+(seedCost ?? 0);
        return {forgeExpectedCost:task.expectedGold,forgeSeedTotalCost:seedCost !== null ? cost : null,forgeSeedPriceKnown:seedCost !== null};
    }
    function forgeSuccessPercent(task) {
        const chance = task.averageSuccessChance;
        return Number.isFinite(chance) && chance > 0 && chance <= 1 ? Math.round(chance*1000)/10 : null;
    }
    function forgeDifficulty(task) {
        const chance = task.averageSuccessChance;
        return Number.isFinite(chance) && chance > 0 && chance <= 1 ? (1-chance)*100 : Infinity;
    }
    function compareForge(a, b) {
        const chanceA = Number.isFinite(a.averageSuccessChance) && a.averageSuccessChance > 0 && a.averageSuccessChance <= 1 ? a.averageSuccessChance : -Infinity;
        const chanceB = Number.isFinite(b.averageSuccessChance) && b.averageSuccessChance > 0 && b.averageSuccessChance <= 1 ? b.averageSuccessChance : -Infinity;
        const delta = chanceB-chanceA;
        const goldA = Number.isFinite(a.expectedGold) && a.expectedGold >= 0 ? a.expectedGold : Infinity;
        const goldB = Number.isFinite(b.expectedGold) && b.expectedGold >= 0 ? b.expectedGold : Infinity;
        const costDelta = goldA-goldB;
        return Number(a.rarity === 4)-Number(b.rarity === 4) || (!Number.isNaN(delta) && delta) || number(a.tier)-number(b.tier) || (!Number.isNaN(costDelta) && costDelta) || number(a.expectedShards)-number(b.expectedShards) || number(a.targetPlus)-number(b.targetPlus) || number(a.rarity)-number(b.rarity) || String(a.id).localeCompare(String(b.id));
    }
    function sourceQualityProbability(source, rarity, luck, item, data, multiplier = 1) {
        if (source.quality === 'fixed') return rarity === (source.rarity ?? 0) ? 1 : 0;
        if (source.quality !== 'random') return null;
        if (!item.rarityable) return rarity === 0 ? 1 : 0;
        const floor = integer(source.qualityFloor,0,rarityCount(data)-1) ? source.qualityFloor : 0;
        if (rarity < floor) return 0;
        return rarity === floor ? Array.from({length:floor+1},(_,index)=>qualityProbability(index,luck,data,multiplier)).reduce((a,b)=>a+b,0) : qualityProbability(rarity,luck,data,multiplier);
    }
    function workContext(job, character, data, upgrade = null) {
        if (!featureAvailable(data,'work')) return {skill:character.skills[job.skill],skillLevel:character.skills[job.skill]?.level ?? null,failureChance:1,exportedMultiplier:null,hasSpeedBonus:false,speed:null,tickSeconds:data.rules.tickMs/1000,baseActionSeconds:null,actionSeconds:null,stunSeconds:0,qualityMultiplier:featureAvailable(data,'quality') ? character.qualityMultipliers?.[job.skill] ?? 1 : null,luck:featureAvailable(data,'quality') ? character.luckBonus?.[job.skill]?.bonus ?? character.luckBonus?.elsewhere?.bonus ?? 0 : null};
        const cached = character.workContexts?.get(job.id);
        if (cached) return cached;
        const skill = character.skills[job.skill], skillLevel = skill ? skill.level : null;
        const handsMultiplier = Math.max(0,1-data.rules.workTiming.handsPerRank*number(character.timing?.hands));
        const failureAt = rule => {
            const gap = rule ? rule.safeAtLevel-job.levelReq : 0;
            return gap > 0 ? Math.max(0,Math.min(1,rule.chanceAtReq*(1-((skillLevel || job.levelReq)-job.levelReq)/gap)*handsMultiplier)) : 0;
        };
        const caughtChance = failureAt(job.caught), failureChance = (1-caughtChance)*(1-failureAt(job.burn));
        let exportedMultiplier = character.speedBonus?.[job.skill]?.multiplier;
        let upgradeSpeedKnown = true;
        if (upgrade && data.rules.workTiming.offhandEnabled) {
            upgradeSpeedKnown = own(character.equipment || {},'shield');
            const shield = decodeItem(character.equipment?.shield,data), offhand = itemMap(data).get(shield?.baseItemId)?.offhand;
            const bonus = offhand?.skill === job.skill ? offhand.lift*data.rules.workTiming.toolRarityMultipliers[shield.rarity]*(1+data.rules.workTiming.toolPlusPerLevel*shield.plus) : 0;
            if (Number.isFinite(exportedMultiplier)) exportedMultiplier /= 1+bonus;
        }
        const hasSpeedBonus = typeof exportedMultiplier === 'number' && Number.isFinite(exportedMultiplier) && exportedMultiplier > 0 && exportedMultiplier <= 1e6;
        const speed = (1+Math.max(0,(skillLevel || 1)-job.levelReq)*data.rules.xp.speedPerLevelAboveRequirement)*(hasSpeedBonus ? exportedMultiplier : 1);
        const tickSeconds = data.rules.tickMs/1000, baseTicks = number(job.baseTicks);
        const baseActionSeconds = !job.grow && baseTicks > 0 ? baseTicks*tickSeconds : null;
        const actionSeconds = baseActionSeconds === null || upgrade && !upgradeSpeedKnown ? null : (upgrade ? Math.max(1,Math.round(baseTicks/speed)) : Math.max(1,baseTicks/speed))*tickSeconds;
        const context = {skill,skillLevel,failureChance,exportedMultiplier,hasSpeedBonus,speed,tickSeconds,baseActionSeconds,actionSeconds,stunSeconds:caughtChance*Math.max(0,number(job.caught?.stunTicks)-1)*tickSeconds,qualityMultiplier:character.qualityMultipliers?.[job.skill] ?? 1,luck:character.luckBonus?.[job.skill]?.bonus ?? character.luckBonus?.elsewhere?.bonus ?? 0};
        character.workContexts?.set(job.id,context);
        return context;
    }
    const clampProbability = value => Math.max(0,Math.min(1,value));
    function stirlingCorrection(value) {
        const inverse = 1/value, square = inverse*inverse;
        return inverse*(1/12+square*(-1/360+square*(1/1260+square*(-1/1680+square/1188))));
    }
    function logBeta(a,b) {
        let adjustment = 0;
        while (a < 8) {adjustment += Math.log(a+b)-Math.log(a);a++;}
        while (b < 8) {adjustment += Math.log(a+b)-Math.log(b);b++;}
        const sum = a+b;
        let logA,logB;
        if (a <= b) {logA=Math.log(a/sum);logB=Math.log1p(-a/sum);}
        else {logB=Math.log(b/sum);logA=Math.log1p(-b/sum);}
        return adjustment+(a-.5)*logA+(b-.5)*logB-.5*Math.log(sum)+.9189385332046727+stirlingCorrection(a)+stirlingCorrection(b)-stirlingCorrection(sum);
    }
    function normalTail(value) {
        const absolute = Math.abs(value), t = 1/(1+.2316419*absolute);
        const tail = .3989422804014327*Math.exp(-absolute*absolute/2)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
        return clampProbability(value >= 0 ? tail : 1-tail);
    }
    function regularizedBeta(x,a,b) {
        if (!(a > 0 && b > 0) || !Number.isFinite(a+b) || !Number.isFinite(x)) return NaN;
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        if (a === 1) return -Math.expm1(b*Math.log1p(-x));
        if (b === 1) return Math.exp(a*Math.log(x));
        if (a === b && x === .5) return .5;
        if (x > (a+1)/(a+b+2)) return clampProbability(1-regularizedBeta(1-x,b,a));
        const tiny = 1e-300;
        let c = 1, d = 1-(a+b)*x/(a+1);
        if (Math.abs(d) < tiny) d = tiny;
        d = 1/d;
        let fraction = d, converged = false;
        for (let index = 1; index <= 512; index++) {
            let term = index*(b-index)*x/((a+2*index-1)*(a+2*index));
            d = 1+term*d;
            if (Math.abs(d) < tiny) d = tiny;
            c = 1+term/c;
            if (Math.abs(c) < tiny) c = tiny;
            d = 1/d;
            fraction *= d*c;
            term = -(a+index)*(a+b+index)*x/((a+2*index)*(a+2*index+1));
            d = 1+term*d;
            if (Math.abs(d) < tiny) d = tiny;
            c = 1+term/c;
            if (Math.abs(c) < tiny) c = tiny;
            d = 1/d;
            const change = d*c;
            fraction *= change;
            if (Math.abs(change-1) < 3e-14) {converged=true;break;}
        }
        const value = Math.exp(a*Math.log(x)+b*Math.log1p(-x)-logBeta(a,b))*fraction/a;
        if (converged && Number.isFinite(value)) return clampProbability(value);
        const mean = a/(a+b), deviation = Math.sqrt(a*b/((a+b)**2*(a+b+1)));
        return 1-normalTail((x-mean)/deviation);
    }
    function negativeBinomialTail(successes,successChance,required) {
        if (required <= 0) return 1;
        if (successes <= 0 || successChance >= 1) return 0;
        if (successChance <= 0) return 1;
        return regularizedBeta(1-successChance,required,successes);
    }
    function binomialTail(trials,chance,required) {
        if (required <= 0) return 1;
        if (required > trials || chance <= 0) return 0;
        if (chance >= 1) return 1;
        return regularizedBeta(chance,required,trials-required+1);
    }
    function rankingSeconds(task) {
        const seconds = task.expectedSeconds ?? task.seconds;
        if (!Number.isFinite(seconds) || seconds < 0) return null;
        const successes = task.minimumBatches, mean = task.expectedActions;
        if (task.kind === 'forge' || task.kind === 'farm' || !Number.isSafeInteger(successes) || successes < 1 || !Number.isFinite(mean) || mean <= successes) return seconds;
        const chance = successes/mean;
        let lower = successes, upper = Math.ceil(mean);
        if (!Number.isSafeInteger(upper)) return seconds;
        if (successes === 1) {
            upper = Math.ceil(Math.log(.1)/Math.log1p(-chance));
            if (!Number.isSafeInteger(upper)) return seconds;
            if (upper > 1 && binomialTail(upper-1,chance,1) >= .9-1e-12) upper--;
        } else {
            while (binomialTail(upper,chance,successes) < .9) {
                if (upper === Number.MAX_SAFE_INTEGER) return seconds;
                upper = Math.min(Number.MAX_SAFE_INTEGER,upper*2);
            }
            while (lower < upper) {
                const middle = lower+Math.floor((upper-lower)/2);
                if (binomialTail(middle,chance,successes) >= .9) upper = middle;
                else lower = middle+1;
            }
        }
        const estimate = seconds*Math.max(1,upper/mean);
        return Number.isFinite(estimate) ? estimate : seconds;
    }
    function jointThresholdEstimate(successes,targetChance,companionChance,required,jointChance=0) {
        if (![successes,required].every(Number.isSafeInteger) || successes < 0 || required < 0 || ![targetChance,companionChance,jointChance].every(Number.isFinite) || targetChance <= 0 || targetChance > 1 || companionChance < 0 || companionChance > 1 || jointChance < Math.max(0,targetChance+companionChance-1)-1e-12 || jointChance > Math.min(targetChance,companionChance)+1e-12) return {probability:NaN,approximate:false};
        if (required === 0) return {probability:1,approximate:false};
        if (successes === 0 || companionChance === 0) return {probability:0,approximate:false};
        const overlap = Math.max(0,Math.min(targetChance,companionChance,jointChance));
        if (required === 1) {
            const noCompanion = (targetChance-overlap)/(targetChance+companionChance-overlap);
            return {probability:clampProbability(-Math.expm1(successes*Math.log(noCompanion))),approximate:false};
        }
        const simultaneousChance = overlap/targetChance;
        const raceSuccess = targetChance/(targetChance+companionChance-overlap);
        if (simultaneousChance === 0) return {probability:negativeBinomialTail(successes,raceSuccess,required),approximate:false};
        if (simultaneousChance === 1) return {probability:negativeBinomialTail(successes,raceSuccess,required-successes),approximate:false};
        if (raceSuccess === 1) return {probability:binomialTail(successes,simultaneousChance,required),approximate:false};
        const terms = Math.min(successes,required-1)+1;
        if (terms > 128) {
            const mean = successes*(simultaneousChance+(1-raceSuccess)/raceSuccess);
            const variance = successes*(simultaneousChance*(1-simultaneousChance)+(1-raceSuccess)/(raceSuccess*raceSuccess));
            const probability = variance > 0 ? normalTail((required-.5-mean)/Math.sqrt(variance)) : Number(mean >= required);
            return {probability,approximate:true};
        }
        let probability = binomialTail(successes,simultaneousChance,required);
        let logMass = successes*Math.log1p(-simultaneousChance);
        for (let count = 0; count < terms; count++) {
            probability += Math.exp(logMass)*negativeBinomialTail(successes,raceSuccess,required-count);
            logMass += Math.log(successes-count)-Math.log(count+1)+Math.log(simultaneousChance)-Math.log1p(-simultaneousChance);
        }
        return {probability:clampProbability(probability),approximate:false};
    }
    const jointThresholdChance = (...args) => jointThresholdEstimate(...args).probability;
    function* collectionBenefitSteps(tasks, character, data) {
        const actions = new Map(), rule = collectionRule(data), items = itemMap(data), jobs = jobMap(data).map;
        for (const source of data.collectionSources || []) {
            if (!taskAvailable(source,data,character)) continue;
            const item = items.get(source.itemId), job = jobs.get(source.jobId);
            if (!item || item.pet || source.pet || source.retired || job?.retired || source.qty !== 1 || rule.excludedItemIds.includes(item.id)) continue;
            const combat = source.kind === 'combat';
            if (!combat && (source.kind !== 'job' || !job || job.inputs.length || job.grow)) continue;
            const context = combat ? null : workContext(job,character,data);
            const multiplier = source.chanceMode === 'combatLuck' ? character.combatLuckMultiplier : 1;
            if (!(multiplier > 0) || !Number.isFinite(multiplier)) continue;
            const key = combat ? `combat:${source.monsterId}` : `job:${source.jobId}`;
            if (!actions.has(key)) actions.set(key,[]);
            for (let rarity = 0; rarity < (item.rarityable ? rarityCount(data) : 1); rarity++) {
                const quality = sourceQualityProbability(source,rarity,combat ? character.luckBonus?.elsewhere?.bonus || 0 : context.luck,item,data,combat ? character.qualityMultipliers?.combat ?? 1 : context.qualityMultiplier);
                const probability = Math.min(1,source.chance*multiplier)*quality;
                if (!(probability > 0 && probability <= 1)) continue;
                const itemId = encodeItem(item.id,rarity,0,data), current = character.collections[itemId] || 0;
                actions.get(key).push({itemId,baseItemId:item.id,current,rarity,branch:source.sourceType,probability});
            }
        }
        let processed = 0;
        for (const task of tasks) {
            if (++processed % 32 === 0) yield;
            task.rankingGain = task.gain;
            if (task.kind === 'forge') continue;
            task.rankingSeconds = rankingSeconds(task);
            const benefits = [];
            const thresholds=collectionThresholds(task.baseItemId,data);
            for (let index = 0; index < thresholds.length; index++) {
                const threshold = thresholds[index];
                if (threshold > task.current && threshold <= task.target) benefits.push({key:`${task.itemId}:${threshold}`,gain:collectionStepPoints(task.baseItemId,task.rarity,index,data),probability:1});
            }
            task.collectionBenefits = benefits;
            if (!['gather','combat'].includes(task.kind) || !(task.outputChance > 0) || !integer(task.minimumBatches,1)) continue;
            const key = task.kind === 'combat' ? `combat:${task.monsterId}` : `job:${task.jobId}`;
            const outcomes = actions.get(key), target = outcomes?.find(row=>row.itemId === task.itemId && row.branch === (task.sourceType || 'output'));
            if (!target) continue;
            for (const row of outcomes) for (const [index,threshold] of collectionThresholds(row.baseItemId,data).entries()) {
                if (threshold <= row.current || row.itemId === task.itemId) continue;
                const probability = jointThresholdChance(task.minimumBatches,task.outputChance,row.probability,threshold-row.current,row.branch === target.branch ? 0 : task.outputChance*row.probability);
                if (!(probability > 1e-12)) continue;
                benefits.push({key:`${row.itemId}:${threshold}`,gain:collectionStepPoints(row.baseItemId,row.rarity,index,data),probability});
            }
            task.rankingGain = Math.max(task.gain,benefits.reduce((sum,row)=>sum+row.gain*row.probability,0));
        }
    }
    function makeCollectionTask(job, rarity, character, data, options, upgrade = null, source = null, collect = null) {
        if(!upgrade&&!taskAvailable({kind:'job',jobId:job.id,sourceType:source?.sourceType},data,character))return null;
        const baseItemId = job.output.itemId, items = itemMap(data), item = items.get(baseItemId);
        if (!item || item.pet || source?.sourceType === 'pet' || data.rules.collection.excludedItemIds.includes(baseItemId) || data.rules.collection.unplannableItemIds?.includes(baseItemId) || (!item.rarityable && rarity > 0) || job.retired || !source && !upgrade && job.fixedOutputRarity !== undefined && rarity !== job.fixedOutputRarity) return null;
        const itemId = encodeItem(baseItemId, rarity, 0, data), current = character.collections[itemId] || 0;
        const next = nextMilestone(current,data,baseItemId);
        if (!next || !integer(job.output.qty,1)) return null;
        const basicGather = !source && !upgrade && !job.grow && job.inputs.length === 0 && data.skillGroups.gather.includes(job.skill);
        const {skill,skillLevel,failureChance,exportedMultiplier,hasSpeedBonus,speed,tickSeconds,baseActionSeconds,actionSeconds,stunSeconds,luck,qualityMultiplier} = workContext(job,character,data,upgrade);
        const sourceQuality = source ? sourceQualityProbability(source,rarity,luck,item,data,qualityMultiplier) : null;
        if (source && (!(source.chance > 0 && source.chance <= 1) || !Number.isFinite(source.chance) || !(sourceQuality > 0))) return null;
        const sourceChance = source ? Math.min(1,source.chance * sourceQuality) : 1;
        const failurePossible = failureChance < 1;
        const productionRarity = source ? 0 : job.inputs.length ? rarity : 0;
        const inputs = recipeInputs(job, productionRarity, data);
        if (upgrade) {
            inputs.length = 0;
            inputs.push({ itemId: encodeItem(upgrade.from, rarity, 0, data), qty: 1 });
            for (const extra of upgrade.extra || []) {
                const extraItem = items.get(extra.itemId);
                inputs.push({ itemId: extra.perTier && extraItem && extraItem.rarityable ? encodeItem(extra.itemId, rarity, 0, data) : extra.itemId, qty: extra.qty * (extra.perTier && !(extraItem && extraItem.rarityable) ? rarity + 1 : 1) });
            }
        }
        const locked = skillLevel === null || skillLevel < job.levelReq;
        const randomOutput = source ? sourceChance < 1 || source.quality === 'random' && !!item.rarityable : job.fixedOutputRarity === undefined && inputs.length === 0 && !!item.rarityable;
        const uncertainAttempts = randomOutput || failurePossible;
        const outputChance = source ? sourceChance : randomOutput ? qualityProbability(rarity,luck,data,qualityMultiplier) : 1;
        // Input-saving tools only waive consumption; the full recipe remains a safe material ceiling.
        const materialsConservative = !upgrade && conservativeWorkMaterials(job,character,data);
        const reservations = character.reservations;
        const selfOrder = !source && !upgrade && inputs.length && character.completeness?.workOrders !== false && !reservations.ambiguousJobs.has(job.id) ? reservations.selfOrders.get(`${job.id}:${productionRarity}`) : null;
        const rule = collectionRule(data), farmBase = job.grow && source ? farmEstimate(1,skillLevel,job,character,data) : null;
        const build = milestone => {
            const bulk = milestone.target > next.target;
            const farm = job.grow ? source ? (()=>{
                const harvests = Math.ceil(milestone.remaining/job.output.qty)/sourceChance;
                return {...farmBase,harvests,batches:Math.ceil(harvests),seconds:harvests*(farmBase.growthSeconds+2*data.rules.tickMs/1000),meanYield:job.output.qty*sourceChance};
            })() : farmEstimate(milestone.remaining,skillLevel,job,character,data) : null;
            const minimumBatches = farm ? farm.batches : Math.ceil(milestone.remaining / job.output.qty), batches = minimumBatches;
            const expectedActions = farm ? farm.harvests : outputChance > 0 && failureChance > 0 ? minimumBatches / outputChance / failureChance : null;
            const estimatedBatches = expectedActions === null ? null : Math.ceil(expectedActions);
            const materials = estimatedBatches === null ? null : materialsFor(inputs, estimatedBatches, character, data, selfOrder);
            if (!materials) return null;
            let expectedSeconds = !farm && actionSeconds === null || expectedActions === null ? null : farm ? farm.seconds : expectedActions * (actionSeconds+stunSeconds);
    
            if (Number.isFinite(expectedSeconds) && !farm && !upgrade && !locked && inputs.length === 0 && skill?.xp === 0 && job.xp > 0) expectedSeconds += (tickSeconds-actionSeconds)/failureChance;
            if (!Number.isFinite(expectedSeconds) || expectedSeconds > MAX) expectedSeconds = null;
            let seconds = farm || uncertainAttempts || actionSeconds === null ? null : batches * actionSeconds;
            if (!Number.isFinite(seconds) || seconds > MAX) seconds = null;
            const gain = collectionGain(current,milestone.target,baseItemId,rarity,data);
            const cost = purchaseCost(materials, options.prices);
            const materialCost = purchaseCost(materials, options.prices, 0, true);
            const task = {
                id: `collection:${itemId}:${milestone.target}:${source ? source.id : upgrade ? 'upgrade-' + upgrade.recipe : job.id}`,
                kind: upgrade ? 'upgrade' : job.grow ? 'farm' : inputs.length ? 'craft' : 'gather',
                title: `${(data.rules.rarityNamesZh || [])[rarity] || ''}${item.nameZh || item.name} · 自产累计 ${milestone.target}`,
                itemId, baseItemId, rarity, current, target: milestone.target, remaining: milestone.remaining, gain,
                jobId: upgrade ? upgrade.job || null : job.id, skill: job.skill, levelReq: job.levelReq, locked, productionRarity,
                materials, batches, minimumBatches, expectedActions, estimatedBatches, materialsEstimated:!!farm || uncertainAttempts || materialsConservative, ...(materialsConservative ? {materialsConservative:true} : {}), bulk, uncertainAttempts, stopMode:basicGather || uncertainAttempts ? 'endless' : 'count', seconds, expectedSeconds, actionSeconds, baseActionSeconds, speedMultiplier:farm ? null : hasSpeedBonus ? exportedMultiplier : null, outputChance, ...(farm ? {farmHarvests:farm.harvests,farmMeanYield:farm.meanYield,farmGrowthSeconds:farm.growthSeconds,farmCycleSeconds:farm.growthSeconds+2*tickSeconds} : {}), secondsConservative:!!farm?.conservative,secondsBaseline:farm ? character.timing?.farmGrowthMultiplier == null || !own(character.equipment || {},'hoe') : !hasSpeedBonus || failurePossible && character.timing?.hands == null || randomOutput && (!character.completeness?.qualityModifiers || !character.completeness?.luckBonus), secondsEstimated: true, cost, costKnown: cost !== null, costEstimated: true, materialCost, materialCostPerPoint:materialCost === null ? null : materialCost / Math.max(1,gain), coinCost: 0,
                randomOutput, progress: Math.min(1, current / milestone.target)
            };
            if (source) Object.assign(task,{sourceId:source.id,sourceType:source.sourceType,sourceKind:'job',sourceJobId:job.id,actionName:job.nameZh || job.name});
            const work = !upgrade && character.scheduledWork?.get(job.id);
            const scheduled = work && (inputs.length === 0 ? work.all : work.rarities.get(rarity));
            task.queueQualityUnknown = !scheduled?.count && !!work?.unknownQuality?.count;
            const status = task.queueQualityUnknown ? work.unknownQuality : scheduled;
            task.relatedWork = randomOutput && rarity > 0 && !!scheduled?.count || task.queueQualityUnknown;
            task.queued = !!scheduled?.count && !task.relatedWork;
            task.queueStatus = status?.running ? 'running' : status?.count ? 'queued' : null;
            task.queuedBatches = status?.batches || 0;
            if(!upgrade&&inputs.length&&!job.grow){
                const exact=work?.rarities.get(productionRarity),primary=!source||source.sourceType==='output';
                const finite=!!exact?.count&&!exact.unbounded&&!uncertainAttempts;
                const covered=finite&&minimumBatches<=exact.finiteBatches;
                const runningCovered=finite&&minimumBatches<=exact.runningBatches;
                task.queued=primary&&!!exact?.count&&(covered||!bulk);
                task.relatedWork=false;
                task.queueQualityUnknown=false;
                task.queueStatus=task.queued?(runningCovered||!covered&&exact.running?'running':'queued'):null;
                task.queuedBatches=task.queued?exact.batches:0;
                task.queueReachable=task.queued&&finite?covered:null;
            }
            if (upgrade) { task.recipeId = upgrade.recipe; task.predecessorItemId = encodeItem(upgrade.from, rarity, 0, data); }
            return task;
        };
        const task = build(next);
        if (!task) return null;
        if (collect) collect(task);
        if (!collect && (task.queued || task.relatedWork)) { task.difficulty = rankTask(task,options); return task; }
        let best = task;
        for (const threshold of collectionThresholds(baseItemId,data)) {
            if (threshold <= next.target) continue;
            const candidate = build({target:threshold,remaining:threshold-current});
            if (!candidate) continue;
            if (collect) {
                if ((task.queued || task.relatedWork) && task.kind !== 'craft') { candidate.queued = false; candidate.relatedWork = true; }
                collect(candidate); continue;
            }
            const ready = row => !missingMarketStock(row.materials,options.prices) && row.materials.every(material=>!material.missing || material.marketTradable && !character.ironman);
            let delta = Number(ready(best))-Number(ready(candidate));
            if (!delta && isManufacturing(task) && options.materialCostSort !== false) delta = (candidate.materialCost ?? Infinity)/candidate.gain-(best.materialCost ?? Infinity)/best.gain;
            if (!delta || Number.isNaN(delta)) delta = (candidate.expectedSeconds ?? candidate.seconds ?? Infinity)/candidate.gain-(best.expectedSeconds ?? best.seconds ?? Infinity)/best.gain;
            if (delta < 0) best = candidate;
        }
        if (!collect) best.difficulty = rankTask(best,options);
        return best;
    }
    function makeCombatTask(source, rarity, character, data, options, monster, collect = null) {
        const item = itemMap(data).get(source.itemId);
        if (!item || !monster || data.rules.collection.excludedItemIds.includes(item.id) || rarity > 0 && !item.rarityable || !integer(source.qty,1) || !(source.chance > 0 && source.chance <= 1) || !Number.isFinite(source.chance)) return null;
        const itemId = encodeItem(item.id,rarity,0,data), current = character.collections[itemId] || 0, next = nextMilestone(current,data,item.id);
        if (!next) return null;
        const qualityChance = sourceQualityProbability(source,rarity,character.luckBonus?.elsewhere?.bonus || 0,item,data,character.qualityMultipliers?.combat ?? 1);
        if (!(qualityChance > 0)) return null;
        const multiplier = source.chanceMode === 'combatLuck' ? character.combatLuckMultiplier : 1;
        const outputChance = Number.isFinite(multiplier) && multiplier > 0 ? Math.min(1,source.chance*multiplier)*qualityChance : null;
        const measured = character.combatKillSeconds?.[source.monsterId], actionSeconds = Number.isFinite(measured) && measured > 0 ? measured : null;
        const zoneIds = Array.isArray(source.zoneIds) ? source.zoneIds.filter(id=>integer(id,1)) : [];
        const orders = (character.workOrders || []).filter(order=>order.kind === 'combat' && (order.monsterId === source.monsterId || zoneIds.includes(order.zoneId)));
        const activeOrder = orders.find(order=>order.running) || orders[0];
        const build = milestone => {
            const minimumBatches = Math.ceil(milestone.remaining/source.qty), expectedKills = outputChance > 0 ? minimumBatches/outputChance : null;
            const duration = expectedKills !== null && actionSeconds !== null ? expectedKills*actionSeconds : null;
            const expectedSeconds = Number.isFinite(duration) && duration <= MAX ? duration : null;
            const gain = collectionGain(current,milestone.target,item.id,rarity,data), bulk = milestone.target > next.target;
            const task = {
                id:`collection:${itemId}:${milestone.target}:${source.id}`, kind:'combat',
                title:`${(data.rules.rarityNamesZh || [])[rarity] || ''}${item.nameZh || item.name} · 自产累计 ${milestone.target}`,
                itemId,baseItemId:item.id,rarity,current,target:milestone.target,remaining:milestone.remaining,gain,
                skill:'combat',levelReq:0,locked:false,jobId:null,monsterId:source.monsterId,zoneId:activeOrder?.zoneId ?? zoneIds[0] ?? null,zoneIds,
                sourceId:source.id,sourceType:source.sourceType,sourceKind:'combat',actionName:monster.nameZh || monster.name,
                materials:[],batches:expectedKills === null ? minimumBatches : Math.ceil(expectedKills),minimumBatches,expectedKills,expectedActions:expectedKills,bulk,stopMode:'endless',
                seconds:null,expectedSeconds,actionSeconds,baseActionSeconds:null,speedMultiplier:null,secondsBaseline:!character.completeness?.qualityModifiers || !character.completeness?.luckBonus,secondsEstimated:true,
                outputChance,randomOutput:outputChance !== 1,uncertainAttempts:outputChance !== 1,
                cost:0,costKnown:true,costEstimated:true,materialCost:0,materialCostPerPoint:0,coinCost:0,
                queued:!bulk && orders.length > 0,relatedWork:bulk && orders.length > 0,queueStatus:orders.some(order=>order.running) ? 'running' : orders.length ? 'queued' : null,queuedBatches:orders.reduce((sum,order)=>sum+number(order.limit),0),
                progress:Math.min(1,current/milestone.target),
            };
            task.difficulty = rankTask(task,options);
            return task;
        };
        const task = build(next);
        if (collect) for (const target of collectionThresholds(item.id,data)) {
            if (target <= current) continue;
            collect(target === next.target ? task : build({target,remaining:target-current}));
        }
        return task;
    }
    function makeManualCollectionTask(source, character, data, options) {
        const item = itemMap(data).get(source.itemId);
        if (!item?.pet || data.rules.collection.excludedItemIds.includes(item.id)) return null;
        const itemId = encodeItem(item.id,0,0,data), current = character.collections[itemId] || 0;
        if (!nextMilestone(current,data,item.id)) return null;
        const task = {
            id:`collection:${itemId}:1:${source.id}`,kind:'enhance',skill:source.skill || 'enhancing',title:`${item.nameZh || item.name} · 首次自产`,
            itemId,baseItemId:item.id,rarity:0,current,target:1,remaining:1,gain:data.rules.collection.petFirst,
            sourceId:source.id,sourceKind:source.kind,sourceType:source.sourceType,actionName:'强化尝试',jobId:null,levelReq:0,locked:false,
            materials:[],batches:1,minimumBatches:1,bulk:false,stopMode:'endless',seconds:null,expectedSeconds:null,actionSeconds:null,
            outputChance:source.chance,randomOutput:true,uncertainAttempts:true,cost:null,costKnown:false,costEstimated:true,materialCost:null,materialCostPerPoint:null,coinCost:0,
            queued:false,relatedWork:false,manual:true,routeUnsupported:true,progress:0
        };
        task.difficulty = rankTask(task,options);
        return task;
    }
    function* makeForgeTaskSteps(character, data, options) {
        if (!featureAvailable(data,'enhancing') || !object(character.forgeLog) || !data.rules.forge) return [];
        const rule = data.rules.forge, tasks = [], tiers = catalog(data).forge;
        const enhancing = character.enhance, enhanced = decodeItem(enhancing?.itemId,data), enhancedItem = itemMap(data).get(enhanced?.baseItemId);
        const plusLimit = Math.min(rule.maxPlusScored, integer(options.maxForgePlus, 1, rule.maxPlusScored) ? options.maxForgePlus : rule.maxPlusScored);
        const estimates = new Map();
        const estimateFor = (current,target,strategy) => {
            const key = `${current}:${target}:${strategy?.protectFrom ?? ''}:${strategy?.useCore === true}`;
            if (!estimates.has(key)) estimates.set(key,forgeEstimate(current,target,character,data,strategy));
            return estimates.get(key);
        };
        for (let tier = 1; tier <= rule.tierWeights.length; tier++) for (let rarity = 0; rarity < rule.rarityWeights.length; rarity++) {
            const forgeKey = (tier - 1) * rarityCount(data) + rarity, mask = character.forgeLog[forgeKey] || 0;
            const targets = [];
            for (let plus = 1; plus <= plusLimit; plus++) {
                if (forgeHasStep(mask,plus)) continue;
                targets.push(plus);
                if (options.allMilestones !== true) break;
            }
            for (const targetPlus of targets) {
                const running = enhancedItem?.enhanceTier === tier && enhanced.rarity === rarity && targetPlus > enhanced.plus && targetPlus <= enhancing.toPlus && (!enhancing.once || targetPlus === enhanced.plus+1);
                const candidates = tiers.get(tier)?.[rarity === 0 ? 0 : 1];
                if (!candidates?.length) continue;
                let best = null;
                for (const item of candidates) {
                    yield;
                    if (running && item.id !== enhanced.baseItemId) continue;
                    let currentPlus = running ? enhanced.plus : 0, seedId = running ? enhancing.itemId : encodeItem(item.id, rarity, 0, data), seedOwned = 0;
                    for (let plus = targetPlus - 1; !running && plus >= 0; plus--) {
                        const id = encodeItem(item.id, rarity, plus, data), count = available(character,id);
                        if (count > 0) { currentPlus = plus; seedId = id; seedOwned = count; break; }
                    }
                    const minimumSteps = (targetPlus-currentPlus)*(targetPlus+currentPlus+1)/2;
                    const coreStart = Math.max(currentPlus,rule.coreMinPlus ?? targetPlus), coreStock = number(character.bank?.[rule.coreItemId])+number(character.pack?.[rule.coreItemId]);
                    const cores = running && enhancing.useCore ? Math.min(coreStock,Math.max(0,targetPlus-coreStart)) : 0;
                    const shards = rule.shardsPerPlus[tier-1]*(minimumSteps-cores*(2*coreStart+cores+1)/2);
                    let gold = rule.goldTierWeights[tier-1]*rule.goldRarityWeights[rarity]*minimumSteps;
                    const inputs = [{ itemId: seedId, qty: 1 }];
                    if (shards && integer(rule.shardItemId, 1)) inputs.push({ itemId: rule.shardItemId, qty: shards });
                    if (cores) inputs.push({itemId:rule.coreItemId,qty:cores});
                    const external = running && (enhancing.contract || enhancing.order);
                    const materials = materialsFor(external ? inputs.filter(input=>input.itemId !== seedId) : inputs, 1, character, data);
                    if (!materials) continue;
                    if (external) gold = 0;
                    const seed = materials.find(material => material.itemId === seedId), seedEquipped = !!(running && enhancing.worn);
                    if (seed) {
                        seed.forgeSeed = true;
                        seed.seedEquipped = seedEquipped;
                        seed.needsDeposit = !running && seed.owned > 0 && Math.max(0,number(character.bank[seedId])-number(character.reservations?.reserved[seedId])) < 1;
                        if (seedEquipped) {seed.owned++;seed.missing=Math.max(0,seed.need-seed.owned);}
                    }
                    const cost = purchaseCost(materials, options.prices, gold);
                    const materialCost = purchaseCost(materials, options.prices, gold, true);
                    const stockIssue = missingMarketStock(materials,options.prices);
                    const estimate = estimateFor(currentPlus,targetPlus,running ? enhancing : null);
                    const economics = {id:String(item.id),materials,forgeShardItemId:rule.shardItemId,targetPlus,rarity,tier,nextSuccessChance:estimate.successChance,targetSuccessChance:estimate.targetSuccessChance,totalSuccessChance:estimate.totalSuccessChance,averageSuccessChance:estimate.averageSuccessChance,expectedGold:estimate.steps*rule.goldTierWeights[tier-1]*rule.goldRarityWeights[rarity],expectedShards:estimate.shardSteps*rule.shardsPerPlus[tier-1],expectedCores:estimate.cores,expectedScrolls:estimate.scrolls};
                    const forgeCosts = forgeCostEstimate(economics,options.prices);
                    Object.assign(economics,forgeCosts);
                    const seedCostDelta = (economics.forgeSeedTotalCost ?? Infinity)-(best?.economics.forgeSeedTotalCost ?? Infinity);
                    const seedOrder = Number(!seedOwned)-Number(!best?.seedOwned) || (!Number.isNaN(seedCostDelta) && seedCostDelta) || (best ? compareForge(economics,best.economics) : -1);
                    if (!best || !stockIssue && best.stockIssue || !!stockIssue === !!best.stockIssue && seedOrder < 0) best = { item, seedId, seedOwned, currentPlus, materials, gold, cost, materialCost, estimate,economics,forgeCosts,stockIssue,needsDeposit:seed?.needsDeposit || false };
                }
                if (!best) continue;
                const current = Array.from({ length: targetPlus }, (_, index) => Math.floor(mask / 2 ** index) % 2).reduce((sum, n) => sum + n, 0);
                const collectionBenefits = [];
                for (let plus = best.currentPlus+1; plus <= targetPlus; plus++) if (!forgeHasStep(mask,plus)) {
                    collectionBenefits.push({key:`forge:${forgeKey}:${plus}`,gain:forgeStepValue(tier,rarity,plus,rule),probability:1});
                }
                const materialCost = best.materialCost, gain = collectionBenefits.reduce((sum,row)=>sum+row.gain,0);
                const task = {
                    id: `forge:${forgeKey}:${targetPlus}`, kind: 'forge', title: `${tier} 阶${(data.rules.rarityNamesZh || [])[rarity] || ''}装备 · 强化日志 +${targetPlus}`,
                    itemId: best.seedId, baseItemId: best.item.id, rarity, current, target: targetPlus, remaining: targetPlus - current,
                    gain, collectionBenefits, jobId: null, skill: 'enhancing', levelReq: 1, locked: false,
                    materials: best.materials, batches: Math.max(0,targetPlus - best.currentPlus), actionSeconds:rule.attemptTicks*data.rules.tickMs/1000, speedMultiplier:null, seconds: rule.attemptTicks * data.rules.tickMs / 1000 * Math.max(0,targetPlus - best.currentPlus), expectedSeconds:best.estimate.attempts*rule.attemptTicks*data.rules.tickMs/1000, secondsBaseline:!character.completeness?.masteries || rule.houseBonusEnabled && character.timing?.forgeHouseBonus == null, secondsEstimated: true,
                    secondsNeedsScrolls:best.estimate.secondsNeedsScrolls,expectedAttempts:best.estimate.attempts,expectedGold:best.economics.expectedGold,expectedShards:best.economics.expectedShards,expectedCores:best.economics.expectedCores,expectedScrolls:best.economics.expectedScrolls,nextSuccessChance:best.estimate.successChance,targetSuccessChance:best.estimate.targetSuccessChance,totalSuccessChance:best.estimate.totalSuccessChance,averageSuccessChance:best.estimate.averageSuccessChance,forgeShardItemId:rule.shardItemId,
                    ...best.forgeCosts,
                    cost: best.cost, costKnown: best.cost !== null, costEstimated: true, materialCost, materialCostPerPoint:materialCost === null ? null : materialCost / Math.max(1,gain), coinCost: best.gold, forgeKey, tier, targetPlus, currentPlus: best.currentPlus,forgeNeedsDeposit:best.needsDeposit,
                    randomOutput: false, progress: current / targetPlus,
                    queued:!!running,queueStatus:running ? 'running' : null
                };
                task.difficulty = rankTask(task, options);
                tasks.push(task);
            }
        }
        return tasks;
    }
    const readyCount = (tasks,character) => tasks.filter(task=>!task.locked && queueRank(task) === 2 && !task.routeUnsupported && !task.forgeNeedsDeposit && (task.kind === 'forge' ? task.expectedGold : number(task.coinCost)) <= number(character.coins) && task.materials.every(material=>material.missing === 0 && !material.reservationUncertain)).length;
    const finishSteps = steps => {
        let result;
        do { result = steps.next(); } while (!result.done);
        return result.value;
    };
    function* sortSteps(rows, compare) {
        const size = 128;
        for (let start = 0; start < rows.length; start += size) {
            const chunk = rows.slice(start,start+size).sort(compare);
            for (let i = 0; i < chunk.length; i++) rows[start+i] = chunk[i];
            yield;
        }
        let source = rows, target = new Array(rows.length), processed = 0;
        for (let width = size; width < rows.length; width *= 2) {
            for (let start = 0; start < rows.length; start += width*2) {
                const middle = Math.min(start+width,rows.length), end = Math.min(start+width*2,rows.length);
                let left = start, right = middle;
                for (let i = start; i < end; i++) {
                    const order = left < middle && right < end ? compare(source[left],source[right]) : 0;
                    target[i] = right >= end || left < middle && !(order > 0) ? source[left++] : source[right++];
                    if (++processed % 256 === 0) yield;
                }
            }
            [source,target] = [target,source];
        }
        if (source !== rows) for (let i = 0; i < rows.length; i++) { rows[i] = source[i]; if (i % 256 === 0) yield; }
    }
    const planTasks = (character, data, options = {}) => finishSteps(planTaskSteps(character,data,options));
    function* planTaskSteps(character, data, options = {}) {
        if (!character || !object(character.collections) || !object(character.skills) || !object(character.bank) || !object(character.pack)) return { tasks: [], summary: null };
        if (!data || !Array.isArray(data.items) || !Array.isArray(data.jobs) || !rulesReady(data)) return { tasks: [], summary: null };
        character = { ...character, reservations:reserveMaterials(character, data), scheduledWork:scheduledWork(character.workOrders), workContexts:new Map() };
        const items = itemMap(data), jobs = jobMap(data).map, monsters = indexById(data.monsters), upgrades = indexById(data.upgrades);
        const petAcquisition = (itemId,sourceType) => sourceType === 'pet' || items.get(itemId)?.pet === true;
        const goals = new Map();
        const sourceSkills = Array.isArray(options.sourceSkills) ? new Set(options.sourceSkills) : null;
        const quoted = task => !options.requireMaterialQuotes || !isManufacturing(task) || Number.isFinite(task.materialCost);
        const included = task => {
            if (!taskAvailable(task,data,character) || petAcquisition(task.baseItemId,task.sourceType)) return false;
            if (sourceSkills && !sourceSkills.has(task.skill)) return false;
            task.marketStockIssue = missingMarketStock(task.materials,options.prices);
            return task.queued || task.relatedWork || !!task.marketStockIssue || options.keepUnquoted || quoted(task);
        };
        const push = task => {
            if (!included(task)) return;
            const key = `${task.itemId}:${task.target}`;
            if (!goals.has(key)) goals.set(key,[]);
            else {
                for (const source of goals.get(key)) source.difficulty ??= rankTask(source,options);
                task.difficulty ??= rankTask(task,options);
            }
            goals.get(key).push(task);
        };
        const pushCollection = (job,rarity,upgrade = null,source = null) => {
            const expanded = options.allMilestones === true;
            const add = task => {
                if (task && upgrade) Object.assign(task,{sourceId:source.id,sourceKind:'upgrade',sourceType:'output',actionName:upgrade.nameZh || upgrade.name});
                push(task);
            };
            const task = makeCollectionTask(job,rarity,character,data,options,upgrade,upgrade ? null : source,expanded ? add : null);
            if (!expanded) add(task);
        };
        for (const job of data.jobs) {
            if (job.retired || !featureAvailable(data,job.grow ? 'farming' : 'work')) continue;
            const qualities = items.get(job.output.itemId)?.rarityable ? rarityCount(data) : 1;
            for (let rarity = 0; rarity < qualities; rarity++) pushCollection(job,rarity);
            yield;
        }
        for (const source of data.collectionSources || []) {
            if (!taskAvailable(source,data,character)) continue;
            if (petAcquisition(source.itemId,source.sourceType)) continue;
            if (source.kind === 'upgrade') {
                const upgrade = upgrades.get(source.upgradeId);
                if (!upgrade || source.itemId !== upgrade.id || source.skill !== upgrade.skill || source.qty !== 1 || source.chance !== 1 || source.sourceType !== 'output') continue;
                const job = {id:-upgrade.recipe,skill:upgrade.skill,levelReq:upgrade.make,baseTicks:upgrade.baseTicks,inputs:[],output:{itemId:upgrade.id,qty:1}};
                const qualities = items.get(upgrade.id)?.rarityable ? rarityCount(data) : 1;
                for (let rarity = 0; rarity < qualities; rarity++) pushCollection(job,rarity,upgrade,source);
                yield;
                continue;
            }
            if (source.kind === 'enhance') { push(makeManualCollectionTask(source,character,data,options)); continue; }
            if (source.kind === 'job' && (source.sourceType === 'output' || source.sourceType === 'primary')) continue;
            const job = source.kind === 'job' && jobs.get(source.jobId), monster = source.kind === 'combat' && monsters.get(source.monsterId);
            if (!job && !monster || job?.retired) continue;
            const work = job && {...job,output:{itemId:source.itemId,qty:source.qty}};
            const first = source.quality === 'fixed' ? source.rarity ?? 0 : source.qualityFloor ?? 0;
            const last = source.quality === 'fixed' || !items.get(source.itemId)?.rarityable ? first : rarityCount(data)-1;
            for (let rarity = first; rarity <= last; rarity++) {
                if (job) pushCollection(work,rarity,null,source);
                else {
                    const expanded = options.allMilestones === true;
                    const task = makeCombatTask(source,rarity,character,data,options,monster,expanded ? push : null);
                    if (!expanded) push(task);
                }
            }
            yield;
        }
        const seconds = task=>task.expectedSeconds ?? task.seconds ?? Infinity;
        const compareSourceTime = (a,b) => {
            const delta = seconds(a)-seconds(b);
            return !Number.isNaN(delta) && delta || a.difficulty-b.difficulty || a.id.localeCompare(b.id);
        };
        const compareSources = (a,b) => {
            if (options.materialCostSort !== false && isManufacturing(a)) {
                const delta = (a.materialCost ?? Infinity)/a.gain-(b.materialCost ?? Infinity)/b.gain;
                if (!Number.isNaN(delta) && delta) return delta;
            }
            return compareSourceTime(a,b);
        };
        const tasks = [];
        let processed = 0;
        for (const sources of goals.values()) {
            if (sources.length === 1) {
                tasks.push(sources[0]);
                if (++processed % 128 === 0) yield;
                continue;
            }
            let chosen = [...new Map(sources.filter(task=>queueRank(task) < 2).map(task=>[task.id,task])).values()];
            if (!chosen.length) {
                const availableSources = sources.some(task=>!task.marketStockIssue) ? sources.filter(task=>!task.marketStockIssue) : sources;
                const feasible = availableSources.some(task=>!task.locked) ? availableSources.filter(task=>!task.locked) : availableSources;
                const pool = feasible.some(quoted) ? feasible.filter(quoted) : feasible;
                const groups = options.materialCostSort !== false ? [pool.filter(task=>!isManufacturing(task)),pool.filter(isManufacturing)] : [pool];
                const heads = groups.filter(group=>group.length).map(group=>group.reduce((a,b)=>compareSources(a,b)<=0 ? a : b));
                chosen = [heads.reduce((a,b)=>compareSourceTime(a,b) <= 0 ? a : b)];
            }
            const alternatives = sources.length > 1 ? sources.map(row=>({id:row.id,sourceId:row.sourceId ?? null,sourceType:row.sourceType ?? 'output',kind:row.kind,jobId:row.jobId,monsterId:row.monsterId ?? null,zoneIds:row.zoneIds ?? [],actionName:row.actionName ?? jobs.get(row.jobId)?.nameZh ?? jobs.get(row.jobId)?.name,expectedSeconds:row.expectedSeconds,cost:row.cost,locked:row.locked,queued:row.queued,relatedWork:row.relatedWork})) : null;
            for (const task of chosen) {
                if (alternatives) task.sourceAlternatives = alternatives;
            }
            tasks.push(...chosen);
            if (++processed % 128 === 0) yield;
        }
        if (options.includeForge !== false) tasks.push(...(yield* makeForgeTaskSteps(character, data, options)).filter(included));
        yield;
        yield* collectionBenefitSteps(tasks,character,data);
        for (const task of tasks) { task.difficulty = rankTask(task,options); if (++processed % 128 === 0) yield; }
        yield;
        const limit = integer(options.maxTasks, 1, 10000) ? options.maxTasks : Infinity;
        const compare = (a,b)=>queueRank(a)-queueRank(b) || Number(isDeferredCollection(a))-Number(isDeferredCollection(b)) || Number(a.kind === 'forge')-Number(b.kind === 'forge') || (a.kind === 'forge' ? compareForge(a,b) : a.difficulty-b.difficulty || b.gain-a.gain || a.id.localeCompare(b.id));
        if (options.sortTasks === false && tasks.length <= limit) {
            const scheduled = tasks.filter(task=>queueRank(task) < 2);
            yield* sortSteps(scheduled,compare);
            let index = 0;
            for (let i = 0; i < tasks.length; i++) if (queueRank(tasks[i]) < 2) tasks[i] = scheduled[index++];
        } else yield* sortSteps(tasks,compare);
        yield;
        const cp = collectionPoints(character.collections, data), fp = forgePoints(character.forgeLog, data);
        const summary = { collectionPoints: cp, forgePoints: fp, totalPoints: fp === null ? null : cp + fp, taskCount: tasks.length, readyCount:readyCount(tasks,character), lockedCount: tasks.filter(t => t.locked).length };
        if (Array.isArray(data.collectionCatalog) || object(data.collectionGroups)) {
            const produced = new Set([...data.jobs.filter(job=>featureAvailable(data,job.grow ? 'farming' : 'work') && !job.retired && !petAcquisition(job.output.itemId,'output')).map(job=>job.output.itemId),...(data.collectionSources || []).filter(source=>taskAvailable(source,data,character) && !petAcquisition(source.itemId,source.sourceType) && (source.kind === 'combat' && monsters.has(source.monsterId) || source.kind === 'job' && jobs.has(source.jobId) && !jobs.get(source.jobId).retired || source.kind === 'upgrade' && upgrades.get(source.upgradeId)?.id === source.itemId)).map(source=>source.itemId)]);
            const manual = new Set((data.collectionSources || []).filter(source=>taskAvailable(source,data,character) && source.kind === 'enhance' && !petAcquisition(source.itemId,source.sourceType)).map(source=>source.itemId));
            const entries = (Array.isArray(data.collectionCatalog) ? data.collectionCatalog.map(row=>row.itemId) : Object.keys(data.collectionGroups).map(Number)).filter(id=>items.has(id) && !data.rules.collection.excludedItemIds.includes(id));
            const petSources = new Set((data.collectionSources || []).filter(source=>petAcquisition(source.itemId,source.sourceType)).map(source=>source.itemId));
            const excludedPets = new Set(entries.filter(id=>petAcquisition(id) || petSources.has(id) && !produced.has(id) && !manual.has(id)));
            summary.collectionCoverage = {catalogItemCount:entries.length,supportedItemCount:entries.filter(id=>produced.has(id)).length,manualItemIds:entries.filter(id=>!produced.has(id) && manual.has(id)),unsupportedItemIds:entries.filter(id=>!excludedPets.has(id) && !produced.has(id) && !manual.has(id)),excludedPetItemIds:[...excludedPets]};
        }
        const firstUnqueued = tasks.findIndex(task=>queueRank(task) === 2);
        return { tasks: tasks.slice(0, firstUnqueued < 0 ? tasks.length : firstUnqueued+limit), summary };
    }
    const optimizeRoute = (tasks, character, data, options = {}) => finishSteps(routeSteps(tasks,character,data,options));
    function* routeSteps(tasks, character, data, options = {}) {
        const copies = [];
        if (Array.isArray(tasks)) for (const task of tasks) { if (!taskAvailable(task,data,character)) continue; copies.push({...task}); if (copies.length % 128 === 0) yield; }
        const empty = { recommendedCount:0, gain:0, purchaseCost:0, materialValue:0, expectedSeconds:0 };
        if (!character || !object(character.bank) || !object(character.pack) || !Array.isArray(data?.jobs) || !Array.isArray(data?.items) || !rulesReady(data)) return {tasks:copies,summary:empty};
        const state = {...character,reservations:reserveMaterials(character,data)}, stock = new Map(), initial = new Map();
        const queueUnknown = character.completeness?.workOrders === false;
        const blocked = material => state.reservations.uncertain.has(material.itemId) || queueUnknown && number(character.bank[material.itemId])+number(character.pack[material.itemId]) > 0;
        const excluded = new Set(options.excludedTaskIds || []), priced = options.materialCostSort !== false, fullRoute = options.fullRoute === true;
        const independent = options.independentTasks === true;
        const priority = ['inventory','cost','quality','time','points','high-points'].includes(options.routePriority) ? options.routePriority : null;
        const inventoryReady = priority === 'inventory' ? new WeakSet() : null;
        const limit = Math.min(copies.length, integer(options.maxRecommendations,1) ? options.maxRecommendations : 60);
        let coins = number(character.coins);
        const coverage = new Map(), purchased = new Map(), coverageRevisions = independent ? new Map() : null;
        const balance = itemId => {
            if (!stock.has(itemId)) { const qty = blocked({itemId}) ? 0 : available(state,itemId); stock.set(itemId,qty); initial.set(itemId,qty); }
            return stock.get(itemId);
        };
        const costAt = task => {
            let cost = task.kind === 'forge' ? number(task.expectedGold,Infinity) : number(task.coinCost);
            let known = !task.routeBlocked && !task.routeUnsupported;
            task.routeIssue = task.routeBlocked ? 'queue' : task.routeUnsupported ? 'unsupported' : task.forgeNeedsDeposit ? 'deposit' : null;
            task.routeReady = true;
            task.routeStockIssue = null;
            for (const material of task.materials || []) {
                const missing = Math.max(0,material.need-balance(material.itemId)-(material.forgeSeed && material.seedEquipped ? 1 : 0));
                if (!missing) continue;
                task.routeReady = false;
                const quote = options.prices?.[material.itemId], price = object(quote) ? quote.lowestSell : quote;
                task.routeStockIssue ||= marketStockIssue(material.itemId,missing+(purchased.get(material.itemId) || 0),quote);
                if (material.marketTradable === false || character.ironman) { task.routeIssue ||= 'material'; known = false; continue; }
                if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) { task.routeIssue ||= 'quote'; known = false; continue; }
                cost += missing * price;
                if (!Number.isFinite(cost) || cost > Number.MAX_SAFE_INTEGER) known = false;
            }
            task.routeStockBlocked = !!task.routeStockIssue;
            if (task.routeStockBlocked) task.routeIssue ||= 'stock';
            if (known && cost > coins) task.routeIssue ||= 'budget';
            if (!Number.isFinite(cost) || cost > Number.MAX_SAFE_INTEGER) { task.routeIssue ||= 'quote'; known = false; }
            return known ? cost : null;
        };
        const valueOf = task => isManufacturing(task) ? task.routeMaterialValue : task.routeCost;
        const compareCost = (a,b) => (valueOf(a) ?? Infinity)/a.routeExpectedGain-(valueOf(b) ?? Infinity)/b.routeExpectedGain;
        const setCost = (task,refresh = !independent) => {
            if (refresh) task.routeCost = costAt(task);
            const value = valueOf(task);
            task.routeCoinsPerPoint = value === null ? null : value/task.gain;
            task.routeExpectedGain = task.collectionBenefits ? task.collectionBenefits.reduce((sum,row)=>sum+row.gain*Math.max(0,row.probability-(coverage.get(row.key) || 0)),0) : task.gain;
            task.routeSecondsPerPoint = task.routeSeconds === null || !(task.routeExpectedGain > 0) ? null : task.routeSeconds/task.routeExpectedGain;
            task.routeRankingSecondsPerPoint = task.routeRankingSeconds === null || !(task.routeExpectedGain > 0) ? null : task.routeRankingSeconds/task.routeExpectedGain;
        };
        const secondsOf = task => {
            const seconds = task.expectedSeconds ?? task.seconds;
            return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
        };
        const eligible = task => !task.queued && !task.relatedWork && !task.locked && !task.skipped && !task.routeIssue && task.routeCost !== null && !excluded.has(task.id) && Number.isFinite(task.gain) && task.gain > 0 && task.routeExpectedGain > 0;
        const candidates = [], other = [];
        let processed = 0;
        for (const task of copies) {
            if (inventoryReady && (task.materials || []).some(material=>material.need > 0)
                && task.materials.every(material=>material.need <= 0 || !blocked(material) && balance(material.itemId) >= material.need)) inventoryReady.add(task);
            task.routeBlocked = (task.materials || []).some(blocked);
            task.routeMaterialValue = task.routeUnsupported ? null : purchaseCost(task.materials || [],options.prices,number(task.coinCost),true);
            task.routeSeconds = secondsOf(task);
            task.routeRankingSeconds = task.rankingSeconds ?? rankingSeconds(task);
            setCost(task,true);
            task.routeIndex = null;
            (eligible(task) ? candidates : other).push(task);
            if (++processed % 128 === 0) yield;
        }
        const compareTime = (a,b) => {
            const delta = (a.routeRankingSecondsPerPoint ?? Infinity)-(b.routeRankingSecondsPerPoint ?? Infinity);
            return !Number.isNaN(delta) && delta || 0;
        };
        const compareStable = (a,b) => number(a.rarity)-number(b.rarity) || number(a.levelReq)-number(b.levelReq) || String(a.id).localeCompare(String(b.id));
        const priorityValue = task => {
            if (inventoryReady) return inventoryReady.has(task) ? 0 : 1;
            const value = number(priority === 'cost' ? task.routeCoinsPerPoint : priority === 'quality' ? task.rarity : priority === 'points' || priority === 'high-points' ? task.gain : task.routeSeconds,Infinity);
            return priority === 'high-points' && value !== Infinity ? -value : value;
        };
        const comparePriority = (a,b) => {
            if (!priority) return 0;
            const first = priorityValue(a), second = priorityValue(b);
            return first === second ? 0 : first < second ? -1 : 1;
        };
        const displayOrder = function* (rows) {
            if (priority) yield* sortSteps(rows,comparePriority);
            return rows;
        };
        const groupOf = task => isDeferredCollection(task) ? 3 : task.kind === 'forge' ? 2 : priced && isManufacturing(task) ? 1 : 0;
        const splitGroups = rows => {
            const groups = [[],[],[],[]];
            for (const task of rows) groups[groupOf(task)].push(task);
            return groups;
        };
        const compareWithinGroup = (a,b) => {
            const primary = comparePriority(a,b);
            if (primary) return primary;
            if (a.kind === 'forge') return compareForge(a,b);
            const known = Number(a.routeRankingSeconds === null)-Number(b.routeRankingSeconds === null);
            if (known) return known;
            if (priced && isManufacturing(a)) {
                const costDelta = compareCost(a,b);
                if (!Number.isNaN(costDelta) && costDelta) return costDelta;
            }
            const timeDelta = compareTime(a,b);
            if (timeDelta) return timeDelta;
            return compareStable(a,b);
        };
        const chooseHead = (heads,rows) => heads.filter(index=>index !== -1).reduce((best,index)=>{
            if (best === -1) return index;
            const a = rows[best], b = rows[index];
            const forge = Number(a.kind === 'forge')-Number(b.kind === 'forge');
            const delta = comparePriority(a,b) || Number(isDeferredCollection(a))-Number(isDeferredCollection(b)) || (forge || (a.kind === 'forge' ? compareForge(a,b) : compareTime(a,b) || compareCost(a,b) || Number(a.uncertainAttempts)-Number(b.uncertainAttempts) || compareStable(a,b)));
            return delta <= 0 ? best : index;
        },-1);
        const dependents = new Map(), active = new Set(candidates), dirty = new Set();
        let stockRevision = 0;
        if (!fullRoute) for (const task of candidates) for (const material of task.materials || []) {
            if (!dependents.has(material.itemId)) dependents.set(material.itemId,new Set());
            dependents.get(material.itemId).add(task);
        }
        const setMaterials = (task,commit) => {
            task.routeMaterials = (task.materials || []).map(material => {
                const inventory = balance(material.itemId), worn = material.forgeSeed && material.seedEquipped ? 1 : 0;
                const owned = inventory+worn, allocated = Math.min(material.need,owned);
                const row = {...material,owned,missing:Math.max(0,material.need-owned),allocated:commit ? allocated : 0,plannedReserved:initial.get(material.itemId)-inventory,reservationUncertain:!!material.reservationUncertain || blocked(material)};
                if (commit && !independent && allocated > worn) {
                    stock.set(material.itemId,inventory-allocated+worn);
                    stockRevision++;
                    for (const dependent of dependents.get(material.itemId) || []) if (active.has(dependent)) dirty.add(dependent);
                }
                return row;
            });
        };
        const selected = [], pending = fullRoute ? [] : [...candidates];
        const select = task => {
            active.delete(task);
            task.routeIndex = selected.length+1;
            setMaterials(task,true);
            if (!independent) {
                coins = Math.max(0,coins-task.routeCost);
                for (const material of task.routeMaterials) if (material.missing) purchased.set(material.itemId,(purchased.get(material.itemId) || 0)+material.missing);
            }
            let coverageChanged = false;
            for (const row of task.collectionBenefits || []) {
                const previous = coverage.get(row.key) || 0, next = Math.max(previous,row.probability);
                if (next !== previous) {
                    coverage.set(row.key,next); coverageRevisions?.set(row.key,stockRevision+1); coverageChanged = true;
                }
            }
            if (!independent || coverageChanged) stockRevision++;
            if (!fullRoute) for (const dependent of active) dirty.add(dependent);
            selected.push(task);
        };
        if (fullRoute) {
            const makeHeap = rows => {
                const down = index => {
                    const task = rows[index];
                    for (let child = index*2+1; child < rows.length; child = index*2+1) {
                        if (child+1 < rows.length && compareWithinGroup(rows[child+1],rows[child]) < 0) child++;
                        if (compareWithinGroup(task,rows[child]) <= 0) break;
                        rows[index] = rows[child]; index = child;
                    }
                    rows[index] = task;
                };
                for (let index = Math.floor(rows.length/2)-1; index >= 0; index--) down(index);
                return { rows,repair:() => down(0),pop:() => {
                    const task = rows[0], last = rows.pop();
                    if (rows.length) { rows[0] = last; down(0); }
                    return task;
                }};
            };
            const heaps = splitGroups(candidates).map(makeHeap);
            const checked = new WeakMap(candidates.map(task=>[task,0]));
            while (heaps.some(heap=>heap.rows.length)) {
                const rows = [];
                for (const heap of heaps) {
                    while (heap.rows.length) {
                        const task = heap.rows[0];
                        const previous = checked.get(task);
                        if (previous === stockRevision) break;
                        checked.set(task,stockRevision);
                        if (!independent || task.collectionBenefits?.some(row=>(coverageRevisions.get(row.key) || 0) > previous)) {
                            setCost(task);
                            if (!eligible(task)) pending.push(heap.pop()); else heap.repair();
                        }
                        if (++processed % 64 === 0) yield;
                    }
                    rows.push(heap.rows[0] || null);
                }
                const group = chooseHead(rows.map((task,index)=>task ? index : -1),rows);
                if (group === -1) break;
                select(heaps[group].pop());
                if (++processed % 64 === 0) yield;
            }
            for (const task of pending) setCost(task);
        } else {
            while (pending.length && selected.length < limit) {
                for (const task of dirty) setCost(task);
                dirty.clear();
                const heads = [-1,-1,-1,-1];
                for (let index = 0; index < pending.length; index++) {
                    if (!eligible(pending[index])) continue;
                    const group = groupOf(pending[index]);
                    if (heads[group] === -1 || compareWithinGroup(pending[index],pending[heads[group]]) < 0) heads[group] = index;
                }
                const best = chooseHead(heads,pending);
                if (best === -1) break;
                const [task] = pending.splice(best,1);
                select(task);
                yield;
            }
            for (const task of dirty) setCost(task);
        }
        {
            const groups = splitGroups(pending);
            for (const group of groups) yield* sortSteps(group,compareWithinGroup);
            const offsets = [0,0,0,0];
            pending.length = 0;
            while (groups.some((group,index)=>offsets[index] < group.length)) {
                const rows = groups.map((group,index)=>group[offsets[index]]);
                const group = chooseHead(rows.map((row,index)=>row ? index : -1),rows);
                pending.push(groups[group][offsets[group]++]);
            }
        }
        for (const task of pending) { setMaterials(task,false); if (++processed % 128 === 0) yield; }
        for (const task of other) { setCost(task); setMaterials(task,false); if (++processed % 128 === 0) yield; }
        const summary = {...empty};
        const sum = (key,value) => { summary[key] = summary[key] === null || value === null ? null : summary[key]+value; };
        for (const task of selected) {
            summary.recommendedCount++;
            summary.gain += options.allMilestones ? task.routeExpectedGain : task.gain;
            sum('purchaseCost',task.routeCost);
            sum('materialValue',task.routeMaterialValue);
            sum('expectedSeconds',task.routeSeconds);
        }
        const scheduled = [], unscheduled = [];
        for (const task of other) (queueRank(task) < 2 ? scheduled : unscheduled).push(task);
        scheduled.sort((a,b)=>queueRank(a)-queueRank(b));
        yield* sortSteps(unscheduled,(a,b)=>comparePriority(a,b) || Number(isDeferredCollection(a))-Number(isDeferredCollection(b)) || Number(a.kind === 'forge')-Number(b.kind === 'forge') || (a.kind === 'forge' ? compareForge(a,b) : a.difficulty-b.difficulty || compareStable(a,b)));
        const ordered = [...selected,...pending,...unscheduled];
        if (priority) return {tasks:yield* displayOrder([...scheduled,...ordered]),summary};
        const forgeTasks = ordered.filter(task=>task.kind === 'forge').sort((a,b)=>Number(a.rarity === 4)-Number(b.rarity === 4));
        let forgeIndex = 0;
        return {tasks:yield* displayOrder([...scheduled,...ordered.map(task=>task.kind === 'forge' ? forgeTasks[forgeIndex++] : task)]),summary};
    }
    return { rulesReady, baseRulesReady, featureAvailable, taskAvailable, readyCount, normalizeCharacter, normalizeWorkOrders, decodeItem, encodeItem, levelFromXp, nextMilestone, collectionPoints, forgeStepPoints, forgePoints, planTasks, optimizeRoute, planTaskSteps, routeSteps, rankTask, isDeferredCollection, forgeEstimate, forgeSuccessPercent, forgeHasStep, mergeForgeMask, itemMap, jobMap, indexById, purchaseCost };
});
const CORE = module.exports;
(function(root,factory){
    'use strict';
    const api=factory(CORE.rulesReady);
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.DVIGameDataLoader=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(rulesReady){
    'use strict';
    const fail=message=>{throw new Error(`游戏源数据不兼容：${message}`);};
    const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const forbidden=new Set(['__proto__','prototype','constructor']);
    const DATA_FORMAT_VERSION=16;
    function dictionaryEntries(text){
        const entries=[],seen=new Map();let at=0,previous='';
        const readString=()=>{const start=at,quote=text[at++];while(at<text.length){const char=text[at++];if(char==='\\')at++;else if(char===quote)return text.slice(start,at);}fail('翻译字符串未结束');};
        while(at<text.length){
            const char=text[at];
            if(/\s/.test(char)){at++;continue;}
            if(text.startsWith('//',at)){at=text.indexOf('\n',at);if(at<0)break;continue;}
            if(text.startsWith('/*',at)){const end=text.indexOf('*/',at+2);if(end<0)fail('翻译注释未结束');at=end+2;continue;}
            if(char==='"'||char==="'"||char==='`'||/[A-Za-z_$]/.test(char)){
                let raw,key;
                if(char==='"'||char==="'"||char==='`'){raw=readString();if(char==='"')key=JSON.parse(raw);}
                else {raw=/^[A-Za-z_$][\w$]*/.exec(text.slice(at))[0];at+=raw.length;key=raw;}
                if(key!==undefined&&(previous==='{'||previous===',')){
                    let next=at;while(/\s/.test(text[next]||'')&&next<text.length)next++;
                    if(text[next]===':'){
                        next++;while(/\s/.test(text[next]||'')&&next<text.length)next++;
                        if(text[next]==='"'){at=next;const value=JSON.parse(readString());if(/[\u3400-\u9fff]/.test(value)){if(seen.has(key)&&seen.get(key)!==value)fail(`翻译键 ${key} 存在歧义`);seen.set(key,value);entries.push([key,value]);}}
                    }
                }
                previous='value';continue;
            }
            previous=char;at++;
        }
        return entries;
    }
    function validateGameData(data){
        try{
            const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
            const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
            const positive=value=>finite(value)&&value>0;
            const id=value=>Number.isSafeInteger(value)&&value>0;
            const numbers=value=>Array.isArray(value)&&value.length>0&&value.every(finite);
            if(!object(data)||data.loaderFormatVersion!==DATA_FORMAT_VERSION||typeof data.version!=='string'||!Array.isArray(data.skills)||!data.skills.length||!data.skills.every(skill=>typeof skill==='string'))return false;
            if(!Array.isArray(data.items)||!data.items.length||!Array.isArray(data.jobs)||!data.jobs.length||!Array.isArray(data.upgrades)||!object(data.rules)||!rulesReady(data))return false;
            const capabilities=data.capabilities;
            if(!object(capabilities)||['work','farming','combat','enhancing','upgrades','quality'].some(key=>!object(capabilities[key])||typeof capabilities[key].available!=='boolean'||typeof capabilities[key].reason!=='string'||!capabilities[key].available&&!capabilities[key].reason))return false;
            const available=key=>capabilities[key].available;
            if(!available('quality')&&['work','farming','combat'].some(available)||available('enhancing')&&!object(data.rules.forge))return false;
            const ids=new Set(data.items.map(item=>item.id));
            if(!Array.isArray(data.monsters)||!data.monsters.length||!Array.isArray(data.zones)||!data.zones.length||!Array.isArray(data.collectionSources)||!data.collectionSources.length||!Array.isArray(data.collectionCatalog)||!data.collectionCatalog.length)return false;
            const jobIds=new Set(data.jobs.map(job=>job.id)),monsterIds=new Set(data.monsters.map(monster=>monster.id)),zoneIds=new Set(data.zones.map(zone=>zone.id));
            const zoneMap=new Map(data.zones.map(zone=>[zone.id,zone])),catalogIds=new Set(data.collectionCatalog.map(row=>row.itemId)),sourceCatalog=new Map();
            if(jobIds.size!==data.jobs.length||monsterIds.size!==data.monsters.length||zoneIds.size!==data.zones.length||catalogIds.size!==data.collectionCatalog.length)return false;
            if(data.monsters.some(row=>!id(row.id)||typeof row.name!=='string'||typeof row.nameZh!=='string'||!ids.has(row.drop)||!object(row.bonus)||!ids.has(row.bonus.itemId)||available('combat')&&(!finite(row.bonus.chance)||row.bonus.chance>1||row.dropChance!==undefined&&(!finite(row.dropChance)||row.dropChance>1))))return false;
            if(data.zones.some(row=>!id(row.id)||!monsterIds.has(row.monsterId)||typeof row.name!=='string'||typeof row.nameZh!=='string')||data.collectionCatalog.some(row=>!ids.has(row.itemId)||!Array.isArray(row.skills)||!row.skills.length||new Set(row.skills).size!==row.skills.length||row.skills.some(skill=>skill!=='combat'&&!data.skills.includes(skill))))return false;
            if(new Set(data.collectionSources.map(row=>row.id)).size!==data.collectionSources.length||data.collectionSources.some(row=>typeof row.id!=='string'||!row.id||!ids.has(row.itemId)||!catalogIds.has(row.itemId)||!positive(row.chance)||row.chance>1||!id(row.qty)||!['output','bonus'].includes(row.sourceType)||row.pet===true||!['random','fixed'].includes(row.quality)||!['job','combat','enhance','upgrade'].includes(row.kind)||row.retired!==undefined&&typeof row.retired!=='boolean'||row.skill!=='combat'&&!data.skills.includes(row.skill)||row.kind==='combat'&&row.skill!=='combat'||row.rarity!==undefined&&(!Number.isSafeInteger(row.rarity)||row.rarity<0||row.rarity>=data.rules.rarityNames?.length)||row.qualityFloor!==undefined&&(row.quality!=='random'||!Number.isSafeInteger(row.qualityFloor)||row.qualityFloor<0||row.qualityFloor>=data.rules.rarityNames?.length)||row.chanceMode!==undefined&&!(row.kind==='combat'&&row.chanceMode==='combatLuck')||row.kind==='job'&&!jobIds.has(row.jobId)||row.kind==='upgrade'&&(!data.upgrades.some(upgrade=>upgrade.id===row.upgradeId&&upgrade.id===row.itemId&&upgrade.skill===row.skill)||row.sourceType!=='output'||row.qty!==1||row.chance!==1||row.quality!=='fixed')||row.kind==='combat'&&(!monsterIds.has(row.monsterId)||!Array.isArray(row.zoneIds)||!row.zoneIds.length||new Set(row.zoneIds).size!==row.zoneIds.length||row.zoneIds.some(zoneId=>!zoneIds.has(zoneId)||zoneMap.get(zoneId).monsterId!==row.monsterId))))return false;
            for(const row of data.collectionSources){const skills=sourceCatalog.get(row.itemId)??new Set();skills.add(row.skill);sourceCatalog.set(row.itemId,skills);}
            if(data.collectionCatalog.some(row=>{const skills=sourceCatalog.get(row.itemId);return !skills||skills.size!==row.skills.length||row.skills.some(skill=>!skills.has(skill));}))return false;
            if(ids.size!==data.items.length||data.items.some(item=>!Number.isSafeInteger(item.id)||item.id<=0||typeof item.name!=='string'||typeof item.nameZh!=='string'||!finite(item.value)||typeof item.rarityable!=='boolean'||typeof item.enhanceable!=='boolean'||typeof item.pet!=='boolean'||typeof item.marketTradable!=='boolean'||item.baseLuck!==undefined&&!finite(item.baseLuck)||item.slot==='amulet'&&!finite(item.baseLuck)))return false;
            if(data.jobs.some(job=>!Number.isSafeInteger(job.id)||!data.skills.includes(job.skill)||!positive(job.levelReq)||!positive(job.baseTicks)||!finite(job.xp)||!Array.isArray(job.inputs)||job.inputs.some(row=>!ids.has(row.itemId)||!positive(row.qty))||!ids.has(job.output?.itemId)||!positive(job.output.qty)||!Array.isArray(job.qualityInputs)||job.plain!==undefined&&typeof job.plain!=='boolean'||job.plain&&(job.inputs.length||job.grow!==undefined||job.fixedOutputRarity!==0)||job.fixedOutputRarity!==undefined&&(job.fixedOutputRarity!==0||!job.plain&&!job.inputs.length||job.qualityInputs.length)))return false;
            const rules=data.rules,collection=rules.collection,forge=rules.forge,timing=rules.workTiming,quality=rules.qualityModifiers;
            if(!object(collection)||!Array.isArray(collection.unplannableItemIds)||collection.unplannableItemIds.some(itemId=>!ids.has(itemId)))return false;
            if(!object(collection.firstOnlyRewards)||!object(collection.minimumRarity))return false;
            if(Object.entries(collection.firstOnlyRewards).some(([key,reward])=>!ids.has(Number(key))||!object(reward)||!positive(reward.points)||typeof reward.rarityScaled!=='boolean'))return false;
            if(Object.entries(collection.minimumRarity).some(([key,rarity])=>!ids.has(Number(key))||!Number.isSafeInteger(rarity)||rarity<0||rarity>=rules.rarityNames.length))return false;
            if(!object(timing)||typeof timing.offhandEnabled!=='boolean'||!object(timing.toolLuckBonuses)||!object(timing.freeInputToolSkills))return false;
            if(data.items.some(item=>item.offhand!==undefined&&(!object(item.offhand)||item.slot!=='shield'||!data.skills.includes(item.offhand.skill)||!finite(item.offhand.lift))))return false;
            if(Object.entries(timing.toolLuckBonuses).some(([key,bonus])=>!ids.has(Number(key))||!finite(bonus))||Object.entries(timing.freeInputToolSkills).some(([key,skill])=>!ids.has(Number(key))||!data.skills.includes(skill)))return false;
            if (available('quality')) {
                if(typeof quality?.combatBonusIncludesHouse!=='boolean')return false;
                const strings = rows => Array.isArray(rows) && rows.length > 0 && new Set(rows).size === rows.length && rows.every(value=>typeof value === 'string' && value.length > 0);
                if (!object(quality) || !['hunterPerTier','masteryPerRank'].every(key=>finite(quality[key])) || !['blessingMultiplier','eventRarityMultiplier'].every(key=>positive(quality[key])) || !id(quality.eventTicks) || !id(quality.eventSeed) || !numbers(quality.brewMultipliers) || quality.brewMultipliers.length !== rules.rarityNames.length) return false;
                if (!strings(quality.eventSkills) || quality.eventSkills.some(skill=>skill !== 'combat' && !data.skills.includes(skill)) || !strings(quality.eventRaritySkills) || quality.eventRaritySkills.some(skill=>!quality.eventSkills.includes(skill)) || !strings(quality.combatSkills) || quality.combatSkills.some(skill=>!data.skills.includes(skill))) return false;
                if (!Array.isArray(quality.rareRooms) || new Set(quality.rareRooms.map(room=>room.id)).size !== quality.rareRooms.length || quality.rareRooms.some(room=>!object(room) || typeof room.id !== 'string' || !room.id || !positive(room.rate))) return false;
            }
            if (available('enhancing')&&(!['protectionItemId','coreItemId'].every(key=>id(forge[key]) && ids.has(forge[key])) || !['protectionMinPlus','coreMinPlus'].every(key=>id(forge[key]) && forge[key] <= forge.maxPlus))) return false;
            const material=row=>object(row)&&ids.has(row.itemId)&&id(row.qty);
            const failure=row=>object(row)&&finite(row.chanceAtReq)&&row.chanceAtReq<=1&&positive(row.safeAtLevel);
            if(data.items.some(item=>item.id>=rules.encoding.rarityStride||available('enhancing')&&item.enhanceable&&(!id(item.enhanceTier)||item.enhanceTier>forge.tierWeights.length)||item.tool!==undefined&&(!object(item.tool)||!data.skills.includes(item.tool.skill)||!id(item.tool.levelReq)||!finite(item.tool.baseBonus))))return false;
            if(available('enhancing')&&!ids.has(forge.shardItemId)||data.jobs.some(job=>!id(job.levelReq)||!id(job.output.qty)||job.inputs.some(row=>!material(row))||new Set(job.qualityInputs).size!==job.qualityInputs.length||job.qualityInputs.some(itemId=>!job.inputs.some(row=>row.itemId===itemId))||job.grow!==undefined&&!id(job.grow)||job.bonus!==undefined&&(!object(job.bonus)||!ids.has(job.bonus.itemId)||!finite(job.bonus.chance)||job.bonus.chance>1)||job.burn!==undefined&&!failure(job.burn)||job.caught!==undefined&&(!failure(job.caught)||!id(job.caught.stunTicks))))return false;
            if(new Set(data.upgrades.map(row=>row.id)).size!==data.upgrades.length||new Set(data.upgrades.map(row=>row.recipe)).size!==data.upgrades.length||data.upgrades.some(row=>!id(row.id)||!ids.has(row.id)||!ids.has(row.from)||!id(row.recipe)||!data.skills.includes(row.skill)||!id(row.make)||row.baseTicks!==null&&!id(row.baseTicks)||!finite(row.xp)||!Array.isArray(row.extra)||row.extra.some(materialRow=>!material(materialRow)||materialRow.perTier!==undefined&&typeof materialRow.perTier!=='boolean')||row.startsAtZero!==undefined&&typeof row.startsAtZero!=='boolean'||row.job!==undefined&&!jobIds.has(row.job)))return false;
            if(!object(collection)||!numbers(collection.thresholds)||!numbers(collection.incrementPoints)||collection.thresholds.length!==collection.incrementPoints.length||!numbers(collection.rarityMultipliers)||!positive(collection.petFirst)||!numbers(collection.excludedItemIds))return false;
            if(available('enhancing')&&(!object(forge)||!['maxPlusScored','maxPlus','loggedMaxPlus','divisor','minPoints','defaultTier','maxTotalPoints','baseSuccessReductionPerPlus','shardItemId','attemptTicks','successBonusPerSkillLevel','maxMasteryMultiplier'].every(key=>positive(forge[key]))||!['stepWeights','tierWeights','rarityWeights','tierLevelThresholds','goldTierWeights','goldRarityWeights','shardsPerPlus'].every(key=>numbers(forge[key]))))return false;
            if(!object(rules.encoding)||!positive(rules.encoding.rarityStride)||!positive(rules.encoding.plusStride)||!object(rules.xp)||!numbers(rules.xp.levelThresholds)||!positive(rules.tickMs)||!positive(rules.masteryBaseCost)||!positive(rules.masteryCostStep))return false;
            if(!object(timing)||!['skillRooms','skillRoomRates','skillToolSlots','skillMasteries','luckToolSlots'].every(key=>object(timing[key])))return false;
            if(available('work')&&(!['quickPerkPerRank','handsPerRank','maxHandsRank','masterySpeedPerRank'].every(key=>finite(timing[key]))||!id(timing.maxHandsRank)))return false;
            if((available('work')||available('farming')||available('combat'))&&(!finite(timing.toolPlusPerLevel)||!numbers(timing.toolRarityMultipliers)||!numbers(timing.toolLuckByRarity)))return false;
            if(available('enhancing')&&!finite(timing.forgeMasteryPerRank))return false;
            if(!object(data.masteryNames)||!object(data.skillNames)||!object(data.skillNamesZh)||data.skills.some(skill=>typeof data.skillNames[skill]!=='string'||typeof data.skillNamesZh[skill]!=='string')||!object(data.skillGroups)||!['gather','craft','combat'].every(group=>Array.isArray(data.skillGroups[group])&&data.skillGroups[group].every(skill=>data.skills.includes(skill))))return false;
            if(!Array.isArray(rules.rarityNames)||!Array.isArray(rules.rarityNamesZh)||rules.rarityNames.length!==rules.rarityNamesZh.length||rules.rarityNames.length!==collection.rarityMultipliers.length||available('quality')&&(!numbers(rules.qualityCumulative)||rules.qualityCumulative.length!==rules.rarityNames.length+1))return false;
            const workSkills=[...data.skillGroups.gather,...data.skillGroups.craft],masteryIds=new Set(Object.values(data.masteryNames));
            if(workSkills.some(skill=>{
                if(!(skill==='enhancing'?available('enhancing'):skill==='farming'?available('farming'):available('work')))return false;
                return (skill!=='enhancing'||forge.houseBonusEnabled)&&(typeof timing.skillRooms[skill]!=='string'||!finite(timing.skillRoomRates[skill]))||!masteryIds.has(timing.skillMasteries[skill])||skill!=='enhancing'&&typeof timing.skillToolSlots[skill]!=='string';
            }))return false;
            if(available('quality')&&(timing.toolLuckByRarity.length!==rules.rarityNames.length||!Object.keys(timing.luckToolSlots).length||Object.entries(timing.luckToolSlots).some(([skill,slot])=>!data.skills.includes(skill)||typeof slot!=='string'||timing.skillToolSlots[skill]!==slot)))return false;
            if(!['journeyLevel','baseXp','growth','beyondStep','beyondGrowth','speedPerLevelAboveRequirement'].every(key=>positive(rules.xp[key])))return false;
            return true;
        }catch{return false;}
    }
    function parseExpression(text,resolve,calls={},locals={}){
        let at=0,steps=0,depth=0;
        const skip=()=>{while(/\s/.test(text[at]||'')&&at<text.length)at++;};
        const take=token=>{skip();if(text.startsWith(token,at)){at+=token.length;return true;}return false;};
        const expect=token=>{if(!take(token))fail(`需要 ${token}，位置 ${at}`);};
        const identifier=()=>{skip();const found=/^[A-Za-z_$][\w$]*/.exec(text.slice(at));if(!found)fail(`标识符无效，位置 ${at}`);at+=found[0].length;return found[0];};
        const string=()=>{
            skip();const start=at,quote=text[at++];
            if(quote!=='"')fail('数据字符串必须使用双引号');
            while(at<text.length){const char=text[at++];if(char==='\\')at++;else if(char===quote){try{return JSON.parse(text.slice(start,at));}catch{fail('数据字符串无效');}}}
            fail('数据字符串未结束');
        };
        const binary={'||':1,'&&':2,'===':3,'!==':3,'==':3,'!=':3,'>=':4,'<=':4,'>':4,'<':4,'+':5,'-':5,'*':6,'/':6,'%':6,'**':7};
        const apply=(op,a,b)=>{
            switch(op){case'||':return a||b;case'&&':return a&&b;case'===':return a===b;case'!==':return a!==b;case'==':return a==b;case'!=':return a!=b;case'>=':return a>=b;case'<=':return a<=b;case'>':return a>b;case'<':return a<b;case'+':return a+b;case'-':return a-b;case'*':return a*b;case'/':return a/b;case'%':return a%b;case'**':return a**b;default:fail('不支持的数据运算');}
        };
        const readAtom=()=>{
            if(++steps>100000)fail('数据表达式过大');
            skip();
            if(take('!'))return !atom();
            if(take('-'))return -atom();
            if(take('+'))return +atom();
            if(take('(')){const value=expression();expect(')');return value;}
            if(text[at]==='"')return string();
            if(take('[')){
                const value=[];
                if(!take(']'))do{
                    if(take('...')){const rows=expression();if(!Array.isArray(rows))fail('数组展开值无效');if(value.length+rows.length>100000)fail('数据数组过大');for(const row of rows)value.push(row);}
                    else {if(value.length>=100000)fail('数据数组过大');value.push(expression());}
                    if(take(']'))break;
                    expect(',');if(take(']'))break;
                }while(true);
                return value;
            }
            if(take('{')){
                const value={};
                if(!take('}'))do{
                    if(take('...')){const row=expression();if(!row||typeof row!=='object'||Array.isArray(row))fail('对象展开值无效');for(const [key,item]of Object.entries(row)){if(forbidden.has(key))fail('禁止的数据键');value[key]=item;}}
                    else {skip();const key=text[at]==='"'?string():identifier();if(forbidden.has(key))fail('禁止的数据键');expect(':');value[key]=expression();}
                    if(take('}'))break;
                    expect(',');if(take('}'))break;
                }while(true);
                return value;
            }
            const numeric=/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(at));
            if(numeric){at+=numeric[0].length;return Number(numeric[0]);}
            const name=identifier();
            if(name==='true')return true;if(name==='false')return false;if(name==='null')return null;
            if(name==='undefined')return undefined;
            if(name==='new'){
                const type=identifier();if(type!=='Set')fail('禁止的数据构造器');expect('(');const rows=expression();expect(')');if(!Array.isArray(rows))fail('集合数据无效');return new Set(rows);
            }
            if(take('(')){
                if(!Object.hasOwn(calls,name))fail(`禁止调用 ${name}`);
                const args=[];if(!take(')'))do{args.push(expression());if(take(')'))break;expect(',');}while(true);
                return calls[name](...args);
            }
            return Object.hasOwn(locals,name)?locals[name]:resolve(name);
        };
        const atom=()=>{if(++depth>128)fail('数据表达式嵌套过深');try{return readAtom();}finally{depth--;}};
        const expression=(minimum=0)=>{
            let value=atom();
            while(true){skip();const op=/^(\*\*|===|!==|==|!=|>=|<=|&&|\|\||[+\-*/%<>])/.exec(text.slice(at))?.[0];if(!op||binary[op]<minimum)break;at+=op.length;value=apply(op,value,expression(binary[op]+(op==='**'?0:1)));}
            return value;
        };
        const value=expression();skip();if(at!==text.length)fail(`不支持的数据表达式，位置 ${at}`);return value;
    }
    const adaptGameSource=(()=>{
const idStart = /[$_\p{ID_Start}]/u, idPart = /[$_\u200c\u200d\p{ID_Continue}]/u;
const before = new Set('return throw case delete void typeof new in instanceof else do yield await'.split(' '));
const control = new Set(['if','for','while','with','switch','catch']);
const operators = /^(?:>>>=|===|!==|>>>|\*\*=|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|\*\*|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\.\.\.)/;
function scanner(source, start = 0, end = source.length, nesting = 0, shapeMode = false) {
    if (nesting > 64) throw new Error('Template nesting limit');
    let pos = start, previous = null, allowed = true;
    const contexts = [{token:'{',expr:false}];
    const current = () => contexts[contexts.length - 1];
    const fail = message => { throw new Error(`${message} at ${pos}`); };
    function template() {
        pos++;
        while (pos < end) {
            const c = source[pos++];
            if (c === '\\') { pos++; continue; }
            if (c === '`') return;
            if (c === '$' && source[pos] === '{') {
                const inner = scanner(source, ++pos, end, nesting + 1);
                let depth = 0, token;
                while ((token = inner.next())) {
                    if (token.value === '{') depth++;
                    if (token.value === '}' && depth-- === 0) { pos = token.end; break; }
                }
                if (!token) fail('Unterminated template interpolation');
            }
        }
        fail('Unterminated template');
    }
    function next() {
        while (pos < end) {
            if (/\s/.test(source[pos])) { pos++; continue; }
            if (source[pos] === '/' && source[pos + 1] === '/') {
                pos += 2; while (pos < end && !/[\r\n]/.test(source[pos])) pos++;
                continue;
            }
            if (source[pos] === '/' && source[pos + 1] === '*') {
                const close = source.indexOf('*/',pos + 2);
                if (close < 0 || close + 2 > end) fail('Unterminated comment');
                pos = close + 2; continue;
            }
            if (pos === 0 && source.startsWith('#!')) {
                while (pos < end && !/[\r\n]/.test(source[pos])) pos++;
                continue;
            }
            break;
        }
        if (pos >= end) return null;
        const tokenStart = pos, c = source[pos];
        let type = 'punct';
        if (c === '"' || c === "'") {
            type = 'string'; pos++;
            while (pos < end && source[pos] !== c) {
                if (/[\r\n]/.test(source[pos])) fail('Unterminated string');
                if (source[pos++] === '\\') { if (source[pos] === '\r' && source[pos + 1] === '\n') pos++; pos++; }
            }
            if (pos >= end) fail('Unterminated string');
            pos++;
        } else if (c === '`') { type = 'template'; template(); }
        else if (c === '/' && allowed) {
            type = 'regexp'; pos++;
            let inClass = false, closed = false;
            while (pos < end) {
                const ch = source[pos++];
                if (/[\r\n]/.test(ch)) fail('Unterminated regex');
                if (ch === '\\') { pos++; continue; }
                if (ch === '[') inClass = true;
                if (ch === ']') inClass = false;
                if (ch === '/' && !inClass) { closed = true; break; }
            }
            if (!closed) fail('Unterminated regex');
            while (pos < end && idPart.test(source[pos])) pos++;
        } else if (idStart.test(String.fromCodePoint(source.codePointAt(pos))) || c === '\\') {
            type = 'name';
            do {
                if (source[pos] === '\\') {
                    const escape = /^\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\})/.exec(source.slice(pos,pos + 14));
                    if (!escape) fail('Invalid identifier escape');
                    pos += escape[0].length;
                } else pos += source.codePointAt(pos) > 65535 ? 2 : 1;
            } while (pos < end && (idPart.test(String.fromCodePoint(source.codePointAt(pos))) || source[pos] === '\\'));
        } else if (shapeMode && c === '#') { type = 'num'; pos++; }
        else if (/\d/.test(c) || c === '.' && /\d/.test(source[pos + 1] || '')) {
            type = 'num';
            const number = /^(?:0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?n?)/.exec(source.slice(pos,pos + 256));
            if (!number) fail('Invalid number');
            pos += number[0].length;
        } else { const operator = operators.exec(source.slice(pos,pos + 4)); pos += operator ? operator[0].length : 1; }
        const value = source.slice(tokenStart,pos), token = {value,start:tokenStart,end:pos,type};
        const prev = previous?.value, parent = current();
        const beforeExpr = type === 'punct' ? ![')',']','}','.','?.','++','--'].includes(value) : before.has(value);
        if (type === 'string' || type === 'template' || type === 'num' || type === 'regexp') allowed = false;
        else if (prev === '.' || prev === '?.') allowed = false;
        else if (value === '(') { contexts.push({token:'(',expr:!control.has(prev) || !!previous?.property}); allowed = true; }
        else if (value === '{') {
            let block = parent.token === 'function';
            if (!block) {
                if (prev === ':' && parent.token === '{') block = !parent.expr;
                else if (prev === 'return' || previous?.type === 'name' && allowed) block = /[\r\n]/.test(source.slice(previous.end,tokenStart));
                else if (!previous || ['else',';',')','=>'].includes(prev)) block = true;
                else if (prev === '{') block = !parent.expr;
                else if (['var','const','let'].includes(prev) || previous?.type === 'name') block = false;
                else block = !allowed;
            }
            contexts.push({token:'{',expr:!block}); allowed = true;
        } else if (value === ')' || value === '}') {
            let closed = contexts.length > 1 ? contexts.pop() : {expr:false};
            if (value === '}' && !closed.expr && current().token === 'function') closed = contexts.pop();
            allowed = !closed.expr;
        } else if (value === 'function' || value === 'class') {
            const expression = previous?.beforeExpr && prev !== 'else' && !(prev === ';' && parent.token !== '(') && !(prev === 'return' && /[\r\n]/.test(source.slice(previous.end,tokenStart))) && !([':','{'].includes(prev) && parent.token === '{' && !parent.expr);
            contexts.push({token:'function',expr:!!expression,generator:false}); allowed = false;
        } else if (value === ':') { if (parent.token === 'function') contexts.pop(); allowed = true; }
        else if (value === '++' || value === '--') {}
        else if (value === '*' && prev === 'function') { parent.generator = true; allowed = true; }
        else if (type === 'name') allowed = before.has(value) || value === 'of' && !allowed;
        else allowed = beforeExpr;
        token.beforeExpr = beforeExpr;
        token.property = prev === '.' || prev === '?.';
        previous = token;
        return token;
    }
    return {next};
}
function tokenize(source,start = 0,end = source.length,shapeMode = false) {
    const reader = scanner(source,start,end,0,shapeMode), tokens = [];
    for (let token; (token = reader.next());) { const {value,start,end,type} = token; tokens.push({value,start,end,type}); }
    return tokens;
}
function topLevelArrowFunction(entry) {
    const expression = entry.expression;
    if (entry.kind !== 'const' || !expression || expression.length > 250000 || !/^(?:[A-Za-z_$][\w$]*|\(\s*(?:[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*)?\))\s*=>/.test(expression)) return entry;
    const tokens = tokenize(expression), arrow = tokens.findIndex(token => token.value === '=>');
    if (arrow < 1 || /[\r\n\u2028\u2029]/.test(expression.slice(tokens[arrow-1].end,tokens[arrow].start))) return entry;
    const parameters = tokens[0].value === '(' ? tokens.slice(1,arrow-1) : tokens.slice(0,arrow);
    const reserved = new Set('arguments eval this super async await yield break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return static switch throw true try typeof var void while with'.split(' '));
    if (parameters.some((token,index) => index % 2 ? token.value !== ',' : token.type !== 'name' || reserved.has(token.value)) || parameters.length && parameters.length % 2 === 0) return entry;
    const params = parameters.filter((_,index) => index % 2 === 0).map(token => token.value);
    if (new Set(params).size !== params.length) return entry;
    const bodyTokens = tokens.slice(arrow+1);
    if (!bodyTokens.length || bodyTokens.some((token,index) => token.type === 'name' && (['this','arguments','super','eval','await','yield'].includes(token.value) || token.value.includes(String.fromCharCode(92))) || token.type === 'punct' && token.value === String.fromCharCode(92) || token.type === 'template' && token.value.includes('$'+'{') || token.value === 'new' && bodyTokens[index+1]?.value === '.' && bodyTokens[index+2]?.value === 'target')) return entry;
    const stack = [], pairs = {'(':')','[':']','{':'}'};
    for (const [index,token] of bodyTokens.entries()) {
        if (pairs[token.value]) stack.push(pairs[token.value]);
        else if ([')',']','}'].includes(token.value) && stack.pop() !== token.value) return entry;
        if (bodyTokens[0].value === '{' && !stack.length && index !== bodyTokens.length-1) return entry;
    }
    if (stack.length) return entry;
    const block = bodyTokens[0].value === '{';
    const body = block ? expression.slice(bodyTokens[0].end,bodyTokens.at(-1).start) : 'return ' + expression.slice(bodyTokens[0].start,bodyTokens.at(-1).end);
    return {...entry,kind:'function',params:params.join(','),body,valueForm:entry};
}
function indexTopLevel(source,{maxSourceLength = 12000000,maxDeclarations = 30000} = {}) {
    if (typeof source !== 'string' || source.length > maxSourceLength) throw new Error('Source size limit');
    const reader = scanner(source), result = new Map();
    let token, previous = null, depth = 0;
    const add = (name,entry) => {
        if (result.has(name)) throw new Error(`Duplicate top-level binding: ${name}`);
        if (result.size >= maxDeclarations) throw new Error('Declaration count limit');
        result.set(name,entry);
    };
    const balanced = (open,close) => {
        let level = 1, t;
        while ((t = reader.next())) { if (t.value === open) level++; if (t.value === close && --level === 0) return t; }
        throw new Error(`Unclosed ${open}`);
    };
    function binding(pattern,entry) {
        let i = 0;
        function walk(path) {
            const first = pattern[i++];
            if (!first) throw new Error('Missing binding');
            if (first.type === 'name') { add(first.value,{...entry,kind:'binding',source:entry.expression,property:path?.length === 1 ? path[0] : null,path}); return; }
            const object = first.value === '{', close = object ? '}' : ']';
            if (!object && first.value !== '[') throw new Error('Unsupported binding pattern');
            let index = 0;
            while (pattern[i]?.value !== close) {
                if (pattern[i]?.value === ',') { i++; index++; continue; }
                if (pattern[i]?.value === '...') { i++; walk(null); }
                else {
                    const keyToken = object ? pattern[i++] : null;
                    let key = object ? keyToken.value : String(index++);
                    if (keyToken?.type === 'string') key = key.startsWith('"') ? JSON.parse(key) : /^'[\w$]+'$/.test(key) ? key.slice(1,-1) : null;
                    if (object && key === '[') {
                        let nesting = 1;
                        while (i < pattern.length && nesting) { const value = pattern[i++].value; if (value === '[') nesting++; if (value === ']') nesting--; }
                        key = null;
                    }
                    const nextPath = path && key !== null ? [...path,key] : null;
                    if (object && pattern[i]?.value === ':') { i++; walk(nextPath); }
                    else if (object) { i--; walk(nextPath); }
                    else walk(nextPath);
                }
                if (pattern[i]?.value === '=') {
                    i++; let nesting = 0;
                    while (i < pattern.length && (nesting || ![',',close].includes(pattern[i].value))) {
                        const value = pattern[i++].value;
                        if (['(','[','{'].includes(value)) nesting++;
                        if ([')',']','}'].includes(value)) nesting--;
                    }
                }
                if (pattern[i]?.value === ',') i++;
                else if (pattern[i]?.value !== close) throw new Error('Invalid binding pattern');
            }
            i++;
        }
        walk([]);
    }
    while ((token = reader.next())) {
        const value = token.value;
        if (!depth && ['const','let','var'].includes(value)) {
            const kind = value;
            while (true) {
                const name = reader.next();
                if (!name) throw new Error('Missing declaration');
                const pattern = [name];
                let next = reader.next();
                if (name.value === '{' || name.value === '[') {
                    let nesting = 1;
                    while (next && nesting) { pattern.push(next); if (['{','['].includes(next.value)) nesting++; if (['}',']'].includes(next.value)) nesting--; if (nesting) next = reader.next(); }
                    if (nesting) throw new Error('Unclosed binding');
                    next = reader.next();
                }
                const expressionStart = next?.value === '=' ? next.end : name.end;
                let expressionEnd = expressionStart, nested = 0;
                if (next?.value === '=') {
                    while ((next = reader.next())) {
                        if (!nested && [',',';'].includes(next.value)) break;
                        if (['(','[','{'].includes(next.value)) nested++;
                        if ([')',']','}'].includes(next.value)) nested--;
                        if (nested < 0) throw new Error('Invalid declaration boundary');
                        expressionEnd = next.end;
                    }
                }
                if (nested) throw new Error('Unclosed initializer');
                const entry = {kind,expression:expressionEnd > expressionStart ? source.slice(expressionStart,expressionEnd).trim() : null,start:name.start,end:expressionEnd};
                if (pattern.length === 1 && name.type === 'name') add(name.value,topLevelArrowFunction(entry));
                else binding(pattern,entry);
                if (next?.value !== ',') { previous = next; break; }
            }
            continue;
        }
        if (!depth && value === 'function' && (!previous || [';','}','export','default','async'].includes(previous.value))) {
            let name = reader.next();
            if (name?.value === '*') name = reader.next();
            if (name?.type !== 'name') throw new Error('Missing function name');
            const open = reader.next();
            if (open?.value !== '(') throw new Error('Missing function parameters');
            const functionStart = previous?.value === 'async' ? previous.start : token.start;
            const paramsEnd = balanced('(',')'), bodyStart = reader.next();
            if (bodyStart?.value !== '{') throw new Error('Missing function body');
            const end = balanced('{','}');
            add(name.value,{kind:'function',params:source.slice(open.end,paramsEnd.start),body:source.slice(bodyStart.end,end.start),expression:source.slice(functionStart,end.end),start:functionStart,end:end.end});
            previous = end; continue;
        }
        if (['(','[','{'].includes(value)) depth++;
        if ([')',']','}'].includes(value)) depth--;
        if (depth < 0) throw new Error('Invalid top-level boundary');
        previous = token;
    }
    if (depth) throw new Error('Unclosed source');
    return result;
}
function adaptiveSchema() {
    const names=["ro","Om","aa","GD","Mu","vD","yD","qS","Z2","wD","HD","YD","ff","wt","Se","$d","Pc","TS","mO","ar","Jc","go","Xl","md","Ju","vm","PD","cn","Cd","oH","rs","UD","Wr","BS","I1","gO","wz","Hi","ag","JD","yz","tH","Vc","_D","Bt","JS","_l","Az","Aa","Ud","yd","bf","c6","Bc","xz","pf","_S","QS","Bb","pd","ga","T6","Qb","Ym","V6","Zb","Am","sx","E6","X6","Da","dx","h4","ow","cw","ew","nx","nj","ij","rj","hj","UH","uj","mj","dr","Ji","Tx","fj","Ns","gj","bj","pj","Oj","Gj","vj","Sr","uw","Hn","Hj","Ce","je","Nx","Nd","Zx","lq","iq","rq","Rq","Mq","Sd","vt","Sw","kw","Hw","Wu","bb","Yw","Lq","Jq","P4","Ls","yK","ir","Qq","tT","$a","G9","v9","y9","S9","b0","k9","H9","eF","Jw","aF","R9","_6","yt","O0","Af","Nm","fF","E4","LS","Pl","$D","dH","QD","ZD","WD","Rz","On","XD","VC","rp","wB","yB","SB","PB","BC","Cdo","LC","aH","ED","Un","Um","fireworks","fireworkPowder","fireworkIds","vz","recordUpgrade","upgradeTarget","upgradeExtra","upgradeInputs","upgradeGear","upgradeOther","jobQuality","qualityInput","jobOutput","jobInputs","upgradeMaterials","excludedCollection","collectionCount","collectionMilestone","G2","qualityEventMult","qualityHouseCurve","forgePetMultiplier","forgeBaseChance","forgeSuccess","forgeSkillMultiplier","forgeMasteryMultiplier","forgeHouseBonus","UT","xo","Ge","hy","su","Fj","xj","Sk","xx","Kx","yk","Xa","Xi","_i","xl","JU","EU","XU","_U","QU","ZU","bi","Yt","ql","wf","cb","Vx","Kn","av","Sy","CO","lf","zk","oT","Bx","eT","Fh","oG","Ov","Po","Ad","gt","zh","as","Yo","jo","Zf","cT","fy","ic","ze","Jn","Kl","pa","Lx","qn","Qe","II","ly","kO","yx","$H","Xm","pi","bY","ad","gY","pY","Vs","Bq","__native_Lq","VK","Vq","vY","zy","Fy","__native_Ym","a2","Ho","Kh","VU","E9","Lk","Ph","Z9","fI","bI","vI","$o","cG","m2","h2","tG","sf","WW","$h","zW","xW","KI","u2","TI","KW","YW","CI","Sf","Yn","EW","fa","iP","Zl","rB","ri","lG","FO","vB","Hv","uS","bv","__native_wB","oA","__native_yB","bP","gP","iG","__native_SB","MB","R7","cv","dY","Kj","RO","FW","Ix","du","Nb","yn","Ey","KY","PY","$Y","farmBaseYield","farmToolYield","farmPetChance","farmYieldBase","farmYieldThresholds","farmToolYieldRate","farmPetTicks","farmYieldSeed","farmEntrySeed","farmGrowthSeed","farmRaritySeed","farmSeedStride"],shapes=["#","$0 , $1 , $2 , $3 { return @0 ( $0 , $1 , $2 ) < $3 }","$0 , $1 , $2 , $3 , $4 , $5 { return $1 ? @0 ( @1 ( @2 ( $0 , $1 ( $5 ) , $2 ) , $3 , $4 ) ) / # : null }","{ journeyLevel : @0 , baseXp : @1 , growth : @2 , beyondStep : @3 , beyondGrowth : @4 , speedPerLevelAboveRequirement : @5 }","@0 . journeyLevel","@0 . baseXp","@0 . beyondGrowth","( ( ) => { const $0 = [ # , # ] ; for ( let $1 = # ; $1 <= @0 ; $1 ++ ) $0 [ $1 ] = Math . round ( @1 * ( @2 ** ( $1 - # ) - # ) / ( @2 - # ) ) ; let $2 = $0 [ @0 ] * @3 , $3 = $0 [ @0 ] ; for ( let $4 = @0 + # ; $3 += $2 , ! ( $3 > Number . MAX_SAFE_INTEGER ) ; $4 ++ ) $0 [ $4 ] = Math . round ( $3 ) , $2 *= @4 ; return $0 } ) ( )","@0 . growth","@0 . beyondStep","new Set ( [ # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # ] )","new Set ( [ # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # ] )","$0 { return @0 . has ( $0 % # ) }","[ { id : # , name : \"Gnawer\" , level : # , hp : # , maxHit : # , attack : # , defence : # , speed : # , xp : # , gold : [ # , # ] , bonus : { itemId : # , chance : # } , drop : # } , { id : # , name : \"Bogling\" , level : # , hp : # , maxHit : # , attack : # , defence : # , speed : # , ~tail~ , speed : # , xp : # , gold : [ # , # ] , bonus : { itemId : # , chance : # } , drop : # } , { id : # , name : \"Chalk wight\" , level : # , hp : # , maxHit : # , attack : # , defence : # , speed : # , xp : # , gold : [ # , # ] , bonus : { itemId : # , chance : # } , drop : # } ]","[ \"Normal\" , \"Uncommon\" , \"Rare\" , \"Epic\" , \"Legendary\" ]","$0 , $1 { return $1 === # ? $0 : $1 * @0 + $0 }","$0 { return $0 % @0 }","$0 { const $1 = @0 ( $0 ) ; return $1 >= @1 ? $1 % @1 : $1 }","[ # , # , # , # , # ]","{ legendary : # / # , epic : # / # , rare : # / # , uncommon : # / # }","$0 , $1 , $2 = # , $3 = @0 { const $4 = ( # + $1 ) * $2 ; return $0 < $3 . legendary * $4 ? # : $0 < $3 . epic * $4 ? # : $0 < $3 . rare * $4 ? # : $0 < $3 . uncommon * $4 ? # : # }","$0 { return $0 >= # && $0 <= # }","$0 { return { itemId : # , chanceAtReq : # , safeAtLevel : $0 + # } }","[ { id : # , name : \"Copper\" , skill : \"mining\" , group : \"Ore\" , levelReq : # , baseTicks : # , xp : # , inputs : @0 , output : { itemId : # , qty : # } } , { id : # , name : \"Tin\" , skill : \"mining\" , group : \"Ore\" , levelReq : # , baseTicks : # , xp : # , inputs : @0 , output : { itemId : # , qty : # } } , { id : ~tail~ { itemId : # , qty : # } } , ... @2 . map ( $0 => ( { id : $0 . jobId , name : $0 . name , skill : \"crafting\" , group : \"Fireworks\" , levelReq : $0 . level , baseTicks : $0 . baseTicks , xp : $0 . xp , inputs : [ ... $0 . inputs , { itemId : @3 , qty : $0 . powder } ] , output : { itemId : $0 . itemId , qty : # } } ) ) ]","[ { itemId : # , slot : \"pickaxe\" , bonus : # } , { itemId : # , slot : \"pickaxe\" , bonus : # } , { itemId : # , slot : \"pickaxe\" , bonus : # } , { itemId : # , slot : \"pickaxe\" , bonus : # } , { itemId : # , slot : \"pickaxe\" , bonus : # } , { itemId : # , slot : \"rod\" , bonus : # } , { itemId : # , slot : \"rod\" , bonus : ~tail~ : # , slot : \"mortar\" , bonus : # } , { itemId : # , slot : \"hoe\" , bonus : # } , { itemId : # , slot : \"hoe\" , bonus : # } , { itemId : # , slot : \"hoe\" , bonus : # } , { itemId : # , slot : \"hoe\" , bonus : # } , { itemId : # , slot : \"hoe\" , bonus : # } , { itemId : # , slot : \"mount\" , bonus : # } ]","$0 { const $1 = @0 . get ( $0 ) ; return $1 || ( @1 ( $0 ) >= # ? @2 ( $0 ) : void # ) }","$0 { const $1 = @0 . get ( $0 ) ; if ( $1 ) return $1 ; const $2 = @1 . get ( @2 ( $0 ) ) ; if ( ! $2 ) return ; const $3 = { itemId : $0 , slot : $2 . slot , bonus : $2 . bonus * ( # + ( $2 . slot === \"mount\" ? @3 : @4 ) * @5 ( $0 ) ) } ; return @0 . set ( $0 , $3 ) , $3 }","{ pickaxe : \"mining\" , rod : \"fishing\" , axe : \"woodcutting\" , gloves : \"thieving\" , pan : \"cooking\" , hammer : \"smithing\" , knife : \"fletching\" , needle : \"crafting\" , mortar : \"herblore\" , hoe : \"farming\" }","$0 { const $1 = @0 ( $0 ) ; if ( ! $1 || $1 . slot === \"mount\" ) return null ; const $2 = @1 . find ( $3 => $3 . output . itemId === @2 ( $0 ) ) ; return { skill : @3 [ $1 . slot ] , level : $2 ?. levelReq ?? # } }","$0 { return @0 [ @1 ( $0 ) ] }","[ { id : # , name : \"Drakestring shortbow\" , from : # , recipe : # , skill : \"fletching\" , make : # , xp : # , extra : [ { itemId : @0 , qty : # , perTier : ! # } ] , wear : # , accuracy : # , strength : # , defence : # } , { id : # , name : \"Drakestring longbow\" , from : # , recipe : # , skill : \"fletching\" , make : # , xp : # , extra ~tail~ : @1 , qty : # , perTier : ! # } ] , wear : # , accuracy : # , strength : # , defence : # } , { id : # , name : \"Abyssweave grimoire\" , from : # , recipe : # , skill : \"crafting\" , make : # , xp : # , extra : [ { itemId : @1 , qty : # , perTier : ! # } ] , wear : # , accuracy : # , strength : # , defence : # } ]","@0 . map ( $0 => $0 . id )","$0 => [ { itemId : @0 , qty : $0 , perTier : ! # } ]","[ { id : # , name : \"Colossus blade\" , from : # , job : # , recipe : # , skill : \"smithing\" , make : # , xp : # , extra : @0 ( # ) } , { id : # , name : \"Colossus greatsword\" , from : # , job : # , recipe : # , skill : \"smithing\" , make : # , xp : # , extra : @0 ( # ) } , { id : # , name : \"Colossus shield\" , from : # , ~tail~ , name : \"Drake chaps\" , from : # , job : # , recipe : # , skill : \"crafting\" , make : # , xp : # , extra : @1 ( # ) } , { id : # , name : \"Drake quiver\" , from : # , job : # , recipe : # , skill : \"fletching\" , make : # , xp : # , extra : [ ... @1 ( # ) , { itemId : @2 , qty : # , perTier : ! # } ] } ]","[ { itemId : # , slot : \"weapon\" , accuracy : # , strength : # , defence : # , speed : @0 , levelReq : # , needs : \"melee\" } , { itemId : # , slot : \"weapon\" , accuracy : # , strength : # , defence : # , speed : @0 , levelReq : # , needs : \"melee\" } , { itemId : # , slot : \"weapon\" , accuracy : # , strength : # , defence : # , speed : @0 , levelReq : ~tail~ speed : @3 , ranged : ! # , levelReq : # , needs : \"ranged\" } , { itemId : # , slot : \"weapon\" , accuracy : # , strength : # , defence : # , speed : @3 , ranged : ! # , levelReq : # , needs : \"ranged\" } , { itemId : # , slot : \"weapon\" , accuracy : # , strength : # , defence : # , speed : @3 , ranged : ! # , levelReq : # , needs : \"ranged\" } ]","new Map","$0 { const $1 = @0 . get ( $0 ) ; if ( $1 ) return $1 ; const $2 = @1 . get ( @2 ( $0 ) ) ; if ( ! $2 ) return ; const $3 = # + @3 * @4 ( $0 ) , $4 = { ... $2 , itemId : $0 , accuracy : Math . round ( $2 . accuracy * $3 ) , strength : Math . round ( $2 . strength * $3 ) , defence : Math . round ( $2 . defence * $3 ) , ... $2 . luck !== void # ? { luck : $2 . luck * $3 } : { } } ; return @0 . set ( $0 , $4 ) , $4 }","$0 { const $1 = @0 ( $0 ) ; return @1 . has ( $1 ) || @2 ( $1 ) !== void # }","new Map ( @0 . map ( $0 => [ $0 . itemId , $0 ] ) )","$0 { return $0 . amulet === null ? # : @0 ( $0 . amulet ) ?. luck ?? # }","[ { id : # , name : \"Copper\" , stackable : ! # , value : # } , { id : # , name : \"Tin\" , stackable : ! # , value : # } , { id : # , name : \"Iron\" , stackable : ! # , value : # } , { id : # , name : \"Silver\" , stackable : ! # , value : # } , { id : # , name : \"Coal\" , stackable : ! # , value : # } , ~tail~ , value : # } , { id : # , name : \"Vein of gems\" , stackable : ! # , value : # } , { id : # , name : \"Hoard of gems\" , stackable : ! # , value : # } , { id : @4 , name : \"Firework powder\" , stackable : ! # , value : # } , ... @5 . map ( $0 => ( { id : $0 . itemId , name : $0 . name , stackable : ! # , value : # } ) ) ]","$0 { return @0 . has ( $0 ) }","@0 . map ( $0 => { const $1 = $2 => @1 . find ( $3 => $3 . id === $2 ) . value ; return { id : $0 . id , name : $0 . name , stackable : ! # , value : $1 ( $0 . from ) + $0 . extra . reduce ( ( $4 , $5 ) => $4 + $1 ( $5 . itemId ) * $5 . qty , # ) } } )","[ \"mining\" , \"fishing\" , \"woodcutting\" , \"farming\" , \"thieving\" , \"cooking\" , \"smithing\" , \"fletching\" , \"herblore\" , \"crafting\" , \"enhancing\" , \"melee\" , \"ranged\" , \"magic\" , \"defence\" , \"hitpoints\" ]","{ mining : \"Mining\" , fishing : \"Fishing\" , woodcutting : \"Woodcutting\" , farming : \"Farming\" , cooking : \"Cooking\" , smithing : \"Smithing\" , fletching : \"Fletching\" , enhancing : \"Enhancing\" , melee : \"Melee\" , ranged : \"Ranged\" , defence : \"Defence\" , hitpoints : \"Hitpoints\" , magic : \"Magic\" , herblore : \"Herblore\" , crafting : \"Crafting\" , thieving : \"Thieving\" }","[ \"mining\" , \"fishing\" , \"woodcutting\" , \"farming\" , \"thieving\" ]","[ \"cooking\" , \"smithing\" , \"fletching\" , \"herblore\" , \"crafting\" , \"enhancing\" ]","[ \"melee\" , \"ranged\" , \"magic\" , \"defence\" , \"hitpoints\" ]","$0 , $1 , $2 = ! # { if ( $2 ) return # ; const $3 = @0 ( $0 ) ; return $3 . kind === \"rarity\" && @1 ( $3 , $1 ) ? $3 . mult : # }","$0 { return # + # * Math . max ( # , Math . floor ( $0 ) ) }","$0 , $1 { return # + @0 ( $0 , $1 ) }","[ { id : # , name : \"The Warrens\" , monsterId : # , population : # , x : # , y : # , width : # , height : # } , { id : # , name : \"Mirefen\" , monsterId : # , population : # , x : # , y : # , width : # , height : # } , { id : # , name : \"Dust Hollow\" , monsterId : # , population : # , x : # , y : # , width : ~tail~ : \"Gritmaw\" , monsterId : # , population : # , x : # , y : # , width : # , height : # } , { id : # , name : \"Hollowbarrow\" , monsterId : # , population : # , x : # , y : # , width : # , height : # } , { id : # , name : \"The Chalk Steps\" , monsterId : # , population : # , x : # , y : # , width : # , height : # } ]","# / #","$0 { return $0 < @0 ? @1 + $0 - # : @2 + $0 - @0 }","@0 - #","$0 { const $1 = @0 ( $0 ) ; return $1 >= @1 && $1 < @1 + @2 || $1 >= @3 && $1 < @3 + @4 || @5 ( $1 ) }","$0 { const $1 = @0 ( $0 ) ; return $1 >= # && $1 <= # }","[ { itemId : # , skill : \"mining\" , art : \"pebble-golem\" } , { itemId : # , skill : \"fishing\" , art : \"baby-kraken\" } , { itemId : # , skill : \"woodcutting\" , art : \"acorn-squirrel\" } , { itemId : # , skill : \"farming\" , art : \"queen-bee\" } , { itemId : # , skill : \"thieving\" , art : \"raccoon\" } , { itemId : # , skill : \"cooking\" , art : \"chef-rat\" } , { itemId : # , skill : \"smithing\" , art : \"ember-salamander\" } , { itemId : # , skill : \"fletching\" , art : \"fletch-falcon\" } , { itemId : # , skill : \"herblore\" , art : \"toadstool\" } , { itemId : # , skill : \"crafting\" , art : \"yarn-kitten\" } , { itemId : # , skill : \"enhancing\" , art : \"star-fairy\" } ]","$0 { return Math . min ( # , @0 * ( $0 === \"enhancing\" ? @1 : # ) ) }","$0 { return @0 . find ( $1 => $1 . skill === $0 ) }","$0 , $1 , $2 , $3 { if ( $1 . length === $2 ) return ; const $4 = $0 . tally ; let $5 = ! # , $6 = null , $7 = null , $8 = ! # ; for ( let $9 = $2 ; $9 < $1 . length ; $9 ++ ) { const $10 = $1 [ $9 ] ; switch ( $10 . kind ) { case \"produced\" : if ( $10 . itemId !== # ) { $0 . collection [ $10 . itemId ] === void # && ( $8 = ! # ) , $0 . collection [ $10 . itemId ] = # ; const $11 = @0 ( $10 . itemId ) ; @1 . has ( @2 ( $10 . itemId ) ) || ( $0 . collections [ $11 ] = ( $0 . collections [ $11 ] ?? # ) + ( $10 . qty ?? # ) ) , $4 . made += $10 . qty ?? # ; const $12 = @2 ( $10 . itemId ) ; $4 . items [ $12 ] = ( $4 . items [ $12 ] ?? # ) + ( $10 . qty ?? # ) , ( $6 ??= new Set ) . add ( $12 ) } $5 = ! # ; break ; case \"bonus\" : case \"pet\" : $0 . collection [ $10 . itemId ] === void # && ( $8 = ! # ) , $0 . collection [ $10 . itemId ] = # , $0 . collections [ $10 . itemId ] = ( $0 . collections [ $10 . itemId ] ?? # ) + # , $5 = ! # ; break ; case \"box\" : { const $13 = $10 . itemId ?? @3 ; $0 . collection [ $13 ] === void # && ( $8 = ! # ) , $0 . collection [ $13 ] = # , $0 . collections [ $13 ] = ( $0 . collections [ $13 ] ?? # ) + # , $5 = ! # ; break } case \"voidshard\" : case \"enhanced\" : $0 . collection [ $10 . itemId ] === void # && ( $8 = ! # ) , $0 . collection [ $10 . itemId ] = # , $5 = ! # ; break ; case \"killed\" : $4 . kills ++ , $4 . monsters [ $10 . monsterId ] = ( $4 . monsters [ $10 . monsterId ] ?? # ) + # , ( $7 ??= new Set ) . add ( $10 . monsterId ) , $5 = ! # ; break ; case \"died\" : $4 . deaths ++ , $5 = ! # ; break ; case \"caught\" : $4 . caught ++ , $5 = ! # ; break ; case \"questDone\" : $4 . questsDone ++ , $5 = ! # ; break ; case \"ate\" : $4 . eaten ++ , $5 = ! # ; break ; case \"burnt\" : $4 . burnt ++ , $5 = ! # ; break ; case \"levelUp\" : $5 = ! # ; break } } if ( ! $5 ) return ; const $14 = $8 || ! @4 . has ( $0 ) , $15 = @5 ( $0 ) , $16 = @6 . get ( $0 ) !== $15 ; let $17 = @7 . get ( $0 ) ; $17 || @7 . set ( $0 , $17 = new Uint8Array ( @8 . length ) ) ; for ( let $18 = # ; $18 < @8 . length ; $18 ++ ) { if ( $17 [ $18 ] === # || @9 [ $18 ] && ! $14 || @10 [ $18 ] && ! $16 ) continue ; const $19 = @8 [ $18 ] ; @11 ( $0 , $19 , $3 ) , $0 . achievements [ $19 . id ] !== void # ? $17 [ $18 ] = # : $18 = @12 [ $18 ] - # } if ( @4 . add ( $0 ) , @6 . set ( $0 , $15 ) , $6 ) for ( const $20 of $6 ) @13 ( $0 , @14 . get ( $20 ) , $3 ) ; if ( $7 ) for ( const $21 of $7 ) @13 ( $0 , @15 . get ( $21 ) , $3 ) }","[ # , # , # , # , # , # , # , # ]","[ # ]","$0 { return $0 !== void # && @0 ( $0 ) ? @1 : @2 }","$0 , $1 , $2 { if ( $2 !== void # && @0 ( $2 ) ) return $0 === # ? @1 * @2 : # ; const $3 = @3 [ $0 ] ; return $3 === void # ? # : $3 * @4 [ $1 ] * @2 }","$0 , $1 , $2 { const $3 = @0 ( $0 , $2 ) ; let $4 = # ; for ( let $5 = # ; $5 <= $3 ; $5 ++ ) $4 += @1 ( $5 , $1 , $2 ) ; return $4 }","$0 { let $1 = # ; for ( const $2 in $0 ) @0 ( Number ( $2 ) ) || ( $1 += @1 ( $0 [ $2 ] , @2 ( Number ( $2 ) ) , @3 ( Number ( $2 ) ) ) ) ; return $1 }","[ # , # , # , # , # , # ]","[ # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # , # ]","$0 , $1 , $2 { if ( $2 > @0 ) return # ; const $3 = @1 [ $2 - # ] , $4 = @2 [ $0 - # ] , $5 = @3 [ $1 ] ; return $3 === void # || $4 === void # || $5 === void # ? # : Math . max ( @4 , Math . round ( $4 * $5 * $3 / @5 ) ) }","$0 { let $1 = # ; if ( ! $0 ) return # ; for ( const $2 in $0 ) { const $3 = Number ( $2 ) ; $3 >= # && $3 < @0 && ( $1 += @1 ( $3 , $0 [ $3 ] ) ) } return $1 }","$0 { return @0 ( $0 . collections ) + @1 ( $0 . forgeLog ) }","new Set ( [ # , # , # , # ] )","$0 { const $1 = @0 ( $0 ) ; return $1 . id !== @1 && ( $1 . value > # || $1 . id === @2 || @3 . has ( @4 ( $1 . id ) ) ) && ! @5 . has ( $1 . id ) && ! @6 ( $1 . id ) }","[ { id : \"mine\" , name : \"The mine\" , bonus : { kind : \"gatherSpeed\" , skill : \"mining\" } , feeds : \"wood\" , look : \"house-mine\" , blurb : \"Timber props hold the shaft: every log shores it deeper, and you mine the faster for it.\" } , { id : \"sawmill\" , name : \"The sawmill\" , bonus : { kind : \"gatherSpeed\" , skill : \"woodcutting\" } , feeds : \"stone\" , look : \"house-sawmill\" , blurb : \"Millstones and blades of ore: the sharper the mill, the quicker the felling.\" } , { id : \"pond\" , name : \"The pond\" , bonus : { kind : \"gatherSpeed\" , skill : \"fishing\" } , feeds : \"stone\" , look : ~tail~ : { kind : \"dmg\" , skill : \"magic\" } , rate : # , feeds : \"fish\" , look : \"house-altar\" , blurb : \"A stone altar with candles kept lit: the mind focused here casts with more force.\" } , { id : \"shrine\" , name : \"The lucky shrine\" , bonus : { kind : \"rareChance\" } , feeds : \"hide\" , look : \"house-shrine\" , rate : # , blurb : \"Coins on a little shrine and a four-leaf clover pressed under glass: fortune, everywhere you look for it. Half a lift a level -- it reaches every skill.\" } , { id : \"storeroom\" , name : \"The storeroom\" , bonus : { kind : \"bankSlots\" } , feeds : \"wood\" , look : \"house-store\" , rate : # , blurb : \"Shelves and crates: one more shelf in Storage for every two levels.\" } ]","[ ... @0 , ... @1 ]","$0 , $1 { if ( ! @0 ( $0 ) ) return # ; let $2 = # ; for ( const $3 of @1 ) @2 ( $0 , $3 . id ) && ( $3 . bonus . kind === \"gatherSpeed\" || $3 . bonus . kind === \"craftSpeed\" ) && $3 . bonus . skill === $1 && ( $2 += @3 ( $3 , @4 ( $0 , $3 . id ) ) ) ; return # + $2 }","$0 , $1 , $2 { return @0 ( @1 ( $1 . windows , $2 ) . rarityMult , # + @2 * @3 ( $0 , \"hunter\" ) , @4 ( $0 , \"blessing\" ) ? @5 : # , @6 ( $2 , \"combat\" , $1 . hypothetical ) , @7 ( $0 . masteries , \"rare\" ) ) }","$0 , $1 , $2 , $3 , $4 { $0 . actionIndex ++ ; const $5 = @0 ( $0 , \"kill\" ) , $6 = $2 . gold [ # ] - $2 . gold [ # ] + # , $7 = @1 ( $1 . seed , $1 . secretAt , @2 , $0 . id , $5 , $3 ) , $8 = $7 === null ? # : Math . floor ( ( $2 . gold [ # ] + $7 % $6 ) * ( # + @3 * @4 ( $0 , \"abyssal\" ) ) ) ; @5 ( $0 , $8 , \"kill\" ) , $4 . push ( { kind : \"killed\" , monsterId : $2 . id , coins : $8 } ) , $8 > # && $4 . push ( { kind : \"produced\" , jobId : # , itemId : @6 , xp : # } ) ; const $9 = @7 ( $0 , $1 , $3 ) , $10 = @8 ( $1 . seed , $1 . secretAt , @9 , $0 . id , $5 , $3 ) , $11 = $2 . dropChance === void # ? # : @8 ( $1 . seed , $1 . secretAt , @10 , $0 . id , $5 , $3 ) ; if ( $10 !== null && $11 !== null && $11 < ( $2 . dropChance ?? # ) ) { const $12 = @11 ( $10 , @12 ( $0 . equipment ) , @13 ( $9 , @14 ( $0 ) ) ) , $13 = @15 ( $2 . drop , $12 ) ; @16 ( $0 , $13 , # ) , $4 . push ( { kind : \"produced\" , jobId : # , itemId : $13 , xp : # , tier : $12 , wire : ! # } ) } const $14 = @8 ( $1 . seed , $1 . secretAt , @17 , $0 . id , $5 , $3 ) ; if ( $14 !== null && $14 < @18 ) { const $15 = @19 ( $2 . id ) ; @16 ( $0 , $15 , # ) , $4 . push ( { kind : \"pet\" , itemId : $15 } ) } const $16 = ( # + @12 ( $0 . equipment ) ) * $9 , $17 = @8 ( $1 . seed , $1 . secretAt , @20 , $0 . id , $5 , $3 ) ; $17 !== null && $17 < Math . min ( # , $2 . bonus . chance * $16 ) && ( @16 ( $0 , $2 . bonus . itemId , # ) , $4 . push ( { kind : \"bonus\" , itemId : $2 . bonus . itemId } ) ) ; const $18 = @8 ( $1 . seed , $1 . secretAt , @21 , $0 . id , $5 , $3 ) ; if ( $18 !== null && $18 < @22 ( $2 . level ) ) { const $19 = @23 ( $2 . level ) ; @16 ( $0 , @24 , $19 ) , $4 . push ( { kind : \"voidshard\" , itemId : @24 , qty : $19 } ) } $0 . foeIndex !== null && ( $0 . lastFoe = $0 . foeIndex ) , $0 . foeIndex = null , $0 . foeHp = # , @25 ( $0 ) }","$0 , $1 , $2 { return @0 ( $0 , $1 , $2 ) ? \"pack\" : ( $0 . bank [ $1 ] = ( $0 . bank [ $1 ] ?? # ) + $2 , \"bank\" ) }","$0 , $1 , $2 { const $3 = @0 ( $0 . skills [ $1 ] ) ; return $0 . skills [ $1 ] += $2 , { before : $3 , after : @0 ( $0 . skills [ $1 ] ) } }","$0 { const $1 = @0 . find ( $2 => $2 . output . itemId === $0 ) ; return $1 ? $1 . levelReq : @1 . find ( $3 => $3 . to . includes ( $0 ) ) ?. levelReq }","$0 { const $1 = @0 ( @1 ( $0 ) ) ; if ( $1 === void # ) return @2 ; let $2 = # ; for ( const $3 of @3 ) $1 >= $3 && $2 ++ ; return $2 }","$0 , $1 , $2 , $3 { const $4 = $2 . itemId , $5 = @0 ( $4 ) , $6 = @1 ( $4 ) , $7 = @2 ( $4 , $2 . useCore === ! # && @3 ( $0 , $4 ) ) ; if ( ! @4 ( $0 , $2 ) || ! @5 ( $0 , $2 , $7 . gold ) || @6 ( $0 ) < $7 . shards ) return null ; const $8 = $2 . contract ? $0 . contract : null , $9 = $2 . order ? @7 ( $0 ) : null , $10 = $9 ?. kind === \"enhance\" ? $9 : null ; let $11 = # ; if ( $8 ) $8 . escrow -= $7 . gold , $8 . spent += $7 . gold , @8 ( $0 , \"enhance\" , $7 . gold ) ; else if ( $10 ) { const $12 = @9 ( $10 . tipLeft , $0 . coins , $7 . gold ) ; $11 = $12 . tip , $10 . tipLeft -= $12 . tip , $0 . coins -= $12 . bank , @8 ( $0 , \"enhance\" , $7 . gold ) } else @10 ( $0 , $7 . gold , \"enhance\" ) ; $7 . core ? @11 ( $0 ) : @12 ( $0 , $7 . shards ) , $0 . actionIndex ++ ; const $13 = @13 ( $0 , \"enhance\" ) , $14 = @14 ( $1 . seed , $1 . secretAt , @15 , $0 . id , $13 , $0 . lastTick ) , $15 = $14 !== null && $14 < @16 ( $0 , $5 ) , $16 = ! $15 && $2 . protectFrom !== void # && $5 >= Math . max ( @17 , $2 . protectFrom ) && @18 ( $0 ) > # ; $16 && @19 ( $0 , @20 , # ) ; const $17 = $16 && $8 ? @21 ( $0 , $8 ) : # , $18 = $15 ? @22 ( $6 , $5 + # ) : $16 ? @22 ( $6 , $5 - # ) : $6 ; $2 . itemId = $18 ; const $19 = $15 ? @23 ( $0 , $4 , $5 + # ) : # ; $8 ? ( $8 . itemId = $18 , @0 ( $18 ) >= $8 . goal && ( $8 . ended = \"goal\" ) ) : $10 ? ( $10 . itemId = $18 , @0 ( $18 ) >= $10 . goal && ( $10 . ended = \"done\" ) ) : $2 . worn ? $0 . equipment [ $2 . worn ] = $18 : ( $0 . bank [ $4 ] = @24 ( $0 , $4 ) - # , $0 . bank [ $4 ] === # && delete $0 . bank [ $4 ] , $0 . bank [ $18 ] = @24 ( $0 , $18 ) + # , $0 . bankOrder = @25 ( $0 . bankOrder , $4 , $18 , @24 ( $0 , $4 ) >= # ) ) ; const $20 = @26 ( $0 , $1 , $0 . lastTick , $6 , $5 ) , $21 = @27 ( $0 , \"enhancing\" , $20 ) , $22 = { worn : $2 . worn ?? null , from : $4 , gold : $7 . gold , shards : $7 . shards , core : $7 . core , ... $8 ? { contract : ! # } : { } , ... $17 ? { refund : $17 } : { } , ... $10 ? { order : ! # , tip : $11 } : { } } ; return $3 . push ( $15 ? { kind : \"enhanced\" , itemId : $18 , plus : $5 + # , xp : $20 , ... $22 , ... $19 ? { forge : $19 } : { } } : { kind : \"enhanceFailed\" , itemId : $18 , xp : $20 , ... $22 , ... $16 ? { protect : ! # } : { } } ) , $21 . after > $21 . before && $3 . push ( { kind : \"levelUp\" , skill : \"enhancing\" , level : $21 . after } ) , @28 ( $0 , $1 , \"enhancing\" , $13 , $0 . lastTick , $3 ) , $15 }","$0 , $1 , $2 { const $3 = @0 ( $1 , $2 ) ; if ( $3 === null ) return \"notFrom\" ; if ( @1 ( $0 . skills [ $1 . skill ] ) < $1 . levelReq ) return \"level\" ; if ( @2 ( $0 , $2 ) < # ) return \"missing\" ; const $4 = @3 ( $0 , $1 , $2 ) ; if ( $4 === \"missing\" ) return \"missing\" ; const $5 = new Map , $6 = ( $7 , $8 ) => $5 . set ( $7 , ( $5 . get ( $7 ) ?? # ) + $8 ) ; $6 ( $2 , - # ) ; for ( const $9 of $4 ) $6 ( $9 . itemId , - $9 . qty ) ; $6 ( $3 , # ) ; const $10 = @4 ( $0 ) ; let $11 = $10 ; for ( const [ $12 , $13 ] of $5 ) { const $14 = @2 ( $0 , $12 ) , $15 = $14 + $13 ; $14 > # && $15 === # && $11 -- , $14 === # && $15 > # && $11 ++ } if ( $11 > $10 && $11 > @5 ( $0 ) && ! @6 ( $0 ) ) return \"full\" ; for ( const [ $16 , $17 ] of $5 ) { const $18 = @2 ( $0 , $16 ) + $17 ; $18 === # ? delete $0 . bank [ $16 ] : $0 . bank [ $16 ] = $18 } return @7 ( $0 , $1 . skill , $1 . xp ) , @8 ( $0 , $1 , $3 ) , \"ok\" }","$0 , $1 , $2 { if ( @0 ( $1 ) . stackable ) { const $3 = $0 . pack . find ( $4 => $4 . itemId === $1 ) ; return $3 ? ( $3 . qty += $2 , ! # ) : @1 ( $0 ) ? ! # : ( $0 . pack . push ( { itemId : $1 , qty : $2 } ) , ! # ) } if ( @2 ( $0 ) - $0 . pack . length < $2 ) return ! # ; for ( let $5 = # ; $5 < $2 ; $5 ++ ) $0 . pack . push ( { itemId : $1 , qty : # } ) ; return ! # }","$0 , $1 { const $2 = @0 [ $1 ] ; return $2 ? $0 . equipment [ $2 ] : null }","$0 , $1 { const $2 = @0 [ $1 ] ; if ( ! $2 ) return # ; const $3 = $0 . equipment [ $2 ] ; return $3 === null || @1 ( $3 ) ?. slot !== $2 ? # : # + @2 ( $3 ) }","$0 , $1 { const $2 = $0 . burn ; if ( ! $2 ) return # ; const $3 = @0 ( $1 . skills [ $0 . skill ] ) , $4 = $2 . safeAtLevel - $0 . levelReq , $5 = ( $3 - $0 . levelReq ) / $4 ; return Math . max ( # , $2 . chanceAtReq * ( # - $5 ) ) * ( # - # * $1 . perks . hands ) }","$0 , $1 { const $2 = $0 . caught ; if ( ! $2 ) return # ; const $3 = @0 ( $1 . skills [ $0 . skill ] ) , $4 = $2 . safeAtLevel - $0 . levelReq , $5 = ( $3 - $0 . levelReq ) / $4 ; return Math . max ( # , $2 . chanceAtReq * ( # - $5 ) ) * ( # - # * $1 . perks . hands ) }","$0 { return @0 ( # + @1 * @2 ( $0 , \"hunter\" ) , @3 ( $0 , \"blessing\" ) ? @4 : # ) }","$0 , $1 { const $2 = @0 ( $0 , $1 ) , $3 = # + # * $0 . perks . quick , $4 = @1 ( $0 , $1 ) , $5 = @2 . includes ( $1 ) ? @3 ( $0 . masteries , \"gather\" ) : @3 ( $0 . masteries , \"craft\" ) ; return { tool : $2 , quick : $3 , home : $4 , mastery : $5 , combined : $2 * @4 ( $3 , $4 ) * $5 } }","$0 , $1 , $2 , $3 , $4 { const $5 = @0 ( $2 , $0 . workRarity ) ; for ( const $6 of $5 ) if ( $0 . pack . reduce ( ( $7 , $8 ) => $8 . itemId === $6 . itemId ? $7 + $8 . qty : $7 , # ) < $6 . qty ) return ; for ( const $9 of $5 ) { let $10 = $9 . qty ; for ( let $11 = $0 . pack . length - # ; $11 >= # && $10 > # ; $11 -- ) { const $12 = $0 . pack [ $11 ] ; if ( $12 . itemId !== $9 . itemId ) continue ; const $13 = Math . min ( $10 , $12 . qty ) ; $12 . qty -= $13 , $10 -= $13 , $12 . qty === # && $0 . pack . splice ( $11 , # ) } } $0 . actionIndex ++ ; const $14 = $2 . burn ; if ( $14 && @1 ( $1 . seed ^ @2 , $0 . id , $0 . actionIndex , @3 ( $2 , $0 ) ) ) { @4 ( $0 , $14 . itemId , # ) , $4 . push ( { kind : \"burnt\" , itemId : $14 . itemId } ) ; return } const $15 = $2 . caught ; if ( $15 && @1 ( $1 . seed ^ @5 , $0 . id , $0 . actionIndex , @6 ( $2 , $0 ) ) ) { $0 . stunUntil = $3 + $15 . stunTicks , $4 . push ( { kind : \"caught\" , ticks : $15 . stunTicks } ) ; return } const $16 = @7 ( $1 . windows , $3 ) , $17 = @8 ( $0 , \"craft\" ) , $18 = $2 . output . itemId === @9 , $19 = $2 . inputs . length === # && ! $18 , $20 = $19 ? @10 ( $1 . seed , $1 . secretAt , @11 , $0 . id , $17 , $3 ) : null ; if ( ! $19 || $20 !== null ) { let $21 = # ; if ( $19 ) { const $22 = @12 ( $0 , $2 . skill ) , $23 = ( $22 === null ? # : @13 ( $22 ) ) + @14 ( $0 . equipment ) ; $21 = @15 ( $20 , $23 , @16 ( $16 . rarityMult , @17 ( $0 ) , @18 ( $3 , $2 . skill , $1 . hypothetical ) , @19 ( $0 ) , @20 ( $0 . masteries , \"rare\" ) ) ) } else $18 || ( $21 = @21 ( $2 , $0 . workRarity ) ) ; const $24 = $18 ? @9 : @22 ( $2 , $21 ) , $25 = Math . round ( $2 . xp * @23 [ $21 ] * @16 ( $16 . xpMult , @24 ( $0 , $2 . inputs . length === # , $2 . skill ) , @25 ( $3 , $2 . skill , $1 . hypothetical ) , @20 ( $0 . masteries , \"xp\" ) ) ) ; $18 ? @26 ( $0 , $2 . output . qty , \"stall\" ) : @27 ( $0 , $2 , $2 . output . qty ) || @28 ( $0 , $24 , $2 . output . qty ) ; const $26 = @29 ( $0 , $2 . skill , $25 ) ; $4 . push ( { kind : \"produced\" , jobId : $2 . id , itemId : $24 , xp : $25 , tier : $21 , ... $2 . output . qty !== # ? { qty : $2 . output . qty } : { } , ... $19 ? { wire : ! # , xpBonus : $25 } : { } , ... $0 . route ?. order ? { order : ! # } : { } } ) , $26 . after > $26 . before && $4 . push ( { kind : \"levelUp\" , skill : $2 . skill , level : $26 . after } ) } @30 ( $0 , $1 , # / @31 ( $2 , $0 ) , $4 ) , @32 ( $0 , $1 , # / @31 ( $2 , $0 ) , $4 ) ; const $27 = $2 . bonus ? @10 ( $1 . seed , $1 . secretAt , @33 , $0 . id , $17 , $3 ) : null ; if ( $2 . bonus && $27 !== null && $27 < $2 . bonus . chance ) { let $28 = $2 . bonus . itemId ; if ( @34 ( $28 ) ) { const $29 = @12 ( $0 , $2 . skill ) , $30 = ( $29 === null ? # : @13 ( $29 ) ) + @14 ( $0 . equipment ) , $31 = @10 ( $1 . seed , $1 . secretAt , @35 , $0 . id , $17 , $3 ) , $32 = $31 === null ? # : @15 ( $31 , $30 , @16 ( $16 . rarityMult , @17 ( $0 ) , @18 ( $3 , $2 . skill , $1 . hypothetical ) , @19 ( $0 ) , @20 ( $0 . masteries , \"rare\" ) ) ) , $33 = @36 ( $28 ) ? Math . max ( # , $32 ) : $32 ; $28 = @37 ( $28 , $33 ) } @4 ( $0 , $28 , # ) && $4 . push ( { kind : \"bonus\" , itemId : $28 } ) } @38 ( $0 , $1 , $2 . skill , $17 , $3 , $4 ) }","$0 { const $1 = @0 ( $0 ) ; return @1 . find ( $2 => $2 . grow !== void # && $2 . inputs [ # ] ?. itemId === $1 ) ?? null }","$0 { return @0 ( $0 ) !== null }","$0 , $1 , $2 , $3 , $4 , $5 = ! # { const $6 = @0 ( $2 . seedItemId ) ; if ( ! $6 ) return ; $0 . actionIndex ++ ; const $7 = @1 ( $0 , \"farm\" ) , $8 = $6 . inputs [ # ] ?. qty ?? # , $9 = @2 ( $2 . seedItemId ) ; if ( @3 ( $1 . seed , $1 . secretAt , @4 , $0 . id , $7 , $3 ) === null ) { for ( let $10 = # ; $10 < $8 ; $10 ++ ) @5 ( $0 , $5 ? $2 . seedItemId : $9 , # ) ; const $11 = @6 ( $2 , Object . keys ( $0 . plots ) . length , $3 , $6 . grow ?? # ) ; @7 ( $0 , $1 , $11 , $4 ) , @8 ( $0 , $1 , $11 , $4 ) ; return } const $12 = @9 ( $1 . windows , $3 ) , $13 = @3 ( $1 . seed , $1 . secretAt , @10 , $0 . id , $7 , $3 ) ?? # , $14 = @3 ( $1 . seed , $1 . secretAt , @11 , $0 . id , $7 , $3 ) , $15 = @12 ( @13 ( $2 , $3 ) , $14 ) , $16 = @14 ( @15 ( $0 . skills . farming ) ) + @16 ( @17 ( $0 . equipment . hoe ) , $13 ) , $17 = $16 * $15 , $18 = $16 * Math . max ( # , $15 - # ) , $19 = Math . max ( # , Math . min ( # , @18 ( $2 . seedItemId ) ) ) , $20 = @19 ( $6 . output . itemId , $19 ) ; for ( let $21 = # ; $21 < $17 ; $21 ++ ) @5 ( $0 , $20 , # ) ; const $22 = @20 ( $12 . rarityMult , @21 ( $0 ) , @22 ( $3 , \"farming\" , $1 . hypothetical ) , @23 ( $0 . masteries , \"rare\" ) ) ; for ( let $23 = # ; $23 < $8 ; $23 ++ ) { if ( $5 && $15 === # ) { @5 ( $0 , $2 . seedItemId , # ) ; continue } const $24 = @3 ( $1 . seed , $1 . secretAt , @24 , $0 . id , $7 * @25 + $23 , $3 ) , $25 = @26 ( $24 , @27 ( $0 . equipment ) + ( $0 . equipment . hoe === null ? # : @28 ( $0 . equipment . hoe ) ) , @20 ( $22 , @29 ( $0 ) ) ) ; @5 ( $0 , $25 === # ? $9 : @19 ( $9 , $25 ) , # ) } if ( $15 === # ) $4 . push ( { kind : \"harvestLost\" , itemId : $6 . output . itemId } ) ; else { const $26 = Math . round ( $6 . xp * @30 [ $19 ] * @20 ( $12 . xpMult , @31 ( $0 , ! # , \"farming\" ) , @32 ( $3 , \"farming\" , $1 . hypothetical ) , @23 ( $0 . masteries , \"xp\" ) ) ) , $27 = @33 ( $0 , \"farming\" , $26 ) ; $4 . push ( { kind : \"produced\" , jobId : $6 . id , itemId : $20 , xp : $26 , tier : $19 , qty : $17 , wire : ! # , xpBonus : $26 , ... $18 ? { overgrowth : $18 } : { } } ) , $27 . after > $27 . before && $4 . push ( { kind : \"levelUp\" , skill : \"farming\" , level : $27 . after } ) } const $28 = @6 ( $2 , Object . keys ( $0 . plots ) . length , $3 , $6 . grow ?? # ) ; @7 ( $0 , $1 , $28 , $4 ) , @8 ( $0 , $1 , $28 , $4 ) , @34 ( $0 , $1 , \"farming\" , $7 , $3 , $4 , @35 ( $6 . grow ?? # , $3 - $2 . plantedAt ) ) }","$0 , $1 , $2 , $3 , $4 , $5 , $6 = @0 ( $2 ) { const $7 = @1 ( $2 ) ; if ( ! $7 ) return ; const $8 = @2 ( $1 . seed , $1 . secretAt , @3 , $0 . id , $3 , $4 ) ; $8 === null || $8 >= $6 || ( @4 ( $0 , $7 . itemId , # ) , $5 . push ( { kind : \"pet\" , itemId : $7 . itemId } ) ) }","[ ... @0 , ... @0 . filter ( $0 => @1 . has ( $0 . itemId ) ) . flatMap ( @2 ) ]","[ { version : \"#string\"","new Set ( [ ... @0 . map ( $0 => $0 . output . itemId ) , ... @1 . map ( $1 => $1 . drop ) , # , # , ... @0 . filter ( $2 => $2 . grow !== void # ) . map ( $3 => $3 . inputs [ # ] . itemId ) ] )","new Set ( [ ... @0 . map ( $0 => $0 . output . itemId ) . filter ( $1 => $1 !== @1 ) , @2 , @3 , ... @4 . map ( $2 => $2 . drop ) , ... @5 , ... @0 . filter ( $3 => $3 . grow !== void # ) . map ( $4 => $4 . inputs [ # ] . itemId ) ] )","[ { id : \"xp\" , name : \"XP gain\" , blurb : \"More XP from every skill.\" , lane : \"efficiency\" , perRank : # , unit : \"percent\" } , { id : \"gather\" , name : \"Gather speed\" , blurb : \"Faster Mining, Fishing, Woodcutting, Thieving and Farming work. Crops still take as long to grow.\" , lane : \"efficiency\" , perRank : # , unit : \"percent\" } , { id : \"craft\" , name : \"Craft speed\" , blurb : \"Faster Smithing, Cooking, Fletching, Herblore and Crafting.\" , lane : \"efficiency\" , perRank : # , unit : \"percent\" } , { id : \"offline\" , name : \"Offline hours\" , blurb : \"Bank more progress while you are away.\" , lane : \"efficiency\" , ~tail~ , blurb : \"Hit harder with every style.\" , lane : \"power\" , perRank : # , unit : \"percent\" } , { id : \"accuracy\" , name : \"Accuracy\" , blurb : \"Land more of your swings.\" , lane : \"power\" , perRank : # , unit : \"percent\" } , { id : \"rare\" , name : \"Rare-find\" , blurb : \"Better odds of a rarer drop.\" , lane : \"power\" , perRank : # , unit : \"percent\" } , { id : \"enhance\" , name : \"Enhance odds\" , blurb : \"Better odds when enhancing gear.\" , lane : \"power\" , perRank : # , unit : \"percent\" } ]","$0 { const $1 = [ ] ; for ( const $2 of [ # , # , # , # ] ) { const $3 = @0 [ $2 ] ; $1 . push ( { ... $0 , itemId : @1 ( $0 . itemId , $2 ) , accuracy : Math . round ( $0 . accuracy * $3 ) , strength : Math . round ( $0 . strength * $3 ) , defence : Math . round ( $0 . defence * $3 ) , ... $0 . luck !== void # ? { luck : $0 . luck * $3 } : { } } ) } return $1 }","$0 { const $1 = { } ; for ( const [ $2 , $3 ] of @0 ) { const $4 = $0 . equipment [ $2 ] ; $1 [ $3 ] = $4 == null ? # : @1 ( $4 ) } return { amulet : @2 ( $0 . equipment ) , tools : $1 } }","[ { id : \"pockets\" , name : \"Deep pockets\" , each : \"+1 inventory slot\" , ranks : # , cost : $0 => # + # * $0 } , { id : \"hands\" , name : \"Steady hands\" , each : \"Burn and stall-catch chance 3% lower, of the chance itself (20% becomes 19.4%)\" , ranks : # , cost : $1 => # + # * $1 } , { id : \"meals\" , name : \"Hearty meals\" , each : \"food heals 2.5% more\" , ranks : # , cost : $2 => # + # * $2 } , { id : \"rest\" , name : \"Quick rest\" , each : \"the fountain heals a tick sooner\" , ranks : # , cost : $3 => # + # * $3 } , { id : \"quick\" , name : \"Quick hands\" , each : \"0.5% faster at every gathering and crafting job\" , ranks : # , cost : $4 => # + # * $4 } ]","{ Copper : \"铜矿\" , Tin : \"锡矿\" , Iron : \"铁矿\" , Silver : \"银矿\" , Coal : \"煤炭\" , Gold : \"金矿\" , Cobalt : \"钴矿\" , Meteoric : \"陨铁矿\" , \"Bronze bar\" : \"青铜锭\" , \"Iron bar\" : \"铁锭\" , \"Steel bar\" : \"钢锭\" , \"Cobalt bar\" : \"钴锭\" , \"Meteoric bar\" : \"陨铁锭\" , Logs : \"原木\" , \"Oak logs\" : \"橡木\" , \"Willow logs\" : \"柳木\" , \"Maple logs\" : \"枫木\" , \"Yew logs\" : \"紫杉木\" , \"Magic logs\" : \"魔法原木\" , Shrimp : \"虾\" , Sardine : \"沙丁鱼\" , Trout : \"鳟鱼\" , Salmon : \"三文鱼\" , Tuna : \"金枪鱼\" ~tail~ \"Rock mite nymph\" : \"岩螨若虫\" , \"Stalker claw\" : \"潜袭者之爪\" , \"Stalker fang\" : \"潜袭者之牙\" , \"Stalker kit\" : \"潜袭者幼崽\" , \"Stone eater pebble\" : \"食石者卵石\" , \"Sump crawler hatchling\" : \"污水爬行者幼体\" , \"Troll hide\" : \"巨魔皮\" , \"Troll tusk\" : \"巨魔獠牙\" , \"Troll coif\" : \"巨魔头巾\" , \"Troll jerkin\" : \"巨魔上衣\" , \"Troll chaps\" : \"巨魔护腿\" , \"Troll quiver\" : \"巨魔箭袋\" , \"Wight crown\" : \"尸灵王冠\" , \"Wraith ash\" : \"怨灵之烬\" , \"Wraith dust\" : \"怨灵之尘\" , \"Wraith mote\" : \"怨灵微粒\" , \"Wyrm ember\" : \"巨龙余烬\" , Voidshard : \"虚空碎片\" , \"Firework powder\" : \"烟花火药\" , \"Cobalt rocket\" : \"钴火箭\" , \"Void rain\" : \"虚空雨\" , \"Golden arrow rain\" : \"金箭雨\" , \"Jewel crown\" : \"宝石王冠\" , \"Dragon egg\" : \"龙蛋\" }","{ \"From a good meal. Every rarity hits the same; the rarer the food, the longer it lasts.\" : \"吃顿好的。任何稀有度效果相同；食物越稀有，持续越久。\" , \"Prices have changed since this page was opened. Reload the game and look again; nothing was sold.\" : \"页面打开后价格已变动。请刷新游戏后重试；本次未售出任何物品。\" , \"The raid room is for the fight: go to the boss to speak in it.\" : \"团战频道仅限战斗使用：到首领身边才能发言。\" , \"Today's free reroll is used, or that quest is already begun.\" : \"今日免费刷新已用完，或该任务已开始。\" , \"That tag will not do: two to five letters or numbers.\" : \"标签无效：需两到五个字母或数字。\" , \"Both of you have to be within 20 tiles of a depot.\" : \"双方都须在仓库20格内。\" , \"That is as many orders as you can have resting at once.\" : \"挂单数量已达上限。\" , \"Not enough gems for that.\" : \"宝石不足。\" , \"The stable only breeds plain horses at +0, and nothing above epic.\" : \"马厩只能合成+0的普通马，最高史诗。\" , \"Nothing to eat there — either none left, or you are already as well fed as it can make you.\" : \"没东西可吃——要么吃完了，要么已经吃饱了。\" , \"Storage is full. Take something out, buy another slot in the storage window, or bless the vein.\" : \"仓库已满。取出物品、在仓库界面购买格子，或为矿脉祈福。\" , \"One task can wait its turn for free; more slots are coming.\" : \"免费队列仅限一个任务；更多队列格子即将开放。\" , \"That did not go through. Give it a moment and try again.\" : \"操作失败，请稍后重试。\" , \"A bid has to be at least the vendor price.\" : \"出价不能低于商店价。\" , \"A choice poll needs at least two options.\" : \"选择投票至少需要两个选项。\" , \"A good catch is worth eating.\" : \"好鱼就该吃掉。\" , \"A guild already has that name.\" : \"公会名称已被占用。\" , \"A guild already has that tag.\" : \"公会标签已被占用。\" , \"A horse is a tool for the road.\" : \"马是用来赶路的。\" , \"A little onboarding record\" : \"新手引导记录\" , \"A material\" : \"材料\" , \"A material. Something is made of it.\" : \"材料。可用于制作。\" , \"A pet\" : \"宠物\" , \"A quest\" : \"任务\" ~tail~ \"Masteries are open\" : \"精通已开放\" , \"📖 Masteries are open: spend your Collection Points on bonuses that last for good, in ten tracks from XP and gather speed to max hit and rare-find. Every rank adds half a percent (enhance odds a quarter), each rank costs a little more than the last, and there is no cap.\" : \"📖 精通现已开放：用收藏点数换取永久加成，共十条路线，涵盖经验、采集速度、最大伤害、稀有掉落等。每级加 0.5%（强化成功率为 0.25%），每级比上一级稍贵，没有上限。\" , \"➕ Hold + to add several ranks at once. Nothing works until you Confirm, and a reset for 20 gems gives every point back.\" : \"➕ 按住 + 可一次加多级。确认前不会生效；花 20 宝石重置可返还全部点数。\" , \"💎 Bought gems arrive as gem packs in your storage, and the game now tells you so the moment they land. Open them from their menu in storage.\" : \"💎 购买的宝石以宝石包形式存入仓库，到账时会立即提示。在仓库中点开菜单即可打开。\" , \"Your own look\" : \"专属外观\" , \"Your own mount\" : \"专属坐骑\" , \"A character skin drawn just for you, that no one else will ever wear. It is drawn after you buy it, together with the developer, who gets in touch to make it with you.\" : \"为你专门绘制的角色皮肤，独一无二。购买后开发者会联系你，与你一起设计绘制。\" , \"A mount skin drawn just for you, that no one else will ever ride. It is drawn after you buy it, together with the developer, who gets in touch to make it with you.\" : \"为你专门绘制的坐骑皮肤，独一无二。购买后开发者会联系你，与你一起设计绘制。\" , \"Your own icon\" : \"专属图标\" , \"A name icon drawn just for you, that no one else will ever show. It is drawn after you buy it, together with the developer, who gets in touch to make it with you.\" : \"为你专门绘制的名字图标，独一无二。购买后开发者会联系你，与你一起设计绘制。\" , \"Shown before your name in chat.\" : \"显示在聊天中你的名字前面。\" , \"Royal Gold\" : \"皇家金\" , Sunset : \"落日\" , Glacier : \"冰川\" , \"Rose Quartz\" : \"玫瑰石英\" , Gilded : \"鎏金\" , Ember : \"余烬\" , Prism : \"棱镜\" , \"Void Pulse\" : \"虚空脉动\" , \"Paints your name in chat.\" : \"改变聊天中你名字的颜色。\" , \"Your own name colour\" : \"专属名字颜色\" , \"A name colour made just for you, that no one else will ever show. It is made after you buy it, together with the developer, who gets in touch to make it with you.\" : \"为你专门制作的名字颜色，独一无二。购买后开发者会联系你，与你一起设计制作。\" , \"Fill in the most you can afford\" : \"填入最多能买的数量\" , \"Buy from the vendor?\" : \"从商人处购买？\" }","{ \"1 in {n}\" : \"几率 1/{n}\" , \"{skill} {level}: plant {seed} at {place}\" : \"{skill} {level} 级：在{place}种下{seed}\" , \"{skill} {level}: {job} at {place}\" : \"{skill} {level} 级：在{place}获得{job}\" , \"{skill} {level}: made from {inputs}\" : \"{skill} {level} 级：用 {inputs} 制作\" , \"An extra drop from {job} ({skill} {level}), {odds}\" : \"{job}（{skill} {level} 级）的额外掉落，{odds}\" , \"Dropped by every {monster} (level {level})\" : \"每只{monster}（{level} 级）必掉\" , \"Dropped by the {monster} (level {level}), {odds}\" : \"{monster}（{level} 级）掉落，{odds}\" , \"A rare drop from {monster} (level {level}), {odds}\" : \"{monster}（{level} 级）的稀有掉落，{odds}\" , \"Left by the {boss}, {qty} to each raider, {odds}\" : \"{boss}掉落，每位参战者 {qty} 个，{odds}\" , \"1 in {n} for every raider when the {boss} falls, each their own roll, twice for the top ten\" : \"{boss}倒下时，每名参战者各自独立有 1/{n} 的几率获得，前十名几率翻倍\" , \"…and {n} more in the Codex\" : \"……另有 {n} 条，详见图鉴\" , \"Cut for {style}: with {wrong} its bonus counts against you instead\" : \"专为{style}打造：若用{wrong}作战，它的加成反而会拖累你\" , \"Well fed: +{pct}% damage, {time} ({rarity})\" : \"饱食：伤害 +{pct}%，持续 {time}（{rarity}）\" , \"Well rooted: −{pct}% damage taken, {time}\" : \"扎根：受到的伤害 −{pct}%，持续 {time}\" , \"No buff; Uncommon or better gives Well fed\" : \"无增益；罕见或更高稀有度才有饱食\" , \"Uncommon or better gives Well fed\" : \"罕见或更高稀有度可获得饱食\" , \"Well fed: an Uncommon fish or better gives +{pct}% damage\" : \"饱食：罕见或更高稀有度的鱼可让伤害 +{pct}%\" , \"1 minute\" : \"1 分钟\" , \"{n} minutes\" : \"{n} 分钟\" , \"1 hour\" : \"1 小时\" , \"{n} hours\" : \"{n} 小时\" , \"1 day\" : \"1 天\" , \"{n} days\" : \"{n} 天\" , \"{h} h {m} min\" : \"{h} 小时 {m} 分钟\" ~tail~ \"Every last one\" : \"一只不落\" , Charcoal : \"木炭\" , \"Smoke alarm\" : \"烟雾报警器\" , Butterfingers : \"笨手笨脚\" , \"One in a hundred thousand\" : \"十万分之一\" , \"A bit of everything\" : \"样样都会\" , \"Finish a quest.\" : \"完成一个任务。\" , \"Fell a million monsters.\" : \"击倒一百万只怪物。\" , \"Make or gather a million things.\" : \"制作或采集一百万件物品。\" , \"Make or gather ten million things.\" : \"制作或采集一千万件物品。\" , \"Earn a million coins, all told.\" : \"累计赚取一百万金币。\" , \"Earn ten million coins, all told.\" : \"累计赚取一千万金币。\" , \"Earn a hundred million coins, all told.\" : \"累计赚取一亿金币。\" , \"Earn a billion coins, all told.\" : \"累计赚取十亿金币。\" , \"Log in seven days in a row.\" : \"连续登录七天。\" , \"Log in thirty days in a row.\" : \"连续登录三十天。\" , \"Log in a hundred days in a row.\" : \"连续登录一百天。\" , \"Log in a year of days in a row.\" : \"连续登录一整年。\" , \"Log in a thousand days in a row.\" : \"连续登录一千天。\" , \"Have a monster's young follow you home.\" : \"让一只怪物幼崽跟你回家。\" , \"Hold three different pets.\" : \"拥有三种不同的宠物。\" , \"Hold the young of every monster there is.\" : \"集齐所有怪物的幼崽。\" , \"Hold a Legendary anything.\" : \"拥有任意一件传说物品。\" , \"Reach level 10 in every skill.\" : \"所有技能达到 10 级。\" }","{ Bank : \"银行\" , Storage : \"仓库\" , Market : \"市场\" , Shop : \"商店\" , \"Gem shop\" : \"宝石商店\" , Enhance : \"强化\" , Quests : \"任务\" , Skills : \"技能\" , Inventory : \"背包\" , Worn : \"装备\" , More : \"更多\" , Menu : \"菜单\" , Achievements : \"成就\" , Collections : \"收藏\" , Stats : \"属性\" , Friends : \"好友\" , Ranks : \"排行榜\" , Guild : \"公会\" , \"World map\" : \"世界地图\" , Codex : \"图鉴\" , Account : \"账号\" , \"The board\" : \"布告栏\" , Poll : \"投票\" , Admin : \"管理\" ~tail~ \"Interface size\" : \"界面大小\" , \"Combat panel\" : \"战斗面板\" , \"Chat name colour\" : \"聊天昵称颜色\" , Language : \"语言\" , \"Replay the guide\" : \"重看教程\" , \"Report a bug\" : \"反馈问题\" , \"Sign out\" : \"退出登录\" , \"Change password\" : \"修改密码\" , \"Change email\" : \"修改邮箱\" , \"Add email\" : \"添加邮箱\" , \"Bring a friend\" : \"邀请好友\" , \"Start digging\" : \"开始挖矿\" , \"Sign in\" : \"登录\" , \"Play as a guest\" : \"游客试玩\" , \"I already have a character\" : \"已有角色\" , \"I need a character\" : \"创建角色\" , \"Forgot your password?\" : \"忘记密码？\" , or : \"或\" , Name : \"角色名\" , Password : \"密码\" , Email : \"邮箱\" , \"A shared world under the ground. Send your character to mine, fish, smith and fight — it keeps working after you close the tab.\" : \"一个所有人共享的地下世界。派角色去采矿、钓鱼、锻造、战斗——关掉页面也照样干活。\" , \"Welcome back. Your character has been busy.\" : \"欢迎回来，你的角色可没闲着。\" , \"No sign-up. The character lives in this browser until you give it a name under Account.\" : \"无需注册。角色先存在本浏览器里，在“账号”中起个名字就能永久保存。\" }","( ( ) => { const $0 = new Map , $1 = ( $2 , $3 ) => { if ( @0 . has ( $2 ) || @1 . has ( $2 ) ) return ; const $4 = $0 . get ( $2 ) ?? $0 . set ( $2 , [ ] ) . get ( $2 ) ; $4 . includes ( $3 ) || $4 . push ( $3 ) } ; for ( const $5 of @2 ) $1 ( $5 . output . itemId , $5 . skill ~tail~ . itemId , $5 . skill ) ; for ( const $6 of @3 ) for ( const $7 of $6 . to ) $1 ( $7 , $6 . skill ) ; for ( const $8 of @4 ) $1 ( $8 . drop , \"combat\" ) , $1 ( $8 . bonus . itemId , \"combat\" ) , $1 ( @5 ( $8 . id ) , \"combat\" ) ; for ( const $9 of @6 ) $1 ( $9 . itemId , $9 . skill ) ; return $0 } ) ( )","new Set ( [ # , # ] )","[ [ \"pickaxe\" , \"mining\" , \"Pickaxe\" , \"镐\" ] , [ \"axe\" , \"woodcutting\" , \"Axe\" , \"斧\" ] , [ \"rod\" , \"fishing\" , \"Rod\" , \"鱼竿\" ] , [ \"gloves\" , \"thieving\" , \"Gloves\" , \"手套\" ] ]","new Set ( [ ... @0 . map ( $0 => $0 . output . itemId ) , ... @1 ] )","$0 , $1 { let $2 = # , $3 = # ; for ( const $4 of $0 ) $1 < $4 . fromTick || $1 > $4 . toTick || ( $2 += ( $4 . xpMult ?? # ) - # , $3 += ( $4 . rarityMult ?? # ) - # ) ; return { xpMult : # + $2 , rarityMult : # + $3 } }","$0 { if ( ! @0 ( $0 ) ) return # ; let $1 = # ; for ( const $2 of @1 ) $2 . bonus . kind === \"rareChance\" && @2 ( $0 , $2 . id ) && ( $1 += @3 ( $2 , @4 ( $0 , $2 . id ) ) ) ; return # + $1 }","[ { itemId : # , jobId : # , name : \"Cobalt rocket\" , style : \"peony\" , colour : \"#5aa8ff\" , sparks : [ \"#5aa8ff\" , \"#a8d4ff\" , \"#ffffff\" ] , level : # , baseTicks : # , xp : # , inputs : [ { itemId : # , qty : # } ] , powder : # } , { itemId : # , jobId : # , name : \"Void rain\" , style : \"rain\" , colour : \"#a77bff\" , sparks : [ \"#a77bff\" , \"#d6c2ff\" , \"#6a3ad0\" ] , level : ~tail~ : # , qty : # } , { itemId : # , qty : # } ] , powder : # } , { itemId : # , jobId : # , name : \"Dragon egg\" , style : \"egg\" , colour : \"#ff7a3a\" , sparks : [ \"#ff7a3a\" , \"#ffc15a\" , \"#ff3a2a\" ] , level : # , baseTicks : # , xp : # , inputs : [ { itemId : # , qty : # } , { itemId : # , qty : # } ] , powder : # } ]","new Set ( @0 . map ( $0 => $0 . itemId ) )","$0 , $1 , $2 { if ( $0 . collection [ $2 ] = # , @0 . some ( $3 => $3 . recipe === $1 . id ) ) return ; const $4 = @1 ( $2 ) ; $0 . collections [ $4 ] = ( $0 . collections [ $4 ] ?? # ) + # }","$0 , $1 { const $2 = $0 . from . indexOf ( @0 ( $1 ) ) ; if ( $2 < # ) return null ; const $3 = @1 ( $0 . to [ $2 ] , @2 ( $1 ) ) , $4 = @3 ( $1 ) ; return $4 > # ? @4 ( $3 , $4 ) : $3 }","$0 , $1 { if ( ! $0 . perTier ) return [ { itemId : $0 . itemId , qty : $0 . qty } ] ; const $2 = @0 ( $1 ) ; return @1 ( $0 . itemId ) ? [ { itemId : @2 ( $0 . itemId , $2 ) , qty : $0 . qty } ] : [ { itemId : $0 . itemId , qty : $0 . qty * ( $2 + # ) } ] }","$0 , $1 { return { named : $0 . extra . flatMap ( $2 => @0 ( $2 , $1 ) ) } }","@0 . map ( $0 => ( { id : $0 . recipe , name : $0 . name , skill : $0 . skill , levelReq : $0 . make , xp : $0 . xp , from : [ $0 . from ] , to : [ $0 . id ] , extra : $0 . extra } ) )","$0 , $1 { return $1 === # || $0 . inputs . length === # || $0 . inputs . some ( $2 => @0 ( $2 . itemId ) ) ? $1 : # }","$0 { return ! @0 ( $0 ) && $0 !== @1 && @2 . has ( $0 ) }","$0 , $1 { return @0 ( $0 . output . itemId , @1 ( $0 , $1 ) ) }","$0 , $1 { return $1 === # || $0 . inputs . length === # ? $0 . inputs : $0 . inputs . map ( $2 => @0 ( $2 . itemId ) ? { itemId : @1 ( $2 . itemId , $1 ) , qty : $2 . qty } : $2 ) }","$0 , $1 , $2 { const $3 = [ ] ; for ( const $4 of @0 ( $1 , $2 ) . named ) { if ( @1 ( $0 , $4 . itemId ) < $4 . qty ) return \"missing\" ; $3 . push ( { itemId : $4 . itemId , qty : $4 . qty } ) } return $3 }","$0 { return @0 . has ( @1 ( $0 ) ) }","$0 { let $1 = # ; for ( const $2 in $0 ) @0 ( Number ( $2 ) ) || ( $1 += @1 ( $0 [ $2 ] , @2 ( Number ( $2 ) ) ) + # ) ; return $1 }","$0 , $1 { const $2 = @0 ( $1 ) ; let $3 = - # ; for ( let $4 = # ; $4 < $2 . length ; $4 ++ ) $0 >= $2 [ $4 ] && ( $3 = $4 ) ; return $3 }","$0 { let $1 = # ; for ( const [ $2 , $3 ] of Object . entries ( $0 . bank ) ) $3 > # && ! @0 ( Number ( $2 ) ) && $1 ++ ; return $1 }","$0 { return $0 * @0 }","$0 { return Math . max ( @0 , # - $0 * @1 ) }","$0 , $1 { return Math . min ( # , @0 ( $1 ) * ( # + @1 ( $0 ) ) * @2 ( $0 ) * @3 ( $0 ) ) }","$0 { return # + @0 * ( @1 ( $0 . skills . enhancing ) - # ) }","$0 { return Math . min ( # + @0 , @1 ( $0 . masteries , \"enhance\" ) ) }","$0 { if ( ! @0 ( $0 ) ) return # ; let $1 = # ; for ( const $2 of @1 ) $2 . bonus . kind === \"enhanceChance\" && @2 ( $0 , $2 . id ) && ( $1 += @3 ( $2 , @4 ( $0 , $2 . id ) ) ) ; return $1 }","$0 , $1 { const $2 = $0 . brewBuckets ?. [ $1 ] ; if ( $2 && $2 . length ) { const $3 = $2 . reduce ( ( $4 , $5 ) => $4 + $5 , # ) , $6 = Math . max ( # , $0 . lastTick - ( ( $0 . brews [ $1 ] ?? # ) - $3 ) ) ; let $7 = # ; for ( let $8 = $2 . length - # ; $8 >= # ; $8 -- ) if ( $7 += $2 [ $8 ] , $6 < $7 ) return @0 ( $8 ) } return @0 ( $0 . brewTier ?. [ $1 ] ?? # ) }","@0 . filter ( $0 => ! @1 . has ( $0 . id ) )","[ ]","@0","new Map ( @0 . map ( $0 => [ $0 . id , $0 ] ) )","Math . round ( # * # * # / @0 )","$0 => Math . max ( # , Math . min ( @0 - # , $0 ) )","@0 . length","[ \"mining\" , \"fishing\" , \"woodcutting\" , \"farming\" , \"thieving\" , \"cooking\" , \"smithing\" , \"fletching\" , \"herblore\" , \"crafting\" , \"enhancing\" , \"combat\" ]","[ \"mining\" , \"fishing\" , \"woodcutting\" , \"farming\" , \"combat\" ]","$0 , $1 = ! # { const $2 = @0 ( $0 ) , $3 = @1 [ @2 ( $0 ) - # ] * @3 [ @4 ( $0 ) ] , $4 = $1 && $2 >= @5 ? # : # ; return { gold : $3 * ( $2 + # ) , shards : $4 ? # : @6 * ( $2 + # ) , core : $4 } }","$0 , $1 { return @0 ( $1 ) >= @1 && @2 ( $0 ) > # }","$0 { return @0 ( $0 , @1 ) + $0 . pack . filter ( $1 => $1 . itemId === @1 ) . reduce ( ( $2 , $3 ) => $2 + $3 . qty , # ) }","$0 , $1 { return $0 . bank [ $1 ] ?? # }","$0 { return @0 ( $0 , @1 ) }","$0 , $1 { return $0 . houseFurniture [ $1 ] !== void # }","$0 { for ( const $1 in $0 . houseFurniture ) return ! # ; return ! # }","$0 , $1 { return $1 * @0 + $0 }","$0 { return Math . floor ( $0 / @0 ) }","$0 { const $1 = @0 ( $0 ) ; return $1 >= @1 ? Math . floor ( $1 / @1 ) : # }","$0 { const $1 = Math . floor ( $0 / @0 ) , $2 = @1 [ @2 ( $1 ) ] , $3 = @3 . includes ( $2 ) && @4 ( $1 , # , @5 ) % # === # ; return { skill : $2 , kind : $3 ? \"rarity\" : \"xp\" , mult : $3 ? @6 : @7 , from : $1 * @0 , until : ( $1 + # ) * @0 } }","$0 { for ( $0 < @0 && ( @0 = # , @1 = @2 ( # ) ) ; @0 < $0 ; ) { @0 ++ ; const $1 = @2 ( @0 ) ; @1 = $1 === @1 ? ( $1 + # ) % @3 . length : $1 } return @1 }","$0 { return @0 ( $0 , # , @1 ) % @2 . length }","$0 , $1 , $2 { let $3 = ( $0 ^ # ) >>> # ; return $3 = Math . imul ( $3 ^ $1 >>> # , # ) >>> # , $3 = ( $3 ^ $3 >>> # ) >>> # , $3 = Math . imul ( $3 ^ $2 >>> # , # ) >>> # , $3 = ( $3 ^ $3 >>> # ) >>> # , $3 >>> # }","$0 , $1 { return @0 ( $0 , $1 ) ? @1 [ @2 ( $0 , $1 ) ] : # }","$0 , $1 { return ( $0 . brews [ $1 ] ?? # ) > $0 . lastTick }","$0 , $1 { const $2 = @0 . get ( $1 ) ; return ! $2 || ! $0 ? # : ( $0 [ $1 ] ?? # ) * $2 . perRank }","... $0 { let $1 = # ; for ( const $2 of $0 ) $1 += $2 - # ; return # + $1 }","$0 , $1 { return $0 . skill === $1 || $0 . skill === \"combat\" && @0 . includes ( $1 ) }","$0 , $1 { return @0 ( $1 ) * ( $0 . rate ?? # ) }","$0 , $1 { return $0 . house [ $1 ] ?? # }","$0 , $1 , $2 { const $3 = $0 . enhance ; if ( ! $3 ) return ; if ( @0 ( $3 . itemId ) >= Math . min ( $3 . toPlus , @1 ) ) { @2 ( $0 , $2 , \"done\" ) ; return } if ( $3 . ticks = ( $3 . ticks ?? # ) + # , $3 . ticks < @3 ) return ; if ( $3 . ticks = # , ! $1 . secretAt ) { if ( $3 . once ) { @4 ( $0 ) ; return } @5 ( $0 , $3 ) ? @6 ( $0 , $3 ) && @2 ( $0 , $2 , \"noMaterials\" , @7 ) : @8 ( $0 , $3 , $2 ) ; return } if ( ! @5 ( $0 , $3 ) ) { @8 ( $0 , $3 , $2 ) ; return } if ( @6 ( $0 , $3 ) ) { @2 ( $0 , $2 , \"noMaterials\" , @7 ) ; return } const $4 = @9 ( $0 , $1 , $3 , $2 ) ; if ( $4 === null ) { @2 ( $0 , $2 , \"noMaterials\" , @10 ) ; return } if ( $3 . once ) { $4 ? @2 ( $0 , $2 , \"done\" ) : @4 ( $0 ) ; return } @0 ( $3 . itemId ) >= $3 . toPlus && @2 ( $0 , $2 , \"done\" ) }","$0 , $1 , $2 { return @0 ( @1 ( $0 , $1 , $2 ) ) / # }","$0 { return $0 = ( $0 ^ $0 >>> # ) >>> # , $0 = Math . imul ( $0 , # ) >>> # , $0 = ( $0 ^ $0 >>> # ) >>> # , $0 = Math . imul ( $0 , # ) >>> # , ( $0 ^ $0 >>> # ) >>> # }","$0 , $1 , $2 { return @0 ( @1 ( $0 ^ $1 , $2 , # ) ) }","new $0","$0 { let $1 = # ; for ( const $2 of @0 ) $1 += @1 ( $0 . skills [ $2 ] ) ; return $1 }","@0 . filter ( $0 => $0 . watch ?. item === void # && $0 . watch ?. monster === void # )","@0 . map ( $0 => $0 . watch ?. collection === ! # )","@0 . map ( $0 => $0 . watch ?. levels === ! # )","$0 , $1 , $2 { $0 . achievements [ $1 . id ] === void # && $1 . check ( $0 ) && ( $0 . achievements [ $1 . id ] = $0 . lastTick , @0 ( $0 , $1 . reward , \"achievement\" ) , $2 . push ( { kind : \"achievement\" , id : $1 . id } ) ) }","( ( ) => { const $0 = new Array ( @0 . length ) ; let $1 = # ; for ( let $2 = # ; $2 <= @0 . length ; $2 ++ ) { const $3 = @1 . get ( @0 [ $2 - # ] . id ) , $4 = $2 < @0 . length ? @1 . get ( @0 [ $2 ] . id ) : void # ; if ( ! $3 || ! $4 || $3 . have !== $4 . have || $4 . want < $3 . want ) { for ( let $5 = $1 ; $5 < $2 ; $5 ++ ) $0 [ $5 ] = $2 ; $1 = $2 } } return $0 } ) ( )","$0 , $1 , $2 { if ( $1 ) { for ( const $3 of $1 ) if ( @0 ( $0 , $3 , $2 ) , $0 . achievements [ $3 . id ] === void # ) return } }","@0 * @1","$0 , $1 { const { tier : $2 , rarity : $3 } = @0 ( $0 ) ; let $4 = # ; for ( let $5 = # ; $5 <= @1 ; $5 ++ ) @2 ( $1 , $5 ) && ( $4 += @3 ( $2 , $3 , $5 ) ) ; return $4 }","$0 { const $1 = @0 . get ( $0 ) ; if ( $1 ) return $1 ; if ( @1 ( $0 ) >= # ) return @2 ( $0 ) ; throw new Error ( ` unknown item id:  ${ $0 }  ` ) }","$0 , $1 { const $2 = $0 . rollIndex ??= { } , $3 = ( $2 [ $1 ] ?? # ) + # ; return $2 [ $1 ] = $3 , $3 }","$0 , $1 , $2 , $3 , $4 , $5 { return $1 ? @0 ( @1 ( @2 ( $0 , $1 ( $5 ) , $2 ) , $3 , $4 ) ) : null }","$0 , $1 , $2 , $3 = ! # { $0 . coins += $1 , @0 ( $0 , $2 , $1 ) , $1 > # && $3 && ( $0 . tally . coinsEarned += $1 ) }","$0 { return Math . min ( # , # + $0 * # ) }","$0 { return # + Math . floor ( $0 / # ) }","$0 { $0 . route ?. limit != null && ( $0 . route . limit -- , $0 . route . limit <= # && ( $0 . activity = \"idle\" ) ) }","$0 { if ( $0 <= # ) return # ; let $1 = # , $2 = @0 ; for ( ; $1 < $2 ; ) { const $3 = Math . ceil ( ( $1 + $2 ) / # ) ; @1 [ $3 ] <= $0 ? $1 = $3 : $2 = $3 - # } return $1 }","$0 , $1 { if ( $1 . contract ) return @0 ( $0 ) ?. itemId === $1 . itemId ; if ( $1 . order ) { const $2 = @1 ( $0 ) ; return $2 ?. kind === \"enhance\" && $2 . itemId === $1 . itemId } return $1 . worn ? $0 . equipment [ $1 . worn ] === $1 . itemId : @2 ( $0 , $1 . itemId ) >= # }","$0 , $1 , $2 { if ( $1 . order ) { const $3 = @0 ( $0 ) ; return $3 ?. kind === \"enhance\" && @1 ( $3 . tipLeft , $0 . coins , $2 ) !== null } if ( ! $1 . contract ) return $0 . coins >= $2 ; const $4 = @2 ( $0 ) ; return $4 !== null && @3 ( $4 , $2 , @4 ( $0 , $1 ) ? $4 . scrollValue : # ) }","$0 { return $0 . order && $0 . order . ended === void # ? $0 . order : null }","$0 , $1 , $2 { if ( $2 <= # || $1 === \"transfer\" ) return ; let $3 = @0 . get ( $0 ) ; $3 || @0 . set ( $0 , $3 = new Map ) , $3 . set ( $1 , ( $3 . get ( $1 ) ?? # ) + $2 ) }","$0 , $1 , $2 { const $3 = Math . min ( $0 , $2 ) , $4 = $2 - $3 ; return $1 >= $4 ? { tip : $3 , bank : $4 } : null }","$0 , $1 , $2 { return $0 . coins < $1 ? ! # : ( $0 . coins -= $1 , @0 ( $0 , $2 , $1 ) , ! # ) }","$0 { const $1 = $0 . pack . find ( $2 => $2 . itemId === @0 ) ; if ( $1 ) { $1 . qty -= # , $0 . pack = $0 . pack . filter ( $3 => $3 . qty > # ) ; return } $0 . bank [ @0 ] = @1 ( $0 , @0 ) - # , $0 . bank [ @0 ] === # && delete $0 . bank [ @0 ] }","$0 , $1 { @0 ( $0 , @1 , $1 ) }","$0 , $1 , $2 { let $3 = $2 ; for ( const $4 of $0 . pack ) { if ( $3 === # ) break ; if ( $4 . itemId !== $1 ) continue ; const $5 = Math . min ( $4 . qty , $3 ) ; $4 . qty -= $5 , $3 -= $5 } $0 . pack = $0 . pack . filter ( $6 => $6 . qty > # ) , $3 > # && ( $0 . bank [ $1 ] = @0 ( $0 , $1 ) - $3 , $0 . bank [ $1 ] === # && delete $0 . bank [ $1 ] ) }","$0 , $1 { const $2 = $1 . scrollValue ; return $1 . escrow -= $2 , $1 . spent += $2 , $0 . coins += $2 , @0 ( $0 , \"contractScroll\" , $2 ) , $2 }","$0 , $1 , $2 { return $0 . forgeLog ??= { } , @0 ( $0 . forgeLog , @1 ( $1 ) , @2 ( $1 ) , $2 ) }","$0 , $1 , $2 , $3 { const $4 = $0 . slice ( ) ; if ( $2 === $1 ) return $4 ; const $5 = $4 . includes ( $2 ) , $6 = $4 . indexOf ( $1 ) ; if ( $6 >= # ) return $3 ? $5 || $4 . splice ( $6 + # , # , $2 ) : $5 ? $4 . splice ( $6 , # ) : $4 [ $6 ] = $2 , $4 ; if ( $5 ) return $4 ; let $7 = - # ; for ( let $8 = $4 . length - # ; $8 >= # ; $8 -- ) if ( @0 ( $4 [ $8 ] ) === @0 ( $2 ) ) { $7 = $8 ; break } return $7 >= # ? $4 . splice ( $7 + # , # , $2 ) : $4 . push ( $2 ) , $4 }","$0 , $1 , $2 , $3 , $4 { const $5 = @0 * ( $4 + # ) * @1 [ @2 ( $3 ) ] ; return Math . round ( $5 * @3 ( @4 ( $1 . windows , $2 ) . xpMult , @5 ( $0 , ! # ) , @6 ( $2 , \"enhancing\" , $1 . hypothetical ) , @7 ( $0 . masteries , \"xp\" ) ) ) }","$0 { return @0 + ( $0 . bankSlotsBought ?? # ) + @1 ( $0 ) }","$0 { return $0 . unlimitedBank || ( $0 . brews . blessing ?? # ) > $0 . lastTick }","$0 { return $0 . pack . length >= @0 ( $0 ) }","$0 { return @0 + $0 . perks . pockets }","Object . fromEntries ( Object . entries ( @0 ) . map ( ( [ $0 , $1 ] ) => [ $1 , $0 ] ) )","$0 { return $0 === null ? # : @0 ( $0 ) ?. bonus ?? # }","$0 , $1 , $2 { const $3 = $1 && $2 !== void # && @0 . includes ( $2 ) ; return @1 ( $1 ? # + @2 * @3 ( $0 , \"gatherer\" ) : # , $3 ? # + @4 * @3 ( $0 , \"packed-lunch\" ) : # , $3 ? # + @5 * @3 ( $0 , \"hearty-lunch\" ) : # , # + @6 * @3 ( $0 , \"elixir\" ) , @7 ( $0 , \"blessing\" ) ? @8 : # , # + ( $0 . guildBonus ?? # ) ) }","$0 , $1 , $2 = ! # { if ( $2 ) return # ; const $3 = @0 ( $0 ) ; return $3 . kind === \"xp\" && @1 ( $3 , $1 ) ? $3 . mult : # }","$0 , $1 , $2 { const $3 = $0 . order ; return $0 . route ?. order !== ! # || $3 ?. kind !== \"craft\" || $3 . ended !== void # || $3 . jobId !== $1 . id ? ! # : ( $3 . made += $2 , ! # ) }","$0 , $1 , $2 , $3 { const $4 = @0 ( $0 , \"mount\" ) ; if ( $0 . ironman ) return ; const $5 = @1 ( $1 . seed , $1 . secretAt , @2 , $0 . id , $4 , $0 . lastTick ) ; if ( $5 === null || $5 >= @3 ( $2 ) ) return ; const $6 = @1 ( $1 . seed , $1 . secretAt , @4 , $0 . id , $4 , $0 . lastTick ) , $7 = $6 === null ? # : @5 ( $6 , @6 ( $0 . equipment ) , # , @7 ) , $8 = @8 ( @9 , $7 ) ; $0 . bank [ $8 ] = ( $0 . bank [ $8 ] ?? # ) + # , $3 . push ( { kind : \"mount\" , itemId : $8 } ) }","$0 , $1 { return Math . min ( # , @0 ( $0 , $1 ) / $0 . baseTicks ) }","$0 , $1 , $2 , $3 { const $4 = $0 . lastTick , $5 = @0 ( $4 ) ; if ( ! $5 || @1 ( $0 , $4 ) === # || ! @2 ( $0 ) ) return ; const $6 = @3 ( $0 , \"box\" ) , $7 = @4 ( $1 . seed , $1 . secretAt , @5 , $0 . id , $6 , $4 ) ; if ( $7 === null || $7 >= @6 ( $2 ) ) return ; const $8 = @7 ( $4 ) ; $0 . bank [ $5 . itemId ] = ( $0 . bank [ $5 . itemId ] ?? # ) + # , @8 ( $0 , $8 ) , $3 . push ( { kind : \"box\" , day : $8 , itemId : $5 . itemId } ) }","$0 , $1 , $2 , $3 { return Math . min ( $3 , Math . max ( # , $2 - $0 . plantedAt ) ) / Math . max ( # , $1 ) }","$0 , $1 { const $2 = Math . floor ( $0 / # ) , $3 = ( $0 - $2 * # ) / # ; return $2 + ( $1 !== null && $1 < $3 ? # : # ) }","$0 , $1 { const $2 = @0 ( $0 ) ; if ( $1 < $2 ) return @1 ( $0 , $1 ) * # ; const $3 = Math . min ( # , ( $1 - $2 ) / @2 ) ; return # + ( @3 - # ) * ( # - ( # - $3 ) * ( # - $3 ) ) }","{ version : \"1.0.1192\" , date : \"2026-10-16\" , title : \"Deep Vein 1.0.1192 · Overgrowth\" , lines : [ ] , sections : [ { kind : \"new\" , lines : [ \"Overgrowth: every field shows one percent, 0% to 100% as it grows, and past ripe it keeps climbing, slower and slower, to 200% after ten hours. Each full 100% is a whole harvest and the rest is the chance of one more, so a field left at 151% gives one harvest and a 51% chance of a second. A field still growing can be harvested early with Harvest now on the farm chip or in the Fields list: its percent is the chance of the harvest, and the seeds come back either way. Extra harvests give no extra xp.\" ] } ] }","`  ${ @0 . map ( $0 => $0 . en ) . join ( \", \" ) } , for fourteen days `","`  ${ @0 . map ( $0 => $0 . zh ) . join ( \"、\" ) } ，持续十四天 `","@0 . map ( $0 => ( { ... @1 . find ( $1 => $1 . itemId === $0 . from ) , itemId : $0 . id , accuracy : $0 . accuracy , strength : $0 . strength , defence : $0 . defence , levelReq : $0 . wear } ) )","$0 , $1 { return @0 ( $0 , $1 ) + $0 . pack . filter ( $2 => $2 . itemId === $1 ) . reduce ( ( $3 , $4 ) => $3 + $4 . qty , # ) }","@0 ( # )","$0 , $1 , $2 , $3 { @0 ( $0 ) , $1 . push ( $3 === void # ? { kind : \"routeStopped\" , reason : $2 } : { kind : \"routeStopped\" , reason : $2 , itemId : $3 } ) }","$0 { $0 . enhance = null }","$0 , $1 { if ( ! @0 ( $0 , $1 ) ) return ! # ; const $2 = @1 ( $1 . itemId , $1 . useCore === ! # && @2 ( $0 , $1 . itemId ) ) ; return @3 ( $0 , $1 , $2 . gold ) && @4 ( $0 ) >= $2 . shards }","$0 , $1 { return $1 . protectFrom !== void # && ( $1 . stopNoScrolls === ! # || @0 ( $1 . itemId ) >= Math . max ( @1 , $1 . protectFrom ) ) && @2 ( $0 ) === # }","$0 , $1 , $2 { @0 ( $0 , $1 ) ? @1 ( $0 , $2 , \"noMaterials\" ) : @1 ( $0 , $2 , \"noMaterials\" , @2 ( $0 , $1 ) ? @3 : $1 . itemId ) }","$0 { return @0 + @1 . filter ( $1 => $0 >= $1 ) . length }","$0 , $1 { const $2 = $0 * @0 ; return Math . floor ( $2 ) + ( $1 < $2 % # ? # : # ) }","$0 , $1 { return Math . min ( # , Math . max ( # , Math . min ( $0 , $1 ) ) / @0 ) }","[ # , # , # , # ]"],localNames=["","c,o,e,a","c,o,e,a,t,s","c,a,o,e,a","c","c,o","c,o,e,a,t","c,o,e,a,e,a","c,o,e,a,t,s,d,n,l,u,g,f,p,f,i,h,r,m,u,g,u,u","c,o,e","c,o,e,a,t,s,d,n,l,i,h,r,p,O,m,p,u,g,f,p","c,o,e,e","c,o,e,a,t,s,d,n,l,i,h,r,R,m,u,g,f,p,v,O,w,k,H","c,o,e,a,t,s,d,i,h,i,n,l,i,h,r,m,i,h,r","c,o,e,a,t,a","c,o,e,a,t,s,g,p,O,g,f,p,O,G,d,n,l,i,h,r,m,g,G,y,f,p,O,u,g,f,p,O,G,y","c,o,e,a,t,s,d,n,l,i,R,J,r,f,u,m,g,v,p,w,G,J,k,J,R,F,J,R,A","c,o,e,a,t,s,d,n,l","c,c,c,c","c,c,c,c,c","c,o,e,a,t,e,e,a,e,e","c,o,e,t,a","c,o,e,a,d,n,t,s,d","c,o,o,e","WeakSet","WeakMap","c,o,e,a,t,s,t","c,e","c,o,e,e,a"],rows=[[0,0],[1,1,[9,252],[],1],[1,2,[15,253,17,243,19,254],[],2],[0,3,[3,209,7,210,11,211,15,212,19,213,23,214]],[2,4,[0,3]],[2,5,[0,3]],[2,6,[0,3]],[0,7,[23,4,37,5,40,8,52,8,63,4,66,9,72,4,80,4,-8,6],[],3],[2,8,[0,3]],[2,9,[0,3]],[0,10],[0,11],[1,12,[3,11],[],4],[0,13],[0,14],[0,0],[1,15,[13,15],[],5],[0,0],[0,0],[0,0],[1,16,[5,17],[],4],[1,17,[5,20,13,15,17,15],[],5],[0,18],[0,19],[0,18],[1,20,[10,23],[],6],[1,21,[],[],4],[1,22,[],[],4],[0,23,[32,196,78,196,-84,167,-27,168],[[27,8,[",","qty",":","#","}",",","burn",":","@","(","#",")","}",",","{","id",":"]]],4],[0,24],[1,25,[5,170,16,238,23,31],[],5],[1,26,[5,255,22,170,26,20,69,256,71,19,74,238,82,255],[],1],[0,27],[1,28,[5,30,27,195,39,21,49,32],[],1],[1,29,[3,24,5,239],[],4],[0,30,[36,197,-95,198,-30,198]],[0,31,[0,35],[],4],[0,32,[6,199],[],4],[0,32,[6,197],[],4],[0,33,[36,37,77,37,-65,38,-22,38,-14,200]],[0,34,[24,205,58,205,92,205,-94,208,-55,208,-16,208],[[206,32,["needs",":","\"ranged\"",",","style",":","\"ranged\"","}",",","{","itemId",":","#",",","slot",":","\"weapon\"",",","accuracy",":","#",",","strength",":","#",",","defence",":","#",",","speed",":","@",",","ranged",":","!","#",",","levelReq",":","#",",","needs",":","\"ranged\"","}",",","{","itemId",":","#",",","slot",":","\"weapon\"",",","accuracy",":","#",",","strength",":","#",","]],[207,8,["#",",","defence",":","#",",","speed",":","@",",","magic",":","!","#",",","levelReq",":"]]]],[0,35],[1,25,[5,45,16,238,23,43],[],5],[1,36,[5,41,22,45,26,20,44,19,46,238,123,41],[],6],[1,37,[5,20,11,45,18,30],[],5],[0,38,[3,144],[],4],[1,39,[11,42],[],4],[0,40,[-49,168,-32,167],[[201,8,["heals",":","#","}",",","{","id",":","@",",","name",":","\"Spice\"",",","stackable",":","!"]],[202,8,["value",":","#","}",",","{","id",":","@",",","name",":","\"Packed lunch\"",",","stackable",":","!"]],[203,8,["value",":","#","}",",","{","id",":","@",",","name",":","\"Hearty lunch\"",",","stackable",":","!"]],[204,8,["heals",":","#","}",",","{","id",":","@",",","name",":","\"Salt\"",",","stackable",":","!"]]],4],[0,0],[0,0],[0,0],[1,41,[3,151],[],4],[0,42,[0,35,12,47],[],7],[0,43],[0,44],[0,45],[0,46],[0,47],[1,48,[19,240,31,248],[],1],[1,49,[],[],4],[1,50,[7,246],[],5],[0,51],[0,0],[0,52],[0,0],[0,0],[0,0],[1,53,[5,65,7,62,13,66,17,65],[],4],[0,54,[0,65]],[0,0],[1,55,[5,21,13,62,17,62,19,68,23,66,27,66,29,69,31,71],[],5],[1,56,[5,21],[],5],[0,57],[0,52,[],[],0,{"strict":true}],[0,0],[1,58,[9,73,16,188],[],4,{"strict":true,"numbers":[1,1]}],[1,59,[3,72],[],5],[1,60,[121,20,128,169,132,21,181,21,311,257,561,258,570,259,577,260,589,261,598,261,609,262,624,262,641,263,649,264,662,262,667,265,697,266,706,258,713,260,731,267,735,268,756,267,760,269],[],8],[0,61],[0,61],[0,18],[0,0],[0,0],[0,62],[1,63,[8,70,13,83,15,78],[],4],[1,64,[13,70,23,82,25,81,32,79,47,80,52,81],[],1],[1,65,[9,184,37,85],[],2],[1,66,[14,182,25,86,32,239,40,21],[],9],[0,0],[0,67],[0,18],[0,68],[0,0],[0,0],[0,0],[1,69,[10,94,18,91,27,89,36,90,63,93,75,92],[],2],[1,70,[37,270,42,271],[],1],[1,71,[3,87,10,96],[],4],[0,72],[1,73,[5,272,15,48,28,149,30,169,34,21,44,98,54,12],[],5],[0,74],[0,0],[0,75,[2,175,5,176]],[1,76,[7,236,25,100,27,235,65,249,69,250],[],1],[0,0],[0,0],[0,0],[1,77,[7,247,9,165,22,224,24,244,31,245,38,225,42,58,53,60],[],9],[1,78,[18,273,45,274,55,275,94,276,96,244,105,277,154,48,165,107,176,2,186,104,208,2,218,105,253,25,257,46,264,247,268,166,277,16,286,109,330,2,340,64,359,63,365,67,372,109,402,46,414,2,424,106,457,109,493,2,503,278,522,279,533,280,540,109,544,49,560,49,596,281],[],10],[1,79,[7,125],[],9],[1,80,[9,282,36,282],[],1],[0,0],[0,0],[0,0],[0,18],[0,67],[0,18],[0,0],[1,81,[5,195,27,102],[],11],[1,82,[5,118,7,21,21,117,33,116],[],1],[0,0],[0,0],[0,0],[1,83,[17,238,24,20,31,230,42,231,53,283,61,284,72,285,103,286,147,287,167,288,204,287,216,289,231,290,236,291,253,273,262,2,272,292,293,190,318,216,325,234,334,293,338,215,350,294,363,237,374,237,396,295,418,238,445,238,486,233,519,233,532,296,542,233,556,297,573,110,760,143],[],12],[1,84,[9,172,27,282,48,233,63,181,152,185,177,233,220,298,226,299,249,233,280,110,293,171],[],13],[1,85,[8,272,48,300,80,301],[],14],[0,0],[0,0],[0,0],[0,0],[1,86,[7,302],[],9],[1,87,[7,302,35,30,48,303],[],1],[1,88,[22,282],[],2],[1,89,[22,282],[],2],[1,90,[3,247,7,224,9,244,16,245,23,225],[],4],[1,91,[7,131,28,103,37,55,44,60,53,60,84,247],[],2],[1,92,[13,180,188,1,194,127,204,132,213,125,254,1,260,128,270,133,311,165,322,273,337,48,356,2,366,304,402,130,420,34,426,46,435,25,441,247,447,134,452,58,465,166,470,60,487,177,502,48,504,179,521,305,526,247,532,306,549,307,562,60,575,277,588,308,601,109,617,110,744,309,752,310,762,311,770,310,787,2,797,126,840,51,849,130,867,34,873,46,882,2,892,129,911,25,917,247,923,134,928,58,941,166,946,60,959,141,977,16,984,125,1008,143],[],15],[0,0,[],[],0,{"strict":true}],[1,93,[5,21,11,195],[],9],[0,0],[0,0],[1,94,[3,138],[],4],[1,95,[18,138,40,273,62,21,71,2,81,342,109,125,127,313,151,309,162,311,178,165,189,2,199,341,214,2,224,343,237,316,239,317,251,334,253,282,263,335,265,303,312,239,323,16,348,125,360,247,366,134,371,58,382,60,416,125,432,2,442,344,450,345,459,25,463,46,481,34,491,247,495,166,502,125,512,16,560,305,565,247,571,306,581,307,592,60,605,110,700,313,724,309,735,311,746,143,760,336],[],16,{"strict":true,"numbers":[1,0,1,0,1,0,1,0,1,0,4,0,1,0,0,1,0,0,1,0,0,0,0,0]}],[1,96,[14,75,22,76,37,2,47,137,67,109],[],17,{"strict":true,"numbers":[1]}],[0,97,[2,163,5,163,11,164,23,153],[],4],[0,98],[0,99,[5,28,19,13,35,28],[],18],[0,75,[2,47,5,52]],[0,0],[0,0],[0,0],[0,100,[5,28,24,48,27,148,29,50,32,13,44,36,47,28],[],19],[0,101],[1,102,[27,22,42,16],[],1],[1,103,[17,162,41,34,50,46],[],6],[0,104,[],[],19],[0,105,[],[],0,{"dictionary":["Copper","Salmon","Salted shrimp","Bronze shield","Steel hammer","Cobalt greatsword","Colossus shield","Yew staff","Bogskin jerkin","Homespun bolt","Gilded skirt","Turnip seed","Ember salamander","Drake scale","Rock mite nymph","Dragon egg"]}],[0,106,[],[],0,{"dictionary":["From a good meal. Every rarity hits the same; the rarer the food, the longer it lasts.","Deep Vein","Stop after","Offline","Only moderators read this","You cannot wear that yet.","A whole vein","On the phone the top bar shows one buff chip with a count; a tap opens the sheet with every buff.","grows","👥 The player count over the door now counts people who are here or away with a task running — not accounts that connected once and never did anything. It had been inflated by a wave of throwaway guest accounts; the real number is back.","Five parts a level 85+ monster left could only be sold. Now: Troll hide is the sixth leather (Crafting 95) with a Troll quiver (Fletching 95); Drake hide the seventh (99) with a Drake quiver; an ice wight’s shard stiffens voidweave into Wightweave hood, robe, skirt and grimoire (Crafting 90); and meteoric folded round a Colossus chip is the one metal set past meteoric: blade, shield, helm, plate and greaves at Smithing 99. Each rung about a quarter over the one below.","sinks in","Take it down -- it keeps its level, frees the room, and gives nothing until it is put back","Pay a step from +5 with a Colossus core","A barrier of light ripples round you","Buy from the vendor?"]}],[0,107,[],[],0,{"dictionary":["1 in {n}","1 minute","The vein answers to you.","a narrow gorge","The altar","A straw butt on a stout wooden post: the eye trained here drives every arrow home harder.","Hit harder with every style.","Owl Cloak","White hair standing on end, eyes that flash, a midnight cloak that billows out behind you in four frames, and lightning that strikes the ground beside you as you walk. The most noise a character can make without a sound.","Snow falls around you; breath puffs; crown glints","Ash coat","Well travelled","Half a million","Errand legend","Finish a quest.","Reach level 10 in every skill."]}],[0,108,[],[],0,{"dictionary":["Bread stall","Relic stall","Cook sardine","Cook tuna","Cook shark","Silk cart","Maple","Tree","Husk","Emberkin","Dune stalker","Ash drake","Fen lurker","Stone eater","Interface size","No sign-up. The character lives in this browser until you give it a name under Account."]}],[0,109,[22,161,29,169,83,195,-83,102,-58,13,-34,67,-19,72],[],20],[0,110],[0,111],[0,75,[2,40,5,323]],[0,112,[5,195,19,36],[],4],[1,113,[],[],6],[1,114,[5,236,23,100,33,235,45,249,49,250],[],9],[0,115],[0,0],[0,116,[3,167],[],4],[0,38,[3,324],[],4],[1,117,[17,39,37,20],[],21],[1,118,[13,21,31,16,40,239,48,238,58,237],[],6],[1,119,[31,239,37,51,48,16],[],9],[1,120,[16,173],[],9],[0,121,[0,35],[],4],[0,121,[0,39],[],4],[1,122,[25,178],[],9],[1,123,[4,26,11,150,13,146],[],4],[1,124,[5,16,13,177],[],5],[1,125,[29,178,39,16],[],9],[1,126,[17,174,29,233],[],6],[1,127,[3,169,7,21],[],4],[1,128,[14,182,25,184,32,21],[],9],[1,129,[7,84],[],6],[1,130,[30,70],[],1],[0,0],[1,131,[5,101],[],4],[0,0,[],[],0,{"strict":true}],[1,132,[7,112,13,111],[],4],[1,133,[11,189,19,193,25,191,30,192],[],5],[1,134,[5,122,8,282],[],4],[1,135,[9,121,11,60],[],4],[1,136,[5,236,23,100,33,235,45,249,49,250],[],9],[1,137,[109,222,115,222],[],22],[0,138,[0,28,7,10],[],4],[0,139],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,140,[0,22]],[0,141,[3,152],[],4],[0,142,[10,0]],[0,143,[12,223],[],4],[0,144,[0,219]],[0,0],[0,0],[0,145],[0,146],[0,0],[0,47],[1,147,[10,238,17,115,19,119,27,114,29,239,41,218,65,113],[],6],[1,148,[5,238,10,218,12,232],[],5],[1,149,[3,233,7,217,22,217],[],23],[1,150,[],[],5],[1,151,[3,325,7,215],[],4],[1,152,[],[],5],[1,153,[],[],5],[1,154,[7,17],[],5],[1,155,[9,17],[],4],[1,156,[5,20,13,15,21,15],[],5],[1,157,[11,221,16,226,18,241,26,227,33,243,39,228,64,186,66,326,72,221,82,221],[],1],[1,158,[6,327,9,327,13,328,15,242,21,327,27,327,33,242,35,327,38,328,42,328,50,226,57,328],[],5],[1,159,[3,243,9,228,12,226],[],4],[1,160,[],[],1],[1,161,[5,245,12,219,14,194],[],5],[1,162,[],[],5],[1,163,[7,220],[],9],[1,164,[],[],9],[1,165,[17,229],[],5],[1,166,[5,187],[],5],[1,167,[],[],5],[1,168,[22,238,37,18,41,329,72,120,97,330,104,331,111,332,118,329,126,215,129,333,143,331,151,333,164,332,172,329,180,215,188,123,206,329,214,49,228,329,237,330,244,238,255,329],[],6],[1,169,[7,253,9,243],[],9],[1,170,[],[],4],[1,171,[7,253,9,243],[],9],[0,35],[0,0],[0,0],[0,172,[],[],24],[1,173,[12,53,16,282],[],9],[0,172,[],[],25],[0,172,[],[],25],[0,174,[0,"__native_$d"],[],4],[0,175,[0,262],[],4],[0,176,[0,262],[],4],[1,177,[39,277],[],9],[0,178,[11,262,30,262,41,"gv",45,262,59,262,63,"gv",67,262],[],2],[1,179,[20,265],[],1],[0,35],[0,35],[0,180,[0,"e2",2,"__native_ff"]],[1,181,[15,"r9",34,88,39,"__native_Cd",49,95],[],2],[1,182,[5,"$x",21,238,29,"Tj"],[],5],[1,183,[],[],1],[1,184,[15,253,17,243,19,254],[],2],[0,0],[0,0],[1,185,[17,287],[],1],[0,0],[1,186,[],[],4],[1,187,[],[],4],[1,188,[],[],4],[1,189,[18,"nd",45,7],[],1],[1,190,[11,"Bs",32,286,70,233],[],9],[1,191,[16,286,28,288,60,"Bs",70,"RW",76,"DI"],[],21],[1,151,[3,325,7,49],[],4],[1,192,[],[],4],[1,193,[21,"sY",30,"sY"],[],1],[1,194,[],[],6],[1,195,[23,287],[],9],[1,196,[17,217,56,217,59,233,63,217,72,217,82,217],[],11],[1,197,[4,293,8,49],[],5],[0,0],[1,198,[94,233],[],26],[1,199,[30,287],[],9],[1,200,[14,"u9",20,119,25,239],[],9],[1,201,[122,21,130,21],[],17],[1,202,[13,"$I",21,305,23,239,36,247,38,165,49,306,57,307,68,60],[],2],[1,203,[3,"sS",13,"U9"],[],4],[1,204,[],[],4],[1,205,[9,301],[],4],[1,206,[3,"__native_G2"],[],4],[0,207,[8,32],[],5],[1,208,[9,30],[],4],[0,0],[0,18],[1,209,[16,"DT",24,247,30,"Nk",32,244,45,"vK",47,244,60,"OK",62,244,73,"DO",75,244,82,245,89,"nf"],[],1],[1,210,[19,240,31,248],[],1],[1,211,[],[],1],[1,212,[11,273,29,2,39,"ZN",60,"cB",70,2,80,"oB",101,25,105,46,114,"__native_Sd",119,16,121,50],[],17],[1,213,[11,"bB"],[],5],[1,214,[17,"uf",27,"$q",37,"Dq",47,273,56,2,66,"xq",85,"Pq",95,"NK",124,"BK"],[],17],[0,0],[1,215,[],[],1],[0,0],[0,0],[1,216,[],[],1],[1,217,[7,"ts",19,"kB",43,"Av",50,"kf"],[],1],[0,0],[0,0],[0,218],[0,219,[3,"nh"],[],4],[0,220,[3,"nh"],[],4],[0,221,[0,35,9,40],[],27],[0,97,[2,29,5,29,11,"Sj",23,"kj"],[],4],[1,222,[5,233],[],28],[0,0],[0,0],[0,223,[0,242]],[1,224,[8,330],[],1],[1,225,[],[],4],[1,226,[7,283,21,230,34,231,45,284,56,285],[],9],[1,227,[20,238,31,216,39,234],[],5],[1,228,[6,"qI",13,329,22,329,30,283,37,49],[],9],[1,229,[3,337,5,338],[],5,{"strict":true,"numbers":[]}],[1,230,[9,339],[],9,{"strict":true,"numbers":[1,1,0]}],[1,231,[27,340],[],5,{"strict":true,"numbers":[1,0]}],[0,0,[],[],0,{"strict":true}],[0,232,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}],[0,0,[],[],0,{"strict":true}]];
    const kinds=['value','function','binding'],schema={},name=value=>typeof value==='number'?names[value]:value;
    for(let index=0;index<rows.length;index++) {
        const [kind,shape,refs=[],links=[],locals=0,extra={}]=rows[index],dependencies=[];
        for(let at=0;at<refs.length;at+=2)dependencies.push([refs[at],name(refs[at+1])]);
        schema[names[index]]={kind:kinds[kind],shape:shapes[shape],refs:dependencies,links:links.map(([role,offset,pattern])=>[name(role),offset,pattern]),locals:localNames[locals]?localNames[locals].split(','):[],...extra};
    }
const work=schema.R9, at=work.shape.split(' ').indexOf('@15');
work.strict=true;
work.numbers=[0,1,0,0,0,1,1,0,0,0,0,1,0,0,1,1,0,0,1,1];
work.variants=[{...work,shape:work.shape.replace('$21 = @15 (','$21 = $2 . plain ? # : @15 ('),refs:work.refs.map(([position,role])=>[position>=at?position+6:position,role]),numbers:[0,1,0,0,0,1,1,0,0,0,0,0,1,0,0,1,1,0,0,1,1]}];
    const tables={
        yz:['itemId','slot','accuracy','strength','defence','levelReq','needs'],
        oH:['itemId','slot','bonus'],je:['id','name','bonus','feeds','look','blurb'],
        wt:['id','name','level','hp','maxHit','attack','defence','speed','xp','gold','bonus','drop'],
        T6:['id','name','monsterId','population'],h4:['itemId','skill','art'],On:['id','perRank','unit','lane']
    };
    for(const [role,fields]of Object.entries(tables))schema[role].table=fields;
    schema.yz.tableRefs=[[110,'speed','Xa'],[140,'speed','Xi'],[146,'speed','xl'],[152,'speed','_i']];
    schema.fF.variants=[{"kind":"function","shape":"$0 , $1 , $2 , $3 , $4 , $5 , $6 = ! # { const $7 = @0 ( $3 . seedItemId ) ; if ( ! $7 ) return ; $0 . actionIndex ++ ; const $8 = @1 ( $0 , \"farm\" ) , $9 = $7 . inputs [ # ] ?. qty ?? # , $10 = @2 ( $3 . seedItemId ) ; if ( @3 ( $1 . seed , $1 . secretAt , @4 , $0 . id , $8 , $4 ) === null ) { for ( let $11 = # ; $11 < $9 ; $11 ++ ) @5 ( $0 , $6 ? $3 . seedItemId : $10 , # ) ; const $12 = @6 ( $3 , Object . keys ( $0 . plots ) . length , $4 , $7 . grow ?? # ) ; @7 ( $0 , $1 , $12 , $5 ) , @8 ( $0 , $1 , $12 , $5 ) ; return } const $13 = @9 ( $1 . windows , $4 ) , $14 = @3 ( $1 . seed , $1 . secretAt , @10 , $0 . id , $8 , $4 ) ?? # , $15 = @11 ( $0 , $1 , $2 , $3 , $4 ) , $16 = @12 ( @13 ( $3 , $4 ) , $15 ) , $17 = @14 ( @15 ( $0 . skills . farming ) ) + @16 ( @17 ( $0 . equipment . hoe ) , $14 ) , $18 = $17 * $16 , $19 = $17 * Math . max ( # , $16 - # ) , $20 = Math . max ( # , Math . min ( # , @18 ( $3 . seedItemId ) ) ) , $21 = @19 ( $7 . output . itemId , $20 ) ; for ( let $22 = # ; $22 < $18 ; $22 ++ ) @5 ( $0 , $21 , # ) ; const $23 = @20 ( $13 . rarityMult , @21 ( $0 ) , @22 ( $4 , \"farming\" , $1 . hypothetical ) , @23 ( $0 . masteries , \"rare\" ) ) ; for ( let $24 = # ; $24 < $9 ; $24 ++ ) { if ( $6 && $16 === # ) { @5 ( $0 , $3 . seedItemId , # ) ; continue } const $25 = @3 ( $1 . seed , $1 . secretAt , @24 , $0 . id , $8 * @25 + $24 , $4 ) , $26 = @26 ( $25 , @27 ( $0 . equipment ) + ( $0 . equipment . hoe === null ? # : @28 ( $0 . equipment . hoe ) ) , @20 ( $23 , @29 ( $0 ) ) ) ; @5 ( $0 , $26 === # ? $10 : @19 ( $10 , $26 ) , # ) } if ( $16 === # ) $5 . push ( { kind : \"harvestLost\" , itemId : $7 . output . itemId } ) ; else { const $27 = Math . round ( $7 . xp * @30 [ $20 ] * @20 ( $13 . xpMult , @31 ( $0 , ! # , \"farming\" ) , @32 ( $4 , \"farming\" , $1 . hypothetical ) , @23 ( $0 . masteries , \"xp\" ) ) ) , $28 = @33 ( $0 , \"farming\" , $27 ) ; $5 . push ( { kind : \"produced\" , jobId : $7 . id , itemId : $21 , xp : $27 , tier : $20 , qty : $18 , wire : ! # , xpBonus : $27 , ... $19 ? { overgrowth : $19 } : { } } ) , $28 . after > $28 . before && $5 . push ( { kind : \"levelUp\" , skill : \"farming\" , level : $28 . after } ) } const $29 = @6 ( $3 , Object . keys ( $0 . plots ) . length , $4 , $7 . grow ?? # ) ; @7 ( $0 , $1 , $29 , $5 ) , @8 ( $0 , $1 , $29 , $5 ) , @34 ( $0 , $1 , \"farming\" , $8 , $4 , $5 , @35 ( $7 . grow ?? # , $4 - $3 . plantedAt ) ) }","refs":[[20,"yt"],[42,"Kh"],[64,"go"],[73,"aa"],[83,"farmEntrySeed"],[111,"$a"],[129,"oA"],[153,"Hv"],[164,"bv"],[180,"Un"],[191,"aa"],[201,"farmYieldSeed"],[216,"farmGrowthRoll"],[231,"gP"],[233,"iG"],[245,"farmBaseYield"],[247,"$o"],[257,"farmToolYield"],[259,"Zl"],[306,"jo"],[317,"Pc"],[342,"$a"],[354,"pa"],[360,"Jw"],[365,"Bb"],[376,"ga"],[410,"$a"],[426,"aa"],[436,"farmRaritySeed"],[444,"farmSeedStride"],[453,"vm"],[457,"_l"],[475,"I1"],[485,"pa"],[489,"Um"],[496,"$a"],[506,"Pc"],[554,"ri"],[559,"pa"],[565,"lG"],[575,"FO"],[586,"ga"],[599,"vt"],[694,"oA"],[718,"Hv"],[729,"bv"],[740,"E4"],[754,"farmPetChance"]],"links":[],"locals":["c","o","plotId","e","a","t","s","d","n","l","i","R","J","r","f","u","m","g","v","p","w","G","J","k","J","R","F","J","R","A"],"strict":true,"numbers":[1,0,1,0,1,0,1,0,1,0,4,0,1,0,0,1,0,0,1,0,0,0,0,0]}];
    schema.tT.variants=[{"kind":"function","shape":"$0 , $1 , $2 { const $3 = @0 ( $1 , $2 ) ; if ( $3 === null ) return \"notFrom\" ; if ( @1 ( $0 . skills [ $1 . skill ] ) < $1 . levelReq ) return \"level\" ; if ( @2 ( $0 , $2 ) < # ) return \"missing\" ; const $4 = @3 ( $0 , $1 , $2 ) ; if ( $4 === \"missing\" ) return \"missing\" ; const $5 = new Map , $6 = ( $7 , $8 ) => $5 . set ( $7 , ( $5 . get ( $7 ) ?? # ) + $8 ) ; $6 ( $2 , - # ) ; for ( const $9 of $4 ) $6 ( $9 . itemId , - $9 . qty ) ; $6 ( $3 , # ) ; let $10 = # ; for ( const [ $11 , $12 ] of $5 ) { const $13 = @2 ( $0 , $11 ) , $14 = $13 + $12 ; $13 > # && $14 === # && $10 -- , $13 === # && $14 > # && $10 ++ } if ( $10 > # && @4 ( $0 ) + $10 > @5 ( $0 ) && ! @6 ( $0 ) ) return \"full\" ; for ( const [ $15 , $16 ] of $5 ) { const $17 = @2 ( $0 , $15 ) + $16 ; $17 === # ? delete $0 . bank [ $15 ] : $0 . bank [ $15 ] = $17 } return @7 ( $0 , $1 . skill , $1 . xp ) , @8 ( $0 , $1 , $3 ) , \"ok\" }","refs":[[9,"upgradeTarget"],[27,"$o"],[48,"Po"],[63,"upgradeMaterials"],[169,"Po"],[210,"G2"],[217,"Sf"],[223,"Yn"],[246,"Po"],[277,"vt"],[290,"recordUpgrade"]],"links":[],"locals":["c","o","e","a","t","s","d","i","h","i","l","i","h","r","m","i","h","r"],"strict":true,"numbers":[1,0,1,1,0,0,0,0,0,0,0]}];
    schema.farmGrowthRoll={"kind":"function","shape":"$0 , $1 , $2 , $3 , $4 { return @0 ( $1 . seed , $1 . secretAt , @1 , $0 . id , @2 ( $2 , $3 . plantedAt , @1 ) , $4 ) }","refs":[[11,"aa"],[21,"farmGrowthSeed"],[27,"ic"],[35,"farmGrowthSeed"]],"links":[],"locals":["c","o","e","a","t"],"strict":true,"numbers":[]};
    // Reviewed source templates are parsed, never executed, to recognize renamed game functions.
    const modern=indexTopLevel(`
function R9(c,o,e,a,t){const s=jobInputs(e,c.workRarity);for(const g of s)if(availableWorkInput(c,e,g.itemId)<g.qty)return;for(const g of s){let f=g.qty;for(let p=c.pack.length-1;p>=0&&f>0;p--){const O=c.pack[p];if(O.itemId!==g.itemId)continue;const G=Math.min(f,O.qty);O.qty-=G,f-=G,O.qty===0&&c.pack.splice(p,1)}}c.actionIndex++;const d=e.burn;if(d&&Om(o.seed^v9,c.id,c.actionIndex,H9(e,c))){$a(c,d.itemId,1),t.push({kind:"burnt",itemId:d.itemId});return}const n=e.caught;if(n&&Om(o.seed^y9,c.id,c.actionIndex,eF(e,c))){c.stunUntil=a+n.stunTicks,t.push({kind:"caught",ticks:n.stunTicks});return}const l=Un(o.windows,a),i=Kh(c,"craft"),h=e.output.itemId===Aa,r=e.inputs.length===0&&!h,m=r?aa(o.seed,o.secretAt,rB,c.id,i,a):null;if(!r||m!==null){let g=0;if(r){const G=b0(c,e.skill),y=(G===null?0:I1(G))+_l(c.equipment);g=e.plain?0:vm(m,y,pa(l.rarityMult,Jw(c),Bb(a,e.skill,o.hypothetical),Um(c),ga(c.masteries,"rare")))}else h||(g=jobQuality(e,c.workRarity));const f=h?Aa:jobOutput(e,g),p=Math.round(e.xp*ri[g]*pa(l.xpMult,lG(c,e.inputs.length===0,e.skill),FO(a,e.skill,o.hypothetical),ga(c.masteries,"xp")));h?Ph(c,e.output.qty,"stall"):vB(c,e,e.output.qty)||Sd(c,f,e.output.qty);const O=vt(c,e.skill,p);t.push({kind:"produced",jobId:e.id,itemId:f,xp:p,tier:g,...e.output.qty!==1?{qty:e.output.qty}:{},...r?{wire:!0,xpBonus:p}:{},...c.route?.order?{order:!0}:{}}),O.after>O.before&&t.push({kind:"levelUp",skill:e.skill,level:O.after})}Hv(c,o,1/uS(e,c),t),bv(c,o,1/uS(e,c),t);const u=e.bonus?aa(o.seed,o.secretAt,G9,c.id,i,a):null;if(e.bonus&&u!==null&&u<e.bonus.chance){let g=e.bonus.itemId;if(bf(g)){const f=b0(c,e.skill),p=(f===null?0:I1(f))+_l(c.equipment),O=aa(o.seed,o.secretAt,S9,c.id,i,a),G=O===null?0:vm(O,p,pa(l.rarityMult,Jw(c),Bb(a,e.skill,o.hypothetical),Um(c),ga(c.masteries,"rare"))),y=Nm(g)?Math.max(1,G):G;g=Pc(g,y)}$a(c,g,1)&&t.push({kind:"bonus",itemId:g})}E4(c,o,e.skill,i,a,t)}
function availableWorkInput(c,o,e){if(lockedWorkInput(c,o,e))return 0;let a=0;for(const t of c.pack)t.itemId===e&&(a+=t.qty);return a}
function lockedWorkInput(c,o,e){return o.grow===void 0&&c.bankLocked.length>0&&c.bankLocked.includes(e)}
`);
    const definitions=new Map([...Object.keys(schema).map(name=>[name,null]),...modern]);
    for(const [name,row]of modern){
        const description=adaptiveDescription(row,definitions);
        const rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true,numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))};
        if(schema[name])(schema[name].variants??=[]).push(rule);else schema[name]=rule;
    }
    const retiredShapes=indexTopLevel('const xo=Cd.filter(c=>!retiredJob(c.id));function retiredJob(c){return HD.has(c)||!jobFeatureFlags.alchemy&&gatedAlchemyJobs.has(c)}function ff(c){return YD.has(c%1e3)||!jobFeatureFlags.alchemy&&gatedAlchemyItems.has(c%1e3)}');
    const retiredDefinitions=new Map([...Object.keys(schema).map(name=>[name,null]),...retiredShapes,['jobFeatureFlags',null],['gatedAlchemyJobs',null],['gatedAlchemyItems',null]]);
    for(const [name,row]of retiredShapes){
        const description=adaptiveDescription(row,retiredDefinitions),rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true};
        if(schema[name])(schema[name].variants??=[]).push(rule);else schema[name]=rule;
    }
    for(const role of ['jobFeatureFlags','gatedAlchemyJobs','gatedAlchemyItems'])schema[role]={kind:'value',shape:'',refs:[],links:[],locals:[]};
    const necessaryTemplates=[
        'function b0(c,o){const e=iP[o];return e?c.equipment[e]:null}',
        'function k9(c,o){const e=iP[o];if(!e)return 1;const a=c.equipment[e];return a===null||rs(a)?.slot!==e?1:1+Zl(a)}',
        'const iP=Object.fromEntries(Object.entries(Wr).map(([c,o])=>[o,c]));',
        'function Zl(c){return c===null?0:rs(c)?.bonus??0}',
        'function excludedCollection(c){return fireworkIds.has(go(c))}',
        'function excludedCollection(c){return fireworkIds.has(go(c))||go(c)===excludedPowder}'
    ];
    for(const source of necessaryTemplates)for(const [name,row]of indexTopLevel(source)){
        const definitions=new Map([...Object.keys(schema).map(role=>[role,null]),['excludedPowder',null]]),description=adaptiveDescription(row,definitions);
        const rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true,numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))};
        (schema[name].variants??=[]).push(rule);
    }
    for(const [role,numbers]of [['b0',[]],['k9',[1,1,1]],['iP',[]],['Zl',[0,0]]])Object.assign(schema[role],{strict:true,numbers});
    schema.excludedCollection.relationOnly=true;
    // BEGIN REVIEWED 1.0.1212 RULES
    const currentTemplates=indexTopLevel("function R9(c , o , e , a , t) { const s = jobInputs ( e , c . workRarity ) ; for ( const g of s ) if ( availableWorkInput ( c , e , g . itemId ) < g . qty ) return ; const n = freeWorkInputs ( c , o , e , b0 ( c , e . skill ) , c . actionIndex + 1 ) ; if ( ! n ) for ( const g of s ) { let w = g . qty ; for ( let p = c . pack . length - 1 ; p >= 0 && w > 0 ; p -- ) { const b = c . pack [ p ] ; if ( b . itemId !== g . itemId ) continue ; const v = Math . min ( w , b . qty ) ; b . qty -= v , w -= v , b . qty === 0 && c . pack . splice ( p , 1 ) } } c . actionIndex ++ ; const d = e . burn ; if ( d && Om ( o . seed ^ v9 , c . id , c . actionIndex , H9 ( e , c ) ) ) { $a ( c , d . itemId , 1 ) , t . push ( { kind : \"burnt\" , itemId : d . itemId } ) ; return } const i = e . caught ; if ( i && Om ( o . seed ^ y9 , c . id , c . actionIndex , eF ( e , c ) ) ) { c . stunUntil = a + i . stunTicks , t . push ( { kind : \"caught\" , ticks : i . stunTicks } ) ; return } const l = Kh ( c , \"craft\" ) , h = e . output . itemId === Aa , r = e . inputs . length === 0 && ! h , u = r ? aa ( o . seed , o . secretAt , rB , c . id , l , a ) : null ; if ( ! r || u !== null ) { let g = 0 ; r ? g = e . plain ? 0 : workQuality ( c , o , a , e . skill , u ) : h || ( g = jobQuality ( e , c . workRarity ) ) ; let w = h ? Aa : jobOutput ( e , g ) , p = e . output . qty ; const b = b0 ( c , e . skill ) , v = workExperience ( c , o , e , g , a , e . inputs . length === 0 ) , O = r ? toolExperienceProc ( c , o , b , w , 1 , l , a , ( Y , R ) => workExperience ( c , o , Y , R , a , ! 1 ) ) : null ; O && O . itemId !== null && ( applyToolExperience ( c , O . fx ) , w = O . itemId , p = O . qty ) , h ? Ph ( c , e . output . qty , \"stall\" ) : vB ( c , e , e . output . qty ) || Sd ( c , w , p ) ; const S = vt ( c , e . skill , v ) , k = O ? vt ( c , O . fx . skill , O . fx . xp ) : null ; t . push ( { kind : \"produced\" , jobId : e . id , itemId : w , xp : v , tier : g , ... p !== 1 ? { qty : p } : { } , ... r ? { wire : ! 0 , xpBonus : v } : { } , ... c . route ?. order ? { order : ! 0 } : { } , ... O ? { fx : O . fx } : { } , ... n ? { free : ! 0 } : { } } ) , S . after > S . before && t . push ( { kind : \"levelUp\" , skill : e . skill , level : S . after } ) , O && k && k . after > k . before && t . push ( { kind : \"levelUp\" , skill : O . fx . skill , level : k . after } ) } Hv ( c , o , 1 / uS ( e , c ) , t ) , bv ( c , o , 1 / uS ( e , c ) , t ) ; const f = e . bonus ? aa ( o . seed , o . secretAt , G9 , c . id , l , a ) : null ; if ( e . bonus && f !== null && f < e . bonus . chance ) { let g = e . bonus . itemId ; if ( bf ( g ) ) { const w = aa ( o . seed , o . secretAt , S9 , c . id , l , a ) , p = w === null ? 0 : workQuality ( c , o , a , e . skill , w ) , b = Nm ( g ) ? Math . max ( 1 , p ) : p ; g = Pc ( g , b ) } $a ( c , g , 1 ) && t . push ( { kind : \"bonus\" , itemId : g } ) } reviewed_az ( c , o , e . skill , l , a , t ) }\nfunction fF(c , o , e , a , t , s , n = ! 1) { const d = yt ( a . seedItemId ) ; if ( ! d ) return ; c . actionIndex ++ ; const i = Kh ( c , \"farm\" ) , l = d . inputs [ 0 ] ?. qty ?? 1 , h = go ( a . seedItemId ) ; if ( aa ( o . seed , o . secretAt , farmEntrySeed , c . id , i , t ) === null ) { for ( let q = 0 ; q < l ; q ++ ) $a ( c , n ? a . seedItemId : h , 1 ) ; const R = oA ( a , Object . keys ( c . plots ) . length , t , d . grow ?? 0 ) ; Hv ( c , o , R , s ) , bv ( c , o , R , s ) ; return } const u = Un ( o . windows , t ) , f = aa ( o . seed , o . secretAt , farmYieldSeed , c . id , i , t ) ?? 1 , g = farmGrowthRoll ( c , o , e , a , t ) , w = gP ( iG ( a , t ) , g ) , p = farmBaseYield ( $o ( c . skills . farming ) ) + farmToolYield ( Zl ( c . equipment . hoe ) , f ) , b = p * w , v = p * Math . max ( 0 , w - 1 ) , O = Math . max ( 0 , Math . min ( 4 , jo ( a . seedItemId ) ) ) , S = Pc ( d . output . itemId , O ) ; for ( let R = 0 ; R < b ; R ++ ) $a ( c , S , 1 ) ; const k = pa ( u . rarityMult , Jw ( c ) , Bb ( t , \"farming\" , o . hypothetical ) , ga ( c . masteries , \"rare\" ) ) ; for ( let R = 0 ; R < l ; R ++ ) { if ( n && w === 0 ) { $a ( c , a . seedItemId , 1 ) ; continue } const q = aa ( o . seed , o . secretAt , farmRaritySeed , c . id , i * farmSeedStride + R , t ) , z = vm ( q , _l ( c . equipment ) + ( c . equipment . hoe === null ? 0 : I1 ( c . equipment . hoe ) ) , pa ( k , Um ( c ) ) ) ; $a ( c , z === 0 ? h : Pc ( h , z ) , 1 ) } if ( w === 0 ) s . push ( { kind : \"harvestLost\" , itemId : d . output . itemId } ) ; else { const R = Math . round ( d . xp * ri [ O ] * pa ( u . xpMult , lG ( c , ! 0 , \"farming\" ) , FO ( t , \"farming\" , o . hypothetical ) , ga ( c . masteries , \"xp\" ) ) ) , q = vt ( c , \"farming\" , R ) , z = toolExperienceProc ( c , o , c . equipment . hoe , S , b , i , t , ( j , T ) => workExperience ( c , o , j , T , t , ! 1 ) ) , F = z ? vt ( c , z . fx . skill , z . fx . xp ) : null ; s . push ( { kind : \"produced\" , jobId : d . id , itemId : S , xp : R , tier : O , qty : b , wire : ! 0 , xpBonus : R , ... v ? { overgrowth : v } : { } , ... z ? { fx : z . fx } : { } } ) , q . after > q . before && s . push ( { kind : \"levelUp\" , skill : \"farming\" , level : q . after } ) , z && F && F . after > F . before && s . push ( { kind : \"levelUp\" , skill : z . fx . skill , level : F . after } ) } const Y = oA ( a , Object . keys ( c . plots ) . length , t , d . grow ?? 0 ) ; Hv ( c , o , Y , s ) , bv ( c , o , Y , s ) , reviewed_az ( c , o , \"farming\" , i , t , s , reviewed_J7 ( d . grow ?? 0 , t - a . plantedAt ) ) }\nfunction workQuality(c , o , e , a , t , s) { const n = Un ( o . windows , e ) , d = b0 ( c , a ) , i = ( d === null ? 0 : I1 ( d ) ) + _l ( c . equipment ) ; return vm ( t , i , pa ( n . rarityMult , Jw ( c ) , Bb ( e , a , o . hypothetical ) , Um ( c ) , ga ( c . masteries , \"rare\" ) ) , s ) }\nfunction freeWorkInputs(c , o , e , a , t) { return e . inputs . length === 0 || freeInputToolSkill ( a ) !== e . skill ? ! 1 : Om ( o . seed ^ freeInputSeed , c . id , t , freeInputChance ) }\nfunction freeInputToolSkill(c) { return c === null ? void 0 : freeInputSkills [ go ( c ) ] }\nfunction toolExperienceProc(c , o , e , a , t , s , n , d) { const i = toolExperienceSource ( e ) ; if ( ! i ) return null ; const l = aa ( o . seed , o . secretAt , toolExperienceSeed , c . id , s , n ) ; if ( l === null || l >= toolExperienceChance ) return null ; const h = toolExperienceJob ( i , a , $o ( c . skills [ i . skill ] ) ) ; if ( ! h ) return null ; const r = jo ( a ) ; if ( i . xpOnly ) { const u = Math . round ( d ( h , r ) * t / h . inputs . reduce ( ( f , g ) => f + g . qty , 0 ) ) ; return u > 0 ? { itemId : null , qty : 0 , fx : { skill : i . skill , xp : u } } : null } return { itemId : null , qty : 0 , fx : { skill : i . skill , xp : d ( h , jobQuality ( h , r ) ) } } }\nfunction toolExperienceSource(c) { if ( c === null ) return ; const o = go ( c ) ; return toolExperienceDefinitions . find ( e => e . tool === o ) }\nfunction toolExperienceJob(c , o , e) { const a = go ( o ) , t = `${c.tool}:${a}:${e}` , s = reviewed_H$ . get ( t ) ; if ( s !== void 0 ) return s ; let n = null ; if ( ! ( c . skill === \"smithing\" && a === reviewed_C0 ) ) for ( const d of xo ) d . skill !== c . skill || d . group !== c . group || d . retired || d . levelReq > e || d . inputs . some ( i => i . itemId === a ) && ( ! n || d . levelReq < n . levelReq || d . levelReq === n . levelReq && d . id < n . id ) && ( n = d ) ; return reviewed_H$ . set ( t , n ) , n }\nfunction workExperience(c , o , e , a , t , s) { const n = Un ( o . windows , t ) ; return Math . round ( e . xp * ri [ a ] * pa ( n . xpMult , lG ( c , s , e . skill ) , FO ( t , e . skill , o . hypothetical ) , ga ( c . masteries , \"xp\" ) ) ) }\nfunction applyToolExperience(c , o) { for ( const e of o . took ?? [ ] ) c . bank [ e . itemId ] = Po ( c , e . itemId ) - e . qty , c . bank [ e . itemId ] <= 0 && delete c . bank [ e . itemId ] }\nfunction Jq(c) { const o = toolTierSources [ c ] ; if ( o !== void 0 ) return Jq ( o ) ; const e = xo . find ( a => a . output . itemId === c ) ; return e ? e . levelReq : Nd . find ( a => a . to . includes ( c ) ) ?. levelReq }\nfunction BS(c) { const o = rs ( c ) ; if ( ! o || o . slot === \"mount\" ) return null ; if ( toolTierSources [ go ( c ) ] !== void 0 ) return { skill : Wr [ o . slot ] , level : toolUpgradeLevelRequirement } ; const e = go ( c ) , a = xo . find ( t => t . output . itemId === e ) ; return { skill : Wr [ o . slot ] , level : a ?. levelReq ?? 1 } }\nfunction Um(c) { if ( ! zh ( c ) ) return 1 ; let o = 0 ; for ( const e of activeHouseRooms ) e . bonus . kind === \"rareChance\" && gt ( c , e . id ) && ( o += qn ( e , Qe ( c , e . id ) ) ) ; return 1 + o }\nfunction Zx(c , o) { if ( ! zh ( c ) ) return 1 ; let e = 0 ; for ( const a of activeHouseRooms ) gt ( c , a . id ) && ( a . bonus . kind === \"gatherSpeed\" || a . bonus . kind === \"craftSpeed\" ) && a . bonus . skill === o && ( e += qn ( a , Qe ( c , a . id ) ) ) ; return 1 + e }\nfunction forgeHouseBonus(c) { if ( ! zh ( c ) ) return 0 ; let o = 0 ; for ( const e of activeHouseRooms ) e . bonus . kind === \"enhanceChance\" && gt ( c , e . id ) && ( o += qn ( e , Qe ( c , e . id ) ) ) ; return o }\nfunction Ji(c , o , e) { if ( e !== void 0 && noScoreItemIds . has ( e ) ) return 0 ; if ( e !== void 0 && Da ( e ) ) return c === 0 ? uj * UH : 0 ; const a = rj [ c ] ; return a === void 0 ? 0 : a * hj [ o ] * UH }\nfunction excludedCollection(c) { return fireworkIds . has ( go ( c ) ) || go ( c ) === excludedPowder || isHomeEssence ( c ) || isAlchemyEssence ( go ( c ) ) }\nfunction isHomeEssence(c) { return go ( c ) === homeEssenceId }\nfunction isAlchemyEssence(c) { return c === homeAlchemyEssenceId || c === bossAlchemyEssenceId || c === enhanceAlchemyEssenceId }\nfunction aF(c , o) { const e = k9 ( c , o ) , a = 1 + .005 * c . perks . quick , t = Zx ( c , o ) , s = pf . includes ( o ) ? ga ( c . masteries , \"gather\" ) : ga ( c . masteries , \"craft\" ) , n = o === \"farming\" ? 1 : 1 + offhandWorkBonus ( c . equipment , o ) ; return { tool : e , quick : a , home : t , mastery : s , offhand : n , combined : e * pa ( a , t ) * s * n } }\nfunction offhandWorkBonus(c , o) { if ( c . shield === null ) return 0 ; const e = Vc ( c . shield ) ?. offhand ; return e !== void 0 && e . skill === o ? e . lift : 0 }\nfunction _D(c) { const o = tH . get ( c ) ; if ( o ) return o ; const e = JS . get ( Jc ( c ) ) ; if ( ! e ) return ; const a = 1 + gearEnhanceScale * Yo ( c ) , t = { ... e , itemId : c , accuracy : Math . round ( e . accuracy * a ) , strength : Math . round ( e . strength * a ) , defence : Math . round ( e . defence * a ) , ... e . luck !== void 0 ? { luck : e . luck * a } : { } , ... e . offhand !== void 0 ? { offhand : { skill : e . offhand . skill , lift : e . offhand . lift * a } } : { } } ; return tH . set ( c , t ) , t }\nfunction XD(c) { const o = [ ] ; for ( const e of [ 1 , 2 , 3 , 4 ] ) { const a = Xl [ e ] ; o . push ( { ... c , itemId : Pc ( c . itemId , e ) , accuracy : Math . round ( c . accuracy * a ) , strength : Math . round ( c . strength * a ) , defence : Math . round ( c . defence * a ) , ... c . luck !== void 0 ? { luck : c . luck * a } : { } , ... c . offhand !== void 0 ? { offhand : { skill : c . offhand . skill , lift : c . offhand . lift * a } } : { } } ) } return o }\nfunction forgeSuccess(c , o , e = ! 1) { return forgeSuccessFromBoost ( o , forgeCombinedMultiplier ( c ) , e ) }\nfunction forgeSuccessFromBoost(c , o , e = ! 1) { const a = forgeBaseChance ( c ) ; if ( ! enhanceRedesignEnabled ) return Math . min ( 1 , a * o ) ; const t = c < enhanceRedesignRules . ladderTop ? a * o ** enhanceRedesignRules . boostPowerLow : a * ( 1 + ( o - 1 ) * enhanceRedesignRules . boostShareHigh ) ; return Math . min ( 1 , Math . min ( 1 , t ) + ( e ? enhanceRedesignRules . coreLift : 0 ) ) }\nfunction forgeCombinedMultiplier(c) { return ( 1 + forgeHouseBonus ( c ) ) * forgeSkillMultiplier ( c ) * forgeMasteryMultiplier ( c ) }\nfunction forgeBaseChance(c) { return enhanceRedesignEnabled ? c < 0 ? 1 : c < enhanceRedesignRules . ladderTop ? enhanceRedesignRules . oddsLow [ c ] : enhanceRedesignRules . oddsHigh [ c - enhanceRedesignRules . ladderTop ] ?? 0 : Math . max ( kw , 1 - c * Sw ) }\nfunction Fh(c , o = ! 1) { const e = Yo ( c ) , a = bb [ P4 ( c ) - 1 ] * Wu [ jo ( c ) ] ; if ( ! enhanceRedesignEnabled ) { const i = o && e >= wf ? 1 : 0 ; return { gold : a * ( e + 1 ) , shards : i ? 0 : Hw * ( e + 1 ) , essence : 0 , core : i } } const t = e < enhanceRedesignRules . ladderTop , s = a * ( t ? enhanceRedesignRules . goldMultLow [ e ] : enhanceRedesignRules . goldMultHigh ) , n = s * ( t ? enhanceRedesignRules . essenceShareLow : enhanceRedesignRules . essenceShareHigh ) , d = Math . round ( n / reviewed_uc . enhanceGoldPerEssence ) ; return { gold : Math . max ( 0 , Math . round ( s - n ) ) , shards : t ? enhanceRedesignRules . shardsLow [ e ] : enhanceRedesignRules . shardsHigh , essence : d , core : o ? 1 : 0 } }\nfunction I1(c) { return Ju [ jo ( c ) ] + ( bossLuckToolIds . has ( go ( c ) ) ? bossToolLuck : 0 ) }\nfunction Bt(c) { const o = Jc ( c ) ; return nonEnhanceableIds . has ( o ) ? ! 1 : JS . has ( o ) || rs ( o ) !== void 0 }\nfunction upgradeTarget(c , o) { const e = c . from . indexOf ( go ( o ) ) ; if ( e < 0 ) return null ; const a = Pc ( c . to [ e ] , jo ( o ) ) , t = c . startsAtZero ? 0 : Yo ( o ) ; return t > 0 ? as ( a , t ) : a }\nfunction Qq(c , o , e , a) { const t = e . itemId , s = Yo ( t ) , n = Jc ( t ) , d = Fh ( t , e . useCore === ! 0 && forgeCanUseCore ( c , t ) ) ; if ( ! cG ( c , e ) || ! m2 ( c , e , d . gold ) || h2 ( c ) < d . shards || forgeEssenceCount ( c ) < d . essence ) return null ; const i = e . contract ? c . contract : null , l = e . order ? tG ( c ) : null , h = l ?. kind === \"enhance\" ? l : null ; let r = 0 ; if ( i ) i . escrow -= d . gold , i . spent += d . gold , sf ( c , \"enhance\" , d . gold ) ; else if ( h ) { const R = WW ( h . tipLeft , c . coins , d . gold ) ; r = R . tip , h . tipLeft -= R . tip , c . coins -= R . bank , sf ( c , \"enhance\" , d . gold ) } else $h ( c , d . gold , \"enhance\" ) ; d . core && zW ( c ) , xW ( c , d . shards ) , d . essence && u2 ( c , reviewed__i , d . essence ) , c . actionIndex ++ ; const u = Kh ( c , \"enhance\" ) , f = aa ( o . seed , o . secretAt , reviewed_Qwo , c . id , u , c . lastTick ) , g = f !== null && f < forgeSuccess ( c , s , d . core > 0 ) , w = ! g && e . protectFrom !== void 0 && s >= Math . max ( Yt , e . protectFrom ) && Ad ( c ) > 0 ; w && u2 ( c , bi , 1 ) ; const p = w && i ? TI ( c , i ) : 0 , b = g ? s + 1 : forgeFailurePlus ( s , w ) , v = b > 0 ? as ( n , b ) : n ; e . itemId = v ; const O = g ? reviewed_KV ( c , t , s + 1 ) : 0 ; i ? ( i . itemId = v , Yo ( v ) >= i . goal && ( i . ended = \"goal\" ) ) : h ? ( h . itemId = v , Yo ( v ) >= h . goal && ( h . ended = \"done\" ) ) : e . worn ? c . equipment [ e . worn ] = v : ( c . bank [ t ] = Po ( c , t ) - 1 , c . bank [ t ] === 0 && delete c . bank [ t ] , c . bank [ v ] = Po ( c , v ) + 1 , c . bankOrder = YW ( c . bankOrder , t , v , Po ( c , t ) >= 1 ) ) ; const S = CI ( c , o , c . lastTick , n , s ) , k = vt ( c , \"enhancing\" , S ) , Y = { worn : e . worn ?? null , from : t , gold : d . gold , shards : d . shards , core : d . core , ... d . essence ? { essence : d . essence } : { } , ... i ? { contract : ! 0 } : { } , ... p ? { refund : p } : { } , ... h ? { order : ! 0 , tip : r } : { } } ; return a . push ( g ? { kind : \"enhanced\" , itemId : v , plus : s + 1 , xp : S , ... Y , ... O ? { forge : O } : { } } : { kind : \"enhanceFailed\" , itemId : v , xp : S , ... Y , ... w ? { protect : ! 0 } : { } } ) , k . after > k . before && a . push ( { kind : \"levelUp\" , skill : \"enhancing\" , level : k . after } ) , reviewed_az ( c , o , \"enhancing\" , u , c . lastTick , a ) , g }\nfunction forgeFailurePlus(c , o) { return o ? enhanceRedesignEnabled && c <= forgeProtectionKeepLevel ? c : c - 1 : 0 }\nfunction forgeCanUseCore(c , o) { const e = Yo ( o ) ; return enhanceRedesignEnabled ? e < mO && Ov ( c ) > 0 && forgeSuccess ( c , e ) < 1 : e >= wf && Ov ( c ) > 0 }\nfunction Ov(c) { return Po ( c , ql ) + c . pack . filter ( o => o . itemId === ql ) . reduce ( ( o , e ) => o + e . qty , 0 ) }\nfunction forgeEssenceCount(c) { return FW ( c , reviewed__i ) }\nfunction CI(c , o , e , a , t) { const s = $I * ( ( enhanceRedesignEnabled ? enhanceRedesignRules . xpHeight : 1 ) * t + 1 ) * ri [ jo ( a ) ] ; return Math . round ( s * pa ( Un ( o . windows , e ) . xpMult , lG ( c , ! 1 ) , FO ( e , \"enhancing\" , o . hypothetical ) , ga ( c . masteries , \"xp\" ) ) ) }\nfunction UD(c) { const o = $H . get ( c ) ; if ( o ) return o ; const e = vz . get ( Jc ( c ) ) ; if ( ! e ) return ; const a = { itemId : c , slot : e . slot , bonus : e . slot === \"mount\" ? e . bonus * ( 1 + Xm * mountPlusFactor ( Yo ( c ) ) ) : e . bonus * ( 1 + gearEnhanceScale * Yo ( c ) ) } ; return $H . set ( c , a ) , a }\nfunction mountPlusFactor(c) { return Math . min ( c , mountSoftCap ) + Math . max ( 0 , c - mountSoftCap ) * mountAfterCapFactor }\nfunction farmPlantAction(c , o , e , a , t) { return e === null || ! reviewed_hyo ( c , e ) ? ! 1 : ( c . plots [ o ] = { seedItemId : e , plantedAt : a , sowSpeed : Zx ( c , \"farming\" ) * ( 1 + offhandWorkBonus ( c . equipment , \"farming\" ) ) } , t . push ( { kind : \"planted\" , itemId : e } ) , ! 0 ) }\nfunction b0(c , o) { const e = iP [ o ] ; return e ? c . equipment [ e ] : null }\nfunction k9(c , o) { const e = iP [ o ] ; if ( ! e || e === \"flask\" ) return 1 ; const a = c . equipment [ e ] ; return a === null || rs ( a ) ?. slot !== e ? 1 : 1 + Zl ( a ) }\nfunction Zl(c) { return c === null ? 0 : rs ( c ) ?. bonus ?? 0 }\nconst activeHouseRooms=je . filter ( c => c . bonus . kind !== \"alchemyYield\" || jobFeatureFlags . alchemy );\nconst toolTierSources=Object . fromEntries ( toolUpgradeDefinitions . map ( c => [ c . id , c . from ] ) );\nconst Nd=[ ... upgradeGear , ... upgradeOther , ... upgradeTools ];\nconst noScoreItemIds=new Set ( collectionCurrencySources . map ( c => c . currency ) );\nconst enhanceRedesignEnabled=jobFeatureFlags . enhanceRedesign;\nconst bossLuckToolIds=new Set ( [ reviewed_BA , reviewed_Zq , reviewed_oK , reviewed_cK , reviewed_eK ] );\nconst aH=[ ... yz , ... upgradeGearEquipment , ... workOffhandEquipment , ... cosmeticGearEquipment ];\nconst upgradeGearEquipment=gO . map ( c => ( { ... yz . find ( e => e . itemId === c . from ) , itemId : c . id , accuracy : c . accuracy , strength : c . strength , defence : c . defence , levelReq : c . wear } ) );\nconst workOffhandEquipment=workOffhandDefinitions . map ( c => ( { itemId : c . id , slot : \"shield\" , accuracy : 0 , strength : 0 , defence : 0 , levelReq : workOffhandLevelRequirement , needs : c . skill , offhand : { skill : c . skill , lift : workOffhandLift } } ) );\nconst cosmeticGearEquipment=cosmeticGearDefinitions . map ( c => ( { itemId : c . id , slot : c . slot , accuracy : 0 , strength : 0 , defence : 0 , levelReq : 1 , needs : \"none\" } ) );\nconst ED=new Set ( [ ... xo . map ( c => c . output . itemId ) , ... wz , ... workOffhandDefinitions . map ( c => c . id ) ] );\nconst iP=Object . fromEntries ( Object . entries ( Wr ) . map ( ( [ c , o ] ) => [ o , c ] ) );");
    for(const role of ["reviewed_az","reviewed_J7","freeInputSeed","freeInputChance","freeInputSkills","toolExperienceSeed","toolExperienceChance","toolExperienceDefinitions","reviewed_H$","reviewed_C0","toolUpgradeLevelRequirement","excludedPowder","homeEssenceId","homeAlchemyEssenceId","bossAlchemyEssenceId","enhanceAlchemyEssenceId","gearEnhanceScale","enhanceRedesignRules","reviewed_uc","bossToolLuck","nonEnhanceableIds","reviewed__i","reviewed_Qwo","reviewed_KV","forgeProtectionKeepLevel","$I","mountSoftCap","mountAfterCapFactor","reviewed_hyo","toolUpgradeDefinitions","upgradeTools","collectionCurrencySources","reviewed_BA","reviewed_Zq","reviewed_oK","reviewed_cK","reviewed_eK","workOffhandDefinitions","workOffhandLevelRequirement","workOffhandLift","cosmeticGearDefinitions"])schema[role]={kind:"value",shape:"",refs:[],links:[],locals:[]};
    const currentDefinitions=new Map([...Object.keys(schema).map(name=>[name,null]),...currentTemplates]);
    for(const [name,row]of currentTemplates){
        const description=adaptiveDescription(projectGearMapping(row),currentDefinitions),rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true,numbers:description.tokens.filter(token=>token.type==="num").map(token=>Number(token.value))};
        if(name==="fF")rule.requires=["farmPlantAction"];
        if(schema[name])(schema[name].variants??=[]).push(rule);else schema[name]=rule;
    }
    schema.toolUpgradeDefinitions={kind:"value",shape:"",refs:[],links:[],locals:[],table:["id","name","from","slot","recipe","skill","core"],fields:["id","name","from","slot","recipe","skill","core"],minRows:1,optional:true};
    schema.collectionCurrencySources={kind:"value",shape:"",refs:[],links:[],locals:[],table:["id","currency","classes","skills","phases"],fields:["id","currency"],minRows:1,optional:true};
    // END REVIEWED 1.0.1212 RULES
    const inventoryTemplates=indexTopLevel(`
function lockedWorkInput(c,o,e){if(o.grow!==void 0||c.bankLocked.length===0)return!1;const a=c.order;return a?.kind==="craft"&&a.inBag===!0&&a.jobId===o.id?!1:c.bankLocked.includes(e)}
function recordUpgrade(c,o,e){if(recordDiscovery(c,e),JD.some(t=>t.recipe===o.id))return;const a=Jc(e);c.collections[a]=(c.collections[a]??0)+1}
function recordDiscovery(c,o){c.collection[o]===void 0&&collectionDirty.add(c),c.collection[o]=1}
const collectionDirty=new WeakSet;
`);
    const inventoryDefinitions=new Map([...Object.keys(schema).map(name=>[name,null]),...inventoryTemplates]);
    for(const [name,row]of inventoryTemplates){
        const description=adaptiveDescription(row,inventoryDefinitions),rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true,numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))};
        if(schema[name])(schema[name].variants??=[]).push(rule);else schema[name]=rule;
    }
    for(const role of ['upgradePerform','upgradeRemaining','upgradeGrantXp'])schema[role]={kind:'value',shape:'',refs:[],links:[],locals:[]};
    const upgradeTimingTemplates=indexTopLevel(`
function upgradeTick(c,o,e){const a=c.route?.upgrade,t=a?upgradeRecipe(a.recipe):void 0;if(!a||!t){c.activity="idle";return}if(c.attemptTicks++,c.attemptTicks<upgradeDuration(c,t))return;c.attemptTicks=0;const s=upgradePerform(c,t,a.itemId);if(typeof s=="string"){c.activity="idle";return}const n=upgradeGrantXp(c,t.skill,t.xp),d=JD.find(l=>l.recipe===t.id);e.push({kind:"produced",jobId:d?.job??0,itemId:s,xp:t.xp,upgrade:t.id}),n.after>n.before&&e.push({kind:"levelUp",skill:t.skill,level:n.after});const i=c.route;if(i.limit!=null&&(i.limit--,i.limit<=0)){c.activity="idle";return}upgradeRemaining(c,t,a.itemId)!==null&&(c.activity="idle")}
function upgradeRecipe(c){return upgradeRecipeMap.get(c)}
const upgradeRecipeMap=new Map(Nd.map(c=>[c.id,c]));
function upgradeDuration(c,o){const e=aF(c,o.skill),a=upgradeLevelSpeed(c.skills[o.skill],o.levelReq)*e.tool*pa(e.quick,e.home)*e.mastery;return Math.max(1,Math.round(upgradeBaseTicks(o)/a))}
function upgradeBaseTicks(c){return Math.round(upgradeTimingJob(c).baseTicks*upgradeDurationFactor)}
function upgradeTimingJob(c){const o=a=>a.skill===c.skill&&a.inputs.length>0&&!upgradeIsFarm(a),e=a=>xo.find(t=>o(t)&&a.includes(go(t.output.itemId)));return e(c.to)??e(c.from)??upgradeSlowestJob(xo.filter(a=>o(a)&&!a.retired&&a.levelReq<=c.levelReq))}
function upgradeSlowestJob(c){let o=c[0];for(const e of c)(e.baseTicks>o.baseTicks||e.baseTicks===o.baseTicks&&e.levelReq>o.levelReq)&&(o=e);return o}
function upgradeIsFarm(c){return c.grow!==void 0}
function upgradeLevelSpeed(c,o){return 1+Math.max(0,$o(c)-o)*upgradeLevelSpeedRate}
const {speedPerLevelAboveRequirement:upgradeLevelSpeedRate}=GD;
const upgradeDurationFactor=1.5;
`);
    const upgradeTimingDefinitions=new Map([...Object.keys(schema).map(name=>[name,null]),...upgradeTimingTemplates]);
    for(const [name,row]of upgradeTimingTemplates){
        const description=adaptiveDescription(row,upgradeTimingDefinitions),rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:name!=='upgradeDurationFactor',numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))};
        if(schema[name])(schema[name].variants??=[]).push(rule);else schema[name]=rule;
    }
    // Reviewed work output after the tool transmutation effect was removed.
    const updatedWorkTemplates=indexTopLevel(`function R9(o , e , t , a , s){ const n = jobInputs ( t , o . workRarity ) ; for ( const m of n ) if ( availableWorkInput ( o , t , m . itemId ) < m . qty ) return ; const i = freeWorkInputs ( o , e , t , b0 ( o , t . skill ) , o . actionIndex + 1 ) ; if ( ! i ) for ( const m of n ) { let b = m . qty ; for ( let w = o . pack . length - 1 ; w >= 0 && b > 0 ; w -- ) { const g = o . pack [ w ] ; if ( g . itemId !== m . itemId ) continue ; const k = Math . min ( b , g . qty ) ; g . qty -= k , b -= k , g . qty === 0 && o . pack . splice ( w , 1 ) } } o . actionIndex ++ ; const r = t . burn ; if ( r && Om ( e . seed ^ v9 , o . id , o . actionIndex , H9 ( t , o ) ) ) { $a ( o , r . itemId , 1 ) , s . push ( { kind : "burnt" , itemId : r . itemId } ) ; return } const h = t . caught ; if ( h && Om ( e . seed ^ y9 , o . id , o . actionIndex , eF ( t , o ) ) ) { o . stunUntil = a + h . stunTicks , s . push ( { kind : "caught" , ticks : h . stunTicks } ) ; return } const l = Kh ( o , "craft" ) , d = t . output . itemId === Aa , c = t . inputs . length === 0 && ! d , u = c ? aa ( e . seed , e . secretAt , rB , o . id , l , a ) : null ; if ( ! c || u !== null ) { let m = 0 ; c ? m = t . plain ? 0 : workQuality ( o , e , a , t . skill , u ) : d || ( m = jobQuality ( t , o . workRarity ) ) ; const b = d ? Aa : jobOutput ( t , m ) , w = t . output . qty ; b0 ( o , t . skill ) ; const g = workExperience ( o , e , t , m , a , t . inputs . length === 0 ) ; d ? Ph ( o , t . output . qty , "stall" ) : vB ( o , t , t . output . qty ) || Sd ( o , b , w ) ; const k = vt ( o , t . skill , g ) ; s . push ( { kind : "produced" , jobId : t . id , itemId : b , xp : g , tier : m , ... w !== 1 ? { qty : w } : { } , ... c ? { wire : ! 0 , xpBonus : g } : { } , ... o . route ?. order ? { order : ! 0 } : { } , ... i ? { free : ! 0 } : { } } ) , k . after > k . before && s . push ( { kind : "levelUp" , skill : t . skill , level : k . after } ) } Hv ( o , e , 1 / uS ( t , o ) , s ) , bv ( o , e , 1 / uS ( t , o ) , s ) ; const f = t . bonus ? aa ( e . seed , e . secretAt , G9 , o . id , l , a ) : null ; if ( t . bonus && f !== null && f < t . bonus . chance ) { let m = t . bonus . itemId ; if ( bf ( m ) ) { const b = aa ( e . seed , e . secretAt , S9 , o . id , l , a ) , w = b === null ? 0 : workQuality ( o , e , a , t . skill , b ) , g = Nm ( m ) ? Math . max ( 1 , w ) : w ; m = Pc ( m , g ) } $a ( o , m , 1 ) && s . push ( { kind : "bonus" , itemId : m } ) } reviewed_az ( o , e , t . skill , l , a , s ) }
function Mq(o , e , t , a , s){ o . actionIndex ++ ; const n = Kh ( o , "kill" ) , i = t . gold [ 1 ] - t . gold [ 0 ] + 1 , r = VU ( e . seed , e . secretAt , E9 , o . id , n , a ) , h = r === null ? 0 : Math . floor ( ( t . gold [ 0 ] + r % i ) * ( 1 + Lk * ze ( o , "abyssal" ) ) ) ; Ph ( o , h , "kill" ) , s . push ( { kind : "killed" , monsterId : t . id , coins : h } ) , h > 0 && s . push ( { kind : "produced" , jobId : 0 , itemId : Aa , xp : 0 } ) ; const l = pa ( Rq ( o , e , a ) , Um ( o ) ) , d = aa ( e . seed , e . secretAt , lq , o . id , n , a ) , c = t . dropChance === void 0 ? 0 : aa ( e . seed , e . secretAt , iq , o . id , n , a ) ; if ( d !== null && c !== null && c < ( t . dropChance ?? 1 ) ) { const w = vm ( d , _l ( o . equipment ) , l ) , g = Pc ( t . drop , w ) ; Sd ( o , g , 1 ) , s . push ( { kind : "produced" , jobId : 0 , itemId : g , xp : 0 , tier : w , wire : ! 0 } ) } const f = ( 1 + _l ( o . equipment ) ) * l , m = aa ( e . seed , e . secretAt , rq , o . id , n , a ) ; m !== null && m < Math . min ( 1 , t . bonus . chance * f ) && ( Sd ( o , t . bonus . itemId , 1 ) , s . push ( { kind : "bonus" , itemId : t . bonus . itemId } ) ) ; const b = aa ( e . seed , e . secretAt , Z9 , o . id , n , a ) ; if ( b !== null && b < fI ( t . level ) ) { const w = bI ( t . level ) ; Sd ( o , Ud , w ) , s . push ( { kind : "voidshard" , itemId : Ud , qty : w } ) } o . foeIndex !== null && ( o . lastFoe = o . foeIndex ) , o . foeIndex = null , o . foeHp = 0 }`);
    const updatedWorkDefinitions=new Map([...Object.keys(schema).map(name=>[name,null]),...updatedWorkTemplates]);
    for(const [name,row]of updatedWorkTemplates){
        const description=adaptiveDescription(row,updatedWorkDefinitions),rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true,numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))};
        (schema[name].variants??=[]).push(rule);
    }
    // First collection rewards and shard rarity floors are read from verified game rules.
    for(const role of ['collectionOutfitPoints','collectionCorePoints','collectionOffhandPoints'])schema[role]={kind:'value',shape:'',refs:[],links:[],locals:[]};
    const collectionRewardTemplates=indexTopLevel(`
function Ji(c,o,e){if(e!==void 0&&noScoreItemIds.has(e))return 0;if(e!==void 0&&(o=Math.max(o,collectionRarityFloors.get(e)??0)),e!==void 0&&Da(e))return c===0?uj*UH:0;const a=e!==void 0?firstCollectionPoints(e):null;if(a!==null)return c===0?a*(collectionOffhand(e)?hj[o]:1)*UH:0;const t=rj[c];return t===void 0?0:t*hj[o]*UH}
function dr(c){return c!==void 0&&(Da(c)||firstCollectionPoints(c)!==null)?mj:ij}
function firstCollectionPoints(c){return collectionOutfitIds.has(c)?collectionOutfitPoints:collectionCoreIds.has(c)?collectionCorePoints:collectionOffhand(c)!==void 0?collectionOffhandPoints:null}
function collectionOffhand(c){return collectionOffhandMap.get(c)}
const collectionOffhandMap=new Map(workOffhandDefinitions.map(c=>[c.id,c]));
const collectionOutfitIds=new Set(cosmeticGearDefinitions.map(c=>c.id));
const collectionCoreIds=new Set(collectionCurrencySources.map(c=>c.core));
const collectionRarityFloors=new Map(collectionCurrencySources.map(c=>[c.shard,2]));
`);
    const collectionRewardDefinitions=new Map([...Object.keys(schema).map(name=>[name,null]),...collectionRewardTemplates]);
    for(const [name,row]of collectionRewardTemplates){
        const description=adaptiveDescription(row,collectionRewardDefinitions),rule={kind:description.kind,shape:description.shape,refs:description.refs,locals:[...description.locals.values()].map(local=>local.name),strict:true,numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))};
        if(schema[name])(schema[name].variants??=[]).push(rule);else schema[name]=rule;
    }
    schema.collectionCurrencySources.fields=['id','currency','core','shard'];
    for(const [role,table,fields,minRows,extensions]of [
        ['Az',['id','name','stackable','value'],['id','name','stackable','value'],1,true],
        ['Cd',['id','name','skill','group','levelReq','baseTicks','xp','inputs','output'],['id','name','skill','group','levelReq','baseTicks','xp','inputs','output','grow','bonus','burn','caught','plain','retired'],1,true],
        ['fireworks',null,['itemId'],1,false],
        ['je',['id','bonus'],['id','bonus','rate','retired'],1,false],
        ['wt',['id','name','drop','bonus'],['id','name','drop','bonus','dropChance'],1,false],
        ['T6',['id','name','monsterId'],['id','name','monsterId'],1,false],
        ['oH',['itemId','slot','bonus'],['itemId','slot','bonus'],1,false],
        ['yz',['itemId','slot'],['itemId','slot','speed','luck'],1,false],
        ['On',['id','perRank'],['id','name','perRank'],1,false],
        ['rp',['id','ranks'],['id','ranks'],1,false],
        ['gO',['id','name','from','recipe','skill','make','xp','extra'],['id','name','from','recipe','skill','make','xp','extra','job'],1,false],
        ['JD',['id','name','from','job','recipe','skill','make','xp','extra'],['id','name','from','job','recipe','skill','make','xp','extra'],1,false]
    ])Object.assign(schema[role],{table,fields,minRows,extensions,refs:[],links:[]});
    schema.je.idType='string';
    schema.On.idType='string';
    schema.rp.idType='string';
    schema.rp.rowId='hands';
    schema.gO.tableAbsent=['job'];
    schema.oH.staticMaps=true;
    schema.Az.staticMaps=true;
    schema.yz.fields=['itemId','slot','luck','offhand'];
    delete schema.yz.tableRefs;
    schema.fireworks.shape='';
    for(const role of ['R9','fF','Mq','II','_D','XD']){
        const rules=[schema[role],...(schema[role].variants||[])].map(rule=>projectRuntimeRule(rule,role));
        schema[role]={...rules[0],...rules.length>1?{variants:rules.slice(1)}:{}};
    }
    const roots='xo dH c6 Rz $D Cd HD gO JD Az wt Aa QD yd oH yz LS JS I1 _l Vc XD _D VC $d TS ff PD Da dx Qb E6 Am X6 Ce Hj fireworkIds Bt rs BS P4 Jq Yw Lq YD ZD Wr GD qS aF farmBaseYield farmToolYield farmPetChance Zl farmYieldBase farmYieldThresholds farmToolYieldRate farmPetTicks On pd Qq vj II mO Ns pj gj bj Oj Gj Sw kw Hw Ud Ls bb Wu ir yK forgeBaseChance forgeSuccess forgeSkillMultiplier forgeMasteryMultiplier forgeHouseBonus gt zh je Sr Bc xz Se H9 eF rp LC pf _S QS md sx ew ow forgePetMultiplier bf Nm yt nx vm R9 E4 fF Mq Jc Pc as Yo go jo Nd recordUpgrade upgradeTarget upgradeExtra upgradeInputs qualityInput jobQuality jobOutput jobInputs mj dr Ji fj excludedCollection Hn T6 fireworks h4 Zb Ym cb Vx Kn av Sy CO lf ro zk oT Bx qualityEventMult eT WD ij rj UH hj uj Xl Ju ar Nx cn Hi ag Jw Bb Zf cT fy ic ze UT Jn Um Un ga Kl pa Lx qn Qe qualityHouseCurve'.split(' ');
    const dropOnlyRules=new Set('E4 nx h4 ew ow forgePetMultiplier farmPetChance farmPetTicks sx Ym _6'.split(' '));
    const required=new Set(),visit=role=>{
        if(required.has(role)||!schema[role]||dropOnlyRules.has(role))return;
        required.add(role);
        for(const rule of [schema[role],...(schema[role].variants||[])]){
            for(const [,dependency]of rule.refs||[])visit(dependency);
            for(const [dependency]of rule.links||[])visit(dependency);
            for(const [,,dependency]of rule.tableRefs||[])visit(dependency);
            for(const dependency of rule.requires||[])visit(dependency);
        }
    };
    roots.push('upgradeTick','upgradeDuration','upgradeLevelSpeedRate');
    roots.forEach(visit);
    schema.farmYieldThresholds.strict=false;
    schema.II.strict=true;
    for(const [role,expected]of Object.entries(schema))if(expected.kind==='function'){
        const rules=[expected,...(expected.variants||[])].map(rule=>projectRuntimeRule(rule,role));
        schema[role]={...rules[0],...rules.length>1?{variants:rules.slice(1)}:{}};
    }
    return Object.fromEntries(Object.entries(schema).filter(([role])=>required.has(role)));
}
const adaptiveKeywords = new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined'.split(' '));
const adaptiveBuiltins = new Set('Math Number Object Array String Boolean Map Set Date JSON Infinity NaN Promise Error RegExp Uint8Array BigInt'.split(' '));
const adaptiveObjectContext=(tokens,index)=>{let depth=0;for(let at=index-1;at>=0;at--){const value=tokens[at].value;if([')',']','}'].includes(value))depth++;else if(['(','[','{'].includes(value)){if(depth){depth--;continue;}return value==='{'&&['=','(','[',',',':','return'].includes(tokens[at-1]?.value);}}return false;};
const adaptiveProperty = (tokens,i) => ['.','?.'].includes(tokens[i-1]?.value) || tokens[i+1]?.value===':' && ['{',','].includes(tokens[i-1]?.value) || (tokens[i+1]?.value==='('&&(['{',',','get','set','async'].includes(tokens[i-1]?.value)||tokens[i-1]?.value==='*'&&['{',',','async'].includes(tokens[i-2]?.value))||['get','set','async'].includes(tokens[i].value)&&tokens[i+1]?.type==='name'&&tokens[i+2]?.value==='(')&&adaptiveObjectContext(tokens,i);
function adaptiveBindings(tokens,paramCount=0) {
    const pairs=new Map(),stack=[],scopes=[{from:0,to:tokens.length,kind:'function',names:new Map()}],keywords=new Set();
    for(let i=0;i<tokens.length;i++) {
        const value=tokens[i].value;
        if(['(','[','{'].includes(value))stack.push(i);
        else if([')',']','}'].includes(value)) {const open=stack.pop();if(open!==undefined){pairs.set(open,i);pairs.set(i,open);}}
    }
    const scope=(from,to,kind)=>{const row={from,to,kind,names:new Map()};scopes.push(row);return row;};
    const endStatement=from=>{if(tokens[from]?.value==='{')return (pairs.get(from)??tokens.length)+1;for(let at=from;at<tokens.length;at++){const value=tokens[at].value;if(['(','[','{'].includes(value)&&pairs.has(at))at=pairs.get(at);else if(value===';'||value==='}')return at+1;}return tokens.length;};
    const endExpression=from=>{for(let at=from;at<tokens.length;at++){const value=tokens[at].value;if(['(','[','{'].includes(value)&&pairs.has(at))at=pairs.get(at);else if([',',';',')',']','}'].includes(value))return at;}return tokens.length;};
    for(let i=0;i<tokens.length;i++) {
        if(tokens[i].value==='{')scope(i,pairs.get(i)??tokens.length,'block');
        if(tokens[i].value==='for'&&tokens[i+1]?.value==='(') {
            const close=pairs.get(i+1),body=close+1,to=endStatement(body);
            if(close) {
                scope(i+1,to,'block');
                let start=i+2;if(['const','let','var'].includes(tokens[start]?.value))start++;
                let bindingEnd=start;
                if(['[','{'].includes(tokens[start]?.value))bindingEnd=(pairs.get(start)??start)+1;
                else if(tokens[start]?.type==='name')bindingEnd++;
                if(tokens[bindingEnd]?.value==='of')keywords.add(bindingEnd);
            }
        }
    }
    const bindings=[];
    const declare=(at,owner)=>{const name=tokens[at]?.value;if(tokens[at]?.type!=='name'||adaptiveKeywords.has(name)&&!['of','as','get','set','async'].includes(name))return;if(!owner.names.has(name)){const row={id:bindings.length,name,owner};bindings.push(row);owner.names.set(name,row);}};
    const pattern=(from,to,owner)=>{
        for(let at=from;at<to;at++) {
            const token=tokens[at];
            if(token.value==='='){at=endExpression(at+1)-1;continue;}
            if(token.type==='name'&&!adaptiveProperty(tokens,at))declare(at,owner);
        }
    };
    if(paramCount)pattern(0,paramCount,scopes[0]);
    for(let i=0;i<tokens.length;i++)if(tokens[i].value==='=>') {
        const before=i-1,from=tokens[before]?.value===')'?pairs.get(before):before,start=from+(tokens[from]?.value==='('?1:0),end=tokens[i+1]?.value==='{'?(pairs.get(i+1)??tokens.length)+1:endExpression(i+1),owner=scope(from,end,'function');
        pattern(start,tokens[before]?.value===')'?before:i,owner);
    }
    for(let i=0;i<tokens.length;i++)if(tokens[i].value==='function') {
        let open=i+1;if(tokens[open]?.value==='*')open++;if(tokens[open]?.type==='name')open++;
        if(tokens[open]?.value==='('){const close=pairs.get(open),body=close+1;if(tokens[body]?.value==='{'){const owner=scope(open,(pairs.get(body)??tokens.length)+1,'function');pattern(open+1,close,owner);}}
    }
    const narrower=(row,prior)=>!prior || row.to-row.from<prior.to-prior.from || row.to-row.from===prior.to-prior.from&&row.from>prior.from;
    const ownerAt=(at,onlyFunction=false)=>{
        let owner;
        for(const row of scopes)if(row.from<=at&&at<row.to&&(!onlyFunction||row.kind==='function')&&narrower(row,owner))owner=row;
        return owner??scopes[0];
    };
    for(let i=0;i<tokens.length;i++)if(['const','let','var'].includes(tokens[i].value)) {
        const owner=ownerAt(i,tokens[i].value==='var');let at=i+1;
        while(at<tokens.length) {
            const from=at;
            if(['{','['].includes(tokens[at]?.value))at=(pairs.get(at)??at)+1;else at++;
            pattern(from,at,owner);
            if(tokens[at]?.value==='=')at=endExpression(at+1);
            if(tokens[at]?.value!==',')break;at++;
        }
    }
    const locals=new Map(),scopesByName=new Map();
    for(const row of scopes)for(const name of row.names.keys()){
        if(!scopesByName.has(name))scopesByName.set(name,[]);
        scopesByName.get(name).push(row);
    }
    for(let i=0;i<tokens.length;i++)if(tokens[i].type==='name'&&!adaptiveProperty(tokens,i)&&!keywords.has(i)) {
        let owner;
        for(const row of scopesByName.get(tokens[i].value)??[])if(row.from<=i&&i<row.to&&narrower(row,owner))owner=row;
        if(owner)locals.set(i,owner.names.get(tokens[i].value));
    }
    return {locals,keywords};
}
const adaptiveKeyword = (tokens,i,scope) => scope?.keywords.has(i) || adaptiveKeywords.has(tokens[i].value) && !['as','of','get','set','async'].includes(tokens[i].value);
function stableShape(shape) {
    const refs=new Map(),tokens=tokenize(shape,0,shape.length,true);let text='',from=0;
    for(let at=0;at<tokens.length-1;at++){
        const token=tokens[at],number=tokens[at+1];
        if(token.value!=='@'||number.type!=='num'||token.end!==number.start)continue;
        const key=token.value+number.value;
        if(!refs.has(key))refs.set(key,'@'+refs.size);
        text+=shape.slice(from,token.start)+refs.get(key);from=number.end;at++;
    }
    return text+shape.slice(from);
}
function dataRecords(tokens,allowSpreads=false,extensions=[],rowId=null) {
    const split=(from,to)=>{
        const rows=[];let start=from,depth=0;
        for(let at=from;at<to;at++){
            const value=tokens[at].value;
            if(['(','[','{'].includes(value))depth++;
            else if([')',']','}'].includes(value))depth--;
            if(value===','&&!depth){if(at>start)rows.push(tokens.slice(start,at));start=at+1;}
        }
        if(start<to)rows.push(tokens.slice(start,to));return rows;
    };
    if(tokens[0]?.value!=='['||tokens.at(-1)?.value!==']')return [];
    return split(1,tokens.length-1).filter(row=>{
        if(allowSpreads&&row[0]?.value==='...'){extensions.push(row);return false;}
        if(rowId!==null){
            let depth=0;
            for(let at=0;at<row.length;at++){
                const token=row[at];
                if(depth===1&&['{',','].includes(row[at-1]?.value)&&['id','"id"'].includes(token.value)&&row[at+1]?.value===':'&&row[at+2]?.type==='string'){
                    try{if(JSON.parse(row[at+2].value)===rowId)return true;}catch{}
                }
                if(['(','[','{'].includes(token.value))depth++;else if([')',']','}'].includes(token.value))depth--;
            }
            return false;
        }
        return true;
    }).map(row=>{
        if(row[0]?.value!=='{'||row.at(-1)?.value!=='}')throw Error('数据表条目结构变化');
        const fields=new Map();let start=1,depth=0;
        for(let at=1;at<row.length;at++){
            const value=row[at].value;
            if(value===','&&!depth||at===row.length-1){
                if(at>start){const key=row[start],name=key.type==='string'?JSON.parse(key.value):key.value;
                    if(!['name','string'].includes(key.type)||row[start+1]?.value!==':'||fields.has(name))throw Error('数据表字段结构变化');
                    fields.set(name,row.slice(start+2,at));}
                start=at+1;
            }
            if(['(','[','{'].includes(value))depth++;else if([')',']','}'].includes(value))depth--;
        }
        return fields;
    });
}
function projectRuntime(row,role='') {
    if(row.kind!=='function'||!role&&!/\bburn\b|\bseedItemId\b|\bfoeHp\b|\btoPlus\b|\bluck\b/.test(row.body))return row;
    const tokens=tokenize(row.body),params=tokenize(row.params).filter(token=>token.type==='name').map(token=>token.value);
    let body=tokens.map(token=>token.value).join(' '),changed=false;
    const id='[A-Za-z_$][\\w$]*',escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const [actor,world,job,time,events]=params.map(escape);
    const replace=(pattern,replacement)=>{const next=body.replace(pattern,replacement);changed||=next!==body;body=next;};
    if(role==='R9'||/\. burn\b/.test(body)&&/\. caught\b/.test(body)&&body.includes('"produced"')){
        replace(new RegExp('(?:; )?'+id+' \\( '+actor+' , '+world+' , '+job+' \\. skill , '+id+' , '+time+' , '+events+'((?: , [\\s\\S]+)?) \\)$'),(match,extra)=>{
            try{if(extra)parseExpression('['+extra.slice(3)+']',name=>{throw Error('宠物参数不是静态值 '+name);});return '';}
            catch{return match;}
        });
        replace(new RegExp(', \\.\\.\\. '+actor+' \\. route \\?\\. order \\? \\{ order : ! \\d+ \\} : \\{ \\}'),'');
        replace(new RegExp('Math \\. (?:round|floor|ceil) \\( '+job+' \\. xp','g'),'Math . round ( '+params[2]+' . xp');
    }
    if(role==='fF'||/\. seedItemId\b/.test(body)&&/\. plantedAt\b/.test(body)&&body.includes('"produced"')){
        const [character,context,,plot,tick,output]=params.map(escape);
        replace(new RegExp(', '+id+' \\( '+character+' , '+context+' , "farming" , '+id+' , '+tick+' , '+output+' , '+id+' \\( '+id+' \\. grow \\?\\? \\d+ , '+tick+' - '+plot+' \\. plantedAt \\) \\)$'),'');
    }
    if(role==='Mq'||body.includes('"kill"')&&body.includes('. foeHp')&&body.includes('"bonus"')){
        const pet=new RegExp('const ('+id+') = '+id+' \\( '+world+' \\. seed , '+world+' \\. secretAt , '+id+' , '+actor+' \\. id , '+id+' , '+time+' \\) ; if \\( \\1 !== null && \\1 < '+id+' \\) \\{ const ('+id+') = '+id+' \\( '+job+' \\. id \\) ; '+id+' \\( '+actor+' , \\2 , \\d+ \\) , '+events+' \\. push \\( \\{ kind : "pet" , itemId : \\2 \\} \\) \\} ');
        replace(pet,'');
        replace(new RegExp(' , '+id+' \\( '+actor+' \\)$'),'');
    }
    if(role==='II'||body.includes('. enhance')&&body.includes('. toPlus')&&body.includes('. ticks')){
        const state=new RegExp('^const ('+id+') = '+actor+' \\. enhance ;').exec(body);
        if(state){
            const local=escape(state[1]);
            replace(new RegExp(local+' \\. ticks = (\\d+) \\+ \\( '+local+' \\. ticks \\?\\? (\\d+) \\)'),state[1]+' . ticks = ( '+state[1]+' . ticks ?? $2 ) + $1');
        }
    }
    if(role==='_D'||role==='XD'||/\. luck\b/.test(body)&&(/\. set\b/.test(body)||/\. push\b/.test(body))){
        const values=tokenize(body),remove=[];
        for(let at=1;at<values.length-2;at++)if(['accuracy','strength','defence'].includes(values[at].value)&&['{',','].includes(values[at-1].value)&&values[at+1].value===':'){
            let depth=0,end=at+2;
            for(;end<values.length;end++){
                const value=values[end].value;
                if(!depth&&[',','}'].includes(value))break;
                if(['(','[','{'].includes(value))depth++;else if([')',']','}'].includes(value))depth--;
            }
            const expression=values.slice(at+2,end).map(token=>token.value).join(' ');
            if(values[end]?.value===','&&new RegExp('^Math \\. (?:round|floor|ceil) \\( '+id+' \\. '+values[at].value+' \\* '+id+' \\)$').test(expression))remove.push([values[at].start,values[end].end]);
        }
        for(const [from,to]of remove.reverse()){body=body.slice(0,from)+body.slice(to);changed=true;}
    }
    if(changed)for(let i=0;i<tokens.length-1;i++)if(/[\r\n\u2028\u2029]/.test(row.body.slice(tokens[i].end,tokens[i+1].start))&&(['return','yield','throw','break','continue'].includes(tokens[i].value)&&![';','}'].includes(tokens[i+1].value)||tokens[i+1].value==='=>'||['++','--'].includes(tokens[i+1].value)))throw Error('规则投影存在换行语义变化');
    return changed?{...row,body:body.trim()}:row;
}
function normalizeRuntimeFunction(row) {
    if(row.kind!=='function')return row;
    const tokens=tokenize(row.body),pairs=new Map(),stack=[];
    let terminalReturn=-1;
    for(let at=0;at<tokens.length;at++){
        const value=tokens[at].value;
        if(!stack.length&&value==='return')terminalReturn=at;
        if(['(','[','{'].includes(value))stack.push(at);
        else if([')',']','}'].includes(value)){
            const open=stack.pop();
            if(open===undefined||({'(':')','[':']','{':'}'})[tokens[open].value]!==value)return row;
            pairs.set(open,at);
        }
    }
    if(stack.length||!tokens.length)return row;
    let end=tokens.length-1;
    while(end>=0&&tokens[end].value===';')end--;
    let body=row.body;
    if(terminalReturn>=0&&terminalReturn<end){
        let from=terminalReturn+1,to=end;
        if(/[\r\n\u2028\u2029]/.test(row.body.slice(tokens[terminalReturn].end,tokens[from].start)))return row;
        let depth=0;
        for(let at=from;at<=to;at++){
            const value=tokens[at].value;
            if(!depth&&value===';')return row;
            if(['(','[','{'].includes(value))depth++;
            else if([')',']','}'].includes(value))depth--;
        }
        while(tokens[from]?.value==='('&&pairs.get(from)===to){from++;to--;}
        if(from<=to)body=row.body.slice(0,tokens[terminalReturn].start)+'return '+row.body.slice(tokens[from].start,tokens[to].end);
    }else if(end>=0&&tokens[end].value==='}'&&end<tokens.length-1){
        body=row.body.slice(0,tokens[end].end);
    }
    return body===row.body?row:{...row,body};
}
function projectRuntimeRule(rule,role) {
    const input=tokenize(rule.shape,0,rule.shape.length,true),tokens=[];
    for(let at=0;at<input.length;at++){
        const token=input[at];
        if(token.value==='@'&&input[at+1]?.type==='num'){tokens.push('@'+input[++at].value);continue;}
        tokens.push(token.value);
    }
    const dependencies=new Map((rule.refs||[]).map(([at,name])=>[at<0?tokens.length+at:at,name]));
    let number=0;
    const text=tokens.map((value,at)=>value==='#'?String(rule.numbers?.[number++]??0):value.startsWith('@')?dependencies.get(at):/^\$\d+$/.test(value)?'__dviLocal'+value.slice(1):value).join(' ');
    const open=text.indexOf('{'),row=normalizeRuntimeFunction(projectRuntime({kind:'function',params:text.slice(0,open).trim(),body:text.slice(open+1,text.lastIndexOf('}'))},role));
    const definitions=new Map([...dependencies.values()].map(name=>[name,null]));
    const description=adaptiveDescription(row,definitions);
    const locals=[...description.locals.values()].map(local=>rule.locals[Number(local.name.slice('__dviLocal'.length))]??local.name);
    return {...rule,shape:description.shape,refs:description.refs,locals,...rule.numbers?{numbers:description.tokens.filter(token=>token.type==='num').map(token=>Number(token.value))}:{}};
}
function adaptiveDescription(row,definitions,limit=0) {
    const kind=row.kind==='function'?'function':row.kind==='binding'?'binding':'value';
    const expression=kind==='function'? (Array.isArray(row.params)?row.params.join(','):row.params)+'{'+row.body+'}' : kind==='binding'?row.source+'.'+row.path.join('.') : row.expression;
    const tokens=tokenize(expression),scope=adaptiveBindings(tokens,kind==='function'?tokenize(Array.isArray(row.params)?row.params.join(','):row.params).length:0),globals=new Map(),locals=new Map(),localAt=new Map(),refs=[],shape=[];
    const release=/^\[\{version:/.test(row.expression);
    const size=limit || (release?5:kind==='function'?tokens.length:Math.min(96,tokens.length));
    for(let i=0;i<tokens.length;i++) {
        const token=tokens[i],name=token.value;
        let value=name;
        if(token.type==='num')value='#';
        else if(token.type==='string' && /^\[\{version:/.test(row.expression) && !adaptiveProperty(tokens,i))value='"#string"';
        else if(token.type==='name' && !adaptiveKeyword(tokens,i,scope) && !adaptiveBuiltins.has(name) && !adaptiveProperty(tokens,i)) {
            if(definitions.has(name)&&!scope.locals.has(i)) {
                if(!globals.has(name))globals.set(name,globals.size);
                value='@'+globals.get(name);
                if(i<size || !release&&kind!=='function'&&i>=tokens.length-96)refs.push([i<size?i:i-tokens.length,name]);
            } else {
                const local=scope.locals.get(i),key=local?'binding:'+local.id:'free:'+name;
                if(!locals.has(key))locals.set(key,{index:locals.size,name});
                localAt.set(i,locals.get(key).index);value='$'+locals.get(key).index;
            }
        }
        if(i<size || !release&&kind!=='function'&&i>=tokens.length-96) {
            if(kind!=='function'&&tokens.length>192&&i===tokens.length-96)shape.push('~tail~');
            shape.push(value);
        }
    }
    return {kind,shape:stableShape(shape.join(' ')),refs,locals,localAt,scope,tokens,numbers:tokens.filter(token=>token.type==='num').map(token=>Number(token.value)).join(',')};
}
function pureGearExpression(tokens,parameter,definitions,active=new Set(),budget={steps:0}) {
    let at=0;
    const fail=()=>{throw Error('装备忽略字段存在不可验证的副作用');};
    const take=value=>tokens[at]?.value===value?(at++,true):false;
    const expect=value=>{if(!take(value))fail();};
    const reference=name=>{
        if(name===parameter||['true','false','null','undefined'].includes(name))return;
        if(adaptiveKeywords.has(name)||forbidden.has(name))fail();
        if(!definitions)return;
        const row=definitions.get(name);
        if(active.has(name)||active.size>=32||row?.kind!=='const'||row.valueForm||!row.expression||row.expression.length>250000)fail();
        active.add(name);try{pureGearExpression(tokenize(row.expression),null,definitions,active,budget);}finally{active.delete(name);}
    };
    const atom=()=>{
        if(++budget.steps>20000)fail();
        const token=tokens[at];if(!token)fail();
        if(['!','+','-','~','void'].includes(token.value)){at++;atom();return;}
        if(take('(')){expression();expect(')');}
        else if(take('[')){if(!take(']')){do{expression();}while(take(',')&&tokens[at]?.value!==']');expect(']');}}
        else if(take('{')){
            if(!take('}')){do{const key=tokens[at++];if(!key||!['name','string'].includes(key.type)||forbidden.has(key.type==='string'?JSON.parse(key.value):key.value))fail();expect(':');expression();}while(take(',')&&tokens[at]?.value!=='}');expect('}');}
        }else if(['num','string'].includes(token.type))at++;
        else if(token.type==='name'){reference(token.value);at++;}
        else fail();
        while(tokens[at]){
            if(take('.')){const key=tokens[at++];if(key?.type!=='name'||forbidden.has(key.value))fail();}
            else if(take('[')){expression();expect(']');}
            else break;
        }
    };
    const binary=new Map([['||',1],['??',1],['&&',2],['|',3],['^',4],['&',5],['===',6],['!==',6],['==',6],['!=',6],['<',7],['>',7],['<=',7],['>=',7],['<<',8],['>>',8],['>>>',8],['+',9],['-',9],['*',10],['/',10],['%',10],['**',11]]);
    const expression=(minimum=0)=>{
        atom();
        while(binary.has(tokens[at]?.value)&&binary.get(tokens[at].value)>=minimum){const op=tokens[at++].value;expression(binary.get(op)+(op==='**'?0:1));}
        if(minimum===0&&take('?')){expression();expect(':');expression();}
    };
    expression();if(at!==tokens.length)fail();
}
function projectGearMapping(row,definitions=null) {
    if(row.kind!=='const'||typeof row.expression!=='string'||row.expression.length>250000)return row;
    const tokens=tokenize(row.expression),values=tokens.map(token=>token.value);
    if(tokens[0]?.type!=='name'||values.slice(1,4).join(' ')!=='. map ('||tokens[4]?.type!=='name'||values[5]!=='=>'||values[6]!=='('||values[7]!=='{'||values.slice(-3).join(' ')!=='} ) )')return row;
    const entries=[];let from=8,depth=0;
    for(let at=8;at<=tokens.length-3;at++){
        const value=values[at];
        if(!depth&&(value===','||at===tokens.length-3)){
            if(at>from)entries.push(tokens.slice(from,at));from=at+1;
        }
        if(['(','[','{'].includes(value))depth++;else if([')',']','}'].includes(value))depth--;
    }
    const key=entry=>entry[0]?.value==='...'?'...':entry[1]?.value===':'&&['name','string'].includes(entry[0]?.type)?entry[0].type==='string'?JSON.parse(entry[0].value):entry[0].value:null;
    const keys=entries.map(key);
    if(!keys.includes('itemId')||!keys.includes('slot')&&!keys.includes('...')||keys.includes('bonus')||keys.includes('qty'))return row;
    const necessary=new Set(['itemId','slot','luck','offhand','...']),seen=new Set(),fields=[];
    for(let at=0;at<entries.length;at++){
        if(keys[at]===null||forbidden.has(keys[at]))throw Error('装备映射字段键不可验证');
        if(keys[at]!=='...'&&seen.has(keys[at]))throw Error('装备精通字段重复');
        seen.add(keys[at]);
        if(necessary.has(keys[at]))fields.push(entries[at].map(token=>token.value).join(' '));
        else pureGearExpression(entries[at].slice(2),tokens[4].value,definitions);
    }
    return {...row,expression:values.slice(0,8).join(' ')+' '+fields.join(' , ')+' } ) )'};
}
function adaptGameSource(source,schema=adaptiveSchema()) {
    const rawDefinitions=indexTopLevel(source),projectionErrors=new Map(),definitions=new Map([...rawDefinitions].map(([name,row])=>{
        try{return [name,normalizeRuntimeFunction(projectRuntime(projectGearMapping(row,rawDefinitions)))];}
        catch(error){projectionErrors.set(name,String(error.message||error));return [name,row];}
    })),candidates=new Map(),descriptions=new Map(),bindings=new Map(),reverse=new Map(),links=new Map(),projected=new Map(),extensions=new Map(),invalid=new Map();
    const invalidate=(role,message)=>{if(!invalid.has(role))invalid.set(role,message);};
    for(const row of Object.values(schema))for(const variant of [row,...(row.variants||[])])variant.shape=stableShape(variant.shape);
    let schemaEntries=Object.entries(schema);
    const dataCache=new Map(),dataActive=new Set(),dataNames=new Map(),dataRoles=new Map(),dataWeights=new WeakMap(),tableCalls={};
    const dataWeight=(value,nesting=0)=>{
        if(nesting>64)throw Error('数据常量嵌套过深');
        if(value&&typeof value==='object'&&dataWeights.has(value))return dataWeights.get(value);
        let size=1+(typeof value==='string'?value.length:0),height=0;
        if(value&&typeof value==='object')for(const [key,item]of value instanceof Set?[...value].map(item=>['',item]):Array.isArray(value)?value.entries():Object.entries(value)){
            const child=dataWeight(item,nesting+1);size+=child.size+(typeof key==='string'?key.length:0);height=Math.max(height,child.height+1);
            if(size>100000||height>64)throw Error('数据常量展开过大');
        }
        if(size>100000)throw Error('数据常量展开过大');
        const weight={size,height};if(value&&typeof value==='object')dataWeights.set(value,weight);return weight;
    };
    const staticMembers=(text,locals={})=>{
        const tokens=tokenize(text),output=[];
        const encode=value=>{
            if(value instanceof Set||typeof value==='function'||typeof value==='number'&&!Number.isFinite(value))throw Error('静态数据成员值无效');
            const encoded=JSON.stringify(value);if(encoded===undefined)throw Error('静态数据成员值无效');return '('+encoded+')';
        };
        for(let at=0;at<tokens.length;at++){
            if(tokens[at].type==='name'&&tokens[at+1]?.value==='.'&&['map','flatMap','filter','find'].includes(tokens[at+2]?.value)&&tokens[at+3]?.value==='('){
                let end=at+4,depth=1;
                for(;end<tokens.length;end++){if(tokens[end].value==='(')depth++;if(tokens[end].value===')'&&!--depth)break;}
                if(end>=tokens.length)throw Error('静态映射边界未结束');
                while(tokens[end+1]?.value==='.'&&['map','flatMap','filter'].includes(tokens[end+2]?.value)&&tokens[end+3]?.value==='('){let close=end+4,nesting=1;for(;close<tokens.length;close++){if(tokens[close].value==='(')nesting++;if(tokens[close].value===')'&&!--nesting)break;}if(close>=tokens.length)throw Error('静态映射链边界未结束');end=close;}
                output.push(encode(staticData(text.slice(tokens[at].start,tokens[end].end),locals)));at=end;
            }else if(tokens[at].type==='name'&&['.','['].includes(tokens[at+1]?.value)){
                let value=Object.hasOwn(locals,tokens[at].value)?locals[tokens[at].value]:readData(tokens[at].value);
                while(['.','['].includes(tokens[at+1]?.value)){
                    let key;
                    if(tokens[at+1].value==='.'){
                        if(tokens[at+2]?.type!=='name')throw Error('静态数据成员键无效');
                        key=tokens[at+2].value;at+=2;
                    }else{
                        let end=at+2,depth=1;
                        for(;end<tokens.length;end++){if(tokens[end].value==='[')depth++;if(tokens[end].value===']'&&!--depth)break;}
                        if(end>=tokens.length)throw Error('静态数据索引未结束');
                        const expression=tokens.slice(at+2,end).map(token=>token.value).join(' ');
                        key=parseExpression(staticMembers(expression,locals),readData,tableCalls,locals);at=end;
                        if(typeof key!=='string'&&!Number.isSafeInteger(key))throw Error('静态数据索引无效');
                    }
                    if(forbidden.has(String(key))||value===null||!['object','string'].includes(typeof value)||!Object.hasOwn(value,key))throw Error('静态数据成员引用无效');
                    value=value[key];
                }
                output.push(encode(value));
            }else output.push(tokens[at].value);
        }
        return output.join(' ');
    };
    const staticData=(text,locals={},nesting=0)=>{
        if(nesting>32)throw Error('静态数据映射嵌套过深');
        const tokens=tokenize(text),pairs=new Map(),stack=[];
        for(let at=0;at<tokens.length;at++){
            const value=tokens[at].value;if(['(','[','{'].includes(value))stack.push(at);
            else if([')',']','}'].includes(value)){const open=stack.pop();if(open===undefined||({'(':')','[':']','{':'}'})[tokens[open].value]!==value)throw Error('静态数据边界无效');pairs.set(open,at);}
        }
        if(stack.length)throw Error('静态数据边界未结束');
        let from=0,to=tokens.length-1;
        while(tokens[from]?.value==='('&&pairs.get(from)===to){from++;to--;}
        const call=tokens.slice(from,to+1);
        if(call.slice(0,4).map(token=>token.value).join(' ')==='Object . fromEntries ('&&pairs.get(from+3)===to){
            const entries=staticData(text.slice(call[4].start,call.at(-1).start),locals,nesting+1),value={};
            if(!Array.isArray(entries)||entries.length>10000)throw Error('静态字典条目无效');
            for(const entry of entries){if(!Array.isArray(entry)||entry.length!==2||!['string','number'].includes(typeof entry[0])||forbidden.has(String(entry[0]))||Object.hasOwn(value,String(entry[0])))throw Error('静态字典键无效或重复');value[entry[0]]=entry[1];}
            dataWeight(value);return value;
        }
        let method=-1;
        for(let at=from+1;at<to-2;at++)if(tokens[at].value==='.'&&['map','flatMap','filter','find'].includes(tokens[at+1]?.value)&&tokens[at+2]?.value==='('&&pairs.get(at+2)===to)method=at-from;
        if(method>=1){
            let arrow=method+3,parameters=[];
            if(call[arrow]?.value==='('){const close=pairs.get(from+arrow)-from;const parts=call.slice(arrow+1,close);if(parts.some((token,index)=>index%2?token.value!==',':token.type!=='name'))throw Error('静态映射参数无效');parameters=parts.filter((_,index)=>index%2===0).map(token=>token.value);arrow=close+1;}
            else if(call[arrow]?.type==='name')parameters=[call[arrow++].value];
            if(call[arrow]?.value!=='=>'||parameters.length<1||parameters.length>2||new Set(parameters).size!==parameters.length||parameters.some(name=>adaptiveKeywords.has(name)||forbidden.has(name)))throw Error('静态映射参数不可验证');
            const input=staticData(text.slice(call[0].start,call[method].start),locals,nesting+1);
            if(!Array.isArray(input)||input.length>10000)throw Error('静态映射源无效');
            const body=text.slice(call[arrow+1].start,call.at(-1).start),output=[];let totalSize=1;
            for(let index=0;index<input.length;index++){
                const scope={...locals,[parameters[0]]:input[index],...parameters.length>1?{[parameters[1]]:index}:{}};
                const value=staticData(body,scope,nesting+1),operation=call[method+1].value;
                if(['filter','find'].includes(operation)&&typeof value!=='boolean')throw Error('静态筛选条件无效');
                if(operation==='find'){if(value)return input[index];continue;}
                const rows=operation==='filter'?(value?[input[index]]:[]):operation==='flatMap'?(Array.isArray(value)?value:[value]):[value];
                if(output.length+rows.length>100000)throw Error('静态映射展开过大');
                for(const row of rows){totalSize+=dataWeight(row).size;if(totalSize>100000)throw Error('静态映射数据过大');output.push(row);}
            }
            return call[method+1].value==='find'?undefined:output;
        }
        if(call[0]?.value==='{'){
            const output=[],containers=[],objectKeys=new Map();
            for(let at=0;at<tokens.length;at++){
                const end=pairs.get(at);
                if(tokens[at].value==='['&&['{',','].includes(tokens[at-1]?.value)&&end!==undefined&&tokens[end+1]?.value===':'){
                    const key=staticData(text.slice(tokens[at].end,tokens[end].start),locals,nesting+1);
                    if(!['string','number'].includes(typeof key)||typeof key==='number'&&!Number.isSafeInteger(key)||forbidden.has(String(key)))throw Error('静态字典计算键无效');
                    const keys=objectKeys.get(containers.at(-1));if(!keys||keys.has(String(key)))throw Error('静态字典键无效或重复');keys.add(String(key));
                    output.push(JSON.stringify(String(key)));at=end;
                }else{
                    const token=tokens[at],keys=objectKeys.get(containers.at(-1));
                    if(keys&&['{',','].includes(tokens[at-1]?.value)&&tokens[at+1]?.value===':'&&['name','string'].includes(token.type)){
                        const key=token.type==='string'?JSON.parse(token.value):token.value;if(keys.has(key))throw Error('静态字典键重复');keys.add(key);
                    }
                    output.push(token.value);
                    if(['(','[','{'].includes(token.value)){containers.push(at);if(token.value==='{')objectKeys.set(at,new Set());}
                    else if([')',']','}'].includes(token.value))containers.pop();
                }
            }
            text=output.join(' ');
        }
        return parseExpression(staticMembers(text,locals),readData,tableCalls,locals);
    };
    const readData=name=>{
        if(dataCache.has(name))return dataCache.get(name);
        if(dataActive.has(name))throw Error('数据常量循环依赖');
        if(dataActive.size>=64||dataCache.size+dataActive.size>=1024)throw Error('数据常量依赖过多');
        const row=definitions.get(name);
        if(row?.kind!=='const'||row.valueForm||!row.expression||row.expression.length>250000)throw Error('数据依赖不是只读常量 '+name);
        dataActive.add(name);
        try{const value=staticData(row.expression);dataWeight(value);dataCache.set(name,value);return value;}
        finally{dataActive.delete(name);}
    };
    const dataReference=name=>{
        readData(name);
        if(!dataNames.has(name)){
            let role='$dviData'+dataNames.size;
            while(definitions.has(role)||schema[role]||dataRoles.has(role))role+='_';
            dataNames.set(name,role);dataRoles.set(role,name);
        }
        return dataNames.get(name);
    };
    const dictionaryKeys=row=>{
        if(!row.expression?.startsWith('{'))return null;
        const tokens=tokenize(row.expression),keys=new Set(),entries=[];let depth=0,start=1;
        for(let i=1;i<tokens.length;i++){const value=tokens[i].value;if(['(','[','{'].includes(value))depth++;else if([')',']','}'].includes(value)){if(depth)depth--;else if(value==='}')entries.push(tokens.slice(start,i));}
            if(value===','&&!depth){entries.push(tokens.slice(start,i));start=i+1;}}
        for(const entry of entries){
            if(!entry.length)continue;
            if(entry[0].value==='[')continue;
            if(entry.length!==3||!['name','string'].includes(entry[0].type)||entry[1].value!==':'||entry[2].type!=='string')return null;
            if(entry[0].type==='string'&&!entry[0].value.startsWith('"'))continue;
            const key=entry[0].type==='string'?JSON.parse(entry[0].value):entry[0].value;if(keys.has(key))return null;keys.add(key);
        }
        return tokens.at(-1)?.value==='}'?keys:null;
    };
    const needed=new Set(schemaEntries.flatMap(([,row])=>[row,...(row.variants||[])].map(variant=>variant.kind+':'+variant.shape)));
    const rowFor=(name,kind)=>{const row=definitions.get(name);return kind!=='function'&&row?.valueForm?row.valueForm:row;};
    const describe=(name,kind)=>{
        const key=kind+':'+name;
        if(!descriptions.has(key)) descriptions.set(key,adaptiveDescription(rowFor(name,kind),definitions));
        return descriptions.get(key);
    };
    for(const [name,entry] of definitions) for(const row of entry.valueForm?[entry,entry.valueForm]:[entry]) {
        if(row.expression===null || row.kind==='binding'&&!row.path || (row.kind==='function'?row.body.length:row.expression?.length)>250000)continue;
        const description=adaptiveDescription(row,definitions),key=description.kind+':'+description.shape;
        if(!needed.has(key))continue;
        descriptions.set(description.kind+':'+name,description);
        if(!candidates.has(key))candidates.set(key,[]);
        candidates.get(key).push(name);
    }
    schemaEntries=Object.entries(schema);
    const bind=(role,name)=>{
        if(!definitions.has(name))throw Error('自动识别缺少定义 '+role);
        if(bindings.has(role)) {if(bindings.get(role)!==name)throw Error('自动识别依赖冲突 '+role);return false;}
        if(reverse.has(name)&&reverse.get(name)!==role)throw Error('自动识别角色冲突 '+role);
        bindings.set(role,name);reverse.set(name,role);return true;
    };
    const bindGroup=(owner,entries)=>{
        const pending=new Map(),used=new Map();
        for(const [role,name]of entries){
            let message=null;
            if(!definitions.has(name))message='自动识别缺少定义 '+role;
            else if(bindings.has(role)&&bindings.get(role)!==name||pending.has(role)&&pending.get(role)!==name)message='自动识别依赖冲突 '+role;
            else if(reverse.has(name)&&reverse.get(name)!==role||used.has(name)&&used.get(name)!==role)message='自动识别角色冲突 '+role;
            if(message){invalidate(owner,message+'（来自 '+owner+'）');return false;}
            pending.set(role,name);used.set(name,role);
        }
        let changed=false;
        for(const [role,name]of pending)if(!bindings.has(role)){bindings.set(role,name);reverse.set(name,role);changed=true;}
        return changed;
    };
    for(const [name,row]of definitions)if(row.kind==='function'&&row.body.length<1000&&adaptiveDescription(row,definitions).shape===schema.cn.shape){
        const match=/^return([\s\S]*?);?$/.exec(row.body),params=tokenize(row.params).filter(token=>token.type==='name').map(token=>token.value);
        if(match)tableCalls[name]=(...args)=>{if(args.length!==params.length)throw Error('配方构造器参数变化');return parseExpression(match[1],readData,{},Object.fromEntries(params.map((param,index)=>[param,args[index]])));};
    }
    const staticCallActive=new Set();
    for(const [name,row]of definitions)if(row.kind==='function'&&row.valueForm&&row.body.length<1000){
        const match=/^return\s*(\[[\s\S]*\])$/.exec(row.body),parameters=tokenize(row.params).filter(token=>token.type==='name').map(token=>token.value);
        if(match&&parameters.length>0&&parameters.length<=4)tableCalls[name]=(...args)=>{
            if(args.length!==parameters.length||staticCallActive.has(name)||staticCallActive.size>=32)throw Error('静态数据构造器依赖无效');
            staticCallActive.add(name);
            try{const value=staticData(match[1],Object.fromEntries(parameters.map((parameter,index)=>[parameter,args[index]])));dataWeight(value);return value;}
            finally{staticCallActive.delete(name);}
        };
    }
    const projectTable=(row,records,fields)=>records.map(record=>Object.fromEntries(fields.filter(key=>record.has(key)).map(key=>{
        const tokens=record.get(key),text=row.expression.slice(tokens[0].start,tokens.at(-1).end);
        return [key,parseExpression(staticMembers(text),readData,tableCalls)];
    })));
    const projectStaticMaps=(table,expected)=>{
        const rows=projectTable(table.row,table.records,expected.fields).map((row,index)=>({at:[...table.records[index].values()][0][0].start,rows:[row]}));
        for(const tokens of table.ignored){
            const values=tokens.map(token=>token.value),parameter=values[5];
            if(values[0]!=='...'||tokens[1]?.type!=='name'||values.slice(2,5).join(' ')!=='. map ('||tokens[5]?.type!=='name'||values.slice(6,9).join(' ')!=='=> ( {'||values.slice(-3).join(' ')!=='} ) )')throw Error('数据表展开不是静态映射');
            const records=dataRecords([{value:'['},...tokens.slice(8,-2),{value:']'}]);
            if(records.length!==1||expected.table.some(field=>!records[0].has(field)))throw Error('数据表映射字段缺失');
            const neededFields=new Set();
            for(const field of expected.fields)for(let at=0,expression=records[0].get(field)||[];at<expression.length-2;at++)if(expression[at].value===parameter&&expression[at+1].value==='.'&&expression[at+2].type==='name')neededFields.add(expression[at+2].value);
            const source=definitions.get(values[1]);let input;
            if(source?.kind==='const'&&!source.valueForm&&/^\[/.test(source.expression)&&source.expression.length<=250000){
                const inputRecords=dataRecords(tokenize(source.expression));
                if(inputRecords.some(row=>[...neededFields].some(field=>!row.has(field))))throw Error('数据表映射源字段缺失');
                input=projectTable(source,inputRecords,[...neededFields]);
            }else input=readData(values[1]);
            if(!Array.isArray(input)||input.length>10000)throw Error('数据表映射源无效');
            const mapped=input.map(record=>{
                if(!record||typeof record!=='object'||Array.isArray(record))throw Error('数据表映射条目无效');
                return Object.fromEntries(expected.fields.filter(field=>records[0].has(field)).map(field=>{
                    const expression=records[0].get(field),output=[];
                    for(let at=0;at<expression.length;at++){
                        if(expression[at].value===parameter&&expression[at+1]?.value==='.'&&expression[at+2]?.type==='name'){
                            const key=expression[at+2].value;
                            if(forbidden.has(key)||!Object.hasOwn(record,key))throw Error('数据表映射引用无效');
                            const value=JSON.stringify(record[key]);if(value===undefined)throw Error('数据表映射值无效');
                            output.push('('+value+')');at+=2;
                        }else output.push(expression[at].value);
                    }
                    return [field,parseExpression(output.join(' '),readData,tableCalls)];
                }));
            });
            rows.push({at:tokens[0].start,rows:mapped});
        }
        return rows.sort((left,right)=>left.at-right.at).flatMap(row=>row.rows);
    };
    const tables=[];
    for(const [name,row]of definitions)if(row.kind==='const'&&/^\[/.test(row.expression)&&row.expression.length<=250000){
        try{const ignored=[],records=dataRecords(tokenize(row.expression),true,ignored);if(records.length)tables.push({name,row,records,ignored,spreads:ignored.length>0});}catch{}
        for(const [,expected]of schemaEntries)if(expected.rowId!==undefined){
            try{const records=dataRecords(tokenize(row.expression),false,[],expected.rowId);if(records.length)tables.push({name,row,records,ignored:[],spreads:false,rowId:expected.rowId});}catch{}
        }
    }
    const validTableData=(role,table)=>{
        if(role==='yz'){
            if(table.records.every(row=>row.has('bonus')))return false;
            try{return projectTable(table.row,table.records,['itemId','slot']).every(row=>Number.isSafeInteger(row.itemId)&&row.itemId>0&&typeof row.slot==='string'&&row.slot.length>0);}catch{return false;}
        }
        if(role!=='Cd')return true;
        try{
            const rows=projectTable(table.row,table.records,['output']);
            return rows.every(row=>Number.isSafeInteger(row.output?.itemId)&&row.output.itemId>0&&Number.isSafeInteger(row.output?.qty)&&row.output.qty>0);
        }catch{return false;}
    };
    for(const [role,expected]of schemaEntries)if(expected.table){
        const found=tables.filter(table=>table.rowId===expected.rowId&&table.records.length>=(expected.minRows??1)&&(!table.spreads||expected.extensions||expected.staticMaps)&&table.records.every(row=>expected.table.every(key=>row.has(key))&&(!expected.tableAbsent||expected.tableAbsent.every(key=>!row.has(key)))&&(!expected.idType||row.get('id')?.length===1&&row.get('id')[0].type===expected.idType))&&(!expected.tableRefs||expected.tableRefs.every(([id,field])=>table.records.some(record=>record.get('itemId')?.length===1&&record.get('itemId')[0].type==='num'&&Number(record.get('itemId')[0].value)===id&&record.has(field))))&&validTableData(role,table));
        if(found.length===0&&expected.optional){invalidate(role,'当前游戏没有此数据表 '+role);continue;}
        if(found.length!==1)throw Error('数据表无法唯一识别 '+role);
        const {name,row,records,ignored}=found[0],id=expected.table.includes('itemId')?'itemId':'id';
        const rows=expected.staticMaps?projectStaticMaps(found[0],expected):expected.fields?projectTable(row,records,expected.fields):readData(name);
        dataWeight(rows);
        if(new Set(rows.map(row=>row[id])).size!==rows.length)throw Error('数据表条目重复 '+role);
        bind(role,name);
        if(expected.fields){dataCache.set(name,rows);projected.set(name,rows);}
        if(expected.extensions&&!expected.staticMaps)extensions.set(role,ignored);
        if(expected.tableRefs){
            for(const [itemId,field,dependency]of expected.tableRefs){
                const indices=rows.map((row,index)=>row[id]===itemId?index:-1).filter(index=>index>=0);
                if(indices.length!==1)throw Error('数据表关键条目缺失 '+role);
                const at=indices[0],tokens=records[at].get(field);
                if(!Number.isFinite(rows[at][field])||rows[at][field]<=0)throw Error('数据表关键数值无效 '+role);
                if(tokens?.length===1&&tokens[0].type==='name')bind(dependency,tokens[0].value);
            }
        }
    }
    const dictionaries=[];
    for(const [name,row]of definitions){try{const keys=dictionaryKeys(row);if(keys)dictionaries.push([name,keys]);}catch{}}
    const upgradeClockVerified=()=>{
        for(const role of ['upgradeDuration','upgradeRecipe','JD'])verify(role);
        const expected=schema.upgradeTick,opaque=new Set(['upgradePerform','upgradeRemaining','upgradeGrantXp']),clocks=[];
        for(const [name,row]of rawDefinitions){
            if(row.kind!=='function')continue;
            const actual=adaptiveDescription(normalizeRuntimeFunction(row),rawDefinitions);
            if(stableShape(actual.shape)!==stableShape(expected.shape))continue;
            const numbers=actual.tokens.filter(token=>token.type==='num').map(token=>Number(token.value));
            if(JSON.stringify(numbers)!==JSON.stringify(expected.numbers))continue;
            const references=new Map(actual.refs);
            if(expected.refs.every(([at,role])=>opaque.has(role)?rawDefinitions.get(references.get(at))?.kind==='function':references.get(at)===bindings.get(role)))clocks.push(name);
        }
        if(clocks.length!==1)throw Error('升级制作时钟消费者无法验证');
        const clock=clocks[0];let count=0;
        for(const row of rawDefinitions.values()){
            if(row.kind!=='function')continue;
            const parameters=tokenize(row.params).map(token=>token.value).filter(value=>value!==',');
            if(parameters.length!==4)continue;
            const [state,world,,events]=parameters,bodyText=tokenize(row.body).map(token=>token.value).join('');
            if(!bodyText.includes(state+'.workSiteId')||!bodyText.includes(state+'.workJobId')||!bodyText.includes(state+'.stunUntil')||!bodyText.includes(state+'.attemptTicks++'))continue;
            if(bodyText.includes('if('+state+'.route?.upgrade){'+clock+'('+state+','+world+','+events+');return}'))count++;
        }
        if(count!==1)throw Error('升级制作时钟与实际工作入口无法关联');
        return true;
    };
    const metadata=()=>{
        const translations=new Map(),versions=[];
        const anchors=[['Copper','Salmon','Bronze shield','Steel hammer'],['Deep Vein','Stop after','Offline','Only moderators read this'],['1 in {n}','1 minute','The vein answers to you.','The altar'],['Bread stall','Relic stall','Cook sardine','Silk cart']];
        for(const keys of anchors){
            const found=dictionaries.filter(([,available])=>keys.every(key=>available.has(key)));
            if(found.length!==1)continue;
            try{for(const [key,value]of dictionaryEntries(definitions.get(found[0][0]).expression))if(!translations.has(key))translations.set(key,value);}catch{}
        }
        for(const row of definitions.values()){
            const match=/^\[\s*\{\s*version\s*:\s*("(?:[^"\\]|\\.)*")/.exec(row.expression||'');
            if(match)try{const version=JSON.parse(match[1]);if(/^\d+\.\d+\.\d+$/.test(version))versions.push(version);}catch{}
        }
        return {translations,version:versions.length===1?versions[0]:null};
    };
    const compatible=(role,name,expected=schema[role])=>{
        if(reverse.has(name)&&reverse.get(name)!==role)return false;
        const actual=describe(name,expected.kind);
        if(actual.refs.length!==expected.refs.length)return false;
        const seen=new Map(),used=new Map();
        for(let i=0;i<expected.refs.length;i++) {
            const [position,dependency]=expected.refs[i], [at,symbol]=actual.refs[i];
            if(position!==at || bindings.has(dependency)&&bindings.get(dependency)!==symbol || reverse.has(symbol)&&reverse.get(symbol)!==dependency)return false;
            if(seen.has(dependency)&&seen.get(dependency)!==symbol || used.has(symbol)&&used.get(symbol)!==dependency)return false;
            seen.set(dependency,symbol);used.set(symbol,dependency);
        }
        return true;
    };
    for(let round=0;round<32;round++) {
        let changed=false;
        for(const [role] of schemaEntries) {
            let expected=schema[role];
            if(expected.dictionary||expected.table||invalid.has(role))continue;
            if(expected.relationOnly&&!bindings.has(role))continue;
            let selected=bindings.get(role);
            if(expected.variants){
                const choices=[];
                for(const variant of [expected,...expected.variants]){
                    const names=selected?[selected]:candidates.get(variant.kind+':'+variant.shape)||[];
                    for(const name of names){
                        const actual=describe(name,variant.kind);
                        if(actual.kind===variant.kind&&actual.shape===variant.shape&&(!variant.numbers||actual.numbers===variant.numbers.join(','))&&compatible(role,name,variant))choices.push({variant,name});
                    }
                }
                const unique=[];
                for(const choice of choices){
                    const same=unique.find(prior=>prior.name===choice.name&&prior.variant.kind===choice.variant.kind&&prior.variant.shape===choice.variant.shape&&JSON.stringify(prior.variant.refs)===JSON.stringify(choice.variant.refs)&&JSON.stringify(prior.variant.locals)===JSON.stringify(choice.variant.locals)&&(!prior.variant.numbers||!choice.variant.numbers||prior.variant.numbers.join(',')===choice.variant.numbers.join(',')));
                    if(!same)unique.push(choice);else if(choice.variant.strict&&Array.isArray(choice.variant.numbers))same.variant=choice.variant;
                }
                if(unique.length!==1)continue;
                expected=unique[0].variant;selected=unique[0].name;schema[role]={...expected};delete schema[role].variants;expected=schema[role];
            }
            if(!selected) {
                const found=(candidates.get(expected.kind+':'+expected.shape)||[]).filter(name=>compatible(role,name));
                if(found.length===1 || found.length>1 && !expected.refs.length && !expected.locals.length && !expected.shape.includes('#') && !expected.shape.startsWith('new ') && found.every(name=>describe(name,expected.kind).tokens.map(token=>token.value).join(' ')===expected.shape))selected=found[0];
            }
            if(!selected)continue;
            if(projectionErrors.has(selected)){invalidate(role,projectionErrors.get(selected)+' '+role);continue;}
            const actual=describe(selected,expected.kind),matches=actual.kind===expected.kind&&actual.shape===expected.shape&&(!expected.numbers||actual.numbers===expected.numbers.join(','));
            if(!matches&&expected.strict){invalidate(role,'游戏规则结构变化 '+role);continue;}
            const pending=[[role,selected]];
            if(expected.links?.length) {
                if(!links.has(role)){
                    const values=actual.tokens.map((token,index)=>token.type==='num'?'#':token.type==='name'&&definitions.has(token.value)&&!actual.scope.locals.has(index)&&!adaptiveKeyword(actual.tokens,index,actual.scope)&&!adaptiveProperty(actual.tokens,index)?'@':token.value),resolved=[];
                    for(const [dependency,offset,pattern] of expected.links) {
                        const found=new Set();
                        for(let at=0;at<=values.length-pattern.length;at++)if(pattern.every((value,index)=>value===values[at+index]))found.add(actual.tokens[at+offset].value);
                        if(found.size===1)resolved.push([dependency,found.values().next().value]);
                    }
                    links.set(role,resolved);
                }
                pending.push(...links.get(role));
            }
            if(matches){
                if(!compatible(role,selected)){invalidate(role,'自动识别调用关系冲突 '+role);continue;}
                for(let i=0;i<expected.refs.length;i++)pending.push([expected.refs[i][1],actual.refs[i][1]]);
            }
            changed=bindGroup(role,pending)||changed;
        }
        if(!changed)break;
        if(round===31)for(const [role,expected]of schemaEntries)if(!expected.table&&!expected.dictionary&&!bindings.has(role))invalidate(role,'自动识别超过依赖上限 '+role);
    }
    // Skill identifiers grow as data; match the complete directory to its labels and groups.
    if(bindings.has('pf')&&bindings.has('QS')){
        const stringRows=[];
        for(const [name,row]of definitions)if(row.kind==='const'&&row.expression?.startsWith('[')&&row.expression.length<10000){
            const tokens=tokenize(row.expression);let end=0,depth=0;
            for(;end<tokens.length;end++){if(tokens[end].value==='[')depth++;if(tokens[end].value===']'&&!--depth)break;}
            const input=tokens.slice(0,end+1),suffix=tokens.slice(end+1),plain=input.every((token,at)=>at===0?token.value==='[':at===input.length-1?token.value===']':at%2?token.type==='string':token.value===',');
            if(!plain)continue;
            let values;try{values=parseExpression(input.map(token=>token.value).join(' '),()=>{throw Error('技能目录不是字面数据');});}catch{continue;}
            if(!values.length||values.some(value=>typeof value!=='string'||!value)||new Set(values).size!==values.length)continue;
            const tail=suffix.map(token=>token.value),filtered=tail.length===13&&tail[0]==='.'&&tail[1]==='filter'&&tail[2]==='('&&suffix[3].type==='name'&&tail[4]==='=>'&&tail[5]===tail[3]&&tail[6]==='!=='&&tail[7]==='"alchemy"'&&tail[8]==='||'&&suffix[9].type==='name'&&tail[10]==='.'&&tail[11]==='alchemy'&&tail[12]===')';
            if(!suffix.length||filtered&&tail[9]===bindings.get('jobFeatureFlags'))stringRows.push({name,values,filtered});
        }
        const gather=readData(bindings.get('pf')),combat=readData(bindings.get('QS')),groups=[...gather,...combat],same=(left,right)=>left.length===right.length&&left.every(value=>right.includes(value)),matches=[];
        if(new Set(groups).size!==groups.length)throw Error('游戏技能分组存在重叠');
        for(const list of stringRows)if(!list.filtered&&groups.every(skill=>list.values.includes(skill))&&(!bindings.has('Bc')||bindings.get('Bc')===list.name)){
            const remainder=list.values.filter(skill=>!groups.includes(skill));
            const crafts=stringRows.filter(row=>same(row.values,remainder)&&(!bindings.has('_S')||bindings.get('_S')===row.name));
            if(crafts.length!==1)continue;
            for(const [name,keys]of dictionaries)if(keys.size===list.values.length&&list.values.every(skill=>keys.has(skill))&&(!bindings.has('xz')||bindings.get('xz')===name)){
                let names;try{names=readData(name);}catch{continue;}
                if(list.values.every(skill=>typeof names[skill]==='string'&&names[skill].replace(/[\s_-]/g,'').toLowerCase()===skill.replace(/[\s_-]/g,'').toLowerCase()))matches.push({list,craft:crafts[0],name});
            }
        }
        if(matches.length!==1)throw Error('技能目录与名称、分组无法唯一关联');
        const match=matches[0];bind('Bc',match.list.name);bind('xz',match.name);bind('_S',match.craft.name);
        if(match.craft.filtered){const description=describe(match.craft.name,'value');schema._S={...schema._S,shape:description.shape,refs:description.refs.map(([at,name])=>{if(name!==bindings.get('jobFeatureFlags'))throw Error('技能分组依赖不可验证');return [at,'jobFeatureFlags'];}),locals:[...description.locals.values()].map(row=>row.name),strict:true};}
    }
    for(const [role,expected]of Object.entries(schema))if(expected.variants&&!expected.table)invalidate(role,'游戏规则结构无法唯一识别 '+role);
    for(const [role,expected]of schemaEntries)if(expected.fields&&!expected.table){
        const name=bindings.get(role),row=definitions.get(name);
        if(!row?.expression)throw Error('精通排除物品表无法识别 '+role);
        const records=dataRecords(tokenize(row.expression));
        if(!records.length||records.some(record=>expected.fields.some(key=>!record.has(key))))throw Error('精通排除物品标识缺失 '+role);
        const rows=projectTable(row,records,expected.fields);
        if(rows.some(row=>!Number.isSafeInteger(row.itemId)||row.itemId<=0)||new Set(rows.map(row=>row.itemId)).size!==rows.length)throw Error('精通排除物品标识无效 '+role);
        dataWeight(rows);dataCache.set(name,rows);projected.set(name,rows);
    }
    for(const [role,rows]of extensions)for(const tokens of rows){
        const values=tokens.map(token=>token.value),param=values[5];
        if(values[1]!==bindings.get('fireworks')||values.slice(2,5).join(' ')!=='. map ('||tokens[5]?.type!=='name'||values.slice(6,9).join(' ')!=='=> ( {'||values.slice(-3).join(' ')!=='} ) )')throw Error('精通目录出现未知扩展 '+role);
        let fields=dataRecords([{value:'['},...tokens.slice(8,-2),{value:']'}])[0];
        if(role==='Cd')fields=dataRecords([{value:'['},...(fields.get('output')||[]),{value:']'}])[0];
        const id=fields?.get(role==='Cd'?'itemId':'id');
        if(id?.map(token=>token.value).join(' ')!==param+' . itemId')throw Error('精通目录扩展物品标识已变化 '+role);
    }
    const verify=(role,visited=new Set())=>{
        if(visited.has(role))return true;
        visited.add(role);
        if(invalid.has(role))throw Error(invalid.get(role));
        if(projectionErrors.has(bindings.get(role)))throw Error(projectionErrors.get(bindings.get(role))+' '+role);
        if(!dataRoles.has(role)&&(!schema[role]||!bindings.has(role)))throw Error('无法自动识别游戏数据依赖 '+role);
        const selected=schema[role];
        for(const dependency of new Set([...(selected?.refs||[]).map(([,name])=>name),...(selected?.links||[]).map(([name])=>name),...(selected?.requires||[])]))if(schema[dependency]?.strict){
            try{verify(dependency,visited);}catch(error){throw Error('游戏规则 '+role+' 的必要依赖 '+dependency+' 不可验证：'+String(error.message||error));}
        }
        return true;
    };
    const render=(role,part)=>{
        verify(role);
        const name=dataRoles.get(role)??bindings.get(role),expected=schema[role]??(dataRoles.has(role)?{kind:'value',locals:[]}:null);
        if(!expected)throw Error('无法自动识别游戏数据依赖 '+role);
        const row=rowFor(name,expected.kind);
        if(!row)throw Error('无法自动识别游戏数据 '+role);
        const description=describe(name,expected.kind),params=Array.isArray(row.params)?row.params.join(','):row.params,offset=part==='body'?tokenize(params).length+1:0;
        const input=part==='params'? (Array.isArray(row.params)?row.params.join(','):row.params) : part==='body'?row.body:row.kind==='binding'?row.source+'.'+row.path.join('.'):row.expression;
        if(input==null)throw Error('自动识别数据类型变化 '+role);
        const tokens=tokenize(input);let text='',previous='';const output=[],containers=[];
        for(let i=0;i<tokens.length-1;i++){const gap=input.slice(tokens[i].end,tokens[i+1].start);if(/[\r\n\u2028\u2029]/.test(gap)&&(['return','yield','throw','break','continue'].includes(tokens[i].value)&&![';','}'].includes(tokens[i+1].value)||tokens[i+1].value==='=>'||['++','--'].includes(tokens[i+1].value)))throw Error('游戏规则存在换行语义变化 '+role);}
        for(let i=0;i<tokens.length;i++) {
            const token=tokens[i];let value=token.value;
            if(token.type==='name' && !adaptiveKeyword(description.tokens,i+offset,description.scope) && !adaptiveProperty(tokens,i)){
                const local=description.localAt.get(i+offset);
                value=local!==undefined?expected.locals[local]??value:reverse.get(value)??((part==='initializer'||part==='body'&&['Da','excludedCollection'].includes(role))&&!expected.dictionary&&definitions.has(value)?dataReference(value):value);
            }
            if(value!==token.value && tokens[containers.at(-1)]?.value==='{'&&!(tokens[containers.at(-1)-3]?.value==='case'||tokens[containers.at(-1)-2]?.value==='default')&&(['=','(','[',',',':','return','const','let','var'].includes(tokens[containers.at(-1)-1]?.value)||containers.at(-1)===0&&['params','initializer'].includes(part))&&['{',','].includes(tokens[i-1]?.value)&&[',','}','='].includes(tokens[i+1]?.value))throw Error('游戏规则存在属性简写变化 '+role);
            if(value!==token.value&&part==='initializer'&&containers.at(-1)===0&&tokens[0]?.value==='{'&&tokens[i+1]?.value==='('&&['{',',','get','set','async','*'].includes(tokens[i-1]?.value))throw Error('游戏规则存在对象方法键变化 '+role);
            output.push(value);if(['(','[','{'].includes(token.value))containers.push(i);else if([')',']','}'].includes(token.value))containers.pop();
            if(/[\w$]$/.test(previous)&&/^[\w$]/.test(value))text+=' ';
            text+=value;previous=value;
        }
        const verified=tokenize(text);if(verified.length!==output.length||verified.some((token,index)=>token.value!==output[index]))throw Error('游戏规则分词语义变化 '+role);
        return text;
    };
    const reviewed=role=>{
        verify(role);
        const rule=schema[role],name=bindings.get(role);
        if(!rule?.strict||!Array.isArray(rule.numbers)||!name)return false;
        const actual=describe(name,rule.kind);
        return actual.kind===rule.kind&&actual.shape===rule.shape&&actual.numbers===rule.numbers.join(',')&&compatible(role,name,rule);
    };
    const gearFields=['itemId','slot','luck','offhand'],gearActive=new Set();
    const projectedGear=name=>{
        if(projected.has(name))return projected.get(name);
        if(gearActive.has(name)||gearActive.size>16)throw Error('装备目录存在循环或嵌套过深');
        const role=reverse.get(name),row=definitions.get(name);
        if(!row||row.kind!=='const'||!role||!reviewed(role))throw Error('装备目录关联未通过校验');
        gearActive.add(name);
        try{
            const tokens=tokenize(row.expression),values=tokens.map(token=>token.value);let rows;
            if(values[0]==='['&&values.at(-1)===']'){
                if(values.slice(1,-1).some((value,at)=>at%3===0?value!=='...':at%3===1?tokens[at+1].type!=='name':value!==','))throw Error('装备聚合目录结构变化');
                rows=[];for(let at=1;at<tokens.length-1;at+=3)rows.push(...projectedGear(tokens[at+1].value));
            }else{
                if(values[1]!=='.'||values[2]!=='map'||values[3]!=='('||tokens[0].type!=='name'||tokens[4].type!=='name'||values[5]!=='=>'||values[6]!=='('||values[7]!=='{'||values.slice(-3).join(' ')!=='} ) )')throw Error('装备映射目录结构变化');
                const fields=[],start=8;let from=start,depth=0;
                for(let at=start;at<=tokens.length-3;at++){
                    const value=values[at];
                    if(!depth&&(value===','||at===tokens.length-3)){
                        const part=tokens.slice(from,at);if(part.length&&(part[0].value==='...'||gearFields.includes(part[0].value)&&part[1]?.value===':'))fields.push(part.map(token=>token.value).join(' '));from=at+1;
                    }
                    if(['(','[','{'].includes(value))depth++;else if([')',']','}'].includes(value))depth--;
                }
                rows=staticData(tokens[0].value+'.map('+tokens[4].value+'=>({'+fields.join(',')+'}))');
            }
            if(!Array.isArray(rows)||rows.some(row=>!Number.isSafeInteger(row?.itemId)||row.itemId<=0||typeof row.slot!=='string'||!row.slot||row.offhand&&(typeof row.offhand.skill!=='string'||!Number.isFinite(row.offhand.lift)||row.offhand.lift<0))||new Set(rows.map(row=>row.itemId)).size!==rows.length)throw Error('装备精通字段无效');
            rows=rows.map(row=>Object.fromEntries(gearFields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])));
            dataWeight(rows);dataCache.set(name,rows);projected.set(name,rows);return rows;
        }finally{gearActive.delete(name);}
    };
        const featureFlags=()=>{
        const owner=definitions.get(bindings.get('jobFeatureFlags'));
        if(!owner||owner.kind!=='const')throw Error('游戏功能开关无法验证');
        const expression=tokenize(owner.expression).map(token=>token.value).join('');
        const ownerTokens=tokenize(owner.expression);let nesting=0,callEnd=-1;
        if(ownerTokens.slice(0,4).map(token=>token.value).join('')!=='Object.freeze(')throw Error('游戏功能开关包装无效');
        for(let at=3;at<ownerTokens.length;at++){if(ownerTokens[at].value==='(')nesting++;else if(ownerTokens[at].value===')'&&--nesting===0){callEnd=at;break;}}
        if(callEnd!==ownerTokens.length-1)throw Error('游戏功能开关存在额外运算');
        const match=/^Object\.freeze\(typeof([A-Za-z_$][\w$]*)<"u"&&\1!==void0\?\{([^{}]+)\}:/.exec(expression);
        if(!match)throw Error('游戏功能开关来源无法验证');
        const name=match[1],row=definitions.get(name);
        if(!row||!['const','var'].includes(row.kind)||!row.expression||row.expression.length>2000)throw Error('游戏功能开关不是静态数据');
        const flags=parseExpression(row.expression,()=>{throw Error('游戏功能开关依赖动态数据');});
        if(!flags||typeof flags!=='object'||Array.isArray(flags))throw Error('游戏功能开关数据无效');
        const declarations=[...definitions.values()].sort((a,b)=>a.start-b.start),localReferences=new Map();
        const shadowed=token=>{
            let low=0,high=declarations.length;
            while(low<high){const mid=(low+high)>>>1;if(declarations[mid].start<=token.start)low=mid+1;else high=mid;}
            const declaration=declarations[low-1];
            if(!declaration||token.end>declaration.end)return false;
            if(!localReferences.has(declaration)){
                const tokens=tokenize(source,declaration.start,declaration.end),scope=adaptiveBindings(tokens);
                localReferences.set(declaration,new Set(tokens.filter((entry,index)=>entry.type==='name'&&entry.value===name&&scope.locals.has(index)).map(entry=>entry.start)));
            }
            return localReferences.get(declaration).has(token.start);
        };
        const reader=scanner(source);let token,previous=null;
        while((token=reader.next())){
            if(token.type==='name'&&token.value===name&&!(token.start>=owner.start&&token.end<=owner.end)&&!(token.start>=row.start&&token.end<=row.end)&&!['.','?.'].includes(previous?.value)){
                const next=reader.next();
                if(!(next?.value===':'&&['{',','].includes(previous?.value))&&!shadowed(token))throw Error('游戏功能开关存在其他引用');
                previous=next;
            }else previous=token;
        }
        const result={};
        for(const entry of match[2].split(',')){
            const field=/^([A-Za-z_$][\w$]*):([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)===!0$/.exec(entry);
            if(!field||field[2]!==name||field[1]!==field[3]||forbidden.has(field[1])||typeof flags[field[1]]!=='boolean')throw Error('游戏功能开关投影无效');
            result[field[1]]=flags[field[1]];
        }
        return result;
    };
    return {aliases:Object.fromEntries(bindings),metadata,verify,featureFlags,reviewed,upgradeClockVerified,data:role=>{verify(role);return readData(dataRoles.get(role)??bindings.get(role));},records:name=>{verify(name);return name==='aH'&&reviewed(name)?projectedGear(bindings.get(name)):projected.get(bindings.get(name));},initializer:name=>render(name,'initializer'),body:name=>({params:render(name,'params').split(',').filter(Boolean),text:render(name,'body')}),diagnostics:{definitions:definitions.size,roles:bindings.size,invalid:Object.fromEntries(invalid)}};
}
return adaptGameSource;
})();
    function extractVerifiedGameData(source,meta,adapted){
        if(typeof source!=='string'||source.length<100000||source.length>12000000)fail('源文件大小无效');
        const cache=new Map(),active=new Set(),calls={};
        const capabilities=Object.fromEntries(['work','farming','combat','enhancing','upgrades','quality'].map(key=>[key,{available:true,reason:''}]));
        const labels={work:'采集与制造',farming:'农耕',combat:'战斗掉落',enhancing:'强化',upgrades:'装备升级',quality:'品质与幸运加成'};
        const validationIssues=[];
        const unavailable=(key,error)=>{
            capabilities[key]={available:false,reason:labels[key]+'的当前数据或计算规则未通过校验，已暂停相关推荐。'};
            validationIssues.push({feature:key,detail:String(error.message||error).slice(0,300)});
        };
        const attempt=(key,run,fallback=null)=>{try{return run();}catch(error){unavailable(key,error);return fallback;}};
        const initializer=name=>adapted.initializer(name);
        const read=name=>{
            if(cache.has(name))return cache.get(name);
            if(active.has(name))fail(`循环常量 ${name}`);
            active.add(name);
            try{const value=adapted.records(name)??(adapted.data?adapted.data(name):parseExpression(initializer(name),read,calls));cache.set(name,value);return value;}
            finally{active.delete(name);}
        };
        const body=name=>adapted.body(name);
        const requirePattern=(name,pattern)=>{const text=body(name).text;if(!pattern.test(text))fail(`函数 ${name} 的规则结构已变化`);return text;};
        const verifyRule=(name,pattern)=>adapted.reviewed?.(name)===true?body(name).text:requirePattern(name,pattern);
        for(const name of ['cn']){
            let params,text;
            if(name==='cn'){const fn=body(name),match=/^return([\s\S]*?);?$/.exec(fn.text);if(!match)fail('配方构造器结构变化');params=fn.params;text=match[1];}
            else {const match=/^([A-Za-z_$][\w$]*)=>([\s\S]+)$/.exec(initializer(name));if(!match)fail('升级材料构造器结构变化');params=[match[1]];text=match[2];}
            calls[name]=(...args)=>{if(args.length!==params.length)fail('构造器参数变化');return parseExpression(text,read,calls,Object.fromEntries(params.map((p,i)=>[p,args[i]])));};
        }
        const exact=(name,expected)=>{if(initializer(name)!==expected)fail(`数据组合 ${name} 已变化`);};
        const activeJobs=initializer('xo');
        const retiredSource=read('HD');
        if(!(retiredSource instanceof Set))fail('任务排除集合无效');
        const retiredJobs=new Set(retiredSource);
        let featureFlags=null;
        if(activeJobs==='Cd.filter(c=>!retiredJob(c.id))'){
            requirePattern('retiredJob',/^return HD\.has\(c\)\|\|!jobFeatureFlags\.alchemy&&gatedAlchemyJobs\.has\(c\)$/);
            const gated=read('gatedAlchemyJobs');
            if(!(gated instanceof Set)||[...gated].some(id=>!Number.isSafeInteger(id)||id<=0))fail('可选任务集合无效');
            featureFlags=adapted.featureFlags();
            if(typeof featureFlags.alchemy!=='boolean')fail('可选任务开关无效');
            if(!featureFlags.alchemy)for(const id of gated)retiredJobs.add(id);
            else for(const key of ['work','farming'])unavailable(key,'炼金产出规则需要独立校验');
        }else exact('xo','Cd.filter(c=>!HD.has(c.id))');
        let upgradeValuesVerified=false;
        try{
            exact('dH','[...Az,...c6]');
            exact('c6','gO.map(c=>{const o=e=>Az.find(a=>a.id===e).value;return{id:c.id,name:c.name,stackable:!1,value:o(c.from)+c.extra.reduce((e,a)=>e+o(a.itemId)*a.qty,0)}})');
            upgradeValuesVerified=true;
        }catch{}
        const allJobs=read('Cd'),jobs=allJobs.filter(job=>!retiredJobs.has(job.id)),upgrades=[...read('gO'),...read('JD')],toolUpgrades=[];
        const baseItems=read('Az'),baseMap=new Map(baseItems.map(item=>[item.id,item]));
        const burntItems=[...new Set(allJobs.filter(job=>job.burn).map(job=>job.burn.itemId))];
        if(burntItems.some(id=>!baseMap.has(id)))fail('烧焦物品引用无效');
        const extended=read('gO').map(item=>({id:item.id,name:item.name,stackable:false,value:upgradeValuesVerified?baseMap.get(item.from).value+item.extra.reduce((sum,row)=>sum+baseMap.get(row.itemId).value*row.qty,0):0}));
        const farmSeeds=allJobs.filter(job=>job.grow!==undefined).map(job=>job.inputs[0].itemId),drops=read('wt').map(monster=>monster.drop);
        const itemSet=name=>{
            const expressions=new Map([
                ['Cd.map(c=>c.output.itemId).filter(c=>c!==Aa)',allJobs.map(job=>job.output.itemId).filter(id=>id!==read('Aa'))],
                ['Cd.map(c=>c.output.itemId)',allJobs.map(job=>job.output.itemId)],
                ['xo.map(c=>c.output.itemId)',jobs.map(job=>job.output.itemId)],
                ['Cd.filter(c=>c.grow!==void 0).map(c=>c.inputs[0].itemId)',farmSeeds],
                ['wt.map(c=>c.drop)',drops],['gO.map(c=>c.id)',read('gO').map(item=>item.id)]
            ]);
            const project=text=>{
                for(const [expression,values]of expressions)text=text.split(expression).join(JSON.stringify(values));
                text=text.replace(/Cd\.filter\(([A-Za-z_$][\w$]*)=>\1\.grow!==void 0\)\.map\(([A-Za-z_$][\w$]*)=>\2\.inputs\[0\]\.itemId\)/g,JSON.stringify(farmSeeds));
                return text.replace(/([A-Za-z_$][\w$]*)\.map\(c=>c\.(id|itemId)\)/g,(_,symbol,key)=>{
                    const rows=read(symbol);
                    if(!Array.isArray(rows)||rows.some(row=>!Number.isSafeInteger(row[key])||row[key]<=0))fail('物品分类映射无效');
                    return JSON.stringify(rows.map(row=>row[key]));
                });
            };
            const value=parseExpression(project(initializer(name)),symbol=>symbol==='wz'?parseExpression(project(initializer(symbol)),read,calls):read(symbol),calls);
            const ids=new Set([...baseItems,...extended].map(item=>item.id));
            if(!(value instanceof Set)||!value.size||[...value].some(id=>!Number.isSafeInteger(id)||!ids.has(id)))fail('物品分类引用无效');
            return value;
        };
        const rarityable=itemSet('Rz'),qualityIds=itemSet('$D');
        const tools=new Map(read('oH').map(tool=>[tool.itemId,tool]));
        const gearRows=adapted.records('aH')??read('yz');
        const gear=new Map(gearRows.map(item=>[item.itemId,item]));
        const equipmentRules=attempt('quality',()=>{
        const gearQualityIds=itemSet('ED');
        if([...gear.values()].some(item=>rarityable.has(item.itemId)&&!gearQualityIds.has(item.itemId)))fail('装备品质目录与物品分类不一致');
        exact('LS','[...aH,...aH.filter(c=>ED.has(c.itemId)).flatMap(XD)]');
        exact('JS','new Map(LS.map(c=>[c.itemId,c]))');
        verifyRule('I1',/^return Ju\[jo\(c\)\]$/);
        requirePattern('_l',/^return c\.amulet===null\?0:Vc\(c\.amulet\)\?\.luck\?\?0$/);
        requirePattern('Vc',/^const o=JS\.get\(c\);return o\|\|\(Yo\(c\)>=1\?_D\(c\):void 0\)$/);
        verifyRule('XD',/^const o=\[\];for\(const e of\[1,2,3,4\]\)\{const a=Xl\[e\];o\.push\(\{\.\.\.c,itemId:Pc\(c\.itemId,e\),\.\.\.c\.luck!==void 0\?\{luck:c\.luck\*a\}:\{\}\}\)\}return o$/);
        verifyRule('_D',/^const o=tH\.get\(c\);if\(o\)return o;const e=JS\.get\(Jc\(c\)\);if\(!e\)return;const a=1\+ar\*Yo\(c\),t=\{\.\.\.e,itemId:c,\.\.\.e\.luck!==void 0\?\{luck:e\.luck\*a\}:\{\}\};return tH\.set\(c,t\),t$/);
        requirePattern('VC',/^const o=\{\};for\(const\[e,a\]of LC\)\{const t=c\.equipment\[e\];o\[a\]=t==null\?0:I1\(t\)\}return\{amulet:_l\(c\.equipment\),tools:o\}$/);
            let toolPlusPerLevel;
            if(adapted.reviewed?.('_D')===true){
                featureFlags??=adapted.featureFlags();
                const scale=initializer('gearEnhanceScale').match(/^jobFeatureFlags\.enhanceRedesign\?([\s\S]+)\.statPerPlus:([\d.e+-]+)$/);
                if(!scale)fail('装备强化倍率无法校验');
                toolPlusPerLevel=featureFlags.enhanceRedesign?adapted.data('enhanceRedesignRules').statPerPlus:Number(scale[2]);
                if(!Number.isFinite(toolPlusPerLevel)||toolPlusPerLevel<0)fail('装备强化倍率无效');
            }else toolPlusPerLevel=read('ar');
            const extra={};
            if(adapted.reviewed?.('I1')===true){
                const ids=adapted.data('bossLuckToolIds'),bonus=adapted.data('bossToolLuck');
                if(!(ids instanceof Set)||!Number.isFinite(bonus)||bonus<0||[...ids].some(id=>!baseMap.has(id)))fail('特殊工具幸运加成引用无效');
                extra.toolLuckBonuses=Object.fromEntries([...ids].map(id=>[id,bonus]));
            }
            if(adapted.reviewed?.('aF')===true){
                body('offhandWorkBonus');
                extra.offhandEnabled=true;
                const free=adapted.data('freeInputSkills');
                if(!free||typeof free!=='object'||Array.isArray(free)||Object.entries(free).some(([id,skill])=>!baseMap.has(Number(id))||typeof skill!=='string'))fail('工具材料消耗映射无效');
                extra.freeInputToolSkills=free;
            }
            return {toolRarityMultipliers:read('Xl'),toolLuckByRarity:read('Ju'),toolPlusPerLevel,...extra};
        },{});
        attempt('enhancing',()=>{for(const upgrade of read('gO')){const prior=gear.get(upgrade.from);if(!prior)fail('升级装备基础条目缺失');gear.set(upgrade.id,{...prior,itemId:upgrade.id});}});
        const metadata=adapted.metadata();
        const translate=name=>metadata.translations.get(name)??name;
        const rarityStride=read('$d'),plusStride=read('TS');
        const hiddenItems=new Set(read('YD'));
        const hiddenRule=body('ff').text;
        if(hiddenRule==='return YD.has(c%1e3)||!jobFeatureFlags.alchemy&&gatedAlchemyItems.has(c%1e3)'){
            featureFlags??=adapted.featureFlags();
            const gated=read('gatedAlchemyItems');
            if(!(gated instanceof Set)||[...gated].some(id=>!Number.isSafeInteger(id)||id<=0))fail('可选物品集合无效');
            if(!featureFlags.alchemy)for(const id of gated)hiddenItems.add(id);
        }else requirePattern('ff',/^return YD\.has\(c%1e3\)$/);
        if(rarityStride!==parseExpression('1e3',read,calls))fail('物品编码关系变化');
        const pdBody=requirePattern('PD',/^return[\s\S]+$/),pdExpression=pdBody.slice('return'.length);
        const isGem=id=>parseExpression(pdExpression,read,calls,{c:id});
        const constant='(?:[A-Za-z_$][\\w$]*|[\\d.e+]+)';
        const petPattern=new RegExp('^const o=go\\(c\\);return o>=('+constant+')&&o<\\1\\+('+constant+')\\|\\|o>=('+constant+')&&o<\\3\\+('+constant+')\\|\\|dx\\(o\\)((?:\\|\\|o==='+constant+')*)$');
        const petRule=requirePattern('Da',petPattern).match(petPattern);
        const petRanges=petRule.slice(1,5).map(value=>parseExpression(value,read,calls));
        if(petRanges.some(value=>!Number.isSafeInteger(value)||value<=0)||petRanges[0]+petRanges[1]>rarityStride||petRanges[2]+petRanges[3]>rarityStride)fail('宠物物品范围无效');
        const additionalIds=(tail,prefix)=>[...new Set(tail.split(prefix).slice(1).map(value=>{
            const id=parseExpression(value,read,calls);
            if(!Number.isSafeInteger(id)||id<=0||id>=rarityStride||!baseMap.has(id))fail('新增精通物品标识无效');
            return id;
        }))];
        const extraPetIds=new Set(additionalIds(petRule[5],'||o==='));
        const petBody=requirePattern('dx',/^const o=go\(c\);return o>=[\d.e+]+&&o<=[\d.e+]+$/),petExpression=petBody.slice(petBody.indexOf('return')+'return'.length);
        const pet=id=>id>=petRanges[0]&&id<petRanges[0]+petRanges[1]||id>=petRanges[2]&&id<petRanges[2]+petRanges[3]||parseExpression(petExpression,read,calls,{o:id})||extraPetIds.has(id);
        let marketExcluded=null;
        try{
            requirePattern('Ce',/^const o=Ho\(c\);return o\.id!==Aa&&\(o\.value>0\|\|o\.id===ZD\|\|fireworkIds\.has\(go\(o\.id\)\)\)&&!Hj\.has\(o\.id\)&&!ff\(o\.id\)$/);
            marketExcluded=read('Hj');
            if(!(marketExcluded instanceof Set))marketExcluded=null;
        }catch{}
        exact('fireworkIds','new Set(fireworks.map(c=>c.itemId))');
        attempt('enhancing',()=>{
            verifyRule('Bt',/^const o=Jc\(c\);return JS\.has\(o\)\|\|rs\(o\)!==void 0$/);
            requirePattern('rs',/^const o=vz\.get\(c\);return o\|\|\(Yo\(c\)>=1\?UD\(c\):void 0\)$/);
            verifyRule('BS',/^const o=rs\(c\);if\(!o\|\|o\.slot==="mount"\)return null;const e=xo\.find\(a=>a\.output\.itemId===go\(c\)\);return\{skill:Wr\[o\.slot\],level:e\?\.levelReq\?\?1\}$/);
        });
        for(const key of ['work','farming'])attempt(key,()=>requirePattern('rs',/^const o=vz\.get\(c\);return o\|\|\(Yo\(c\)>=1\?UD\(c\):void 0\)$/));
        const tiers=attempt('enhancing',()=>{
        requirePattern('P4',/^const o=Jq\(go\(c\)\);if\(o===void 0\)return Lq;let e=1;for\(const a of Yw\)o>=a&&e\+\+;return e$/);
        verifyRule('Jq',/^const o=xo\.find\(e=>e\.output\.itemId===c\);return o\?o\.levelReq:Nd\.find\(e=>e\.to\.includes\(c\)\)\?\.levelReq$/);
        const tierThresholds=read('Yw'),defaultTier=read('Lq');
            return {thresholds:tierThresholds,defaultTier};
        });
        const tierThresholds=tiers?.thresholds,defaultTier=tiers?.defaultTier;
        const nonEnhanceable=attempt('enhancing',()=>adapted.reviewed?.('Bt')===true?adapted.data('nonEnhanceableIds'):new Set(),new Set());
        if(!(nonEnhanceable instanceof Set))fail('不可强化物品集合无效');
        const modernToolLevels=attempt('work',()=>adapted.reviewed?.('BS')===true?{sources:adapted.data('toolTierSources'),level:read('toolUpgradeLevelRequirement')}:null);
        const tier=id=>{
            if(tiers&&adapted.reviewed?.('Jq')===true){
                const sources=adapted.data('toolTierSources'),seen=new Set();
                while(Object.hasOwn(sources,id)){if(seen.has(id))fail('装备阶级继承循环');seen.add(id);id=sources[id];}
            }
            const level=jobs.find(job=>job.output.itemId===id)?.levelReq??upgrades.find(row=>row.id===id)?.make;
            return !tiers?null:level===undefined?defaultTier:1+tierThresholds.filter(value=>level>=value).length;
        };
        const translatedItems=[...baseItems,...extended].filter(item=>!hiddenItems.has(item.id%rarityStride)).map(item=>{
            const tool=tools.get(item.id),slot=gear.get(item.id)?.slot??tool?.slot??null,enhanceable=(gear.has(item.id)||!!tool)&&!nonEnhanceable.has(item.id);
            const row={...item,nameZh:translate(item.name),rarityable:rarityable.has(item.id),enhanceable,enhanceTier:enhanceable?tier(item.id):null,slot,pet:pet(item.id),marketTradable:marketExcluded!==null&&item.id!==read('Aa')&&(item.value>0||item.id===read('ZD'))&&!marketExcluded.has(item.id)};
            if(tool&&tool.slot!=='mount')row.tool={skill:read('Wr')[tool.slot],levelReq:modernToolLevels&&Object.hasOwn(modernToolLevels.sources,item.id)?modernToolLevels.level:jobs.find(job=>job.output.itemId===item.id)?.levelReq??1,baseBonus:tool.bonus};
            if(gear.get(item.id)?.luck!==undefined)row.baseLuck=gear.get(item.id).luck;
            if(gear.get(item.id)?.offhand!==undefined)row.offhand=gear.get(item.id).offhand;
            return row;
        });
        const xp=read('GD');
        exact('qS','(()=>{const c=[0,0];for(let a=2;a<=Mu;a++)c[a]=Math.round(vD*(Z2**(a-1)-1)/(Z2-1));let o=c[Mu]*wD,e=c[Mu];for(let a=Mu+1;e+=o,!(e>Number.MAX_SAFE_INTEGER);a++)c[a]=Math.round(e),o*=yD;return c})()');
        const levelThresholds=[0,0];
        for(let level=2;level<=xp.journeyLevel;level++)levelThresholds[level]=Math.round(xp.baseXp*(xp.growth**(level-1)-1)/(xp.growth-1));
        let step=levelThresholds[xp.journeyLevel]*xp.beyondStep,total=levelThresholds[xp.journeyLevel];
        for(let level=xp.journeyLevel+1;level<10000;level++){total+=step;if(total>Number.MAX_SAFE_INTEGER)break;levelThresholds[level]=Math.round(total);step*=xp.beyondGrowth;}
        const quick=attempt('work',()=>{
        if(adapted.reviewed?.('aF')===true){const match=/a=1\+([\d.e+-]+)\*c\.perks\.quick,/.exec(body('aF').text);if(!match)fail('快捷天赋数值无法验证');return Number(match[1]);}
        const quickPattern=/^const e=k9\(c,o\),a=1\+([\d.e+-]+)\*c\.perks\.quick,t=Zx\(c,o\),s=pf\.includes\(o\)\?ga\(c\.masteries,"gather"\):ga\(c\.masteries,"craft"\);return\{tool:e,quick:a,home:t,mastery:s,combined:e\*pa\(a,t\)\*s\}$/;
        const quick=Number(requirePattern('aF',quickPattern).match(quickPattern)[1]);
            return quick;
        });
        const farmYieldRules=attempt('farming',()=>{
            body('fF');
        requirePattern('farmBaseYield',/^return farmYieldBase\+farmYieldThresholds\.filter\(o=>c>=o\)\.length$/);
        requirePattern('farmToolYield',/^const e=c\*farmToolYieldRate;return Math\.floor\(e\)\+\(o<e%1\?1:0\)$/);
        requirePattern('Zl',/^return c===null\?0:rs\(c\)\?\.bonus\?\?0$/);
        const farmYieldRules={farmYield:{base:read('farmYieldBase'),levelThresholds:read('farmYieldThresholds'),toolMultiplier:read('farmToolYieldRate')}};
            return farmYieldRules;
        },{});
        const mastery=read('On'),masteryRate=id=>{const row=mastery.find(row=>row.id===id);if(!row)fail(`缺少精通规则 ${id}`);return row.perRank;};
        attempt('work',()=>{if(masteryRate('gather')!==masteryRate('craft'))fail('采集制造精通倍率已分离');});
        const costBody=requirePattern('pd',/^return\s*([\d.e+]+)\+([\d.e+]+)\*Math\.max\(1,Math\.floor\(c\)\)$/);
        const [,costBase,costStep]=costBody.match(/^return\s*([\d.e+]+)\+([\d.e+]+)\*/);
        const forge=attempt('enhancing',()=>{
            if(!tiers)fail('强化装备阶级不可用');
        requirePattern('II',/^const a=c\.enhance;if\(!a\)return;if\(Yo\(a\.itemId\)>=Math\.min\(a\.toPlus,mO\)\)\{yn\(c,e,"done"\);return\}if\(a\.ticks=\(a\.ticks\?\?0\)\+1,a\.ticks<Ls\)return;if\(a\.ticks=0,/);
        const modernForge=adapted.reviewed?.('Fh')===true;
        let forgeAction,forgeStrategy;
        if(modernForge){
            featureFlags??=adapted.featureFlags();
            if(featureFlags.enhanceRedesign!==false)fail('新的强化模式需要独立校验');
            for(const name of ['Qq','Fh','forgeFailurePlus','forgeCanUseCore','Ov','forgeSuccess','forgeSuccessFromBoost','forgeCombinedMultiplier','forgeBaseChance'])if(adapted.reviewed(name)!==true)fail('强化规则未通过静态校验 '+name);
            forgeAction=body('Qq').text;
            const minimum=initializer('Yt').match(/^enhanceRedesignEnabled\?enhanceRedesignRules\.protectFromMin:([\d.e+-]+)$/);
            if(!minimum)fail('强化保护等级无法验证');
            forgeStrategy={protectionItemId:read('bi'),protectionMinPlus:Number(minimum[1]),coreItemId:read('ql'),coreMinPlus:read('wf')};
        }else{
        forgeAction=requirePattern('Qq',/^const t=e\.itemId,s=Yo\(t\),d=Jc\(t\),n=([A-Za-z_$][\w$]*)\(t,e\.useCore===!0&&([A-Za-z_$][\w$]*)\(c,t\)\);/);
        const [,forgeCostFunction,coreCheckFunction]=forgeAction.match(/^const t=e\.itemId,s=Yo\(t\),d=Jc\(t\),n=([A-Za-z_$][\w$]*)\(t,e\.useCore===!0&&([A-Za-z_$][\w$]*)\(c,t\)\);/);
        const forgeCostBody=requirePattern(forgeCostFunction,/^const e=Yo\(c\),a=bb\[P4\(c\)-1\]\*Wu\[jo\(c\)\],t=o&&e>=([A-Za-z_$][\w$]*)\?1:0;return\{gold:a\*\(e\+1\),shards:t\?0:Hw\*\(e\+1\),core:t\}$/);
        const coreMinSymbol=forgeCostBody.match(/t=o&&e>=([A-Za-z_$][\w$]*)\?1:0/)[1];
        const coreCheckBody=requirePattern(coreCheckFunction,new RegExp('^return Yo\\(o\\)>='+escape(coreMinSymbol)+'&&([A-Za-z_$][\\w$]*)\\(c\\)>0$'));
        const coreCountFunction=coreCheckBody.match(/&&([A-Za-z_$][\w$]*)\(c\)>0$/)[1];
        const coreCountBody=requirePattern(coreCountFunction,/^return ([A-Za-z_$][\w$]*)\(c,([A-Za-z_$][\w$]*)\)\+c\.pack\.filter\((?<row>[A-Za-z_$][\w$]*)=>\k<row>\.itemId===\2\)\.reduce\(\((?<sum>[A-Za-z_$][\w$]*),(?<entry>[A-Za-z_$][\w$]*)\)=>\k<sum>\+\k<entry>\.qty,0\)$/);
        const [,bankCountFunction,coreItemSymbol]=coreCountBody.match(/^return ([A-Za-z_$][\w$]*)\(c,([A-Za-z_$][\w$]*)\)/);
        requirePattern(bankCountFunction,/^return c\.bank\[o\]\?\?0$/);
        const protection=forgeAction.match(/f=![A-Za-z_$][\w$]*&&e\.protectFrom!==void 0&&s>=Math\.max\(([A-Za-z_$][\w$]*),e\.protectFrom\)&&([A-Za-z_$][\w$]*)\(c\)>0;f&&([A-Za-z_$][\w$]*)\(c,([A-Za-z_$][\w$]*),1\);/);
        if(!protection)fail('强化保护消耗规则已变化');
        const [,protectionMinSymbol,protectionCountFunction,,protectionItemSymbol]=protection;
        requirePattern(protectionCountFunction,new RegExp('^return [A-Za-z_$][\\w$]*\\(c,'+escape(protectionItemSymbol)+'\\)$'));
        if(!/v=[A-Za-z_$][\w$]*\?as\(d,s\+1\):f\?as\(d,s-1\):d;e\.itemId=v;/.test(forgeAction))fail('强化失败回退规则已变化');
        forgeStrategy={protectionItemId:read(protectionItemSymbol),protectionMinPlus:read(protectionMinSymbol),coreItemId:read(coreItemSymbol),coreMinPlus:read(coreMinSymbol)};
        }
        const forge={maxPlusScored:read('vj'),maxPlus:read('mO'),loggedMaxPlus:read('Ns'),stepWeights:read('pj'),tierWeights:read('gj'),rarityWeights:read('bj'),divisor:read('Oj'),minPoints:read('Gj'),tierLevelThresholds:tierThresholds,defaultTier,maxTotalPoints:0,baseSuccessReductionPerPlus:read('Sw'),minBaseSuccess:read('kw'),successTail:null,houseBonusEnabled:true,shardsPerPlus:read('gj').map(()=>read('Hw')),shardItemId:read('Ud'),attemptTicks:read('Ls'),goldTierWeights:read('bb'),goldRarityWeights:read('Wu'),successBonusPerSkillLevel:read('ir'),maxMasteryMultiplier:1+read('yK'),...forgeStrategy};
        verifyRule('forgeBaseChance',/^return Math\.max\(kw,1-c\*Sw\)$/);
        verifyRule('forgeSuccess',/^return Math\.min\(1,forgeBaseChance\(o\)\*\(1\+forgeHouseBonus\(c\)\)\*forgeSkillMultiplier\(c\)\*forgeMasteryMultiplier\(c\)\)$/);
        requirePattern('forgeSkillMultiplier',/^return 1\+ir\*\(\$o\(c\.skills\.enhancing\)-1\)$/);
        requirePattern('forgeMasteryMultiplier',/^return Math\.min\(1\+yK,ga\(c\.masteries,"enhance"\)\)$/);
        verifyRule('forgeHouseBonus',/^if\(!zh\(c\)\)return 0;let o=0;for\(const e of je\)e\.bonus\.kind==="enhanceChance"&&gt\(c,e\.id\)&&\(o\+=qn\(e,Qe\(c,e\.id\)\)\);return o$/);
        requirePattern('gt',/^return c\.houseFurniture\[o\]!==void 0$/);
        requirePattern('zh',/^for\(const o in c\.houseFurniture\)return!0;return!1$/);
        if(read('je').filter(room=>!room.retired&&room.bonus?.kind==='enhanceChance').length!==1)fail('强化家园加成来源已变化');
        if(!modernForge&&!/u!==null&&u<forgeSuccess\(c,s\)/.test(forgeAction))fail('强化最终成功率调用已变化');
        requirePattern('Sr',/^if\(e>vj\)return 0;const a=pj\[e-1\],t=gj\[c-1\],s=bj\[o\];return a===void 0\|\|t===void 0\|\|s===void 0\?0:Math\.max\(Gj,Math\.round\(t\*s\*a\/Oj\)\)$/);
        for(const tierWeight of forge.tierWeights)for(const rarityWeight of forge.rarityWeights)for(const stepWeight of forge.stepWeights.slice(0,forge.maxPlusScored))forge.maxTotalPoints+=Math.max(forge.minPoints,Math.round(tierWeight*rarityWeight*stepWeight/forge.divisor));
            requirePattern('Hn',/^return fj\(c\.collections\)\+uw\(c\.forgeLog\)$/);
            return forge;
        });
        const skills=read('Bc'),skillNames=read('xz'),rarityNames=read('Se');
        const hands=attempt('work',()=>{
        const handsBody=requirePattern('H9',/\*\(1-([\d.e+-]+)\*o\.perks\.hands\)/),handsPerRank=Number(handsBody.match(/\*\(1-([\d.e+-]+)\*o\.perks\.hands\)/)[1]);
        const caughtHands=requirePattern('eF',/\*\(1-([\d.e+-]+)\*o\.perks\.hands\)/).match(/\*\(1-([\d.e+-]+)\*o\.perks\.hands\)/)[1];
        if(handsPerRank!==Number(caughtHands))fail('烧焦与被抓的灵巧规则已分离');
        const handsRows=read('rp');
        if(handsRows.length!==1||handsRows[0].id!=='hands'||!Number.isSafeInteger(handsRows[0].ranks)||handsRows[0].ranks<=0||handsRows[0].ranks*handsPerRank>1)fail('灵巧天赋上限无效');
            return {handsPerRank,maxHandsRank:handsRows[0].ranks};
        },{});
        const skillRooms={},skillRoomRates={};
        for(const room of read('je')){
            const skill=room.bonus?.kind==='enhanceChance'?'enhancing':room.bonus?.skill;
            if(!room.retired&&skill&&['gatherSpeed','craftSpeed','enhanceChance'].includes(room.bonus.kind)){skillRooms[skill]=room.id;skillRoomRates[skill]=room.rate??1;}
        }
        const skillToolSlots=Object.fromEntries(Object.entries(read('Wr')).map(([slot,skill])=>[skill,slot]));
        const luckToolSlots=attempt('quality',()=>{
            const luckTools=read('LC');
            if(!Array.isArray(luckTools)||luckTools.some(row=>!Array.isArray(row)||typeof row[0]!=='string'||typeof row[1]!=='string'||skillToolSlots[row[1]]!==row[0])||new Set(luckTools.map(row=>row[1])).size!==luckTools.length)fail('幸运工具与技能映射已变化');
            return {...Object.fromEntries(luckTools.map(([slot,skill])=>[skill,slot])),farming:'hoe'};
        },{});
        const craftInitializer=initializer('_S');
        const craftMatch=/^(\[[\s\S]*\])\.filter\(([A-Za-z_$][\w$]*)=>\2!=="alchemy"\|\|jobFeatureFlags\.alchemy\)$/.exec(craftInitializer);
        const craftSkills=craftMatch?parseExpression(craftMatch[1],read,calls).filter(skill=>skill!=='alchemy'||(featureFlags??=adapted.featureFlags()).alchemy):read('_S');
        const skillGroups={gather:read('pf'),craft:craftSkills,combat:read('QS')};
        const skillMasteries=Object.fromEntries([...skillGroups.gather.map(skill=>[skill,'gather']),...skillGroups.craft.map(skill=>[skill,'craft'])]);
        const chances=attempt('quality',()=>read('md'),{});
        const requireSnippet=(name,snippet)=>requirePattern(name,new RegExp(escape(snippet)));
        attempt('quality',()=>requirePattern('bf',/^return Rz\.has\(c\)$/));
        attempt('work',()=>{
            requirePattern('Nm',/^return yt\(c\)!==null$/);
            requirePattern('yt',/^const o=go\(c\);return xo\.find\(e=>e\.grow!==void 0&&e\.inputs\[0\]\?\.itemId===o\)\?\?null$/);
        });
        attempt('farming',()=>requirePattern('yt',/^const o=go\(c\);return xo\.find\(e=>e\.grow!==void 0&&e\.inputs\[0\]\?\.itemId===o\)\?\?null$/));
        attempt('quality',()=>{
        if(body('vm').params.join(',')!=='c,o,e=1,a=md')fail('品质随机表默认参数已变化');
        requirePattern('vm',/^const t=\(1\+o\)\*e;return c<a\.legendary\*t\?4:c<a\.epic\*t\?3:c<a\.rare\*t\?2:c<a\.uncommon\*t\?1:0$/);
        });
        attempt('work',()=>{
        if(adapted.reviewed?.('R9')===true){body('R9');return;}
        requireSnippet('R9','const d=e.burn;if(d&&Om(o.seed^v9,c.id,c.actionIndex,H9(e,c))){$a(c,d.itemId,1),t.push({kind:"burnt",itemId:d.itemId});return}const n=e.caught;if(n&&Om(o.seed^y9,c.id,c.actionIndex,eF(e,c))){c.stunUntil=a+n.stunTicks,t.push({kind:"caught",ticks:n.stunTicks});return}');
        if(jobs.some(job=>job.plain)&&!body('R9').text.includes('e.plain?0:vm('))fail('固定普通品质任务规则不兼容');
        const workBonusTail='const u=e.bonus?aa(o.seed,o.secretAt,G9,c.id,i,a):null;if(e.bonus&&u!==null&&u<e.bonus.chance){let g=e.bonus.itemId;if(bf(g)){const f=b0(c,e.skill),p=(f===null?0:I1(f))+_l(c.equipment),O=aa(o.seed,o.secretAt,S9,c.id,i,a),G=O===null?0:vm(O,p,pa(l.rarityMult,Jw(c),Bb(a,e.skill,o.hypothetical),Um(c),ga(c.masteries,"rare"))),y=Nm(g)?Math.max(1,G):G;g=Pc(g,y)}$a(c,g,1)&&t.push({kind:"bonus",itemId:g})}E4(c,o,e.skill,i,a,t)';
        requireSnippet('R9',workBonusTail.slice(0,workBonusTail.lastIndexOf('E4(')));
        });
        let combatBonusIncludesHouse=false;
        attempt('combat',()=>{
        if(adapted.reviewed?.('Mq')===true){body('Mq');combatBonusIncludesHouse=true;return;}
        requireSnippet('Mq','const i=Rq(c,o,a),h=aa(o.seed,o.secretAt,lq,c.id,s,a),r=e.dropChance===void 0?0:aa(o.seed,o.secretAt,iq,c.id,s,a);if(h!==null&&r!==null&&r<(e.dropChance??1)){const p=vm(h,_l(c.equipment),pa(i,Um(c))),O=Pc(e.drop,p);Sd(c,O,1),t.push({kind:"produced",jobId:0,itemId:O,xp:0,tier:p,wire:!0})}');
        requireSnippet('Mq','const u=(1+_l(c.equipment))*i,g=aa(o.seed,o.secretAt,rq,c.id,s,a);g!==null&&g<Math.min(1,e.bonus.chance*u)&&(Sd(c,e.bonus.itemId,1),t.push({kind:"bonus",itemId:e.bonus.itemId}))');
        });
        requirePattern('Jc',/^return c%TS$/);
        requirePattern('Pc',/^return o===0\?c:o\*\$d\+c$/);
        requirePattern('as',/^return o\*TS\+c$/);
        requirePattern('Yo',/^return Math\.floor\(c\/TS\)$/);
        requirePattern('go',/^const o=Jc\(c\);return o>=\$d\?o%\$d:o$/);
        requirePattern('jo',/^const o=Jc\(c\);return o>=\$d\?Math\.floor\(o\/\$d\):0$/);
        attempt('upgrades',()=>{
        requirePattern('bf',/^return Rz\.has\(c\)$/);
        const upgradeDirectory=initializer('Nd');
        if(upgradeDirectory!=='[...upgradeGear,...upgradeOther]'&&upgradeDirectory!=='[...upgradeGear,...upgradeOther,...upgradeTools]')fail('装备升级目录组合无法验证');
        for(const [name,table]of [['upgradeGear','gO'],['upgradeOther','JD']])exact(name,`${table}.map(c=>({id:c.recipe,name:c.name,skill:c.skill,levelReq:c.make,xp:c.xp,from:[c.from],to:[c.id],extra:c.extra}))`);
        verifyRule('recordUpgrade',/^if\(c\.collection\[e\]=1,JD\.some\(t=>t\.recipe===o\.id\)\)return;const a=Jc\(e\);c\.collections\[a\]=\(c\.collections\[a\]\?\?0\)\+1$/);
        const upgradeTargetRule=verifyRule('upgradeTarget',/^const e=c\.from\.indexOf\(go\(o\)\);if\(e<0\)return null;const a=Pc\(c\.to\[e\],jo\(o\)\),t=Yo\(o\);return t>0\?as\(a,t\):a$/);
        requirePattern('upgradeExtra',/^if\(!c\.perTier\)return\[\{itemId:c\.itemId,qty:c\.qty\}\];const e=jo\(o\);return bf\(c\.itemId\)\?\[\{itemId:Pc\(c\.itemId,e\),qty:c\.qty\}\]:\[\{itemId:c\.itemId,qty:c\.qty\*\(e\+1\)\}\]$/);
        requirePattern('upgradeInputs',/^return\{named:c\.extra\.flatMap\(e=>upgradeExtra\(e,o\)\)\}$/);
        if(upgradeDirectory==='[...upgradeGear,...upgradeOther,...upgradeTools]'){
            const rows=read('upgradeTools'),ids=new Set(translatedItems.map(item=>item.id));
            const id=value=>Number.isSafeInteger(value)&&value>0;
            if(!Array.isArray(rows)||rows.some(row=>!row||!id(row.id)||typeof row.name!=='string'||!row.name||!skills.includes(row.skill)||!id(row.levelReq)||!Number.isFinite(row.xp)||row.xp<0||!Array.isArray(row.from)||row.from.length!==1||!ids.has(row.from[0])||!Array.isArray(row.to)||row.to.length!==1||!ids.has(row.to[0])||row.startsAtZero!==undefined&&typeof row.startsAtZero!=='boolean'||!Array.isArray(row.extra)||row.extra.some(material=>!material||!ids.has(material.itemId)||!id(material.qty)||material.perTier!==undefined&&typeof material.perTier!=='boolean')))fail('工具升级配方或材料引用无效');
            const resetsEnhancement=upgradeTargetRule.includes('c.startsAtZero?0:Yo(o)');
            const additions=rows.map(row=>({id:row.to[0],name:row.name,from:row.from[0],recipe:row.id,skill:row.skill,make:row.levelReq,xp:row.xp,extra:row.extra,startsAtZero:resetsEnhancement&&row.startsAtZero===true}));
            const combined=[...upgrades,...additions];
            if(new Set(combined.map(row=>row.id)).size!==combined.length||new Set(combined.map(row=>row.recipe)).size!==combined.length)fail('工具升级目标或配方重复');
            upgrades.push(...additions);toolUpgrades.push(...additions);
        }
        });
        // Upgrade work has its own rounded tick clock and deliberately excludes offhands.
        for(const upgrade of upgrades)upgrade.baseTicks=null;
        try{
            adapted.upgradeClockVerified();
            for(const name of ['upgradeDuration','upgradeBaseTicks','upgradeTimingJob','upgradeSlowestJob','upgradeIsFarm','upgradeLevelSpeed'])body(name);
            const factor=read('upgradeDurationFactor'),levelRate=initializer('upgradeLevelSpeedRate');
            if(!Number.isFinite(factor)||factor<=0||factor>1e6||levelRate!=='GD.speedPerLevelAboveRequirement')fail('升级制作耗时倍率无效');
            for(const upgrade of upgrades){
                const accepts=job=>job.skill===upgrade.skill&&job.inputs.length>0&&job.grow===undefined;
                const goTiming=id=>(id%plusStride)%rarityStride;
                const matching=id=>jobs.find(job=>accepts(job)&&goTiming(job.output.itemId)===id);
                let reference=matching(upgrade.id)??matching(upgrade.from);
                if(!reference)for(const job of jobs)if(accepts(job)&&!job.retired&&job.levelReq<=upgrade.make&&(!reference||job.baseTicks>reference.baseTicks||job.baseTicks===reference.baseTicks&&job.levelReq>reference.levelReq))reference=job;
                const ticks=reference?Math.round(reference.baseTicks*factor):null;
                if(!Number.isSafeInteger(ticks)||ticks<=0)fail('升级制作基础耗时无效');
                upgrade.baseTicks=ticks;
            }
        }catch(error){
            for(const upgrade of upgrades)upgrade.baseTicks=null;
            validationIssues.push({feature:'upgradeTiming',detail:String(error.message||error).slice(0,300)});
        }
        requirePattern('qualityInput',/^return!PD\(c\)&&c!==WD&&\$D\.has\(c\)$/);
        requirePattern('jobQuality',/^return o===0\|\|c\.inputs\.length===0\|\|c\.inputs\.some\(e=>qualityInput\(e\.itemId\)\)\?o:0$/);
        requirePattern('jobOutput',/^return Pc\(c\.output\.itemId,jobQuality\(c,o\)\)$/);
        requirePattern('jobInputs',/^return o===0\|\|c\.inputs\.length===0\?c\.inputs:c\.inputs\.map\(e=>qualityInput\(e\.itemId\)\?\{itemId:Pc\(e\.itemId,o\),qty:e\.qty\}:e\)$/);
        exact('mj','[1]');
        verifyRule('dr',/^return c!==void 0&&Da\(c\)\?mj:ij$/);
        verifyRule('Ji',/^if\(e!==void 0&&Da\(e\)\)return c===0\?uj\*UH:0;const a=rj\[c\];return a===void 0\?0:a\*hj\[o\]\*UH$/);
        requirePattern('fj',/^let o=0;for\(const e in c\)excludedCollection\(Number\(e\)\)\|\|\(o\+=Tx\(c\[e\],jo\(Number\(e\)\),go\(Number\(e\)\)\)\);return o$/);
        const excludedPattern=new RegExp('^return fireworkIds\\.has\\(go\\(c\\)\\)((?:\\|\\|go\\(c\\)==='+constant+')*)$');
        let extraExcludedIds;
        const excludedBody=body('excludedCollection').text;
        if(excludedBody==='return fireworkIds.has(go(c))||go(c)===excludedPowder||isHomeEssence(c)||isAlchemyEssence(go(c))'){
            if(adapted.reviewed?.('excludedCollection')!==true)fail('收藏排除组合无法验证');
            body('isHomeEssence');body('isAlchemyEssence');
            extraExcludedIds=['excludedPowder','homeEssenceId','bossAlchemyEssenceId','enhanceAlchemyEssenceId','homeAlchemyEssenceId'].map(name=>read(name));
        }else{
            const excludedRule=requirePattern('excludedCollection',excludedPattern).match(excludedPattern);
            extraExcludedIds=additionalIds(excludedRule[1],'||go(c)===');
        }
        if(adapted.reviewed?.('Ji')===true){
            const noScore=adapted.data('noScoreItemIds');
            if(!(noScore instanceof Set)||[...noScore].some(id=>!Number.isSafeInteger(id)||!baseMap.has(id)))fail('收藏免分物品引用无效');
            extraExcludedIds.push(...noScore);
        }
        const firstOnlyRewards={},minimumRarity={};
        if(body('Ji').text.includes('firstCollectionPoints(')!==body('dr').text.includes('firstCollectionPoints('))fail('收藏积分与达标门槛规则不一致');
        if(body('Ji').text.includes('firstCollectionPoints(')){
            if(adapted.reviewed('Ji')!==true||adapted.reviewed('dr')!==true)fail('首次收藏积分规则无法验证');
            for(const name of ['firstCollectionPoints','collectionOffhand','collectionOffhandMap','collectionOutfitIds','collectionCoreIds','collectionRarityFloors']){
                if(adapted.reviewed(name)!==true)fail('首次收藏积分依赖无法验证 '+name);
            }
            const offhands=read('workOffhandDefinitions');
            for(const [ids,points,rarityScaled]of [
                [read('collectionOutfitIds'),read('collectionOutfitPoints'),false],
                [read('collectionCoreIds'),read('collectionCorePoints'),false],
                [new Set(offhands.map(row=>row.id)),read('collectionOffhandPoints'),true]
            ]){
                if(!(ids instanceof Set)||!ids.size||!Number.isFinite(points)||points<=0)fail('首次收藏积分数据无效');
                for(const id of ids){
                    if(!Number.isSafeInteger(id)||!baseMap.has(id)||Object.hasOwn(firstOnlyRewards,id))fail('首次收藏物品引用无效或重复');
                    firstOnlyRewards[id]={points:points*read('UH'),rarityScaled};
                }
            }
            const floor=initializer('collectionRarityFloors').match(/^new Map\(collectionCurrencySources\.map\(c=>\[c\.shard,([\d.e+]+)\]\)\)$/);
            if(!floor||!Number.isSafeInteger(Number(floor[1]))||Number(floor[1])<0||Number(floor[1])>=rarityNames.length)fail('收藏最低品质倍率无法验证');
            for(const row of read('collectionCurrencySources')){
                if(!Number.isSafeInteger(row.shard)||!baseMap.has(row.shard)||Object.hasOwn(minimumRarity,row.shard))fail('收藏碎片引用无效或重复');
                minimumRarity[row.shard]=Number(floor[1]);
            }
        }
        const monsters=read('wt').map(row=>({...row,nameZh:translate(row.name)})),zones=read('T6').map(row=>({...row,nameZh:translate(row.name)}));
        attempt('combat',()=>{
            const ids=new Set(translatedItems.map(item=>item.id)),monsterIds=new Set(monsters.map(row=>row.id));
            const probability=value=>Number.isFinite(value)&&value>=0&&value<=1;
            if(monsters.some(row=>!ids.has(row.drop)||!ids.has(row.bonus?.itemId)||!probability(row.bonus?.chance)||row.dropChance!==undefined&&!probability(row.dropChance))||zones.some(row=>!monsterIds.has(row.monsterId)))fail('战斗掉落数据关联或概率无效');
        });
        const excluded=new Set([...read('fireworks').map(row=>row.itemId),...extraExcludedIds]),catalog=new Map(),collectionSources=[];
        const add=(row,skill)=>{if(row.chance===0||row.itemId===read('Aa')||excluded.has(row.itemId)||pet(row.itemId))return;collectionSources.push(row);const list=catalog.get(row.itemId)??[];if(!list.includes(skill))list.push(skill);catalog.set(row.itemId,list);};
        const seedIds=new Set(jobs.filter(job=>job.grow!==undefined).map(job=>job.inputs[0].itemId));
        for(const job of jobs){
            const retirement=job.retired?{retired:true}:{};
            add({id:`job:${job.id}:output`,kind:'job',jobId:job.id,itemId:job.output.itemId,skill:job.skill,sourceType:'output',chance:1,qty:job.output.qty,quality:job.inputs.length||job.plain?'fixed':'random',...job.plain?{rarity:0}:{},...retirement},job.skill);
            if(job.bonus)add({id:`job:${job.id}:bonus`,kind:'job',jobId:job.id,itemId:job.bonus.itemId,skill:job.skill,sourceType:'bonus',chance:job.bonus.chance,qty:1,quality:rarityable.has(job.bonus.itemId)?'random':'fixed',...(seedIds.has(job.bonus.itemId)?{qualityFloor:1}:{}),...retirement},job.skill);
        }
        for(const upgrade of [...read('gO'),...toolUpgrades])add({id:`upgrade:${upgrade.recipe}:output`,kind:'upgrade',upgradeId:upgrade.id,itemId:upgrade.id,skill:upgrade.skill,sourceType:'output',chance:1,qty:1,quality:'fixed'},upgrade.skill);
        for(const monster of capabilities.combat.available?monsters:[]){
            const base={kind:'combat',monsterId:monster.id,zoneIds:zones.filter(zone=>zone.monsterId===monster.id).map(zone=>zone.id),skill:'combat',qty:1};
            add({...base,id:`combat:${monster.id}:output`,itemId:monster.drop,sourceType:'output',chance:monster.dropChance??1,quality:'random'},'combat');
            add({...base,id:`combat:${monster.id}:bonus`,itemId:monster.bonus.itemId,sourceType:'bonus',chance:monster.bonus.chance,chanceMode:'combatLuck',quality:'fixed',rarity:0},'combat');
        }
        const qualityModifiers=attempt('quality',()=>{
        const exactBodies = {
            Jw:'return pa(1+CO*ze(c,"hunter"),Jn(c,"blessing")?lf:1)',
            Bb:'if(e)return 1;const a=Zf(c);return a.kind==="rarity"&&Lx(a,o)?a.mult:1',
            Zf:'const o=Math.floor(c/Kn),e=zk[cT(o)],a=oT.includes(e)&&ic(o,2,Bx)%3===0;return{skill:e,kind:a?"rarity":"xp",mult:a?qualityEventMult:Ix,from:o*Kn,until:(o+1)*Kn}',
            cT:'for(c<du&&(du=0,Nb=fy(0));du<c;){du++;const o=fy(du);Nb=o===Nb?(o+1)%zk.length:o}return Nb',
            fy:'return ic(c,1,Bx)%zk.length',
            ic:'let a=(c^2654435769)>>>0;return a=Math.imul(a^o>>>0,2246822507)>>>0,a=(a^a>>>13)>>>0,a=Math.imul(a^e>>>0,3266489909)>>>0,a=(a^a>>>16)>>>0,a>>>0',
            ze:'return Jn(c,o)?cb[UT(c,o)]:0',
            UT:'const e=c.brewBuckets?.[o];if(e&&e.length){const a=e.reduce((d,n)=>d+n,0),t=Math.max(0,c.lastTick-((c.brews[o]??0)-a));let s=0;for(let d=e.length-1;d>=0;d--)if(s+=e[d],t<s)return av(d)}return av(c.brewTier?.[o]??0)',
            Jn:'return(c.brews[o]??0)>c.lastTick',
            Um:'if(!zh(c))return 1;let o=0;for(const e of je)e.bonus.kind==="rareChance"&&gt(c,e.id)&&(o+=qn(e,Qe(c,e.id)));return 1+o',
            Un:'let e=0,a=0;for(const t of c)o<t.fromTick||o>t.toTick||(e+=(t.xpMult??1)-1,a+=(t.rarityMult??1)-1);return{xpMult:1+e,rarityMult:1+a}',
            ga:'return 1+Kl(c,o)',
            Kl:'const e=Vx.get(o);return!e||!c?0:(c[o]??0)*e.perRank',
            pa:'let o=0;for(const e of c)o+=e-1;return 1+o',
            Lx:'return c.skill===o||c.skill==="combat"&&eT.includes(o)',
            qn:'return qualityHouseCurve(o)*(c.rate??1)',
            Qe:'return c.house[o]??0',
            qualityHouseCurve:'return c*Nx'
        };
        for (const [name,text] of Object.entries(exactBodies)) if (body(name).text !== text && adapted.reviewed?.(name)!==true) fail('品质加成公式 '+name+' 已变化');
        exact('cb','Xl');
        exact('Vx','new Map(On.map(c=>[c.id,c]))');
        exact('Kn','Math.round(30*60*1e3/ro)');
        exact('av','c=>Math.max(0,Math.min(Sy-1,c))');
        exact('Sy','cb.length');
        if (read('cb').length !== rarityNames.length) fail('药水品质数量已变化');
        const qualityModifiers={combatBonusIncludesHouse,hunterPerTier:read('CO'),blessingMultiplier:read('lf'),brewMultipliers:read('cb'),masteryPerRank:masteryRate('rare'),rareRooms:read('je').filter(row=>row.bonus?.kind==='rareChance').map(row=>({id:row.id,rate:row.rate??1})),eventTicks:Math.round(30*60*1000/read('ro')),eventSkills:read('zk'),eventRaritySkills:read('oT'),eventSeed:read('Bx'),eventRarityMultiplier:read('qualityEventMult'),combatSkills:read('eT')};
            return qualityModifiers;
        });
        if(capabilities.enhancing.available)attempt('enhancing',()=>{
            const formulas={ga:'return 1+Kl(c,o)',Kl:'const e=Vx.get(o);return!e||!c?0:(c[o]??0)*e.perRank',qn:'return qualityHouseCurve(o)*(c.rate??1)',Qe:'return c.house[o]??0',qualityHouseCurve:'return c*Nx'};
            for(const [name,text]of Object.entries(formulas))if(body(name).text!==text)fail('强化加成规则不可验证');
            exact('Vx','new Map(On.map(c=>[c.id,c]))');
        });
        if(!capabilities.quality.available)for(const key of ['work','farming','combat'])unavailable(key,'品质或幸运规则无法确认');
        const housePerLevel=attempt('quality',()=>read('Nx'));
        const masterySpeedPerRank=attempt('work',()=>masteryRate('gather'));
        const forgeMasteryPerRank=attempt('enhancing',()=>masteryRate('enhance'));
        const result={loaderFormatVersion:DATA_FORMAT_VERSION,version:metadata.version||meta.bundle||meta.sourceUrl?.split('/').pop()||'当前游戏资源',bundle:meta.bundle??meta.sourceUrl?.split('/').pop()??null,retrievedDate:meta.retrievedDate??new Date().toISOString().slice(0,10),sourceUrl:meta.sourceUrl??null,skills,
            capabilities,validationIssues,monsters,zones,collectionSources,collectionCatalog:[...catalog].map(([itemId,skills])=>({itemId,skills})),
            items:translatedItems,jobs:jobs.map(job=>{const qualityInputs=job.inputs.filter(row=>!isGem(row.itemId)&&row.itemId!==read('WD')&&qualityIds.has(row.itemId)).map(row=>row.itemId);return {...job,nameZh:translate(job.name)!==job.name?translate(job.name):translate(baseMap.get(job.output.itemId)?.name??job.name),groupZh:translate(job.group),qualityInputs,...job.plain||job.inputs.length&&!qualityInputs.length?{fixedOutputRarity:0}:{}};}),
            upgrades:upgrades.map(job=>({...job,nameZh:translate(job.name)})),
            rules:{qualityModifiers,collection:{thresholds:read('ij'),incrementPoints:read('rj').map(value=>value*read('UH')),rarityMultipliers:read('hj'),petFirst:read('uj')*read('UH'),firstOnlyRewards,minimumRarity,excludedItemIds:[...excluded],unplannableItemIds:[read('Aa')]},forge,encoding:{rarityStride,plusStride},xp:{...xp,levelThresholds},workTiming:{offhandEnabled:false,toolLuckBonuses:{},freeInputToolSkills:{},...equipmentRules,luckToolSlots,quickPerkPerRank:quick,housePerLevel,masterySpeedPerRank,forgeMasteryPerRank,...farmYieldRules,...hands,skillRooms,skillRoomRates,skillToolSlots,skillMasteries},tickMs:read('ro'),rarityNames,rarityNamesZh:rarityNames.map(translate),masteryBaseCost:Number(costBase)+Number(costStep),masteryCostStep:Number(costStep),qualityCumulative:[1,chances.uncommon,chances.rare,chances.epic,chances.legendary,0]},
            skillNames,skillNamesZh:Object.fromEntries(skills.map(skill=>[skill,translate(skillNames[skill])])),skillGroups,masteryNames:Object.fromEntries(mastery.map(row=>[row.name,row.id]))};
        if(!result.version||!Array.isArray(result.items)||!result.items.length||!result.jobs.length||new Set(result.items.map(item=>item.id)).size!==result.items.length)fail('提取结果不完整');
        const validationView=enabled=>({...result,capabilities:Object.fromEntries(Object.keys(capabilities).map(key=>[key,{available:enabled.includes(key),reason:enabled.includes(key)?'':'当前验证范围以外'}]))});
        if(!validateGameData(validationView([])))fail('基础目录或物品关系校验失败');
        for(const key of ['quality','work','farming','combat','upgrades','enhancing']){
            if(!capabilities[key].available)continue;
            const dependencies=['work','farming','combat'].includes(key)?['quality']:[];
            if(dependencies.some(dependency=>!capabilities[dependency].available)||!validateGameData(validationView([key,...dependencies])))unavailable(key,'当前数据数值或关联校验失败');
        }
        if(!capabilities.enhancing.available)result.rules.forge=null;
        if(!capabilities.quality.available)result.rules.qualityModifiers=null;
        if(!validateGameData(result))fail('功能校验结果不一致');
        return result;
    }
    function extractGameData(source,meta={}){
        if(typeof source!=='string'||source.length<100000||source.length>12000000)fail('源文件大小无效');
        try{return extractVerifiedGameData(source,meta,adaptGameSource(source));}
        catch(error){fail('自动适配校验失败：'+String(error.message||error));}
    }
    return {extractGameData,validateGameData,DATA_FORMAT_VERSION};
});
const GAME_DATA_LOADER = module.exports;
function startPluginUpdates(version) {
    'use strict';
    return { check: Function.prototype, dispose() {} };
    const host = typeof unsafeWindow === 'object' ? unsafeWindow : globalThis, KEY = '__DVI_MASTERY_UPDATER__';
    try { host[KEY]?.dispose(); } catch (_) {}
    const abort = new AbortController();
    let disposed = false, updateTimer = null, updateTimeout = null, updateBusy = false, updateNextAt = 0, pendingUpdate = null, openedUpdate = '';
    const UPDATE_KEY = 'dvi.mastery.update-opened.v1', UPDATE_INTERVAL = 3600000, UPDATE_RETRY = 900000;
    const UPDATE_API = 'https://api.greasyfork.org/en/scripts/601366.json';
    const UPDATE_INSTALL = 'https://update.greasyfork.org/scripts/601366/%5BDVI%5D%E7%B2%BE%E9%80%9A%E5%8A%A9%E6%89%8B.user.js';
    const versionParts = value => typeof value === 'string' && value.length <= 64 && /^\d+(?:\.\d+)*$/.test(value) ? value.split('.').map(Number) : null;
    function newerVersion(next, current) {
        const a = versionParts(next), b = versionParts(current);
        if (!a || !b || ![...a,...b].every(Number.isSafeInteger)) return false;
        for (let i = 0; i < Math.max(a.length,b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
        return false;
    }
    function scheduleUpdate(delay) {
        clearTimeout(updateTimer);
        if (!disposed) updateTimer = setTimeout(() => { updateTimer = null; void checkForUpdate(); },delay);
    }
    function openUpdate(version) {
        if (disposed) return;
        if (document.hidden) { pendingUpdate = version; return; }
        pendingUpdate = null;
        if (openedUpdate === version) return;
        try {
            if (localStorage.getItem(UPDATE_KEY) === version) return;
            localStorage.setItem(UPDATE_KEY,version);
        } catch (_) {}
        openedUpdate = version;
        location.assign(`${UPDATE_INSTALL}?dvi_version=${encodeURIComponent(version)}&t=${Date.now()}`);
    }
    async function checkForUpdate() {
        if (disposed || updateBusy) return;
        if (document.hidden) { scheduleUpdate(UPDATE_INTERVAL); return; }
        if (pendingUpdate) openUpdate(pendingUpdate);
        if (Date.now() < updateNextAt) { scheduleUpdate(updateNextAt-Date.now()); return; }
        updateNextAt = Date.now()+UPDATE_RETRY; updateBusy = true;
        const request = new AbortController(), stop = () => request.abort();
        abort.signal.addEventListener('abort',stop,{once:true});
        const timeout = updateTimeout = setTimeout(stop,10000);
        try {
            const response = await fetch(UPDATE_API,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:request.signal});
            if (!response.ok || Number(response.headers.get('content-length')) > 65536) return;
            const text = await response.text();
            if (disposed || request.signal.aborted || text.length > 65536) return;
            const data = JSON.parse(text);
            if (data?.id !== 601366 || data.deleted !== false || data.namespace !== 'https://deepveinidle.com/' || !versionParts(data.version)) return;
            const installed = typeof GM_info === 'object' && versionParts(GM_info?.script?.version) ? GM_info.script.version : version;
            updateNextAt = Date.now()+UPDATE_INTERVAL;
            if (newerVersion(data.version,installed)) openUpdate(data.version);
        } catch (_) {
        } finally {
            clearTimeout(timeout); updateTimeout = null; abort.signal.removeEventListener('abort',stop); updateBusy = false;
            if (!disposed) scheduleUpdate(Math.max(1000,updateNextAt-Date.now()));
        }
    }
    function dispose() {
        if (disposed) return;
        disposed = true; abort.abort(); clearTimeout(updateTimer); clearTimeout(updateTimeout);
        updateTimer = updateTimeout = pendingUpdate = null;
        if (host[KEY] === api) delete host[KEY];
        api.check = api.dispose = Function.prototype;
    }
    const api = {check:checkForUpdate,dispose}; host[KEY] = api;
    document.addEventListener('visibilitychange',() => { if (!document.hidden) void checkForUpdate(); },{signal:abort.signal});
    scheduleUpdate(3000);
    return api;
}
function createCombatSampler(options) {
    const {tickMs, zoneMonsterIds, levelFromXp, sampleLimit = 12} = options || {};
    if (!(Number.isFinite(tickMs) && tickMs > 0) || !zoneMonsterIds || typeof levelFromXp !== 'function' ||
        !Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 100) {
        throw new TypeError('Invalid observed combat timing options');
    }
    const combatSkills = ['melee', 'ranged', 'magic', 'defence', 'hitpoints'];
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const stable = value => Array.isArray(value) ? value.map(stable) : object(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    let key = null, lastTick = null, anchorTick = null, monsterId = null, intervals = [], reason = 'unobserved';
    function reset(why = 'reset') {
        key = null; lastTick = null; anchorTick = null; monsterId = null; intervals = []; reason = why;
        return result();
    }
    function context(raw, tick) {
        if (!object(raw) || !Number.isSafeInteger(tick) || tick < 0 || !object(raw.route) ||
            raw.route.phase !== 'working' || !['working', 'walking'].includes(raw.activity) ||
            !Number.isSafeInteger(raw.route.zoneId) || !Number.isSafeInteger(zoneMonsterIds[raw.route.zoneId]) ||
            !object(raw.equipment) || !Object.hasOwn(raw.equipment, 'weapon') || !object(raw.skills) ||
            !object(raw.masteries) || !object(raw.perks) || !object(raw.house) || !object(raw.houseFurniture) || !object(raw.brews)) return null;
        const identity = typeof raw.id === 'string' && raw.id ? ['id', raw.id] : typeof raw.name === 'string' && raw.name ? ['name', raw.name] : null;
        if (!identity) return null;
        const levels = combatSkills.map(skill => {
            const value = raw.skills[skill];
            return object(value) && Number.isSafeInteger(value.level) ? value.level : levelFromXp(object(value) ? value.xp : value);
        });
        if (!levels.every(value => Number.isSafeInteger(value) && value > 0)) return null;
        const brews = {};
        // Active status and effective tier only: expiry countdown/XP changes are not loadout changes.
        for (const [id, expires] of Object.entries(raw.brews)) {
            if (!Number.isSafeInteger(expires) || expires <= tick) continue;
            let tier = raw.brewTier?.[id] ?? 0;
            const buckets = raw.brewBuckets?.[id];
            if (Array.isArray(buckets) && buckets.length) {
                if (!buckets.every(value => Number.isSafeInteger(value) && value >= 0)) return null;
                const elapsed = Math.max(0, tick - (expires - buckets.reduce((sum, value) => sum + value, 0)));
                let consumed = 0;
                for (let index = buckets.length - 1; index >= 0; index--) {
                    if ((consumed += buckets[index]) > elapsed) { tier = index; break; }
                }
            }
            if (!Number.isSafeInteger(tier) || tier < 0) return null;
            brews[id] = tier;
        }
        const target = zoneMonsterIds[raw.route.zoneId];
        const signature = JSON.stringify(stable({identity, zoneId:raw.route.zoneId, target, equipment:raw.equipment,
            levels, masteries:raw.masteries, perks:raw.perks, house:raw.house, houseFurniture:raw.houseFurniture,
            brews, eatAt:raw.eatAt ?? null, foodItemId:raw.foodItemId ?? null, foodMaxTier:raw.foodMaxTier ?? null}));
        return {key:signature, monsterId:target};
    }
    function result() {
        const seconds = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
        return {samples:seconds === null ? {} : {[monsterId]:seconds}, sampleCounts:seconds === null ? {} : {[monsterId]:intervals.length},
            lastTick, anchorTick, reason};
    }
    function read(raw, tick) {
        const current = context(raw, tick);
        return current?.key === key ? result() : reset('context-changed');
    }
    function consume(frame, raw) {
        if (!object(frame) || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Array.isArray(frame.m)) return reset('invalid-frame');
        const messages = frame.m;
        if (messages.some(message => ['welcome', 'snapshot'].includes(message?.t))) return reset('snapshot');
        const current = context(raw, frame.tick);
        if (!current) return reset('inactive-or-unknown');
        if (current.key !== key) {
            reset('context-changed'); key = current.key; monsterId = current.monsterId;
        }
        const batches = messages.filter(message => message?.t === 'batch');
        if (batches.some(message => !Array.isArray(message.e) || message.e.length > 1000)) return reset('invalid-batch');
        const events = batches.flatMap(message => message.e);
        if (events.some(event => ['died', 'routeStopped', 'routeResumed'].includes(event?.kind))) return reset('interrupted');
        const kills = events.filter(event => event?.kind === 'killed');
        if (kills.length > 1 || kills.some(event => event.monsterId !== current.monsterId)) return reset('ambiguous-kills');
        if (lastTick !== null && frame.tick <= lastTick) {
            if (frame.tick === lastTick && !kills.length) return result();
            return reset('replayed-or-out-of-order');
        }
        // An ordered WebSocket stream may omit ticks with no events. A positive
        // tick jump is elapsed game time; interruption/reset events break the cycle.
        lastTick = frame.tick;
        if (kills.length === 1) {
            if (anchorTick !== null) {
                const seconds = (frame.tick - anchorTick) * tickMs / 1000;
                if (Number.isFinite(seconds) && seconds > 0) {
                    intervals.push(seconds);
                    if (intervals.length > sampleLimit) intervals.shift();
                    reason = 'observed';
                }
            }
            anchorTick = frame.tick;
            if (!intervals.length) reason = 'first-kill';
        }
        return result();
    }
    return {consume, read, reset};
}
function bootMasteryAssistant(CORE, DATA, earlySockets, updater, retained, catalogState) {
    'use strict';
    earlySockets ||= [];
    catalogState ||= {};
    const host = typeof unsafeWindow === 'object' ? unsafeWindow : globalThis;
    const KEY = '__DVI_MASTERY_HELPER__', PREF = 'dvi.mastery.preferences.v1', MONITOR_KEY = 'dvi.mastery.monitored-goals.v1';
    try { host[KEY]?.dispose(); } catch (_) {}
    const abort = new AbortController(), timers = new Set(), sleepers = new Set(), sockets = new Set();
    let catalogVerified = catalogState.verified !== false, catalogMessage = catalogState.message || '任务数据正在更新';
    let resolveMount, rejectMount;
    const ready = new Promise((resolve,reject) => { resolveMount = resolve; rejectMount = reject; });
    ready.catch(() => {});
    const itemMap = CORE.itemMap(DATA), jobs = CORE.jobMap(DATA), jobMap = jobs.map;
    const isPetGoal = (itemId,goal) => goal?.sourceType === 'pet' || !!itemMap.get(goal?.baseItemId ?? CORE.decodeItem(itemId,DATA)?.baseItemId)?.pet;
    const zoneMap = CORE.indexById(DATA.zones), monsterMap = CORE.indexById(DATA.monsters);
    const combatSampler = createCombatSampler({tickMs:DATA.rules.tickMs,
        zoneMonsterIds:Object.fromEntries([...zoneMap.values()].filter(zone=>Number.isSafeInteger(zone.monsterId)).map(zone=>[zone.id,zone.monsterId])),
        levelFromXp:xp=>CORE.levelFromXp(xp,DATA)});
    const namedZones = new Map();
    for (const zone of zoneMap.values()) for (const name of new Set([zone.name,zone.nameZh].filter(Boolean))) {
        const rows = namedZones.get(name) || []; rows.push(zone); namedZones.set(name,rows);
    }
    const workKey = task => task.kind === 'combat' ? `zone:${task.zoneId}` : task.jobId;
    const canMonitor = task => CORE.taskAvailable(task,DATA,character) && !isPetGoal(task.itemId,task) && (task.stopMode === 'endless' || task.monitorFinite) && !task.routeUnsupported && (task.kind === 'combat' ? zoneMap.has(task.zoneId) : ['craft','gather'].includes(task.kind) && jobMap.has(task.jobId) && !jobMap.get(task.jobId).grow);
    const gatheringWork = key => jobMap.get(key)?.inputs.length === 0;
    const canAutoStop = task => canMonitor(task) && !gatheringWork(workKey(task));
    const workSources = new Map();
    for (const source of DATA.collectionSources || []) {
        if (!CORE.taskAvailable(source,DATA)) continue;
        const keys = source.kind === 'combat' ? source.zoneIds.map(id => `zone:${id}`) : source.kind === 'job' ? [source.jobId] : [];
        for (const key of keys) {
            if (!workSources.has(key)) workSources.set(key,new Map());
            const items = workSources.get(key);
            if (!items.has(source.itemId)) items.set(source.itemId,[]);
            items.get(source.itemId).push(source);
        }
    }
    const workAvailable = key => CORE.featureAvailable(DATA,typeof key === 'string' && key.startsWith('zone:') ? 'combat' : jobMap.get(key)?.grow ? 'farming' : 'work');
    const sourceFor = (key,itemId) => {
        if (!workAvailable(key)) return null;
        const decoded = CORE.decodeItem(itemId,DATA);
        return decoded && workSources.get(key)?.get(decoded.baseItemId)?.find(source =>
            (source.quality !== 'fixed' || decoded.rarity === (source.rarity || 0) || source.rarity == null && source.sourceType === 'output' && jobMap.get(key)?.inputs.length) && decoded.rarity >= (source.qualityFloor || 0));
    };
    const goalProductionRarity = (key,itemId,goal) => !jobMap.get(key)?.inputs.length ? null : goal.productionRarity ?? (sourceFor(key,itemId)?.sourceType === 'output' ? CORE.decodeItem(itemId,DATA).rarity : 0);
    const goalMatchesOrder = (order,key,itemId,goal) => {
        if (workKey(order) !== key || order.reservationOnly) return false;
        const rarity = goalProductionRarity(key,itemId,goal);
        return rarity === null || !order.best && order.rarity === rarity;
    };
    const skillAliases = {woodcutting:['伐木术'],farming:['耕种'],thieving:['盗窃'],herblore:['草药','炼药']};
    const skillNames = Object.fromEntries(DATA.skills.map(id => [id,[DATA.skillNames[id],DATA.skillNamesZh[id],...(skillAliases[id] || [])].filter(Boolean)]));
    const namedJobs = new Map(), growingJobs = jobs.grow;
    for (const job of DATA.jobs) for (const skill of new Set([job.skill,...(skillNames[job.skill] || [])])) for (const name of new Set([job.name,job.nameZh].filter(Boolean))) {
        const key = `${skill}·${name}`;
        if (!namedJobs.has(key)) namedJobs.set(key,[]);
        namedJobs.get(key).push(job);
    }
    const skills = { ...DATA.skillNamesZh, combat:'战斗' };
    const filterSkills = new Set([...DATA.skillGroups.gather,...DATA.skillGroups.craft,'combat']);
    const qualitySkills = new Set(DATA.jobs.filter(job => !job.retired && itemMap.get(job.output.itemId)?.rarityable).map(job => job.skill));
    for (const source of DATA.collectionSources || []) if (source.quality !== 'fixed' && !source.pet && itemMap.get(source.itemId)?.rarityable) qualitySkills.add(source.kind === 'combat' ? 'combat' : source.skill);
    if (DATA.items.some(item => item.enhanceable && item.rarityable)) qualitySkills.add('enhancing');
    const categories = { gathering:{name:'采集',skills:DATA.skillGroups.gather.filter(id => id !== 'farming')}, farming:{name:skills.farming,skills:['farming']}, production:{name:'制造',skills:DATA.skillGroups.craft.filter(id => id !== 'enhancing')}, combat:{name:'战斗',skills:['combat']}, enhancement:{name:'强化',skills:['enhancing']} };
    const normalizeSearch = text => String(text).normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
    const searchNames = rows => new Map(rows.map(row => [row.id,normalizeSearch(`${row.name || ''} ${row.nameZh || ''}`)]));
    const itemSearch = searchNames(DATA.items), jobSearch = searchNames(DATA.jobs), zoneSearch = searchNames([...zoneMap.values()]), monsterSearch = searchNames([...monsterMap.values()]);
    let searchText = '', searchWords = [], searchTimer = null, searchComposing = false;
    const rarities = DATA.rules.rarityNamesZh;
    const OPINIONS_API = 'https://papiyas.chat/api/dvi-opinions';
    const PRESENCE_KEY = 'dvi.mastery.presence-key.v1';
    const routePriorities = [['default','选择优先模式','使用插件本身的推荐逻辑'],['inventory','库存优先','包里和仓库已备齐全部所需材料的任务优先'],['cost','成本优先','每点成本低的任务优先'],['quality','品质优先','普通 → 罕见 → 稀有 → 史诗 → 传说'],['time','耗时优先','预计总耗时短的任务优先'],['points','低点优先','单个任务可获得的精通点少的优先'],['high-points','高点优先','单个任务可获得的精通点多的优先']];
    const defaults = { x:20, y:85, docked:true, collapsed:false, autoNavigate:true, materialPriceSort:true, routePriority:'default', sound:false, showLocked:false, hiddenTasks:[] };
    let prefs = { ...defaults, skill:'all', category:'all', rarity:'all' };
    try {
        const saved = JSON.parse(localStorage.getItem(PREF) || '{}');
        for (const k of Object.keys(defaults)) if (typeof saved[k] === typeof defaults[k]) prefs[k] = saved[k];
    } catch (_) {}
    if (!routePriorities.some(([id]) => id === prefs.routePriority)) prefs.routePriority = defaults.routePriority;
    prefs.hiddenTasks = Array.isArray(prefs.hiddenTasks) ? [...new Set(prefs.hiddenTasks.filter(id => typeof id === 'string' && /^(collection|forge):[\w:-]+$/.test(id)))].slice(0,2000) : [];
    const hiddenTasks = new Set(prefs.hiddenTasks), endlessTargets = new Map();
    let preparedEndless = null, taskListTab = 'route', automaticWorkClick = false, monitorRestored = false, monitorSaved = null;
    let disposed = false, root, panel, opinionPopup, shadow, toastTimer, poll, pollBusy = false, exportRestore = null, syncTimer;
    let lastReadAt = 0, watchedAt = 0, planNextAt = 0, planTimer = null, syncDueAt = 0, syncUrgent = false;
    let dockAnchor = null, layoutTabs = null, mobileDockState = '', viewportState = '', layoutFrame = 0, layoutDirty = true, layoutPending = true, themeDirty = true, themeSignature = '', drag = null;
    const mobileLayout = host.matchMedia('(max-width:640px),(max-width:1024px) and (pointer:coarse),(max-height:640px) and (pointer:coarse)');
    let mobileZoom = null, layoutMobileShell = null, layoutOverlays = [], mobilePanelBlocked = false, panelFitHeight = 0, panelFitWidth = 0, panelMinScale = 1, panelFitDirty = true;
    const layoutResize = new ResizeObserver(() => scheduleLayout(false,true));
    const layoutChanges = new MutationObserver(() => scheduleLayout(true,true));
    const watched = new Set(), gameObserver = new MutationObserver(() => scheduleSync());
    let socketGeneration = 0, newestSocket = 0, snapshot = null, bridgeReady = false, signature = '';
    let pendingRaw = null, lastRaw = null, rawFrame = 0, rawRevision = 0, pendingForgeEvents = [];
    let character = null, identity = '', live = false, lastSync = 0, availablePoints = null;
    let presenceBusy = false;
    const presenceDays = new Map();
    let plan = { tasks:[], summary:{} }, active = null, complete = false, skipped = new Set();
    const routeCache = new Map(), marketBooks = new Map(), marketAsked = new Map(), routePages = {route:0,hidden:0};
    const PAGE_SIZE = 50;
    const MARKET_TTL = 60000, MARKET_BATCH_INTERVAL = 15000;
    let effectivePrices = null, marketQueryAt = 0, marketCheckAt = 0, marketRetryAt = 0;
    let marketFrame = 0;
    let prices = null, priceTime = '', priceAttempt = 0, priceInterval = 300000, priceBusy = false, priceFailed = false, tab = 'route', busy = false;
    let opinionItems = [], opinionCursor = '', opinionHasMore = false, opinionLoading = false, opinionSubmitting = false, opinionError = '', opinionLoaded = false, opinionDraft = '';
    let renderedHTML = '', renderedTab = '', renderedOpinionHTML = '';
    let planDeferred = false, renderDeferred = false, planError = '', planning = false, planRevision = 0, planningContext = '', planSource = null, routeSource = null;
    const pendingRoute = {tasks:[],summary:{},pending:true};
    const canShowPanel = () => !!character && (prefs.collapsed || !catalogVerified || plan.summary.taskCount !== undefined || !!planError);
    let pointsSignature = '', derivedPointCache = null;
    const renderedParts = new Map(), listViews = new Map();
    let navigationToken = 0, sessionGeneration = 0;
    const nativeWebSocket = host.WebSocket;
    const on = (el, event, fn, options = {}) => el.addEventListener(event, fn, { ...options, signal:abort.signal });
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; };
    const sleep = ms => new Promise(resolve => {
        const finish = () => { sleepers.delete(finish); resolve(); };
        sleepers.add(finish); later(finish,ms);
    });
    const planTurns = [], planChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
    if (planChannel) planChannel.port1.onmessage = () => planTurns.shift()?.();
    const yieldPlan = () => !planChannel ? sleep(0) : new Promise(resolve => {
        const finish = () => { sleepers.delete(finish); resolve(); };
        sleepers.add(finish); planTurns.push(finish); planChannel.port2.postMessage(null);
    });
    const readText = blob => new Promise((resolve,reject) => {
        const finish = (fn,value) => { abort.signal.removeEventListener('abort',stop); fn(value); };
        const stop = () => finish(reject,new DOMException('读取已取消','AbortError'));
        if (disposed) { stop(); return; }
        abort.signal.addEventListener('abort',stop,{once:true});
        Promise.resolve().then(() => blob.text()).then(value => finish(resolve,value),error => finish(reject,error));
    });
    const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(Object.fromEntries(Object.keys(defaults).map(key => [key,prefs[key]])))); } catch (_) {} };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const numbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits:1, useGrouping:false });
    const clockTime = new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit'});
    const fmt = value => Number.isFinite(value) ? numbers.format(value) : '—';
    const moneyNumbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits:2, useGrouping:false });
    const fmtMoney = value => {
        if (!Number.isFinite(value)) return '—';
        if (Math.abs(value) < 100000) return moneyNumbers.format(value);
        let unit = Math.abs(value) >= 1e9 ? 2 : Math.abs(value) >= 1e6 ? 1 : 0;
        if (unit < 2 && Math.round(Math.abs(value)/1000**(unit+1)*100)/100 >= 1000) unit++;
        return `${moneyNumbers.format(value/1000**(unit+1))}${['K','M','B'][unit]}`;
    };
    const duration = seconds => !Number.isFinite(seconds) || seconds < 0 ? '时间不定' : seconds < 60 ? `${seconds > 0 && seconds < .1 ? '<0.1' : fmt(seconds)} s` : `${fmt(seconds / 60)} min`;
    const time = seconds => Number.isFinite(seconds) && seconds >= 0 ? `约 ${duration(seconds)}` : '时间不定';
    const taskTime = task => task.expectedSeconds == null ? time(task.seconds) : `${task.secondsNeedsScrolls ? '补齐卷轴 ' : ''}${task.secondsConservative ? '保守估算 ' : task.secondsBaseline ? '基础估算 ' : ''}${task.kind === 'farm' ? '单田·成熟即收 ' : task.uncertainAttempts || task.kind === 'forge' && task.targetPlus > 1 ? '期望' : ''}${time(task.expectedSeconds)}`;
    const itemNames = new Map();
    const itemName = id => {
        id = Number(id);
        if (itemNames.has(id)) return itemNames.get(id);
        const d = CORE.decodeItem(id,DATA), item = itemMap.get(d?.baseItemId);
        const name = item ? `${item.nameZh || item.name}${d.rarity ? ` - ${rarities[d.rarity]}` : ''}${d.plus ? ` +${d.plus}` : ''}` : `物品 ${id}`;
        if (item && itemNames.size < 10000) itemNames.set(id,name);
        return name;
    };
    const samePerson = (a, b) => !!a && !!b && !!a.name && a.name === b.name && (!a.id || !b.id || a.id === b.id);
    const personIdentity = person => {
        if (!person?.name) return null;
        const known = [snapshot?.character,live ? character : null].find(candidate => candidate && samePerson(candidate,person));
        return {id:person.id || known?.id || '',name:person.name};
    };
    const mergeForgeLog = (next, previous) => {
        if (!CORE.featureAvailable(DATA,'enhancing') || !samePerson(next,previous) || !previous.completeness?.forgeLog) return next;
        const forgeLog = {...previous.forgeLog};
        if (next.completeness?.forgeLog) for (const [key,mask] of Object.entries(next.forgeLog)) forgeLog[key] = CORE.mergeForgeMask(forgeLog[key],mask);
        return {...next,forgeLog,completeness:{...next.completeness,forgeLog:true}};
    };
    const who = c => c.id || c.name || '';
    const masteryKeys = [...new Set(Object.values(DATA.masteryNames))];
    const masteryRankPoints = rank => rank*DATA.rules.masteryBaseCost + DATA.rules.masteryCostStep*rank*(rank-1)/2;
    const unspentPoints = c => {
        const key = JSON.stringify([who(c),c.completeness?.collections,c.completeness?.forgeLog,c.completeness?.masteries,c.collections,c.forgeLog,c.masteries]);
        if (key === pointsSignature) return derivedPointCache;
        pointsSignature = key; derivedPointCache = null;
        if (!c.completeness?.collections || !c.completeness.forgeLog || !c.completeness.masteries) return null;
        const collection = CORE.collectionPoints(c.collections,DATA), forge = CORE.forgePoints(c.forgeLog,DATA);
        if (collection === null || forge === null) return null;
        const spent = masteryKeys.reduce((sum,key) => sum + masteryRankPoints(c.masteries[key] ?? 0),0);
        const points = collection + forge - spent;
        return derivedPointCache = Number.isSafeInteger(points) && points >= 0 ? points : null;
    };
    const q = (s, scope = document) => scope.querySelector(s);
    const matchesFilter = t => (prefs.skill === 'all' || t.skill === prefs.skill) && (prefs.category === 'all' || categories[prefs.category].skills.includes(t.skill));
    const matchesSearch = task => !searchWords.length || searchWords.every(word => [itemSearch.get(task.baseItemId),jobSearch.get(task.jobId),zoneSearch.get(task.zoneId),monsterSearch.get(task.monsterId)].some(name => name?.includes(word)));
    const hasQualityFilter = () => prefs.skill !== 'all' ? qualitySkills.has(prefs.skill) : [...qualitySkills].some(skill => prefs.category === 'all' || categories[prefs.category].skills.includes(skill));
    const queuedWork = t => !!(t.queued || t.relatedWork);
    const queueStatusText = t => t.queueStatus === 'running' ? '进行中' : '队列中';
    const nextAvailable = () => routeFor().tasks.find(t => CORE.taskAvailable(t,DATA,character) && !t.locked && !t.queued && !t.relatedWork && t.routeIndex > 0 && !t.routeBlocked && !skipped.has(t.id)) || null;
    const visible = el => !!el && !el.hidden && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && !!el.getClientRects().length;
    const waitFor = async (fn, ms = 2400, message = '页面控件未就绪，请打开相应页面后重试') => {
        const until = Date.now() + ms;
        while (!disposed && Date.now() < until) { const v = fn(); if (v) return v; await sleep(80); }
        throw new Error(message);
    };
    const setValue = (el, value) => {
        if (!el || el.disabled) throw new Error('输入框不可用');
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles:true }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
    };
    function notify(message, error = false) {
        if (disposed) return;
        const el = shadow?.querySelector('.toast');
        if (el) { el.textContent = message; el.classList.toggle('error', error); el.hidden = false; clearTimeout(toastTimer); timers.delete(toastTimer); toastTimer = later(() => { el.hidden = true; }, error ? 8500 : 5500); }
    }
    function ping() {
        if (!prefs.sound) return;
        try {
            const Audio = host.AudioContext || host.webkitAudioContext, ctx = new Audio(), osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 720; gain.gain.value = .045;
            osc.start(); osc.stop(ctx.currentTime + .15); osc.onended = () => ctx.close();
        } catch (_) {}
    }
    function watchGame() {
        if (disposed || document.hidden) return;
        const state = host.deepvein?.session?.state;
        if (state?.name && state.collections && state.skills && state.equipment && state.bank && Array.isArray(state.pack)) {
            if (watched.size) { gameObserver.disconnect(); watched.clear(); }
            return;
        }
        if (Date.now()-watchedAt < 750) return;
        watchedAt = Date.now();
        if ([...watched].some(el => !el.isConnected)) { gameObserver.disconnect(); watched.clear(); }
        for (const el of document.querySelectorAll('[data-pack],[data-bank-grid],[data-bank-pack],[data-routes],[data-summary-what],[data-summary-train],[data-coll-title],[data-plan]')) {
            if (watched.has(el)) continue;
            watched.add(el); gameObserver.observe(el, { childList:true, subtree:true, characterData:true });
        }
    }
    const syncInterval = () => preparedEndless && canAutoStop(preparedEndless) || [...endlessTargets.keys()].some(key=>!gatheringWork(key)) ? 100 : 500;
    function scheduleSync(delay = 60, urgent = false) {
        if (disposed || (character && !live)) return;
        syncUrgent ||= urgent;
        const wait = Math.max(delay,(syncUrgent ? 100 : syncInterval())-(Date.now()-lastReadAt)), due = Date.now()+wait;
        if (syncTimer && syncDueAt <= due) return;
        if (syncTimer) { clearTimeout(syncTimer); timers.delete(syncTimer); }
        syncDueAt = due;
        syncTimer = later(() => { syncTimer = null; syncDueAt = 0; void monitorTick(); },wait);
    }
    function receiveRaw(raw) {
        if (disposed) return;
        pendingRaw = lastRaw = raw; rawRevision++;
        if (!rawFrame) rawFrame = requestAnimationFrame(flushRaw);
    }
    function receiveForgeEvents(events, identityHint = null) {
        if (!CORE.featureAvailable(DATA,'enhancing') || !DATA.rules.forge || !Array.isArray(events)) return;
        const updates = events.filter(event => event?.kind === 'enhanced' && Number.isSafeInteger(event.from) && Number.isSafeInteger(event.plus) && event.plus >= 1 && event.plus <= DATA.rules.forge.loggedMaxPlus);
        if (!updates.length) return;
        const scope = personIdentity(identityHint);
        if (!scope) return;
        pendingForgeEvents.push(...updates.slice(0,1000-pendingForgeEvents.length).map(event => ({event,scope}))); rawRevision++;
        if (!rawFrame) rawFrame = requestAnimationFrame(flushRaw);
    }
    function flushRaw() {
        if (rawFrame) cancelAnimationFrame(rawFrame);
        rawFrame = 0;
        const raw = pendingRaw, events = pendingForgeEvents; pendingRaw = null; pendingForgeEvents = [];
        if ((!raw && !events.length) || disposed) return;
        const nativeState = host.deepvein?.session?.state;
        const native = !raw && events.length ? captureNative() : null;
        const normalized = raw ? CORE.normalizeCharacter(raw,DATA,samePerson(raw,nativeState) ? host.deepvein?.session?.context : null) : null;
        const candidates = [native?.character,live ? character : null,snapshot?.character].filter(candidate => candidate && (!raw || samePerson(candidate,normalized?.character)) && (raw || !nativeState?.name || samePerson(candidate,nativeState)));
        const baseline = candidates.reduce((best,candidate) => mergeForgeLog(candidate,best),null);
        const current = normalized || {ok:!!(native?.character || baseline),character:native?.character || baseline};
        if (!current.ok || !current.character.name) {
            pendingForgeEvents.push(...events.slice(0,1000-pendingForgeEvents.length));
            return;
        }
        const sameBaseline = samePerson(current.character,baseline);
        if (sameBaseline) current.character = mergeForgeLog(current.character,baseline);
        const scopedEvents = events.filter(entry => samePerson(entry.scope,current.character));
        if (scopedEvents.length && current.character.completeness.forgeLog) {
            const forgeLog = {...current.character.forgeLog};
            for (const {event} of scopedEvents) {
                const from = CORE.decodeItem(event.from,DATA), item = itemMap.get(from?.baseItemId);
                if (!from || !item?.enhanceable || !item.enhanceTier || event.plus !== from.plus+1 || event.itemId !== CORE.encodeItem(from.baseItemId,from.rarity,event.plus,DATA)) continue;
                const key = (item.enhanceTier-1)*DATA.rules.rarityNames.length+from.rarity, bit = 2**(event.plus-1), mask = forgeLog[key] || 0;
                if (!CORE.forgeHasStep(mask,event.plus)) forgeLog[key] = CORE.mergeForgeMask(mask,bit);
            }
            current.character = {...current.character,forgeLog};
        } else if (scopedEvents.length) pendingForgeEvents.push(...scopedEvents.slice(0,1000-pendingForgeEvents.length));
        snapshot = { character:current.character, at:raw ? Date.now() : snapshot?.at || 0 };
        if (!character || live) accept(current.character, '实时快照', true);
    }
    function clearMarketBooks() {
        const changed = marketBooks.size > 0;
        marketBooks.clear(); marketAsked.clear(); effectivePrices = null; marketQueryAt = marketCheckAt = marketRetryAt = 0;
        if (changed) planDeferred = true;
        if (changed && !disposed && !marketFrame) marketFrame = requestAnimationFrame(() => { marketFrame = 0; if (character) replan(); else render(); });
    }
    function quotes() {
        if (effectivePrices) return effectivePrices;
        effectivePrices = {...prices?.items};
        const now = Date.now();
        for (const [itemId,book] of marketBooks) {
            const stale = now-book.at >= MARKET_TTL;
            effectivePrices[itemId] = {...effectivePrices[itemId],lowestSell:book.lowestSell ?? (stale ? effectivePrices[itemId]?.lowestSell ?? null : null),sellQty:stale ? null : book.sellQty};
        }
        return effectivePrices;
    }
    function ownSaleLevels(itemId) {
        const levels = new Map(), orders = host.deepvein?.session?.orders;
        if (Array.isArray(orders)) for (const order of orders) if (order?.itemId === itemId && order.side === 'sell' && Number.isSafeInteger(order.price) && order.price > 0 && Number.isSafeInteger(order.qtyRemaining) && order.qtyRemaining > 0) {
            levels.set(order.price,(levels.get(order.price) || 0)+order.qtyRemaining);
        }
        return levels;
    }
    function rememberBook(top, external = false) {
        if (!Number.isSafeInteger(top?.itemId) || !CORE.decodeItem(top.itemId,DATA) || !(top.ask === null || Number.isSafeInteger(top.ask) && top.ask > 0)) return false;
        const total = Number.isSafeInteger(top.askTotal) && top.askTotal >= 0 ? top.askTotal : top.askMore === false && Number.isSafeInteger(top.askQty) && top.askQty >= 0 ? top.askQty : null;
        const own = external ? null : ownSaleLevels(top.itemId);
        let ownQty = 0;
        if (own) for (const qty of own.values()) ownQty += qty;
        const sellQty = top.ask === null ? 0 : total === null ? null : Math.max(0,total-ownQty);
        const ownBest = Number.isSafeInteger(top.askQty) && top.askQty > 0 && (own?.get(top.ask) || 0) >= top.askQty;
        const now = Date.now(), previous = marketBooks.get(top.itemId), lowestSell = sellQty === 0 || ownBest ? null : top.ask;
        const changed = !previous || now-previous.at >= MARKET_TTL || previous.lowestSell !== lowestSell || previous.sellQty !== sellQty;
        marketBooks.delete(top.itemId);
        marketBooks.set(top.itemId,{at:now,lowestSell,sellQty});
        if (marketBooks.size > 512) { marketBooks.delete(marketBooks.keys().next().value); effectivePrices = null; }
        if (changed) { effectivePrices = null; planDeferred = true; }
        return changed;
    }
    function queryMarketBooks() {
        if (!catalogVerified) return;
        const now = Date.now(), session = host.deepvein?.session;
        if (disposed || document.hidden || prefs.collapsed || !['route','hidden','task'].includes(tab) || !live || !bridgeReady || character?.ironman || !samePerson(session?.state,character) || typeof session?.query !== 'function' || !sockets.size || now < marketRetryAt || now-marketQueryAt < MARKET_BATCH_INTERVAL || now-marketCheckAt < MARKET_BATCH_INTERVAL) return;
        marketCheckAt = now;
        const quality = hasQualityFilter() ? prefs.rarity : 'all', ids = new Set();
        const add = task => { if (!CORE.taskAvailable(task,DATA,character)) return; for (const m of task?.materials || []) if (m.missing > 0 && m.marketTradable !== false) ids.add(m.itemId); };
        add(active);
        for (const task of plan.tasks) if (!task.locked && matchesFilter(task) && matchesSearch(task) && (quality === 'all' || task.rarity === Number(quality)) && hiddenTasks.has(task.id) === (tab === 'hidden')) add(task);
        const lastQuote = id => Math.max(marketBooks.get(id)?.at || 0,marketAsked.get(id) || 0);
        const currentPrices = quotes();
        const itemIds = [...ids].filter(id => now-lastQuote(id) >= MARKET_TTL).sort((a,b) => lastQuote(a)-lastQuote(b) || Number(currentPrices[a]?.lowestSell > 0)-Number(currentPrices[b]?.lowestSell > 0)).slice(0,64);
        if (!itemIds.length) return;
        marketQueryAt = now;
        try {
            if (session.query({t:'marketBooks',itemIds}) !== true) { marketRetryAt = now+MARKET_TTL; return; }
            for (const id of itemIds) marketAsked.set(id,now);
            if (marketAsked.size > 512) marketAsked.clear();
        } catch (_) { marketRetryAt = now+MARKET_TTL; }
    }
    function receiveMarket(messages) {
        let changed = false;
        for (const message of messages) {
            if (message?.t === 'busy' && ['marketBooks','marketBook','marketDepth'].includes(message.q)) marketRetryAt = Date.now()+MARKET_TTL;
            const tops = message?.t === 'marketBook' ? [message.top] : message?.t === 'marketBooks' && Array.isArray(message.tops) && message.tops.length <= 512 ? message.tops : [];
            for (const top of tops) changed = rememberBook(top) || changed;
            if (message?.t === 'marketDepth' && Number.isSafeInteger(message.itemId) && Array.isArray(message.asks) && message.asks.length <= 5000 && message.asks.every(ask => Number.isSafeInteger(ask?.price) && ask.price > 0 && Number.isSafeInteger(ask.qty) && ask.qty > 0)) {
                const own = ownSaleLevels(message.itemId);
                let ask = null, askTotal = 0;
                for (const row of message.asks) {
                    const removed = Math.min(row.qty,own.get(row.price) || 0), qty = row.qty-removed;
                    own.set(row.price,(own.get(row.price) || 0)-removed);
                    if (qty > 0) { ask = ask === null ? row.price : Math.min(ask,row.price); askTotal += qty; }
                }
                changed = rememberBook({itemId:message.itemId,ask,askTotal},true) || changed;
            }
        }
        if (changed && !marketFrame) marketFrame = requestAnimationFrame(() => { marketFrame = 0; if (character) replan(); else render(); });
    }
    function pruneMarketBooks() {
        const now = Date.now();
        let booksChanged = false;
        for (const [id,book] of marketBooks) {
            const quote = prices?.items[id];
            if (prices?.generatedAt >= book.at && (quote?.lowestSell > 0 || quote?.sellQty === 0)) { marketBooks.delete(id); booksChanged = true; }
            else if (!book.stale && now-book.at >= MARKET_TTL) { book.stale = true; booksChanged = true; }
        }
        if (booksChanged) { effectivePrices = null; planDeferred = true; }
        return booksChanged;
    }
    function routeKey(hidden) {
        const quality = hasQualityFilter() ? prefs.rarity : 'all';
        return `${hidden}:${prefs.category}:${prefs.skill}:${quality}:${prefs.showLocked}:${prefs.materialPriceSort}:${prefs.routePriority}:${searchWords.join(' ')}`;
    }
    function routeInputs(hidden, tasks = plan.tasks, routePrices = quotes()) {
        const quality = hasQualityFilter() ? prefs.rarity : 'all';
        tasks = tasks.filter(t => hiddenTasks.has(t.id) === hidden && (prefs.showLocked || !t.locked || queuedWork(t)) && matchesFilter(t) && matchesSearch(t) && (quality === 'all' || t.rarity === Number(quality)));
        return {tasks,options:{ fullRoute:true, independentTasks:true, allMilestones:true, prices:routePrices, materialCostSort:prefs.materialPriceSort, routePriority:prefs.routePriority === 'default' ? null : prefs.routePriority, excludedTaskIds:[...skipped] }};
    }
    const planningKey = () => JSON.stringify([tab,routeKey(false),[...hiddenTasks],[...skipped],monitorSaved]);
    function cacheRoute(key, route) {
        routeCache.delete(key); routeCache.set(key,route);
        let tasks = 0;
        for (const result of routeCache.values()) tasks += result.tasks.length;
        while (routeCache.size > 1 && (routeCache.size > 32 || tasks > 16000)) {
            const oldest = routeCache.keys().next().value;
            tasks -= routeCache.get(oldest).tasks.length; routeCache.delete(oldest);
        }
        return route;
    }
    function routeFor(hidden = false, defer = false) {
        if (!character) return {tasks:[],summary:{}};
        const key = routeKey(hidden);
        if (routeCache.has(key)) {
            const route = routeCache.get(key); routeCache.delete(key); routeCache.set(key,route);
            return route;
        }
        if (defer) {
            if (!planning || planningContext !== planningKey()) replan(false,false,true);
            return pendingRoute;
        }
        const {tasks,options} = routeInputs(hidden);
        const result = CORE.optimizeRoute(tasks,character,DATA,options);
        return cacheRoute(key,result);
    }
    function resetRouteViews() {
        routePages.route = routePages.hidden = 0;
        marketCheckAt = 0;
        for (const view of listViews.values()) view.scrollTop = 0;
        const area = shadow?.querySelector('.route-scroll'); if (area) area.scrollTop = 0;
    }
    function saveRoutePrefs() {
        resetRouteViews(); savePrefs(); render();
    }
    const unwatchSocket = entry => {
        entry.socket.removeEventListener('message',entry.listener);
        entry.socket.removeEventListener('close',entry.close);
        sockets.delete(entry);
    };
    function watchSocket(socket, url) {
        if (disposed) return null;
        try {
            const parsed = new URL(String(url), location.href);
            if (parsed.host !== location.host || parsed.pathname !== '/ws') return null;
            const generation = ++socketGeneration; newestSocket = generation;
            for (const entry of sockets) unwatchSocket(entry);
            pendingRaw = null; pendingForgeEvents = [];
            combatSampler.reset('socket-opened');
            clearMarketBooks();
            const listener = event => {
                if (disposed || generation !== newestSocket) return;
                if (typeof event.data !== 'string' || event.data.length > 4e6) { combatSampler.reset('invalid-frame'); return; }
                try {
                    const frame = JSON.parse(event.data), messages = Array.isArray(frame.m) ? frame.m : [frame];
                    const frameIdentity = messages.find(message => ['welcome','snapshot'].includes(message?.t) && message.you)?.you;
                    if (frameIdentity && character && !samePerson(frameIdentity,character)) clearMarketBooks();
                    receiveMarket(messages);
                    const hasSnapshot = messages.some(message => (message?.t === 'welcome' || message?.t === 'snapshot') && message.you);
                    const nativePerson = host.deepvein?.session?.state;
                    if (!hasSnapshot && nativePerson?.name && pendingRaw && !samePerson(nativePerson,pendingRaw)) flushRaw();
                    let framePerson = hasSnapshot ? (pendingRaw || snapshot?.character || (live ? character : null)) : (nativePerson?.name ? nativePerson : pendingRaw || snapshot?.character || character);
                    let characterMessage = false;
                    for (const message of messages) {
                        if ((message?.t === 'welcome' || message?.t === 'snapshot') && message.you) {
                            characterMessage = true;
                            framePerson = message.you;
                            receiveRaw(message.you);
                        } else if (message?.t === 'batch') { characterMessage = true; rawRevision++; receiveForgeEvents(message.e,framePerson); }
                    }
                    const combatRaw = nativePerson?.name ? nativePerson : null;
                    combatSampler.consume(frame,combatRaw);
                    if (characterMessage) scheduleSync(60,!hasSnapshot);
                } catch (_) { combatSampler.reset('invalid-frame'); }
            };
            const close = () => { unwatchSocket(entry); if (generation === newestSocket) { combatSampler.reset('socket-closed'); clearMarketBooks(); scheduleSync(); } };
            const entry = {socket,listener,close}; sockets.add(entry);
            socket.addEventListener('message',listener);
            socket.addEventListener('close',close,{once:true});
            return listener;
        } catch (_) { return null; }
    }
    let wsProxy;
    if (typeof nativeWebSocket === 'function') {
        wsProxy = new Proxy(nativeWebSocket, {
            construct(Target, args, NewTarget) {
                const socket = Reflect.construct(Target,args,NewTarget);
                watchSocket(socket,args[0]);
                return socket;
            }
        });
        try { host.WebSocket = wsProxy; } catch (_) {}
    }
    function accept(next, source, isLive, unspent = null) {
        if (disposed) return;
        if (!next.name) throw new Error('人物名称缺失');
        if (!character) scheduleLayout();
        if (!catalogVerified) { character = next; live = isLive; lastSync = Date.now(); render(); return; }
        const changed = character && !samePerson(character, next);
        if (changed) {
            active = null; complete = false; skipped.clear(); signature = ''; availablePoints = null;
            plan = {tasks:[],summary:{}}; planSource = routeSource = null; routeCache.clear(); listViews.clear();
            if (root && !prefs.collapsed) root.style.visibility = 'hidden';
            pointsSignature = ''; derivedPointCache = null; monitorRestored = false; planError = ''; 
            endlessTargets.clear(); preparedEndless = null; saveEndlessTargets();
            navigationToken++; sessionGeneration++; bridgeReady = false;
            clearMarketBooks();
            if (!snapshot || !samePerson(snapshot.character, next)) snapshot = null;
        }
        if (!changed && character?.id && !next.id) next.id = character.id;
        const sameEquipment = next.source === 'export' && !changed && character && JSON.stringify(character.equipment) === JSON.stringify(next.equipment);
        if (CORE.featureAvailable(DATA,'work') && sameEquipment && character.speedBonus && !Object.keys(next.speedBonus || {}).length && bridgeReady) next.speedBonus = character.speedBonus;
        if (CORE.featureAvailable(DATA,'quality') && sameEquipment && character.luckBonus && !Object.keys(next.luckBonus || {}).length && bridgeReady) next.luckBonus = character.luckBonus;
        identity = who(next);
        if (isLive) {
            next = mergeForgeLog(next,snapshot?.character);
            next = mergeForgeLog(next,character);
            if (snapshot && samePerson(next,snapshot.character)) snapshot = {...snapshot,character:mergeForgeLog(snapshot.character,next)};
        }
        if (isLive && snapshot && samePerson(next, snapshot.character)) {
            if (CORE.featureAvailable(DATA,'enhancing') && next.source === 'export' && snapshot.character.completeness.enhance) { next.enhance = snapshot.character.enhance; next.completeness.enhance = true; }
            if (next.source === 'export' && snapshot.character.completeness.locks) { next.bankLocked = snapshot.character.bankLocked; next.completeness.locks = true; }
            if (next.source === 'export' && next.timing && snapshot.character.timing?.source === 'snapshot') {
                for (const key of ['hands','forgeHouseBonus','farmGrowthMultiplier']) if (next.timing[key] == null && snapshot.character.timing[key] != null) next.timing[key] = snapshot.character.timing[key];
            }
        }
        if (changed || !isLive) combatSampler.reset('character-changed');
        if (isLive) {
            const nativeRaw = host.deepvein?.session?.state;
            const raw = samePerson(next,nativeRaw) ? nativeRaw : null;
            const measured = combatSampler.read(raw,raw?.lastTick).samples;
            next = {...next,combatKillSeconds:measured};
        }
        const previousPoints = availablePoints, previousCoins = character?.coins;
        character = next; live = isLive; lastSync = Date.now();
        const derivedPoints = isLive ? unspentPoints(next) : null;
        if (!CORE.featureAvailable(DATA,'enhancing') || !next.completeness.forgeLog) availablePoints = null;
        else if (derivedPoints !== null) availablePoints = derivedPoints;
        else if (Number.isSafeInteger(unspent) && unspent >= 0) availablePoints = unspent;
        else if (source === '导入文件' || changed) availablePoints = null;
        character.readSource = source;
        if (isLive) void reportPresence();
        let monitorChanged = false;
        if (isLive && source === '实时读取') { monitorChanged = !!restoreEndlessTargets(); monitorChanged = !!checkEndlessTargets() || monitorChanged; }
        const skillSignature = Object.entries(next.skills).map(([skill,value]) => [skill,value.level,value.xp === 0]);
        const nextSignature = JSON.stringify([identity, next.collections, next.bank, next.pack, skillSignature, next.equipment, next.completeness.equipment, next.speedBonus, next.luckBonus, next.qualityMultipliers, next.completeness.qualityModifiers, next.masteries, [next.timing?.hands, next.timing?.forgeHouseBonus, next.timing?.farmGrowthMultiplier], next.forgeLog, next.enhance, next.bankLocked, next.ironman, next.workOrders, next.completeness.workOrders, next.combatKillSeconds, next.combatLuckMultiplier]);
        if (nextSignature !== signature || monitorChanged) {
            const immediate = changed || !isLive || !signature && !prefs.collapsed;
            signature = nextSignature; replan(false,false,immediate);
        }
        else if (next.coins !== previousCoins) replan();
        else if (availablePoints !== previousPoints) render();
        if (changed) notify('已切换角色，任务已重置');
    }
    function replan(force = false, strict = false, immediate = false) {
        if (!catalogVerified || !character || disposed) return;
        planDeferred = true;
        if (document.hidden || prefs.collapsed && !force) return;
        if (planning && !force && !immediate) return;
        const wait = planNextAt-performance.now();
        if (!force && !immediate && wait > 0) {
            if (!planTimer) planTimer = later(() => { planTimer = null; replan(); },wait);
            return;
        }
        if (planTimer) { clearTimeout(planTimer); timers.delete(planTimer); planTimer = null; }
        const revision = ++planRevision, person = character, sourceSignature = signature, sourcePrices = quotes();
        const sourceSkills = prefs.skill !== 'all' ? [prefs.skill] : prefs.category !== 'all' ? [...categories[prefs.category].skills] : null;
        const sourceSkillsKey = JSON.stringify(sourceSkills);
        const context = planningContext = planningKey();
        const current = () => !disposed && revision === planRevision && catalogVerified && !document.hidden && (!prefs.collapsed || force) && samePerson(person,character) && context === planningKey();
        planning = true; planDeferred = false;
        let computeMs = 0;
        const steps = (function* () {
            const materialPriceSort = prefs.materialPriceSort;
            if (!planSource || planSource.signature !== sourceSignature || planSource.prices !== sourcePrices || planSource.materialPriceSort !== materialPriceSort || planSource.sourceSkillsKey !== sourceSkillsKey) {
                const result = yield* CORE.planTaskSteps(person, DATA, { includeForge:true, allMilestones:true, sortTasks:false, prices:sourcePrices, materialCostSort:materialPriceSort, requireMaterialQuotes:materialPriceSort, keepUnquoted:true, sourceSkills });
                if (!result.summary || !Array.isArray(result.tasks)) throw new Error('任务数据无效');
                if (!current()) throw new DOMException('计算状态已变化','AbortError');
                planSource = {signature:sourceSignature,prices:sourcePrices,materialPriceSort,sourceSkillsKey,result};
            }
            const sourcePlan = planSource, reusableRoutes = routeSource?.plan === sourcePlan && routeSource.coins === person.coins && routeSource.monitor === monitorSaved;
            const nextPlan = {tasks:sourcePlan.result.tasks.slice(),summary:{...sourcePlan.result.summary}};
            nextPlan.summary.readyCount = CORE.readyCount(nextPlan.tasks,person);
            for (const [jobId,group] of endlessTargets) if (group.seen) for (const [itemId,goal] of group.targets) {
                if (!workAvailable(jobId) || isPetGoal(itemId,goal)) continue;
                const order = person.workOrders.find(order => goalMatchesOrder(order,jobId,itemId,goal));
                if (!order) continue;
                if (!gatheringWork(jobId)) for (let index = 0; index < nextPlan.tasks.length; index++) {
                    const related = nextPlan.tasks[index];
                    if (related.itemId === itemId && workKey(related) === jobId && related.target !== goal.target && queuedWork(related)) nextPlan.tasks[index] = {...related,queued:false,relatedWork:related.kind==='combat',queueStatus:related.kind==='combat'?related.queueStatus:null};
                }
                const taskIndex = nextPlan.tasks.findIndex(t => t.itemId === itemId && t.target === goal.target && workKey(t) === jobId);
                let task = taskIndex === -1 ? null : nextPlan.tasks[taskIndex] = {...nextPlan.tasks[taskIndex]};
                if (!task) {
                    const job = jobMap.get(jobId), decoded = CORE.decodeItem(itemId,DATA), source = sourceFor(jobId,itemId);
                    if (!source || !decoded) continue;
                    const current = person.collections[itemId] || 0, combat = source.kind === 'combat';
                    const kind = combat ? 'combat' : job.inputs.length ? 'craft' : 'gather';
                    task = { id:`collection:${itemId}:${goal.target}:${jobId}`, kind, jobId:job?.id || null, zoneId:combat ? Number(jobId.slice(5)) : null, monsterId:source.monsterId,
                        sourceId:source.id, sourceType:source.sourceType, itemId, baseItemId:decoded.baseItemId, rarity:decoded.rarity, skill:combat ? 'combat' : job.skill, levelReq:combat ? 1 : job.levelReq,
                        target:goal.target, current, remaining:Math.max(0,goal.target-current), progress:Math.min(1,current/goal.target), gain:goal.gain, locked:false,
                        materials:[], batches:1, seconds:null, expectedSeconds:current >= goal.target ? 0 : null, stopMode:'endless', uncertainAttempts:true, randomOutput:true };
                    task.difficulty = CORE.rankTask(task);
                    nextPlan.tasks.push(task);
                }
                task.queued = true; task.relatedWork = false; task.queueStatus = order.running ? 'running' : 'queued';
                task.monitoredGoal = true;
                if(task.kind==='craft'){
                    const matching=person.workOrders.filter(candidate=>goalMatchesOrder(candidate,jobId,itemId,goal));
                    const finite=matching.every(candidate=>candidate.known!==false&&!candidate.timed&&!candidate.best&&Number.isSafeInteger(candidate.limit)&&candidate.limit>0);
                    const batches=matching.reduce((sum,candidate)=>sum+(candidate.limit||0),0);
                    const runningBatches=matching.filter(candidate=>candidate.running).reduce((sum,candidate)=>sum+(candidate.limit||0),0);
                    task.queuedBatches=batches;
                    task.queueReachable=finite&&!task.uncertainAttempts?task.minimumBatches<=batches:null;
                    if(task.queueReachable===true)task.queueStatus=task.minimumBatches<=runningBatches?'running':'queued';
                }
                task.monitorFinite = group.allowFinite === true;
                task.awaitingStop = canAutoStop(task) && (person.collections[itemId] || 0) >= goal.target;
                task.stopIssue = canAutoStop(task) ? group.blocked || '' : '';
            }
            const routes = new Map(), lists = new Set();
            if (tab === 'task') lists.add(taskListTab === 'hidden');
            else if (tab === 'route' || tab === 'hidden') lists.add(tab === 'hidden');
            if (!active) lists.add(false);
            for (const hidden of lists) {
                const key = routeKey(hidden), {tasks,options} = routeInputs(hidden,nextPlan.tasks,sourcePrices);
                routes.set(key,reusableRoutes && routeCache.has(key) ? routeCache.get(key) : yield* CORE.routeSteps(tasks,person,DATA,options));
            }
            if (!current()) throw new DOMException('任务状态已变化','AbortError');
            // Finish a coherent snapshot, then merge any updates received while yielding.
            planDeferred ||= signature !== sourceSignature || character.coins !== person.coins || sourcePrices !== quotes();
            if (!reusableRoutes) routeCache.clear(); plan = nextPlan;
            routeSource = {plan:sourcePlan,coins:person.coins,monitor:monitorSaved};
            for (const [key,route] of routes) cacheRoute(key,route);
            const previouslyQueued = active && queuedWork(active);
            if (!active) active = nextAvailable();
            let completionNotice = '';
            if (active) {
                const previous = active;
                const updated = plan.tasks.find(t => t.id === active.id) || plan.tasks.find(t => t.itemId === active.itemId && t.target === active.target && t.kind === active.kind);
                if (updated) active = {...updated};
                let done = false;
                if (active.kind === 'forge') done = CORE.forgeHasStep(character.forgeLog?.[active.forgeKey] || 0,active.targetPlus);
                else {
                    active.current = character.collections[active.itemId] || 0;
                    active.remaining = Math.max(0, active.target - active.current);
                    active.progress = Math.min(1, active.current / active.target);
                    done = active.current >= active.target;
                }
                if (done && !complete) completionNotice = `完成：${taskItemName(previous)} +${fmt(previous.gain)} 点 - 可选下一项`;
                complete = done;
                if (done) active.materials = [];
                else if (!updated) { active = null; complete = false; navigationToken++; if (tab === 'task') tab = taskListTab; }
            }
            let queueNotice = '';
            if (active?.queued && !previouslyQueued && !complete && tab === 'task') {
                trackEndless(active);
                queueNotice = `${taskItemName(active)} - ${queueStatusText(active)}，已返回列表`;
                tab = taskListTab; navigationToken++;
            }
            if (!prefs.collapsed) render();
            if (queueNotice) notify(queueNotice);
            if (completionNotice) { notify(completionNotice); ping(); }
            planError = '';
        })();
        const finish = error => {
            steps.return();
            if (disposed || revision !== planRevision) return;
            planning = false;
            if (error) {
                planDeferred = true;
                if (error.name !== 'AbortError') {
                    const message = error.message || '任务计算失败';
                    if (message !== planError) { planError = message; render(); notify(message,true); }
                }
            }
            planNextAt = performance.now()+Math.max(150,Math.min(1500,computeMs*9));
            if (planDeferred && catalogVerified && !document.hidden && !prefs.collapsed && !planTimer) planTimer = later(() => { planTimer = null; replan(); },planNextAt-performance.now());
        };
        const advance = () => {
            if (!current()) throw new DOMException('任务状态已变化','AbortError');
            const started = performance.now();
            let result;
            do { result = steps.next(); } while (!result.done && (force || performance.now()-started < 2));
            computeMs += performance.now()-started;
            return result.done;
        };
        if (force) {
            try { advance(); finish(); }
            catch (error) { finish(error); if (strict) throw error; }
        } else {
            void (async () => {
                try { await yieldPlan(); while (!advance()) await yieldPlan(); finish(); }
                catch (error) { finish(error); }
            })();
        }
    }
    function captureNative() {
        const state = host.deepvein?.session?.state;
        if (!state?.name || !state.collections || !state.skills || !state.equipment || !state.bank || !Array.isArray(state.pack)) return null;
        const result = CORE.normalizeCharacter(state,DATA,host.deepvein?.session?.context);
        if (!result.ok) return null;
        const c = result.character;
        if (!c.completeness.workOrders) {
            const work = readWorkOrders(); c.workOrders = work.orders; c.completeness.workOrders = work.known;
        }
        return {character:c};
    }
    async function captureExport() {
        const revision = rawRevision;
        const body = q('[data-account-body]');
        if (!body) throw new Error('请先进入游戏，等待角色信息加载');
        if (exportRestore) throw new Error('正在同步');
        const button = document.createElement('button');
        button.type = 'button'; button.hidden = true; button.dataset.exportCharacter = '';
        body.append(button);
        const nativeCreate = URL.createObjectURL, nativeClick = HTMLAnchorElement.prototype.click;
        const blobs = new Map(); let captured = null;
        const create = function (blob) { const url = Reflect.apply(nativeCreate, this, [blob]); if (blob instanceof Blob && blob.type.includes('json') && blob.size <= 3e6) blobs.set(url, blob); return url; };
        const click = function (...args) {
            if (blobs.has(this.href) && /^deepvein-.+\.json$/i.test(this.download)) { captured = blobs.get(this.href); return; }
            return Reflect.apply(nativeClick, this, args);
        };
        const restore = () => { if (URL.createObjectURL === create) URL.createObjectURL = nativeCreate; if (HTMLAnchorElement.prototype.click === click) HTMLAnchorElement.prototype.click = nativeClick; exportRestore = null; };
        const stopExportClick = event => { if (event.target === button) event.stopPropagation(); };
        body.addEventListener('click', stopExportClick);
        exportRestore = restore;
        try { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; button.click(); } finally { restore(); body.removeEventListener('click', stopExportClick); button.remove(); }
        if (!captured) throw new Error('角色暂未就绪，正在等待同步');
        const text = await readText(captured);
        if (disposed) return null;
        if (revision !== rawRevision) { flushRaw(); scheduleSync(100); return null; }
        const raw = JSON.parse(text);
        if (raw.game !== 'Deep Vein Idle' || !Array.isArray(raw.collection) || !raw.character?.name || !raw.exportedAt) throw new Error('导出格式不兼容');
        const normalized = CORE.normalizeCharacter(raw, DATA);
        if (!normalized.ok) throw new Error(normalized.errors[0]);
        const work = readWorkOrders();
        normalized.character.workOrders = work.orders;
        normalized.character.completeness.workOrders = work.known;
        return { character:normalized.character, unspent:raw.masteries?.collectionPointsUnspent };
    }
    function readWorkOrders(withControls = false) {
        const fresh = snapshot && Date.now() - snapshot.at < 2500 && snapshot.character.completeness.workOrders && (!character || samePerson(character, snapshot.character));
        const planEl = q('[data-plan]');
        if (!planEl) return !withControls && fresh ? { orders:snapshot.character.workOrders, known:true } : { orders:[], known:false };
        if (planEl.hidden) return { orders:[], known:true };
        const orders = []; let known = true;
        for (const row of planEl.querySelectorAll(':scope > [data-plan-now], [data-plan-next] .plan-next')) {
            if (withControls && row.classList.contains('plan-back')) continue;
            const label = row.querySelector('.plan-text')?.textContent.trim() || '';
            if (['Harvest & replant','收获并补种'].includes(label)) {
                if (withControls) { known = false; continue; }
                for (const job of growingJobs) orders.push({jobId:job.id,rarity:null,limit:null,reservationOnly:true});
                continue;
            }
            const parts = label.split(/\s*·\s*/), name = parts[1];
            if (['Fight','战斗'].includes(parts[0])) {
                const zones = namedZones.get(name) || [], meta = row.querySelector('.plan-meta')?.textContent || '';
                if (zones.length !== 1 || /任务|quest/.test(meta)) { known = false; continue; }
                const count = meta.match(/^(?:剩\s*)?([\d,]+)(?:\s|·|$)/), running = row.parentElement === planEl;
                if (running && count && Number(count[1].replace(/,/g,'')) === 0) continue;
                const zone = zones[0], order = {kind:'combat',zoneId:zone.id,monsterId:zone.monsterId,limit:count ? Number(count[1].replace(/,/g,'')) : null,timed:meta.includes('⏱'),running,known:!row.querySelector('.plan-limit-input') && (!!count || meta.includes('∞'))};
                if (withControls) { order.row = row; order.control = q(running ? '[data-plan-skip]' : '[data-plan-unqueue]',row); }
                orders.push(order); continue;
            }
            const jobs = namedJobs.get(`${parts[0]}·${name}`) || [];
            if (jobs.length !== 1) {
                const state = row.querySelector(':scope > .plan-state')?.textContent.trim();
                if (!row.querySelector('.plan-idle') && state !== 'fighting' && !/Fight|战斗|Stopped|stopped|停止|Enhancing|强化|On the way|路上/.test(label)) known = false;
                continue;
            }
            const job = jobs[0], running = row.parentElement === planEl;
            const meta = row.querySelector('.plan-meta')?.textContent || '';
            const count = meta.match(/^(?:剩\s*)?([\d,]+)(?:\s|·|$)/);
            if (running && count && Number(count[1].replace(/,/g,'')) === 0) continue;
            const quality = (parts[2] || '').toLowerCase();
            const rarity = rarities.findIndex((name,index) => name === quality || (DATA.rules.rarityNames[index] || '').toLowerCase() === quality);
            if (/任务|quest/.test(meta) || (!count && !meta.includes('∞')) || row.querySelector('.plan-limit-input') || (parts[2] && rarity < 0 && !/Best first|稀有优先/.test(parts[2]))) {
                if (withControls) { known = false; orders.push({jobId:job.id,known:false,row}); }
                else {
                    const unknownQuality = !!parts[2] && rarity < 0;
                    orders.push({jobId:job.id,rarity:unknownQuality ? null : Math.max(0,rarity),limit:null,running,known:false});
                }
                continue;
            }
            const order = { jobId:job.id, rarity:Math.max(0,rarity), limit:count ? Number(count[1].replace(/,/g,'')) : null, timed:meta.includes('⏱'), best:/Best first|稀有优先/.test(parts[2] || ''), running };
            if (withControls) { order.row = row; order.control = q(running ? '[data-plan-skip]' : '[data-plan-unqueue]', row); }
            orders.push(order);
        }
        return !withControls && !known && fresh ? { orders:snapshot.character.workOrders, known:true } : { orders, known };
    }
    function trackEndless(task, retry = false, allowFinite = false, replaceTarget = false) {
        if (!live || !canMonitor(task)) return;
        const key = workKey(task);
        let group = endlessTargets.get(key);
        if (!group) {
            group = { generation:sessionGeneration, targets:new Map(), seen:false, expires:Date.now()+15000, removing:0, running:false, blocked:'' };
            endlessTargets.set(key,group);
        }
        const previous = group.targets.get(task.itemId);
        if (replaceTarget || !previous || task.target > previous.target) group.targets.set(task.itemId,{target:task.target,gain:task.gain,sourceId:task.sourceId,sourceType:task.sourceType,productionRarity:jobMap.get(key)?.inputs.length ? task.productionRarity ?? task.rarity : null});
        if (allowFinite) group.allowFinite = true;
        if (retry && group.blocked) { group.blocked = ''; group.removing = 0; }
        saveEndlessTargets();
    }
    function saveEndlessTargets() {
        try {
            const value = endlessTargets.size && character ? JSON.stringify({ name:character.name,id:character.id || '',groups:[...endlessTargets].map(([jobId,g]) => ({jobId,targets:[...g.targets],seen:g.seen,expires:g.expires,removing:g.removing,running:g.running,blocked:g.blocked,allowFinite:g.allowFinite === true})) }) : '';
            if (value === monitorSaved) return;
            monitorSaved = value;
            if (value) { sessionStorage.setItem(MONITOR_KEY,value); localStorage.setItem(MONITOR_KEY,value); }
            else { sessionStorage.removeItem(MONITOR_KEY); localStorage.removeItem(MONITOR_KEY); }
        } catch (_) {}
    }
    function restoreEndlessTargets() {
        if (!catalogVerified || monitorRestored || !character) return;
        monitorRestored = true;
        try {
            const value = sessionStorage.getItem(MONITOR_KEY) || localStorage.getItem(MONITOR_KEY), saved = JSON.parse(value || 'null');
            if (!saved || saved.name !== character.name || saved.id && character.id && saved.id !== character.id || !Array.isArray(saved.groups)) return;
            for (const entry of saved.groups.slice(0,100)) {
                const key = entry.jobId, job = jobMap.get(key), zone = typeof key === 'string' && /^zone:\d+$/.test(key) ? zoneMap.get(Number(key.slice(5))) : null;
                if (!workAvailable(key) || (!job || job.grow) && !zone || !Array.isArray(entry.targets)) continue;
                let migrated = false;
                const targets = new Map(entry.targets.filter(pair => {
                    if (!Array.isArray(pair) || pair.length !== 2) return false;
                    const [itemId,goal] = pair, decoded = CORE.decodeItem(itemId,DATA), source = sourceFor(key,itemId);
                    if (isPetGoal(itemId,goal) || source?.sourceType === 'pet') { migrated = true; return false; }
                    return !!source && !decoded.plus && CORE.nextMilestone(goal?.target-1,DATA,decoded.baseItemId)?.target===goal?.target && Number.isFinite(goal.gain) && goal.gain > 0;
                }));
                if (targets.size && !endlessTargets.has(key)) endlessTargets.set(key,{generation:sessionGeneration,targets,seen:entry.seen === true,expires:Number(entry.expires) || 0,removing:migrated || gatheringWork(key) ? 0 : Number(entry.removing) || 0,running:entry.running === true,blocked:!migrated && !gatheringWork(key) && typeof entry.blocked === 'string' ? entry.blocked : '',allowFinite:entry.allowFinite === true});
            }
            monitorSaved = value || '';
            saveEndlessTargets();
            return endlessTargets.size > 0;
        } catch (_) {}
    }
    function checkEndlessTargets() {
        if (!catalogVerified || disposed || !live || !bridgeReady || !endlessTargets.size) return;
        let controls;
        const work = character.completeness.workOrders ? {orders:character.workOrders,known:true} : (controls = readWorkOrders(true));
        let changed = false;
        for (const [jobId,group] of endlessTargets) {
            if (!workAvailable(jobId)) { endlessTargets.delete(jobId); changed = true; continue; }
            const autoStop = !gatheringWork(jobId);
            if (!autoStop && (group.removing || group.blocked)) { group.removing = 0; group.blocked = ''; changed = true; }
            if (group.generation !== sessionGeneration) { endlessTargets.delete(jobId); changed = true; continue; }
            for (const [itemId,goal] of group.targets) if (isPetGoal(itemId,goal)) { group.targets.delete(itemId); changed = true; }
            if (!group.targets.size) { endlessTargets.delete(jobId); changed = true; continue; }
            if (!group.seen && Date.now() > group.expires) { endlessTargets.delete(jobId); changed = true; continue; }
            const matches = work.orders.filter(order => [...group.targets].some(([itemId,goal]) => goalMatchesOrder(order,jobId,itemId,goal)));
            if (!matches.length) {
                if (!work.known || work.orders.some(order => workKey(order) === jobId && !order.reservationOnly && order.rarity == null && !order.best)) continue;
                if (group.seen || Date.now() > group.expires) { endlessTargets.delete(jobId); changed = true; }
                if (group.removing) { notify('自产目标已完成，已移出任务队列'); ping(); }
                continue;
            }
            if (!autoStop) {
                const running = matches.some(order => order.running);
                if (!group.seen || group.running !== running) changed = true;
                group.seen = true; group.running = running;
                continue;
            }
            if (matches.length !== 1) {
                if (!group.blocked) { group.blocked = '同来源有多条任务，需核对'; changed = true; notify(group.blocked,true); }
                continue;
            }
            const order = matches[0];
            const targets = [...group.targets].filter(([itemId,goal]) => goalMatchesOrder(order,jobId,itemId,goal));
            if (order.known === false) continue;
            if (order.limit !== null && !group.allowFinite || order.timed || order.best) { endlessTargets.delete(jobId); changed = true; continue; }
            if (!group.seen || group.running !== order.running) changed = true;
            group.seen = true; group.running = order.running;
            if (group.blocked) continue;
            if (group.removing) {
                if (Date.now()-group.removing > 4000) { group.blocked = '已达标，停止未确认'; changed = true; notify('目标已完成；未确认队列移除，请核对游戏任务',true); }
                continue;
            }
            if (!targets.every(([itemId,goal]) => (character.collections[itemId] || 0) >= goal.target)) continue;
            const buttons = (controls ||= readWorkOrders(true)).orders.filter(candidate => candidate.known !== false && candidate.running === order.running && candidate.rarity === order.rarity && candidate.limit === order.limit && !!candidate.timed === !!order.timed && !!candidate.best === !!order.best && targets.every(([itemId,goal]) => goalMatchesOrder(candidate,jobId,itemId,goal)));
            if (buttons.length !== 1) continue;
            const {control:button,row} = buttons[0];
            if (!button?.isConnected || button.disabled || !row.contains(button)) continue;
            if (!order.running && !/^\d+$/.test(button.dataset.planUnqueue || '')) continue;
            group.removing = Date.now(); changed = true;
            automaticWorkClick = true;
            try { button.click(); } finally { automaticWorkClick = false; }
            scheduleSync(100);
            break;
        }
        if (changed) saveEndlessTargets();
        return changed;
    }
    function onNativeWorkClick(event) {
        if (!catalogVerified || automaticWorkClick) return;
        const forgeButton = event.target.closest?.('[data-enhance-detail] [data-act="toN"],[data-enhance-detail] [data-act="once"],[data-enhance-detail] [data-act="stop"]');
        if (CORE.featureAvailable(DATA,'enhancing') && forgeButton && !forgeButton.disabled) { scheduleSync(0,true); return; }
        const button = event.target.closest?.('[data-start],[data-queue],[data-stop],[data-plan-skip],[data-plan-unqueue]');
        if (!button || button.disabled) return;
        if (button.matches('[data-stop],[data-plan-skip],[data-plan-unqueue]')) {
            const row = button.closest('.plan-row');
            const work = readWorkOrders(true).orders;
            const order = row ? work.find(o => o.row === row) : work.find(o => o.running);
            if (order) { endlessTargets.delete(workKey(order)); saveEndlessTargets(); }
            preparedEndless = null; return;
        }
        const scope = button.closest('.routes');
        const pending = preparedEndless; preparedEndless = null;
        if (!scope) return;
        const selected = q('.route[data-picked="true"][data-job],.route[data-picked="true"][data-zone]',scope);
        const key = selected?.hasAttribute('data-zone') ? `zone:${Number(selected.dataset.zone)}` : Number(selected?.dataset.job);
        if (!workAvailable(key)) return;
        if (button.matches('[data-start]') && endlessTargets.delete(key)) saveEndlessTargets();
        if (q('[data-stop-mode="endless"]',scope)?.getAttribute('aria-selected') !== 'true') return;
        const prepared = pending?.person === identity && pending.generation === sessionGeneration && workKey(pending) === key ? pending : null;
        const task = prepared || (tab === 'task' && active && workKey(active) === key && !complete ? active : null) || plan.tasks.find(t => t.kind === 'gather' && !t.sourceType && workKey(t) === key && canMonitor(t) && !t.locked);
        if (!task || !selected) return;
        if (jobMap.get(key)?.inputs.length && q('[data-rarity-choices] [aria-pressed="true"][data-rarity]',scope)?.dataset.rarity !== String(task.productionRarity ?? task.rarity)) return;
        trackEndless(task,true); scheduleSync(100,true);
    }
    async function monitorTick(force = false) {
        if (disposed || (character && !live && !force)) return;
        if (!force && document.hidden && monitorRestored && !endlessTargets.size && !preparedEndless && !pendingForgeEvents.length) return;
        flushRaw();
        if (pollBusy) { scheduleSync(100); return; }
        if (!force && Date.now() - lastReadAt < (syncUrgent ? 100 : syncInterval())) { scheduleSync(); return; }
        if (!host.deepvein?.session?.state && !q('[data-account-body]')) { bridgeReady = false; return; }
        pollBusy = true; lastReadAt = Date.now(); syncUrgent = false; const generation = sessionGeneration;
        try {
            const result = captureNative() || (catalogVerified ? await captureExport() : null);
            if (!result || disposed || generation !== sessionGeneration) return false;
            bridgeReady = true;
            accept(result.character, '实时读取', true, result.unspent);
            bridgeReady = true;
            if (force && (planDeferred || planning)) replan(true,true);
            watchGame();
            if (!prices && !priceAttempt) void refreshPrices();
            return true;
        } catch (_) { if (!disposed && generation === sessionGeneration) bridgeReady = false; return false; }
        finally { pollBusy = false; }
    }
    async function refreshPrices(force = false) {
        if (disposed || priceBusy) return;
        if (priceAttempt && Date.now() - priceAttempt < (force ? 1000 : priceInterval)) return;
        priceBusy = true; priceAttempt = Date.now(); render();
        const controller = new AbortController();
        const stop = () => controller.abort();
        abort.signal.addEventListener('abort', stop, { once:true });
        const timeout = later(() => controller.abort(), 9000);
        try {
            const response = await fetch('/api/market/prices.json', { credentials:'omit', cache:'no-cache', signal:controller.signal });
            if (!response.ok) throw new Error('行情暂不可用');
            const raw = await response.json();
            if (disposed) return;
            if (raw.game !== 'Deep Vein Idle' || !raw.items || typeof raw.items !== 'object' || Array.isArray(raw.items)) throw new Error('行情格式不兼容');
            const generatedAt = typeof raw.generatedAt === 'string' ? Date.parse(raw.generatedAt) : NaN;
            const next = { items:{}, generatedAt:Number.isFinite(generatedAt) ? generatedAt : 0 };
            for (const [key, value] of Object.entries(raw.items)) if (/^\d+$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) {
                next.items[key] = { lowestSell:Number.isFinite(value.lowestSell) && value.lowestSell > 0 ? value.lowestSell : null, sellQty:Number.isSafeInteger(value.sellQty) && value.sellQty >= 0 ? value.sellQty : null };
            }
            const previous = JSON.stringify(quotes());
            prices = next; effectivePrices = null; priceFailed = false;
            pruneMarketBooks();
            const changed = previous !== JSON.stringify(quotes());
            if (Number.isFinite(raw.refreshSeconds) && raw.refreshSeconds >= 60 && raw.refreshSeconds <= 3600) priceInterval = raw.refreshSeconds*1000;
            priceTime = next.generatedAt ? clockTime.format(new Date(next.generatedAt)) : '';
            if (changed) replan();
            queryMarketBooks();
        } catch (_) { priceFailed = true; }
        finally {
            clearTimeout(timeout); timers.delete(timeout); abort.signal.removeEventListener('abort', stop); priceBusy = false;
            if (!disposed) { render(); if (priceFailed) notify(prices ? '行情更新失败，保留上次报价' : '行情读取失败，请点击刷新',true); }
        }
    }
    function quoteStatus() {
        const liveTime = Math.max(0,...[...marketBooks.values()].map(book => book.at));
        const liveLabel = liveTime ? `${Date.now()-liveTime < MARKET_TTL ? '实时' : '上次盘口'} ${clockTime.format(new Date(liveTime))}${Date.now()-liveTime >= MARKET_TTL ? '（待刷新）' : ''} - ` : '';
        return liveLabel+(prices ? `快照 ${priceTime || '时间未知'}${priceBusy ? ' - 更新中' : priceFailed ? ' - 更新失败，旧报价' : ''}` : priceBusy ? '行情读取中' : priceFailed ? '行情读取失败' : '行情未读取');
    }
    async function importFile(file) {
        if (!file) return;
        if (file.size > 3e6) throw new Error('文件过大，请选择角色导出 JSON');
        const raw = JSON.parse(await readText(file));
        if (disposed) return;
        if (raw.game !== 'Deep Vein Idle' || !raw.character?.name || !Array.isArray(raw.collection)) throw new Error('请选择游戏“导出角色”文件');
        const normalized = CORE.normalizeCharacter(raw, DATA);
        if (!normalized.ok) throw new Error(normalized.errors[0]);
        sessionGeneration++; navigationToken++; bridgeReady = false; active = null; complete = false;
        endlessTargets.clear(); preparedEndless = null; saveEndlessTargets();
        accept(normalized.character, '导入文件', false, raw.masteries?.collectionPointsUnspent);
        notify('已导入离线角色；可在设置中读取当前角色恢复实时同步');
    }
    async function openMarketItem(itemId, assertCurrent) {
        const d = CORE.decodeItem(itemId, DATA), base = itemMap.get(d?.baseItemId);
        if (!d || !base) throw new Error('物品不兼容');
        const entry = q('[data-open="market"]') || q('[data-m-open="market"]');
        if (!entry) throw new Error('找不到市场入口');
        entry.click();
        const windowEl = await waitFor(() => { const el = q('[data-market-window]'); return visible(el) && el; }); assertCurrent();
        q('[data-market-mode="buy"]', windowEl)?.click();
        for (const selector of ['[data-market-forsale]','[data-market-onsale]','[data-market-onlyfavs]']) {
            const el = q(selector, windowEl); if (el?.checked || el?.getAttribute('aria-pressed') === 'true') el.click();
        }
        const all = q('[data-family="all"]', windowEl);
        all?.click();
        const search = await waitFor(() => q('[data-market-search]', windowEl)); assertCurrent();
        setValue(search, base.name);
        const tile = await waitFor(() => q(`[data-market-list] [data-item="${d.baseItemId}"]`, windowEl)); assertCurrent();
        tile.click();
        const sheet = await waitFor(() => { const el = q('[data-market-sheet]', windowEl); return visible(el) && el; }); assertCurrent();
        const rarity = q(`[data-sheet-rarity] [data-rarity="${d.rarity}"]`, sheet);
        if (rarity) rarity.click();
        else if (d.rarity) throw new Error('找不到对应品质，已停止填量');
        const plus = q('[data-sheet-plus]', sheet); if (plus) setValue(plus, d.plus);
        await waitFor(() => Number(q('[data-sheet-icon]', sheet)?.dataset.item) === itemId); assertCurrent();
        return { windowEl,sheet };
    }
    async function market(itemId) {
        if (!catalogVerified) throw new Error(catalogMessage);
        if (!CORE.taskAvailable(active,DATA,character)) throw new Error('此功能暂时暂停，请等待游戏规则重新读取。');
        if (!prefs.autoNavigate) return;
        if (!character || !active || character.ironman) throw new Error('此角色不能使用市场');
        if (!live) throw new Error('请先读取实时角色，避免按旧库存填量');
        const token = ++navigationToken, person = identity, taskId = active.id;
        const assertCurrent = () => { if (token !== navigationToken || person !== identity || taskId !== active?.id || complete || !CORE.taskAvailable(active,DATA,character)) throw new Error('任务已变化，请重试'); };
        await waitFor(() => !pollBusy);
        if (!await monitorTick(true)) throw new Error('未能读取当前库存，稍后重试');
        assertCurrent();
        if (Date.now() - lastSync > 15000) throw new Error('数据已过期，请等待角色信息更新');
        const material = active.materials.find(m => m.itemId === itemId);
        if (!material || material.missing <= 0 || material.marketTradable === false) throw new Error('材料已齐全或物品不可交易');
        const queueIssue = materialQueueIssue(material);
        if (queueIssue) throw new Error(`${queueIssue}，请核对相关任务占用后重试`);
        const { sheet,windowEl } = await openMarketItem(itemId,assertCurrent);
        if (quotes()[itemId]?.sellQty === 0) { notify(`${itemName(itemId)} - 市场暂无卖单，已打开对应品质`); return; }
        const currentMaterial = active.materials.find(m => m.itemId === itemId);
        let amount = Math.min(1000000, Math.ceil(currentMaterial?.missing || 0));
        if (amount <= 0) throw new Error('材料已经齐全');
        const sheetQty = q('[data-sheet-qty]', sheet); if (sheetQty) setValue(sheetQty, amount);
        let quick;
        try { quick = await waitFor(() => { const el = q('[data-quick="buy"]', sheet); return el && !el.disabled && el; }, 4000); }
        catch (_) { assertCurrent(); notify(`已打开 ${itemName(itemId)}；报价未就绪，可稍后手动购买`); return; }
        assertCurrent();
        if (Number(q('[data-sheet-icon]', sheet)?.dataset.item) !== itemId) throw new Error('物品已变化，未打开购买确认');
        quick.click();
        const trade = await waitFor(() => {
            const el = q('[data-market-trade]', windowEl) || q('[data-market-trade]');
            return visible(el) && q('.trade-card.buy', el) && el;
        }); assertCurrent();
        if (Number(q('[data-sheet-icon]', sheet)?.dataset.item) !== itemId) throw new Error('物品已变化，未填数量');
        await waitFor(() => !pollBusy);
        if (!await monitorTick(true)) throw new Error('未能核对最新库存，未填购买数量');
        assertCurrent();
        const latestMaterial = active.materials.find(m => m.itemId === itemId);
        if (!latestMaterial || materialQueueIssue(latestMaterial)) throw new Error('队列占用已变化，请核对后重新购买');
        amount = Math.min(1000000, Math.ceil(latestMaterial?.missing || 0));
        if (amount <= 0) throw new Error('材料已经齐全，无需补买');
        const input = q('[data-trade-qty-in]', trade);
        setValue(input, amount);
        const actual = Math.max(0, Number(input.value) || 0);
        notify(actual < amount ? `可售不足：已填 ${fmt(actual)} / 缺 ${fmt(latestMaterial.missing)}，请核对` : amount < latestMaterial.missing ? `本次填 ${fmt(actual)} / 缺 ${fmt(latestMaterial.missing)}，确认后购买` : `已填 ${fmt(actual)}，确认后购买`);
    }
    async function openWorkView(assertCurrent) {
        assertCurrent();
        const shell = q('#app .shell > .m-shell');
        if (!visible(shell)) return;
        if (shell.dataset.mtab !== 'play') {
            const play = q('[data-m-tabs] [data-m-tab="play"]');
            if (!visible(play)) throw new Error('找不到手机技能页入口');
            play.click();
        }
        await waitFor(() => shell.dataset.mtab === 'play' && visible(q('.m-view[data-view="play"]',shell)),3000,'手机技能页未打开，请稍后重试');
        assertCurrent();
    }
    async function craft() {
        if (!catalogVerified) throw new Error(catalogMessage);
        if (!CORE.taskAvailable(active,DATA,character)) throw new Error('此功能暂时暂停，请等待游戏规则重新读取。');
        if (!prefs.autoNavigate) return;
        if (!active || active.locked || complete) throw new Error('请先选择可做的任务');
        preparedEndless = null;
        const taskId = active.id, token = ++navigationToken, person = identity;
        const assertCurrent = () => { if (token !== navigationToken || person !== identity || taskId !== active?.id || complete || !CORE.taskAvailable(active,DATA,character)) throw new Error('任务已变化，请重试'); };
        if (live) { await waitFor(() => !pollBusy); if (!await monitorTick(true)) throw new Error('未能读取当前角色，稍后重试'); assertCurrent(); }
        const task = active;
        if (task.kind === 'forge' && task.forgeNeedsDeposit) throw new Error('目标装备在背包，请先存入仓库再去强化');
        for (const selector of ['[data-market-close]','[data-bank-close]','[data-coll-close]','[data-account-close]']) {
            const close = q(selector); if (visible(close)) close.click();
        }
        if (task.kind === 'forge') {
            const assertForge = () => { assertCurrent(); if (active.itemId !== task.itemId) throw new Error('强化装备已变化，请重试'); };
            if (!visible(q('[data-enhance-veil]'))) {
                const trigger = q('[data-open="enhance"]') || q('[data-m-open="enhance"]');
                if (!trigger) throw new Error('找不到强化入口');
                trigger.click();
            }
            const veil = await waitFor(() => { const el = q('[data-enhance-veil]'); return visible(el) && el; }); assertForge();
            q('[data-enh-tab="enhance"]',veil)?.click();
            q('[data-enhance-cat="all"]',veil)?.click();
            const worn = task.materials.some(material => material.forgeSeed && material.seedEquipped);
            const slotSelector = `[data-enhance-grid] .slot[data-item="${task.itemId}"]:not([data-contract])${worn ? '[data-worn]' : ':not([data-worn])'}`;
            const slot = await waitFor(() => [...veil.querySelectorAll(slotSelector)].find(visible),3000,'找不到对应品质和强化等级的仓库装备；背包装备请先存入仓库'); assertForge();
            slot.click();
            await waitFor(() => q(slotSelector+'.chosen',veil)); assertForge();
            const target = await waitFor(() => q('[data-enhance-detail] [data-enhance-target]',veil)); assertForge();
            setValue(target,task.targetPlus);
            await waitFor(() => Number(q('[data-enhance-detail] [data-enhance-target]',veil)?.value) === task.targetPlus); assertForge();
            const start = q('[data-enhance-detail] [data-act="toN"]',veil);
            if (!start || !q(slotSelector+'.chosen',veil)) throw new Error('强化选项未就绪，请手动核对');
            start.scrollIntoView({block:'nearest',behavior:'instant'});
            notify(`已选 ${itemName(task.itemId)} → +${task.targetPlus}，点击游戏按钮开始`); return;
        }
        await openWorkView(assertCurrent);
        if (task.kind === 'combat') {
            const trigger = q('[data-fight]');
            if (!trigger) throw new Error('找不到战斗入口');
            trigger.click();
            const scope = await waitFor(() => q('.routes[data-open]')); assertCurrent();
            if (scope.dataset.open !== 'true') q('[data-toggle]',scope)?.click();
            const route = await waitFor(() => { const el = q(`.route[data-zone="${task.zoneId}"]`,scope); return visible(el) && el; },3000,'找不到目标战斗区域'); assertCurrent();
            if (route.disabled) throw new Error('目标战斗区域当前不可选');
            route.click();
            await waitFor(() => q(`.route[data-zone="${task.zoneId}"][data-picked="true"]`,scope)); assertCurrent();
            const opt = q('[data-opt-line]',scope); if (opt && opt.getAttribute('aria-expanded') !== 'true') opt.click();
            const endless = await waitFor(() => { const el = q('[data-stop-mode="endless"]',scope); return visible(el) && el; }); assertCurrent(); endless.click();
            if (!q(`.route[data-zone="${task.zoneId}"][data-picked="true"]`,scope) || q('[data-stop-mode="endless"]',scope)?.getAttribute('aria-selected') !== 'true') throw new Error('战斗选项已变化，请重试');
            const start = await waitFor(() => { const el = q('[data-start]',scope); return visible(el) && el; }); assertCurrent();
            const queue = q('[data-queue]',scope);
            if (live && (!start.disabled || queue && !queue.disabled)) preparedEndless = {...task,person:identity,generation:sessionGeneration};
            start.scrollIntoView({block:'nearest',behavior:'instant'});
            if (!start.disabled) start.focus({preventScroll:true});
            notify(`${workName(task)} - 已选无限战斗，核对后点击游戏“开始”${live ? '；目标达标自动移出队列' : ''}`); return;
        }
        const skill = q(`[data-skills] .skill-cell[data-skill="${task.skill}"]`);
        if (!skill) throw new Error('找不到技能入口');
        const nav = q('[data-nav="skills"]');
        if (!visible(skill) && nav?.getAttribute('aria-pressed') !== 'true') nav?.click();
        skill.click();
        const workPanel = await waitFor(() => q('.routes[data-open]')); assertCurrent();
        if (workPanel?.dataset.open !== 'true') q('[data-toggle]', workPanel || document)?.click();
        await waitFor(() => {
            const heading = q('.route-heading', workPanel)?.textContent.trim();
            return heading && (skillNames[task.skill] || []).some(name => heading === name || heading.startsWith(name + ' '));
        }, 4000, `技能视图未切换到${skills[task.skill] || task.skill}，请重试`); assertCurrent();
        if (task.kind === 'farm') {
            q('[data-fields]', workPanel || document)?.scrollIntoView({ block:'center', behavior:'instant' });
            notify(`在地块选择 ${itemName(task.itemId)}，手动种植并收获`); return;
        }
        if (task.kind === 'upgrade') {
            const scope = workPanel || document;
            if (!q(`[data-upgrade="${task.recipeId}"]`, scope)) {
                q('[data-unlocks][aria-pressed="true"]', scope)?.click();
                if (!q('[data-cat="upgrades:"]', scope)) q('[data-cat-back]', scope)?.click();
                const category = await waitFor(() => q('[data-cat="upgrades:"]', scope)); assertCurrent(); category.click();
            }
            const card = await waitFor(() => q(`[data-upgrade="${task.recipeId}"]`, scope)); assertCurrent();
            card.scrollIntoView({ block:'center', behavior:'instant' });
            notify(`已打开${skills[task.skill] || task.skill}；找到${itemName(task.itemId)}升级卡，核对材料后手动升级`); return;
        }
        if (!task.jobId) { notify('已打开技能；请选择对应升级配方'); return; }
        const scope = workPanel || document, job = jobMap.get(task.jobId);
        if (!q(`.route[data-job="${task.jobId}"]`, scope)) {
            const unlocks = q('[data-unlocks][aria-pressed="true"]', scope);
            unlocks?.click(); assertCurrent();
            const findCategory = () => [...scope.querySelectorAll('[data-cat]')].find(el => job && (el.dataset.cat === job.group || el.dataset.cat === job.groupZh));
            if (!findCategory()) q('[data-cat-back]', scope)?.click();
            const category = await waitFor(findCategory, 3000, `找不到${job?.groupZh || job?.group || '目标'}分类`); assertCurrent(); category.click();
        }
        const route = await waitFor(() => { const el = q(`.route[data-job="${task.jobId}"]`, scope); return visible(el) && el; }, 3000, `找不到配方：${workName(task)}`); assertCurrent();
        if (route.disabled) throw new Error('配方当前不可选，请补齐材料或等级后重试');
        route.click();
        await waitFor(() => q(`.route[data-job="${task.jobId}"][data-picked="true"]`, scope)); assertCurrent();
        const rarityBox = q('[data-rarity-choices]', scope);
        const productionRarity = task.productionRarity ?? task.rarity;
        const rarity = rarityBox && q(`[data-rarity="${productionRarity}"]`, rarityBox);
        if (task.kind === 'craft' || task.kind === 'upgrade') {
            if (!rarity || rarity.disabled) throw new Error('目标品质不可选，请补齐对应材料后重试');
            rarity.click();
            const selected = q(`[data-rarity-choices] [data-rarity="${productionRarity}"]`, scope);
            if (selected?.getAttribute('aria-pressed') !== 'true') throw new Error('品质未选中，请手动核对');
        }
        const opt = q('[data-opt-line]', scope);
        if (opt && opt.getAttribute('aria-expanded') !== 'true') opt.click();
        const mode = task.stopMode === 'endless' ? 'endless' : 'count';
        const stopMode = await waitFor(() => { const el = q(`[data-stop-mode="${mode}"]`, scope); return visible(el) && el; }); assertCurrent(); stopMode.click();
        if (mode === 'count') {
            const amount = await waitFor(() => { const el = q('[data-amount-any]', scope); return visible(el) && el; }); assertCurrent();
            setValue(amount, Math.min(1000000, Math.max(1, Math.ceil(task.batches))));
        }
        if (!q(`.route[data-job="${task.jobId}"][data-picked="true"]`, scope)) throw new Error('目标配方已变化，请重试');
        if (task.kind === 'craft' && q(`[data-rarity-choices] [data-rarity="${productionRarity}"]`, scope)?.getAttribute('aria-pressed') !== 'true') throw new Error('品质已变化，请核对材料后重试');
        const start = await waitFor(() => { const el = q('[data-start]', workPanel || document); return visible(el) && el; }); assertCurrent();
        start.scrollIntoView({ block:'center', inline:'nearest', behavior:'instant' });
        const queue = q('[data-queue]', scope);
        if (canMonitor(task) && mode === 'endless' && live && (!start.disabled || queue && !queue.disabled)) preparedEndless = { ...task, person:identity, generation:sessionGeneration };
        if (!start.disabled) start.focus({ preventScroll:true });
        if (start.disabled && (!queue || queue.disabled)) { notify('已展开目标与次数；请按游戏提示补齐开始条件'); return; }
        notify(mode === 'endless' ? `${workName(task)} - 无限次数${canAutoStop(task) && live ? '，达标后自动移出队列' : '，达标后手动停止'}` : task.batches > 1000000 ? '本次已填 100 万次；完成后可继续此任务' : `${workName(task)} - 已填 ${fmt(task.batches)} 次，点击游戏“开始”`);
    }
    function selectTask(id) {
        const task = routeFor(tab === 'hidden').tasks.find(t=>t.id === id) || plan.tasks.find(t=>t.id === id);
        if (!CORE.taskAvailable(task,DATA,character)) return;
        taskListTab = tab === 'hidden' ? 'hidden' : 'route';
        active = { ...task, monitorFinite:queuedWork(task) }; complete = task.current >= task.target; navigationToken++; tab = 'task';
        marketCheckAt = 0;
        if (queuedWork(task)) { trackEndless(active,true,true,true); scheduleSync(100); }
        render();
        if (queuedWork(task)) notify(`${taskItemName(task)} - ${queueStatusText(task)}${canAutoStop(active) && !complete ? ' - 达标自动移除' : ''}`);
    }
    function nextTask(skip = false) {
        if (active) skipped.add(active.id);
        routeCache.clear();
        active = nextAvailable(); taskListTab = 'route';
        complete = false; navigationToken++; tab = active ? 'task' : 'route'; render();
        if (!active) notify(skip ? '已跳过；可在路线中重新选择' : '当前路线已看完，可切换技能');
    }
    function taskLabel(t) { return t.kind === 'combat' ? '战斗' : t.routeUnsupported ? '查看技能' : t.kind === 'forge' ? `强化至 +${t.targetPlus}` : t.kind === 'upgrade' ? '升级' : t.kind === 'farm' ? '种植' : t.skill === 'thieving' ? '盗窃' : t.skill === 'mining' ? '采矿' : t.skill === 'fishing' ? '钓鱼' : t.skill === 'woodcutting' ? '伐木' : t.kind === 'gather' ? '采集' : '制作'; }
    function taskItemName(t) {
        return itemName(t.kind === 'forge' ? CORE.encodeItem(t.baseItemId,t.rarity,t.targetPlus,DATA) : t.itemId);
    }
    function taskTitleHTML(t) {
        const forge = t.kind === 'forge';
        const type = forge ? '强化' : t.kind === 'upgrade' ? '升级' : t.kind === 'farm' ? '种植' : skills[t.skill] || taskLabel(t);
        const name = itemName(forge ? CORE.encodeItem(t.baseItemId,t.rarity,0,DATA) : t.itemId);
        return `<span class="task-type">${esc(type)}</span> <span class="task-name">${esc(name)}</span>${forge ? ` <span class="task-goal">+${t.targetPlus}</span>` : ''}`;
    }
    function routeDescription(t) {
        const locked = t.locked && !queuedWork(t);
        return [
            t.kind === 'combat' || t.sourceType ? workName(t) : '',
            locked ? `${skills[t.skill] || t.skill} ${t.levelReq}级解锁` : t.kind === 'forge' ? `当前 +${t.currentPlus}` : `${fmt(t.current)} / ${fmt(t.target)}`,
            locked ? '' : taskTime(t),
            t.kind === 'forge' ? `平均成功率 ${fmt(CORE.forgeSuccessPercent(t))}%` : '',
            t.randomOutput && t.rarity > 0 ? '随机' : '',
            t.relatedWork ? t.kind === 'combat' ? '同场战斗掉落' : '同配方产出' : '',
            ({stock:'材料货量不足',quote:'报价待确认',material:'需自产材料',budget:'金币不足',queue:'队列待确认',deposit:'装备需存仓'})[t.routeIssue] || (t.routeStockBlocked ? '材料货量不足' : ''),
            queuedWork(t) && t.queuedBatches ? `队列合计 ${fmt(t.queuedBatches)} 次` : '',
            t.queueReachable === false ? '队列数量不足以达标' : '',
            t.awaitingStop ? '达标待停止' : ''
        ].filter(Boolean).join(' - ');
    }
    function queueLabel(t) {
        const status = queueStatusText(t);
        return t.stopIssue || (t.awaitingStop ? '已达标 - 等待停止确认' : canAutoStop(t) && !endlessTargets.has(workKey(t)) ? `${status} - 未设停止目标` : status);
    }
    function workName(t, bilingual = false) {
        if (t.kind === 'combat') { const zone = zoneMap.get(t.zoneId), monster = monsterMap.get(t.monsterId); return [zone?.nameZh || zone?.name, monster?.nameZh || monster?.name].filter(Boolean).join(' - '); }
        const job = t.kind !== 'upgrade' && jobMap.get(t.jobId);
        if (!job) return t.actionName || itemName(t.itemId);
        const name = job.nameZh || job.name;
        return bilingual && name !== job.name ? `${name}（${job.name}）` : name;
    }
    function routeMetricAttributes(t) {
        return `data-route-cost-per-point="${t.routeCoinsPerPoint ?? ''}" data-route-seconds="${t.routeSeconds ?? ''}" data-route-purchase="${t.routeCost ?? ''}" data-route-stock-used="${t.routeMaterials?.reduce((sum,m) => sum+(m.allocated || 0),0) ?? ''}"`;
    }
    function forgeConsumption(t) {
        const parts = [`${fmtMoney(t.expectedGold)} 金币`,`${fmt(t.expectedShards)} 碎片`];
        if (t.expectedCores > 0) parts.push(`${fmt(t.expectedCores)} 核心`);
        if (t.expectedScrolls > 0) parts.push(`${fmt(t.expectedScrolls)} 保护卷轴`);
        return parts.join(' + ');
    }
    function routeEfficiencyHTML(t) {
        if (t.kind === 'forge') return `<span class="route-efficiency">期望 ${esc(forgeConsumption(t))}</span>`;
        if (!t.routeIndex || !['craft','upgrade'].includes(t.kind)) return '';
        const money = t.routeCoinsPerPoint == null ? '费用待确认' : `${t.routeCoinsPerPoint > 0 && t.routeCoinsPerPoint < .01 ? '<0.01' : fmtMoney(t.routeCoinsPerPoint)} 金/点`;
        return `<span class="route-efficiency">${esc(money)}</span>`;
    }
    const filterButtons = (action,rows,selected) => rows.map(([id,name]) => `<button type="button" data-action="${action}" data-value="${id}" aria-pressed="${selected === id}">${esc(name)}</button>`).join('');
    function routeHTML(hidden = false) {
        if (!catalogVerified) return `<div class="empty" role="status">${esc(catalogMessage)}<div class="actions"><button data-action="catalog-retry">重试读取任务数据</button></div></div>`;
        if (!character) return '<div class="empty">未读取角色</div>';
        if (planError && plan.summary.taskCount === undefined) return `<div class="empty" role="status">${esc(planError)}</div>`;
        const route = routeFor(hidden,true), tasks = route.tasks;
        const list = hidden ? 'hidden' : 'route', pageCount = Math.max(1,Math.ceil(tasks.length/PAGE_SIZE));
        const page = route.pending ? 0 : (routePages[list] = Math.min(routePages[list],pageCount-1)), offset = page*PAGE_SIZE;
        const cached = listViews.get(list);
        if (cached?.route === route && cached.key === routeKey(hidden) && cached.page === page && cached.monitor === monitorSaved) return cached.html;
        const shown = tasks.slice(offset,offset+PAGE_SIZE);
        const visibleSkills = Object.entries(skills).filter(([id]) => filterSkills.has(id) && (prefs.category === 'all' || categories[prefs.category].skills.includes(id)));
        const qualityFilter = hasQualityFilter() ? `<select data-action="rarity" aria-label="筛选品质">${[['all','品质'],...rarities.map((name,index) => [String(index),name])].map(([id,name]) => `<option value="${id}"${prefs.rarity === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>` : '';
        const filters = `<div class="filters"><div class="category-filter" role="group" aria-label="筛选大分类">${filterButtons('category',[['all','全部'],...Object.entries(categories).map(([id,row]) => [id,row.name])],prefs.category)}</div><div class="skill-filter" role="group" aria-label="筛选技能"><div class="skill-options">${filterButtons('skill',[['all','全部'],...visibleSkills],prefs.skill)}</div>${qualityFilter}</div></div>`;
        const rows = shown.map((t,i) => {
            const queued = queuedWork(t), status = queueStatusText(t);
            const current = Math.max(0,Math.min(t.target || 0,t.current || 0)), progress = Math.max(0,Math.min(100,(t.progress || 0)*100));
            return `<div class="route-entry"><button class="route-row" data-action="select" data-id="${esc(t.id)}" ${routeMetricAttributes(t)}${queued ? ` data-queue-status="${t.queueStatus}"` : ''}><span class="rank">${offset+i+1}</span><span class="route-text"><span class="route-title"><strong class="task-heading" title="${esc(taskItemName(t))}">${taskTitleHTML(t)}</strong></span><small>${esc(routeDescription(t))}</small>${queued ? `<span class="queue-progress" role="progressbar" aria-label="自产精通进度" aria-valuemin="0" aria-valuemax="${t.target}" aria-valuenow="${current}" data-current="${t.current}" data-target="${t.target}"><i style="width:${progress}%"></i></span>` : ''}${routeEfficiencyHTML(t)}</span><span class="route-end">${queued ? `<span class="queue-status" data-queue-status="${t.queueStatus}" title="${esc(queueLabel(t))}">${status}</span>` : ''}<span class="points">+${fmt(t.gain)}</span></span></button><button class="hide-task" data-action="${hidden ? 'restore' : 'hide'}" data-task-id="${esc(t.id)}" title="${hidden ? '移回默认任务列表' : '隐藏任务'}" aria-label="${hidden ? '移回默认任务列表' : '隐藏任务'}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${hidden ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' : '<path d="m3 3 18 18M10.6 5.1A12.1 12.1 0 0 1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3.2 4.1M6.3 6.3A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.7-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'}</svg></button></div>`;
        }).join('');
        const empty = route.pending ? '正在计算任务路线…' : searchWords.length ? '无匹配任务' : hidden ? '暂无隐藏的任务' : prefs.category === 'combat' ? '暂无可规划的战斗精通任务' : '暂无任务';
        const pagination = `<div class="route-pagination" aria-label="任务分页"><button data-action="page" data-page="${page-1}" ${page === 0 ? 'disabled' : ''}>上一页</button><span data-page-status>${page+1} / ${pageCount} - 共 ${fmt(tasks.length)} 项</span><button data-action="page" data-page="${page+1}" ${page === pageCount-1 ? 'disabled' : ''}>下一页</button></div>`;
        const html = `<div class="route-view"><div class="toolbar">${filters}</div><div class="route-scroll"><div class="list">${rows || `<div class="empty">${empty}</div>`}</div></div>${pagination}</div>`;
        listViews.set(list,{route,key:routeKey(hidden),page,html,node:null,selected:null,scrollTop:0,monitor:monitorSaved});
        return html;
    }
    function syncListSelection(view) {
        if (!view?.node || view.selected === active?.id) return;
        for (const row of view.node.querySelectorAll('.route-entry.selected,.route-row.selected')) row.classList.remove('selected');
        const button = active && [...view.node.querySelectorAll('[data-action="select"]')].find(row=>row.dataset.id === active.id);
        button?.classList.add('selected'); button?.closest('.route-entry').classList.add('selected');
        view.selected = active?.id;
    }
    function materialQueueIssue(material) {
        if (material.bankOwned === 0 && material.packOwned === 0) return '';
        if (!character.completeness.workOrders) return '队列待同步';
        return material.reservationUncertain ? '队列占用不定' : '';
    }
    function taskHTML() {
        if (!active) return '<div class="empty">从路线中选择一项任务</div>';
        const t = active, progress = complete ? 100 : Math.max(0, Math.min(100, (t.progress || 0) * 100));
        const noMarket = character?.ironman;
        const materialTotal = CORE.purchaseCost(t.materials,quotes(),0,true);
        const totalLabel = materialTotal === null ? prices ? '未报价' : quoteStatus() : `${fmtMoney(materialTotal)} 金币`;
        const purchaseLabel = t.materials.map(materialQueueIssue).find(Boolean) || (t.cost === 0 ? '无需补买' : t.cost == null ? prices ? '未报价' : quoteStatus() : `${fmtMoney(t.cost)} 金币`);
        const warning = t.routeUnsupported ? '被动技能宠物：完成该技能动作时随机获得' : t.stopIssue || (t.awaitingStop ? '已达标 - 等待停止确认' : t.locked ? `${skills[t.skill] || t.skill} 达到 ${t.levelReq} 级解锁` : t.forgeNeedsDeposit ? '强化装备在背包，请先存入仓库' : complete && t.stopMode === 'endless' && !canAutoStop(t) ? '目标已完成，请点击游戏“停止”' : t.uncertainAttempts ? '随机产出或可能失败；以实际自产进度为准' : '');
        const queueStatus = queuedWork(t) ? `<span class="queue-status" data-task-queue-status data-queue-status="${t.queueStatus}" title="${esc(queueLabel(t))}">${queueStatusText(t)}</span>` : '';
        const materials = t.materials.length ? `<div class="materials">${t.materials.map(m => {
            const quote = quotes()[m.itemId];
            const issue = materialQueueIssue(m);
            const blocked = !prefs.autoNavigate ? '跳转已关闭' : noMarket ? '铁人模式' : m.marketTradable === false ? '不可交易' : !live ? '等待角色' : complete ? '已完成' : issue;
            const stock = `${t.materialsEstimated ? '预计需' : '需'} ${fmt(m.need)} - 仓 ${fmt(m.bankOwned)} - 身 ${fmt(m.packOwned)}${m.seedEquipped ? ' - 已穿戴' : m.needsDeposit ? ' - 先存仓' : ''}${issue ? ` - ${issue}` : `${m.reserved ? ` - 占用 ${fmt(m.reserved)} - 可用 ${fmt(m.owned)}` : ''}${m.missing > 0 ? ` - 缺 ${fmt(m.missing)}` : ' - 已齐'}`}`;
            const stockIssue = Number.isSafeInteger(quote?.sellQty) && quote.sellQty >= 0 && quote.sellQty < m.missing ? quote.sellQty === 0 ? '市场缺货' : '货量不足' : '';
            return `<div class="material" data-material="${m.itemId}"><div class="material-main"><strong>${esc(itemName(m.itemId))}</strong><small>${esc(stock)}</small></div>${m.missing > 0 || issue ? `<button data-action="market" data-item="${m.itemId}" title="${esc(blocked || stockIssue || '打开对应品质并预填缺量')}" ${blocked ? 'disabled' : ''}>${esc(blocked || stockIssue || '去购买')}</button>` : '<span class="ok">✓</span>'}</div>`;
        }).join('')}</div>` : '';
        return `<div class="task-head"><div class="task-title"><h2 class="task-heading" title="${esc(taskItemName(t))}">${taskTitleHTML(t)}</h2>${t.kind === 'forge' ? '' : `<small>${esc(skills[t.skill] || t.skill)} - ${t.levelReq}级</small>`}</div><span class="route-end">${queueStatus}<span class="gain">+${fmt(t.gain)} 点</span></span></div>
            <div class="progress"><i style="width:${progress}%"></i></div><div class="between"><strong>${complete ? '已完成 ✓' : t.kind === 'forge' ? `目标 +${t.targetPlus}` : `${fmt(t.current)} / ${fmt(t.target)}`}</strong><span class="muted">${complete ? '' : taskTime(t)}</span></div>
            ${warning ? `<p class="warning">${esc(warning)}</p>` : ''}
            ${t.materialsConservative ? '<p class="muted" data-materials-conservative>材料按未触发节省估算，实际消耗可能更少。</p>' : ''}
            ${t.kind === 'forge' ? `<div class="estimate"><div class="between"><span class="muted">成功率</span><span>${esc(fmt(CORE.forgeSuccessPercent(t)))}%</span></div><div class="between"><span class="muted">期望消耗</span><span>${esc(forgeConsumption(t))}</span></div></div>` : ''}
            ${materials}${t.materials.length ? `<div class="estimate"><div class="between"><span class="muted">材料总价</span><span data-material-total>${esc(totalLabel)}</span></div><div class="between"><span class="muted">${t.kind === 'forge' ? '最低操作预算' : '操作预算'}</span><span data-purchase-cost>${esc(purchaseLabel)}${t.cost > (character?.coins || 0) ? ' - 金币不足' : ''}</span></div></div>` : ''}
            `;
    }
    function taskActionsHTML() {
        if (!active) return '';
        const t = active, action = t.kind === 'upgrade' ? '打开技能' : t.kind === 'forge' ? '去强化' : `去${taskLabel(t)}`;
        return `<div class="actions task-actions">${complete ? '<button class="primary" data-action="next">下一项 →</button>' : `${queuedWork(t) ? '<button class="primary" data-action="back-list">返回列表</button>' : `<button class="primary" data-action="craft" ${!CORE.taskAvailable(t,DATA,character) || t.locked || t.routeUnsupported || !prefs.autoNavigate ? 'disabled' : ''} title="${prefs.autoNavigate ? '' : '自动跳转已关闭'}">${esc(action)}</button>`}<button data-action="sync" ${!live ? 'disabled' : ''}>刷新进度</button>`}<button data-action="skip">跳过</button></div>`;
    }
    const settingControls = [['auto-navigate','autoNavigate','自动跳转'],['price-sort','materialPriceSort','制造性价比排序'],['sound','sound','完成提示音'],['locked','showLocked','显示未解锁任务']];
    const settingKeys = Object.fromEntries(settingControls.map(([action,key]) => [action,key]));
    function statsHTML(className) {
        if (!catalogVerified) return '';
        const totals = [availablePoints,plan.summary.totalPoints,plan.summary.readyCount].map(value => {
            const text = fmt(value);
            return `<strong style="--value-width:${Math.max(1,text.length) * .65}">${text}</strong>`;
        });
        return `<div class="stats ${className}"><div><small>可用精通</small>${totals[0]}</div><div><small>精通已得</small>${totals[1]}</div><div><small>可做任务</small>${totals[2]}</div></div>`;
    }
    function settingsHTML() {
        return `<div class="settings">${statsHTML('stats-settings')}${settingControls.map(([action,key,label]) => `<label><span>${label}</span><input type="checkbox" data-action="${action}" ${prefs[key] ? 'checked' : ''}></label>`).join('')}<div class="actions"><button data-action="sync">读取当前角色</button><button data-action="prices">刷新行情</button><button data-action="import">导入角色</button><button data-action="reset">贴合任务面板</button></div><small class="muted">${esc(quoteStatus())}</small></div>`;
    }
    const opinionDateFormat = new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short'});
    const opinionDate = value => { const time = Date.parse(value); return Number.isFinite(time) ? opinionDateFormat.format(time) : ''; };
    async function opinionRequest(path, options = {}) {
        const controller = new AbortController(), stop = () => controller.abort();
        let timeout;
        abort.signal.addEventListener('abort',stop,{once:true});
        try {
            timeout = setTimeout(stop,12000);
            const response = await fetch(`${OPINIONS_API}${path}`,{...options,headers:{Accept:'application/json',...(options.headers || {})},credentials:'omit',cache:'no-store',signal:controller.signal});
            if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw new Error('\u7559\u8A00\u670D\u52A1\u8FD4\u56DE\u683C\u5F0F\u65E0\u6548');
            const data = await response.json();
            if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0,160) : `\u8BF7\u6C42\u5931\u8D25\uFF08${response.status}\uFF09`);
            return data;
        } finally {
            clearTimeout(timeout); abort.signal.removeEventListener('abort',stop);
        }
    }
    async function reportPresence() {
        if (!catalogVerified || disposed || !live || presenceBusy) return;
        const roleName = typeof character?.name === 'string' ? character.name.normalize('NFKC').replace(/\s+/g,' ').trim() : '';
        if (!roleName) return;
        const now = Date.now(), day = Math.floor((now+28800000)/86400000), previous = presenceDays.get(roleName);
        if (previous?.day === day && (previous.registered || now < previous.retryAt)) return;
        const state = host.deepvein?.session?.state;
        if (state ? !samePerson(state,character) : !bridgeReady || now-lastSync > 45000 || !q('[data-account-body]')) return;
        const dayKey = `${PRESENCE_KEY}:day:${roleName}`;
        try {
            if (localStorage.getItem(dayKey) === String(day)) { presenceDays.set(roleName,{day,registered:true}); return; }
        } catch (_) {}
        presenceDays.set(roleName,{day,retryAt:now+300000});
        let playerKey = `dvi-${globalThis.crypto?.randomUUID?.() || `${now.toString(36)}-${Math.random().toString(36).slice(2)}`}`;
        try {
            const key = `${PRESENCE_KEY}:${roleName}`, saved = localStorage.getItem(key);
            if (/^[A-Za-z0-9_-]{8,128}$/.test(saved || '')) playerKey = saved;
            else localStorage.setItem(key,playerKey);
        } catch (_) {}
        const masteryPoints = Number.isSafeInteger(availablePoints) && availablePoints >= 0 ? availablePoints : null;
        const validPoints = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
        let totalMasteryPoints = null, masteryAllocation = null;
        if (character.completeness?.collections && character.completeness.forgeLog) {
            const collection = CORE.collectionPoints(character.collections,DATA), forge = CORE.forgePoints(character.forgeLog,DATA);
            if (collection !== null && forge !== null && validPoints(collection+forge)) totalMasteryPoints = collection+forge;
        }
        if (character.completeness?.masteries) {
            const allocation = Object.fromEntries(masteryKeys.map(key => {
                const rank = character.masteries[key] ?? 0;
                return [key,{rank,points:masteryRankPoints(rank)}];
            }));
            if (Object.values(allocation).every(row => Number.isSafeInteger(row.rank) && row.rank >= 0 && row.rank <= 1e6 && validPoints(row.points))) masteryAllocation = allocation;
        }
        presenceBusy = true;
        try {
            const result = await opinionRequest('/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerKey,roleName,masteryPoints,totalMasteryPoints,masteryAllocation})});
            if (result.ok !== true || disposed) return;
            presenceDays.set(roleName,{day,registered:true});
            try { const saved = Number(localStorage.getItem(dayKey)); if (!Number.isSafeInteger(saved) || saved < day) localStorage.setItem(dayKey,String(day)); } catch (_) {}
        } catch (_) {
            // Presence is best-effort and must not affect task planning.
        } finally {
            presenceBusy = false;
            if (!disposed && character && roleName !== character.name?.normalize('NFKC').replace(/\s+/g,' ').trim()) void reportPresence();
        }
    }
    async function loadOpinions(append = false) {
        if (opinionLoading || disposed) return;
        opinionLoading = true; opinionError = ''; render();
        try {
            const query = new URLSearchParams({limit:'30'});
            if (append && opinionCursor) query.set('before',opinionCursor);
            const data = await opinionRequest(`/opinions?${query}`);
            if (!Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || data.items.length > 30 || data.items.some(item => !item || typeof item.id !== 'string' || !/^匿名网友[1-9]\d{3}$/.test(item.nickname) || typeof item.content !== 'string' || !Array.isArray(item.replies) || item.replies.some(reply => !reply || typeof reply.id !== 'string' || typeof reply.content !== 'string'))) throw new Error('\u7559\u8A00\u670D\u52A1\u8FD4\u56DE\u5185\u5BB9\u65E0\u6548');
            opinionItems = append ? [...opinionItems,...data.items] : data.items;
            opinionHasMore = data.hasMore; opinionCursor = opinionItems.at(-1)?.id || ''; opinionLoaded = true;
        } catch (error) {
            if (!disposed && error.name !== 'AbortError') opinionError = error.message || '\u7559\u8A00\u52A0\u8F7D\u5931\u8D25';
        } finally {
            opinionLoading = false;
            if (!disposed && tab === 'opinions') render();
        }
    }
    function opinionHTML() {
        return `<div class="opinions"><div class="opinion-form-heading"><strong>建议与反馈</strong><small>提交无意义或催更留言将封禁提交权限</small></div>${opinionError ? `<div class="warning">${esc(opinionError)}</div>` : ''}<form class="opinion-form" novalidate><textarea name="content" aria-label="修改建议" maxlength="1200" required placeholder="写下你对插件的修改建议（2–1200字）"${opinionSubmitting ? ' disabled' : ''}>${esc(opinionDraft)}</textarea><button type="submit" class="primary" data-action="opinion-submit" ${opinionSubmitting ? 'disabled' : ''}>${opinionSubmitting ? '\u63D0\u4EA4\u4E2D...' : '\u63D0\u4EA4\u5EFA\u8BAE'}</button></form></div>`;
    }
    async function submitOpinion(form) {
        if (!form || opinionSubmitting || disposed) return;
        const field = form.elements.namedItem('content');
        const content = typeof field?.value === 'string' ? field.value.trim() : '';
        opinionDraft = content;
        if (!content || content.length < 2 || content.length > 1200) {
            opinionError = '建议内容需要 2-1200 个字符。';
            render();
            notify(opinionError,true);
            return;
        }
        const nativeState = host.deepvein?.session?.state;
        const nativeName = typeof nativeState?.name === 'string' ? nativeState.name.trim() : '';
        const fallbackName = live ? character?.name : '';
        const roleName = nativeName || (typeof fallbackName === 'string' ? fallbackName.trim() : '');
        if (!roleName || Array.from(roleName).length > 100) {
            opinionError = '未读取到当前游戏角色，请先进入游戏并等待角色信息加载后再提交。';
            render();
            notify(opinionError,true);
            return;
        }
        opinionSubmitting = true; opinionError = ''; render();
        try {
            const data = await opinionRequest('/opinions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roleName,content})});
            if (!data.item || typeof data.item.id !== 'string' || !/^匿名网友[1-9]\d{3}$/.test(data.item.nickname) || !Array.isArray(data.item.replies)) throw new Error('\u7559\u8A00\u670D\u52A1\u8FD4\u56DE\u5185\u5BB9\u65E0\u6548');
            opinionDraft = ''; opinionItems = [data.item,...opinionItems.filter(item => item.id !== data.item.id)]; opinionLoaded = true; opinionCursor = opinionItems.at(-1)?.id || '';
            notify('\u5EFA\u8BAE\u5DF2\u63D0\u4EA4\uFF0C\u6240\u6709\u7528\u6237\u5747\u53EF\u67E5\u770B');
        } catch (error) {
            opinionError = error?.name === 'AbortError' ? '\u63D0\u4EA4\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5' : error.message || '\u5EFA\u8BAE\u63D0\u4EA4\u5931\u8D25';
            notify(opinionError,true);
        } finally {
            opinionSubmitting = false;
            if (!disposed && tab === 'opinions') render();
        }
    }
    function opinionListHTML() {
        const lineBreaks = value => esc(value).replace(/\n/g,'<br>');
        const entries = opinionItems.map(item => `<article class="opinion-entry"><div class="between"><strong>${esc(item.nickname)}</strong><small>${esc(opinionDate(item.createdAt))}</small></div><p>${lineBreaks(item.content)}</p>${item.replies.map(reply => `<div class="opinion-reply"><small>\u56DE\u590D \u00B7 ${esc(opinionDate(reply.createdAt))}</small><p>${lineBreaks(reply.content)}</p></div>`).join('')}</article>`).join('');
        return `<div class="opinion-popup-inner"><div class="toolbar"><div class="opinion-heading"><strong>留言内容</strong></div><button type="button" data-action="opinions-refresh" ${opinionLoading ? 'disabled' : ''}>刷新留言</button></div><div class="opinion-scroll"><div class="opinion-list">${entries || `<div class="empty">${opinionLoading ? '\u6B63\u5728\u52A0\u8F7D\u7559\u8A00...' : opinionError ? '\u6682\u65F6\u65E0\u6CD5\u663E\u793A\u7559\u8A00' : '\u8FD8\u6CA1\u6709\u7559\u8A00'}</div>`}</div>${opinionHasMore ? `<button class="opinion-more" type="button" data-action="opinions-more" ${opinionLoading ? 'disabled' : ''}>${opinionLoading ? '\u52A0\u8F7D\u4E2D...' : '\u52A0\u8F7D\u66F4\u65E9\u7684\u7559\u8A00'}</button>` : ''}</div></div>`;
    }
    function prioritySelectHTML() {
        return `<select class="route-priority-select" data-action="route-priority" aria-label="路线优先" title="${esc(routePriorities.find(([id]) => id === prefs.routePriority)[2])}">${routePriorities.map(([id,name]) => `<option value="${id}"${prefs.routePriority === id ? ' selected' : ''}>${name}</option>`).join('')}</select>`;
    }
    
    function applySearch(value) {
        searchText = value;
        const normalized = normalizeSearch(value);
        if (normalized === searchWords.join(' ')) return;
        searchWords = normalized ? normalized.split(' ') : [];
        if (prefs.collapsed) { prefs.collapsed = false; savePrefs(); }
        if (!['route','hidden'].includes(tab)) { tab = taskListTab; navigationToken++; }
        resetRouteViews(); render();
    }
    function render() {
        if (!shadow || disposed) return;
        if (document.hidden) { renderDeferred = true; return; }
        renderDeferred = false;
        if (!canShowPanel()) {
            root.style.visibility = 'hidden';
            if (character && catalogVerified && (!planning || planningContext !== planningKey())) replan(false,false,true);
            if (renderedHTML) return;
        }
        const oldScroll = (shadow.querySelector('.route-scroll') || shadow.querySelector('.content'))?.scrollTop || 0;
        const navigation = prefs.collapsed ? '' : [['route','任务'],['hidden','隐藏的任务'],['settings','设置']].map(([id,name]) => `<button class="${(tab === 'task' ? taskListTab : tab) === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${name}</button>`).join('') + (tab === 'opinions' ? '' : prioritySelectHTML());
        const opinionOpen = !prefs.collapsed && tab === 'opinions';
        const content = prefs.collapsed ? '' : `${opinionOpen ? '' : `${statsHTML('stats-main')}<nav>${navigation}</nav>`}<main class="content${tab === 'route' || tab === 'hidden' ? ' route-content' : opinionOpen ? ' opinion-content' : ''}">${tab === 'route' ? routeHTML() : tab === 'hidden' ? routeHTML(true) : tab === 'task' ? taskHTML() : tab === 'opinions' ? opinionHTML() : settingsHTML()}</main>`;
        const search = prefs.collapsed || tab === 'opinions' ? '' : `<input type="search" data-action="search" aria-label="搜索任务名" placeholder="搜索任务" maxlength="120" autocomplete="off" spellcheck="false" value="${esc(searchText)}">`;
        const backTask = !prefs.collapsed && (tab === 'task' || tab === 'opinions') ? `<button type="button" class="back-task" data-action="back-list" title="返回任务列表">返回任务</button>` : '';
        const suggestionButton = prefs.collapsed || tab === 'opinions' ? '' : '<button type="button" class="suggest-button primary" data-action="tab" data-tab="opinions" title="提建议" aria-label="提建议">提建议</button>';
        const html = `<header><button type="button" class="panel-title" data-action="toggle-panel" title="${prefs.collapsed ? '展开' : '收起'}" aria-expanded="${!prefs.collapsed}">${tab === 'opinions' ? '提建议' : '精通助手'}</button>${search}${suggestionButton}<span class="header-tail">${backTask}<button data-action="collapse" title="${prefs.collapsed ? '展开' : '收起'}">${prefs.collapsed ? '＋' : '－'}</button></span></header>${content}${!prefs.collapsed && tab === 'task' ? taskActionsHTML() : ''}<div class="toast" role="status" aria-live="polite" hidden></div><input type="file" accept=".json,application/json" hidden data-file>`;
        renderOpinionPopup(opinionOpen);
        const listView = !prefs.collapsed && (tab === 'route' || tab === 'hidden') ? listViews.get(tab) : null;
        const reusedList = !!listView?.node;
        if (html === renderedHTML) {
            if (listView && !listView.node) listView.node = panel.querySelector('main');
            syncListSelection(listView); return;
        }
        if (renderedTab === 'route' || renderedTab === 'hidden') {
            const previous = listViews.get(renderedTab);
            if (previous?.node?.isConnected) previous.scrollTop = oldScroll;
        }
        const focus = shadow.activeElement;
        const focusAction = focus?.dataset.action;
        const focusId = focus?.dataset.id;
        const next = document.createElement('template');
        next.innerHTML = listView?.node ? html.replace(`<main class="content route-content">${listView.html}</main>`,'<main class="content route-content"></main>') : html;
        const current = new Map([...panel.children].map(el => [`${el.tagName}:${el.className}`,el]));
        let index = 0;
        for (const replacement of [...next.content.children]) {
            const key = `${replacement.tagName}:${replacement.className}`, cached = replacement.tagName === 'MAIN' && listView?.node;
            const markup = replacement.tagName === 'MAIN' && listView ? `<main class="content route-content">${listView.html}</main>` : replacement.outerHTML;
            let child = current.get(key);
            current.delete(key);
            if (cached) { if (child && child !== cached) child.remove(); child = cached; }
            else if (!child) child = replacement;
            else if (renderedParts.get(key) !== markup) {
                if (child.tagName === 'HEADER') {
                        const currentSearch = child.querySelector('[data-action="search"]');
                        const nextSearch = replacement.querySelector('[data-action="search"]');
                        const currentBack = child.querySelector('[data-action="back-list"]');
                        const nextBack = replacement.querySelector('[data-action="back-list"]');
                        if (!!currentSearch !== !!nextSearch || !!currentBack !== !!nextBack) {
                            child.replaceWith(replacement);
                            child = replacement;
                        } else {
                    for (const action of ['collapse','toggle-panel']) {
                        const button = child.querySelector(`[data-action="${action}"]`), nextButton = replacement.querySelector(`[data-action="${action}"]`);
                        button.disabled = nextButton.disabled; button.hidden = nextButton.hidden; button.title = nextButton.title; button.textContent = nextButton.textContent;
                        if (action === 'toggle-panel') button.setAttribute('aria-expanded',nextButton.getAttribute('aria-expanded'));
                    }
                        const suggestion = child.querySelector('[data-action="tab"][data-tab="opinions"]');
                        const nextSuggestion = replacement.querySelector('[data-action="tab"][data-tab="opinions"]');
                        if (suggestion && nextSuggestion) {
                            suggestion.className = nextSuggestion.className;
                            suggestion.hidden = nextSuggestion.hidden;
                            suggestion.title = nextSuggestion.title;
                        }
                        }
                } else if (child.tagName === 'MAIN' && tab === 'opinions' && renderedTab === tab) {
                    const form = child.querySelector('.opinion-form'), nextForm = replacement.querySelector('.opinion-form');
                    const field = form.elements.namedItem('content'), nextField = nextForm.elements.namedItem('content');
                    if (field.value !== nextField.value) field.value = nextField.value;
                    field.disabled = nextField.disabled;
                    const button = form.querySelector('button'), nextButton = nextForm.querySelector('button');
                    button.disabled = nextButton.disabled; button.textContent = nextButton.textContent;
                    const warning = child.querySelector('.warning'), nextWarning = replacement.querySelector('.warning');
                    if (nextWarning) { if (warning) warning.replaceWith(nextWarning); else form.before(nextWarning); }
                    else warning?.remove();
                } else {
                    const filters = child.querySelector('.filters'), nextFilters = replacement.querySelector('.filters');
                    if (filters && nextFilters && renderedTab === tab && filters.outerHTML === nextFilters.outerHTML) {
                        patchRouteList(child.querySelector('.list'),replacement.querySelector('.list'));
                        const pager = child.querySelector('.route-pagination'), nextPager = replacement.querySelector('.route-pagination');
                        if (!pager?.isEqualNode(nextPager)) { pager?.remove(); if (nextPager) child.querySelector('.route-view').append(nextPager); }
                    } else { child.replaceWith(replacement); child = replacement; }
                }
            }
            if (panel.children[index] !== child) panel.insertBefore(child,panel.children[index] || null);
            renderedParts.set(key,markup); index++;
        }
        for (const [key,child] of current) { child.remove(); renderedParts.delete(key); }
        if (listView) { listView.node = panel.querySelector('main'); syncListSelection(listView); }
        const sameTab = renderedTab === tab;
        renderedHTML = html; renderedTab = tab;
        root.classList.toggle('collapsed', prefs.collapsed);
        root.classList.toggle('task-list', !prefs.collapsed && (tab === 'route' || tab === 'hidden'));
        const area = shadow.querySelector('.route-scroll') || shadow.querySelector('.content');
        const scrollTop = sameTab ? oldScroll : listView?.scrollTop || 0;
        if (area && (scrollTop || oldScroll || reusedList)) area.scrollTop = scrollTop;
        if (focusAction && !focus.isConnected) {
            const nextFocus = [...shadow.querySelectorAll('[data-action]')].find(el => el.dataset.action === focusAction && (!focusId || el.dataset.id === focusId));
            nextFocus?.focus({ preventScroll:true });
        }
        scheduleLayout();
    }
    function renderOpinionPopup(open) {
        if (!opinionPopup) return;
        opinionPopup.hidden = !open;
        if (!open) return;
        const html = opinionListHTML();
        if (html === renderedOpinionHTML) return;
        const scrollTop = opinionPopup.querySelector('.opinion-scroll')?.scrollTop || 0;
        const active = shadow.activeElement;
        const focusAction = opinionPopup.contains(active) && active.dataset.action;
        opinionPopup.innerHTML = html;
        renderedOpinionHTML = html;
        opinionPopup.querySelector('.opinion-scroll').scrollTop = scrollTop;
        if (focusAction) opinionPopup.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll:true});
    }
    function patchRouteList(list,next) {
        const rows = new Map([...list.children].map(el => [el.querySelector('[data-id]')?.dataset.id,el]));
        let index = 0;
        for (const candidate of [...next.children]) {
            const id = candidate.querySelector('[data-id]')?.dataset.id;
            let row = rows.get(id); rows.delete(id);
            if (!row || !row.isEqualNode(candidate)) { row?.replaceWith(candidate); row = candidate; }
            if (list.children[index] !== row) list.insertBefore(row,list.children[index] || null);
            index++;
        }
        for (const row of rows.values()) row.remove();
    }
    const style = `
        :host{all:initial;position:fixed;z-index:9;display:block;width:380px;max-width:calc(100vw - 16px);font:var(--mh-size-body,13.5px)/1.4 var(--mh-font,var(--sans,system-ui,sans-serif));-webkit-font-smoothing:antialiased;color:var(--ink,#f5e6c8);color-scheme:dark}
        *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;font-weight:var(--mh-weight-main,600);min-height:33px;border:1px solid var(--edge-bright,#7a5230);background:transparent;border-radius:5px;color:var(--ink-muted,#d6bf98);padding:5px 10px;box-shadow:none}button:hover{background:color-mix(in srgb,var(--panel-raised,#34220f) 70%,transparent);color:var(--ink,#f5e6c8)}button:disabled{opacity:.45;cursor:default}:focus,:focus-visible{outline:none}button.primary,nav button.active{background:linear-gradient(180deg,#6e4423,#4b2c14);color:var(--brass-bright,#f5c572);border-color:var(--edge-bright,#7a5230);box-shadow:inset 0 0 0 1px #c79352,0 1px 2px #0009}input[type=checkbox]{accent-color:var(--brass,#e8b25a);width:18px;height:18px}select{min-height:33px;max-width:150px;background:var(--panel-sunken,#170e07);border:1px solid var(--edge-bright,#7a5230);border-radius:5px;padding:5px;color:var(--ink-muted,#d6bf98)}
        .panel,.opinion-popup{display:flex;flex-direction:column;zoom:var(--mh-ui-scale,1);max-height:min(calc(52.5vh / var(--mh-ui-scale,1)),var(--mh-available-height,100vh));max-height:min(calc(52.5dvh / var(--mh-ui-scale,1)),var(--mh-available-height,100dvh));overflow:hidden;background:var(--mh-background,radial-gradient(ellipse 120% 80% at 50% 0%,#3b2717 0%,#25170d 65%,#1d1209 100%));border:var(--mh-border,1px solid #7a5230);border-radius:var(--mh-radius,8px);box-shadow:var(--mh-shadow,inset 0 0 0 1px #c79352b3,0 0 0 1px #1f1108,0 9px 22px -6px #0009)}header{--header-control-height:max(27px,calc(var(--mh-size-title,24px) * 1.2));min-height:39px;flex:none;display:flex;align-items:center;gap:6px;padding:5px 11px;cursor:move;touch-action:none;user-select:none;border-bottom:1px solid var(--edge,#4d3219);background:transparent}header .panel-title{cursor:grab;font-family:var(--mh-title-font,var(--mh-font,var(--sans,system-ui,sans-serif)));font-size:calc(var(--mh-size-title,24px) - 5px);line-height:1.2;font-weight:var(--mh-weight-title,800);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;padding:0;color:var(--ink,#f5e6c8);background:transparent}header button{flex:none;height:var(--header-control-height);min-height:var(--header-control-height);padding:3px 7px;font-size:var(--mh-size-small,12px)}header [data-action=collapse]{display:inline-flex;align-items:center;justify-content:center;width:var(--header-control-height);padding:0;margin-left:auto;line-height:1}header input[type=search]{flex:1;min-width:0;width:0;height:var(--header-control-height);min-height:var(--header-control-height);border:1px solid var(--edge,#4d3219);border-radius:5px;background:var(--panel-sunken,#170e07);color:var(--ink,#f5e6c8);padding:3px 7px;font-size:var(--mh-size-small,12px);cursor:text;user-select:text;touch-action:auto}header input::placeholder{color:var(--ink-faint,#ab9270)}.stats{display:grid;grid-template-columns:repeat(3,1fr);flex:none;margin:0 10px 6px;text-align:center;padding:5px 0;background:color-mix(in srgb,var(--panel-sunken,#170e07) 45%,transparent);border:1px solid var(--edge,#4d3219);border-radius:6px}.stats>div{min-width:0;container-type:inline-size}.stats small{display:block}.stats strong{display:block;white-space:nowrap;font-size:min(var(--mh-size-value,20px),calc(100cqw / var(--value-width,1)));font-weight:var(--mh-weight-main,600);font-variant-numeric:tabular-nums;color:var(--brass-bright,#f5c572)}nav{display:flex;flex-wrap:wrap;gap:4px;flex:none;padding:0 10px 6px;border-bottom:1px solid var(--edge,#4d3219)}nav button{flex:1;border-color:transparent;min-height:29px;padding:5px 6px;font-size:var(--mh-size-small,12px);white-space:nowrap}.content{flex:1 1 auto;min-height:0;overflow:auto;padding:10px;overscroll-behavior:contain}.toolbar,.between{display:flex;align-items:center;justify-content:space-between;gap:8px}.content.route-content{display:flex;flex-direction:column;overflow:hidden}.route-view{display:flex;flex-direction:column;min-height:0;flex:1}.toolbar{flex:none;margin-bottom:9px;flex-wrap:wrap}.route-scroll{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;overflow-anchor:none}.route-pagination{display:flex;align-items:center;gap:6px;flex:none;padding-top:8px;margin-top:8px;border-top:1px solid var(--edge,#4d3219)}.route-pagination button{flex:none;min-height:28px;padding:3px 8px;font-size:var(--mh-size-small,12px)}.route-pagination span{flex:1;min-width:0;text-align:center;white-space:nowrap;font-size:var(--mh-size-small,12px);color:var(--ink-faint,#ab9270)}.filters{display:flex;flex-direction:column;align-items:stretch;gap:4px;width:100%;min-width:0}.category-filter,.skill-filter{display:flex;align-items:center;gap:2px}.category-filter{flex-wrap:nowrap}.category-filter button{flex:1;min-width:0;white-space:nowrap;padding:5px 3px;font-size:var(--mh-size-body,13.5px)}.skill-filter{flex-wrap:nowrap;min-height:max(29px,calc(var(--mh-size-small,12px) * 1.4 + 8px))}.skill-options{display:flex;align-items:center;flex-wrap:nowrap;gap:2px;flex:1;min-width:0;overflow-x:auto;overscroll-behavior-x:contain}.skill-filter button{flex:none;white-space:nowrap;min-height:25px;padding:2px 3px;font-size:calc(var(--mh-size-small,12px) * .85);font-weight:500;border-color:transparent}.filters button[aria-pressed=true]{background:linear-gradient(180deg,#6e4423,#4b2c14);color:var(--brass-bright,#f5c572);border-color:var(--edge-bright,#7a5230);box-shadow:inset 0 0 0 1px #c7935270}.skill-filter button[aria-pressed=true]{box-shadow:none}.route-entry{display:flex;align-items:center;padding-right:6px;background:color-mix(in srgb,var(--panel-raised,#34220f) 35%,transparent);border:1px solid var(--edge,#4d3219);border-radius:6px;min-width:0}.route-entry.selected{background:color-mix(in srgb,var(--panel-raised,#34220f) 55%,transparent);border-color:var(--edge-bright,#7a5230)}.route-entry .route-row{flex:1;min-width:0;border:0;background:transparent}.hide-task{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;min-height:28px;padding:5px;border:0;color:var(--ink-faint,#ab9270)}.hide-task:hover,.hide-task:focus-visible{color:var(--brass-bright,#f5c572)}.hide-task svg{pointer-events:none}*{scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0;height:0}.muted,small{color:var(--ink-faint,#ab9270);font-size:var(--mh-size-small,12px)}.list{display:flex;flex-direction:column;gap:5px}.route-row{font-weight:400;display:flex;align-items:center;gap:9px;width:100%;padding:8px;text-align:left;background:color-mix(in srgb,var(--panel-raised,#34220f) 35%,transparent);border:1px solid var(--edge,#4d3219);border-radius:6px}.route-row.selected{background:color-mix(in srgb,var(--panel-raised,#34220f) 55%,transparent);border-color:var(--edge-bright,#7a5230)}.rank{font-size:var(--mh-size-small,12px);color:var(--ink-faint,#ab9270);width:20px;flex:none}.route-text{min-width:0;flex:1}.route-text strong{display:block;font-size:var(--mh-size-body,13.5px);font-weight:var(--mh-weight-main,600);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.route-text small,.route-efficiency{display:block;margin-top:2px;font-size:var(--mh-size-caption,10.5px)}.points,.gain{font-weight:600;color:var(--brass,#e8b25a);flex:none}.points{font-size:var(--mh-size-body,13.5px)}.gain{white-space:nowrap}.empty{padding:24px 4px;color:var(--ink-faint,#ab9270);text-align:center;font-size:var(--mh-size-body,13.5px)}.task-title{display:flex;flex:1;flex-direction:column;align-items:stretch;gap:0;min-width:0}.task-title h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.task-title small{flex:none}.task-head{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:10px}h2{font-family:var(--mh-title-font,var(--mh-font,var(--sans,system-ui,sans-serif)));font-size:var(--mh-size-value,20px);line-height:1.4;margin:3px 0;font-weight:var(--mh-weight-title,800)}.progress{height:8px;border-radius:5px;background:var(--panel-sunken,#170e07);overflow:hidden;margin-bottom:7px}.progress i{display:block;background:linear-gradient(90deg,var(--brass,#e8b25a),var(--brass-bright,#f5c572));height:100%;transition:width .2s}.ok{color:var(--moss,#9ed36b)}.material{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--edge,#4d3219)}.material-main{display:flex;flex:1;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;overflow-wrap:anywhere}.material strong{max-width:100%;font-size:var(--mh-size-small,12px);font-weight:var(--mh-weight-main,600)}.material small{font-size:var(--mh-size-caption,10.5px);line-height:1.4}.material button{font-size:var(--mh-size-small,12px);flex:none}.estimate{padding:9px 0;font-size:var(--mh-size-small,12px)}.estimate>.between+.between{margin-top:5px}.actions{display:flex;gap:7px;margin:10px 0 6px;flex-wrap:wrap}.actions .primary{flex:1}.warning{font-size:var(--mh-size-small,12px);color:var(--brass-bright,#f5c572);background:color-mix(in srgb,var(--brass,#e8b25a) 10%,transparent);padding:7px 9px;border-radius:5px}.settings label{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--edge,#4d3219);font-size:var(--mh-size-body,13.5px)}.settings>small{display:block;margin:9px 0}.toast{flex:none;min-height:34px;max-height:max(8vh,54px);overflow:auto;background:var(--panel-raised,#34220f);border-top:1px solid var(--edge,#4d3219);color:var(--moss,#9ed36b);padding:7px 10px;font-size:var(--mh-size-small,12px);overflow-wrap:anywhere}.toast.error{color:var(--rust,#ec7a5a)}[hidden]{display:none!important}
        .task-heading,.route-text strong.task-heading{display:flex;align-items:baseline;gap:.3em;min-width:0}.task-type{flex:none;font-size:var(--mh-size-small,12px);font-weight:400;color:var(--ink-faint,#ab9270)}.task-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.task-goal{flex:none}
        .route-title{display:flex;align-items:center;gap:7px;min-width:0}.route-title strong{flex:1;min-width:0}.route-end{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:0 0 auto;white-space:nowrap}.queue-status{flex:none;padding:1px 5px;border:1px solid var(--edge-bright,#7a5230);border-radius:4px;color:var(--brass,#e8b25a);font-size:var(--mh-size-caption,10.5px);line-height:1.5}.queue-status[data-queue-status=running]{color:var(--moss,#9ed36b);border-color:color-mix(in srgb,var(--moss,#9ed36b) 45%,transparent)}.queue-progress{display:block;height:3px;margin-top:5px;border-radius:3px;overflow:hidden;background:var(--panel-sunken,#170e07)}.queue-progress i{display:block;height:100%;background:var(--brass,#e8b25a)}
        .skill-filter select{flex:none;align-self:flex-start;min-height:29px;margin-left:auto;padding:3px 6px;font-size:var(--mh-size-small,12px)}
        .material button[data-action=market]:enabled{min-width:72px;min-height:34px;background:linear-gradient(180deg,var(--brass-bright,#f5c572),var(--brass,#e8b25a));border-color:var(--brass-bright,#f5c572);color:#25170d;font-weight:700;box-shadow:inset 0 1px 0 #fff5,0 1px 3px #0006}.material button[data-action=market]:enabled:hover{filter:brightness(1.12)}
        .task-actions{flex:none;margin:0;padding:8px 10px;border-top:1px solid var(--edge,#4d3219)}:host(.collapsed) .panel{container-type:normal}:host(.collapsed) header{cursor:pointer;flex-wrap:nowrap}:host(.collapsed) header [data-action=collapse]{margin-left:0}:host(.collapsed) .toast{display:none}
        
        :host(.task-list) .panel{height:var(--mh-available-height,auto)}
        header .suggest-button{width:calc(4em + 32px);white-space:nowrap;margin-left:auto}header .back-task{white-space:nowrap}header .header-tail{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
        .panel{container-type:inline-size}
        @container(max-width:300px){header{flex-wrap:wrap}header .panel-title{flex:1 0 100%;min-width:0}header .header-tail,header .suggest-button,header input[type=search]{order:2}header .header-tail{margin-left:auto}}
        .stats.stats-settings{display:none;margin:0 0 9px}
        nav .route-priority-select{flex:none;min-height:29px;padding:3px 5px;font-size:var(--mh-size-small,12px)}
        .opinion-popup{position:absolute;top:0;left:var(--mh-opinion-left,100%);width:var(--mh-opinion-width,100%);height:100%;max-height:none;zoom:1}.opinion-popup-inner{display:flex;flex-direction:column;flex:1;min-height:0;padding:10px;zoom:var(--mh-ui-scale,1)}.opinion-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;overflow-anchor:none}
        .opinion-heading{min-width:0;display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 6px}.opinion-heading strong{flex:none}.opinion-content,.opinions,.opinion-form{display:flex;flex-direction:column;min-height:0;gap:8px}.opinion-content{overflow:auto}.opinion-form-heading{display:flex;flex-direction:column;justify-content:center;gap:6px;min-height:72px;flex:none}.opinion-form-heading small{color:inherit;font-size:calc(var(--mh-size-small,12px) + 3px);line-height:1.45}.opinions>.warning{flex:none}.opinion-form textarea{flex:0 1 auto;height:clamp(130px,28dvh,230px);min-height:80px;min-width:0;width:100%;resize:none;border:1px solid var(--edge,#4d3219);border-radius:6px;background:var(--panel-sunken,#170e07);color:var(--ink,#f5e6c8);padding:8px;font:inherit}.opinion-form button,.opinion-more{flex:none;min-height:32px}.opinion-form button{min-height:48px}.opinion-form small{flex:none;line-height:1.45}
        .opinion-list{display:flex;flex-direction:column;gap:8px}.opinion-entry{padding:10px;background:color-mix(in srgb,var(--panel-raised,#34220f) 35%,transparent);border:1px solid var(--edge,#4d3219);border-radius:6px;overflow-wrap:anywhere}.opinion-entry>p,.opinion-reply p{margin:6px 0 0;white-space:pre-wrap;line-height:1.5}.opinion-entry>.between{flex-wrap:wrap;gap:2px 8px}.opinion-entry>.between strong{font-size:var(--mh-size-body,13.5px)}.opinion-reply{margin-top:8px;padding:6px 8px;background:color-mix(in srgb,var(--panel-raised,#34220f) 65%,#55616a);border:1px solid color-mix(in srgb,var(--ink-muted,#c8b28e) 30%,transparent);border-radius:5px}.opinion-reply p{color:#fff}.opinion-more{width:100%;margin-top:8px}
        @media ${mobileLayout.media}{:host{z-index:9}.stats-main{display:none}.stats.stats-settings{display:grid}.panel{max-height:var(--mh-available-height,calc(100vh - 16px));max-height:var(--mh-available-height,calc(100dvh - 16px))}}
        @media(max-width:480px){:host{width:360px}}@media(max-height:600px){header{min-height:32px}.stats{padding:2px 0;margin-bottom:4px}nav{padding-bottom:3px}.toast{padding:4px 10px}}
        :host(.compact-desktop) .stats{padding:2px 0;margin-bottom:4px}:host(.compact-desktop) .stats small{font-size:var(--mh-size-caption,10.5px)}:host(.compact-desktop) .stats strong{font-size:min(calc(var(--mh-size-value,20px) * .85),calc(100cqw / var(--value-width,1)))}:host(.compact-desktop) .route-row{padding:5px 6px;gap:6px}:host(.compact-desktop) .list{gap:4px}:host(.compact-desktop) .route-text small,:host(.compact-desktop) .route-efficiency{margin-top:1px;line-height:1.25}
        @media(max-height:400px){:host(.compact-desktop.compact-height) .route-pagination{padding-top:0;margin-top:0}:host(.compact-desktop.compact-height) .toolbar{margin-bottom:1px}}
        @media(max-height:533px){:host(.compact-desktop) .stats>div{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;gap:0 3px}}
        :host(.compact-height) header{min-height:28px;padding:3px 9px}:host(.compact-height) nav{padding-bottom:2px}:host(.compact-height) nav button{min-height:25px;padding:3px 5px}:host(.compact-height) .content{padding:4px 8px}:host(.compact-height) .toolbar{margin-bottom:4px}@media ${mobileLayout.media}{:host(.compact-height) .filters{flex-direction:row;align-items:flex-start;gap:6px;overflow-x:auto}:host(.compact-height) .category-filter{flex:none}:host(.compact-height) .category-filter button{flex:none;min-height:29px;padding:3px}:host(.compact-height) .skill-filter{flex:1;min-width:180px}:host(.compact-height) .skill-options{flex-wrap:nowrap;overflow-x:auto}}:host(.compact-height) .route-pagination{padding-top:3px;margin-top:3px}:host(.compact-height) .toast{min-height:0;max-height:26px;padding:3px 8px}
    `;
    function mount() {
        if (disposed || root) return;
        root = document.createElement('div'); root.id = 'dvi-mastery-helper'; root.style.visibility = 'hidden';
        const layers = document.createElement('style');
        layers.textContent = `#app .shell > .dvi-mastery-zoom{position:fixed;z-index:3;pointer-events:none}@media ${mobileLayout.media}{#app .shell > .boss-hud,#app .shell > .m-chat-fab{z-index:3}}`; root.append(layers);
        shadow = root.attachShadow({ mode:'open' });
        const css = document.createElement('style'); css.textContent = style;
        panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('aria-label','[DVI]精通助手');
        opinionPopup = document.createElement('aside'); opinionPopup.className = 'opinion-popup'; opinionPopup.hidden = true; opinionPopup.setAttribute('aria-label','建议与反馈');
        shadow.append(css, panel, opinionPopup); document.documentElement.append(root);
        render(); watchLayout(); layoutPending = false; placePanel();
        on(document,'click',onNativeWorkClick,{ capture:true });
        let suppressDragClick = false;
        on(shadow, 'click', async event => {
            if (suppressDragClick && event.detail > 0) { suppressDragClick = false; event.preventDefault(); event.stopPropagation(); return; }
            if (prefs.collapsed && panel.contains(event.target)) {
                prefs.collapsed = false; savePrefs(); marketCheckAt = 0; if (planDeferred) replan(false,false,true); render(); scheduleLayout(); return;
            }
            const button = event.target.closest('[data-action]'); if (!button || button.disabled || button.matches('input,select')) return;
            const action = button.dataset.action;
            let ownsBusy = false;
            try {
                if (action === 'collapse' || action === 'toggle-panel') { prefs.collapsed = !prefs.collapsed; savePrefs(); marketCheckAt = 0; if (!prefs.collapsed && planDeferred) replan(false,false,true); render(); scheduleLayout(); return; }
                if (action === 'tab') { if (tab !== button.dataset.tab) navigationToken++; tab = button.dataset.tab; marketCheckAt = 0; render(); if (tab === 'opinions' && !opinionLoaded) loadOpinions(); return; }
                if (action === 'back-list') { navigationToken++; tab = taskListTab; render(); return; }
                if (action === 'opinions-refresh') { loadOpinions(false); return; }
                if (action === 'opinions-more') { loadOpinions(true); return; }
                if (action === 'opinion-submit') { event.preventDefault(); await submitOpinion(button.closest('form')); return; }
                if (action === 'catalog-retry') { catalogState.retry?.(); return; }
                if (action === 'select') { selectTask(button.dataset.id); return; }
                if (action === 'page') {
                    const page = Number(button.dataset.page);
                    if (!Number.isSafeInteger(page) || page < 0 || !['route','hidden'].includes(tab)) return;
                    routePages[tab] = page; render();
                    const area = shadow.querySelector('.route-scroll'); if (area) area.scrollTop = 0;
                    return;
                }
                if (action === 'category' || action === 'skill') {
                    if (action === 'category') {
                        prefs.category = categories[button.dataset.value] ? button.dataset.value : 'all';
                        prefs.skill = 'all';
                    } else prefs.skill = button.dataset.value === 'all' || skills[button.dataset.value] ? button.dataset.value : 'all';
                    resetRouteViews();
                    routeCache.clear(); listViews.clear();
                    replan(false,false,true);
                    render();
                    return;
                }
                if (action === 'hide' || action === 'restore') {
                    const id = button.dataset.taskId;
                    if (!plan.tasks.some(t => t.id === id)) return;
                    if (action === 'hide') hiddenTasks.add(id); else hiddenTasks.delete(id);
                    prefs.hiddenTasks = [...hiddenTasks]; routeCache.clear(); savePrefs(); render(); return;
                }
                if (action === 'next' || action === 'skip') { nextTask(action === 'skip'); return; }
                if (action === 'reset') { prefs.docked = true; savePrefs(); scheduleLayout(); return; }
                if (action === 'import') { q('[data-file]', shadow).click(); return; }
                if (busy) return;
                busy = true; ownsBusy = true; button.disabled = true;
                if (action === 'sync') {
                    const wasOffline=!!character&&!live;
                    if (!await monitorTick(true)) notify('暂未读取到游戏角色，请进入游戏后重试',true);
                    else if(wasOffline)notify('已读取当前角色，恢复实时同步');
                }
                if (action === 'market') await market(Number(button.dataset.item));
                if (action === 'craft') await craft();
                if (action === 'prices') await refreshPrices(true);
            } catch (error) { notify(error.message || '操作未完成，请重试', true); }
            finally { if (ownsBusy) { busy = false; if (!disposed && button.isConnected) button.disabled = false; } }
        });
        on(shadow, 'change', async event => {
            const el = event.target;
            if (el.matches('select[data-action=route-priority]')) {
                if (!routePriorities.some(([id]) => id === el.value) || prefs.routePriority === el.value) return;
                prefs.routePriority = el.value;
                saveRoutePrefs(); return;
            }
            if (el.matches('select[data-action=rarity]')) {
                prefs.rarity = el.value === 'all' || rarities.some((_,index) => el.value === String(index)) ? el.value : 'all';
                resetRouteViews(); render(); return;
            }
            if (el.matches('[data-file]')) { try { await importFile(el.files[0]); } catch (e) { notify(e.message || '文件不可用', true); } finally { el.value = ''; } return; }
            const key = settingKeys[el.dataset.action];
            if (key) {
                prefs[key] = el.checked;
                if (key === 'autoNavigate') { navigationToken++; preparedEndless = null; }
                if (['materialPriceSort','showLocked'].includes(key)) resetRouteViews();
                savePrefs();
                if (key === 'materialPriceSort') replan(false,false,true);
                else render();
            }
        });
        on(shadow,'submit',async event => { if (!event.target.matches('.opinion-form')) return; event.preventDefault(); await submitOpinion(event.target); });
        const cancelSearch = () => { clearTimeout(searchTimer); timers.delete(searchTimer); searchTimer = null; };
        on(shadow,'input',event => {
            if (event.target.matches('.opinion-form textarea[name=content]')) { opinionDraft = event.target.value; return; }
            if (!event.target.matches('[data-action=search]') || searchComposing || event.isComposing) return;
            const value = event.target.value;
            cancelSearch();
            searchTimer = later(() => { searchTimer = null; applySearch(value); },80);
        });
        on(shadow,'compositionstart',event => { if (event.target.matches('[data-action=search]')) { searchComposing = true; cancelSearch(); } });
        on(shadow,'compositionend',event => { if (event.target.matches('[data-action=search]')) { searchComposing = false; applySearch(event.target.value); } });
        on(shadow,'keydown',event => {
            if (!event.target.matches('[data-action=search]')) return;
            event.stopPropagation();
            if (searchComposing || event.isComposing) return;
            if (event.key === 'Escape' || event.key === 'Enter') {
                event.preventDefault(); cancelSearch();
                if (event.key === 'Escape') event.target.value = '';
                applySearch(event.target.value);
            }
        });
        on(shadow, 'pointerdown', event => {
            if (event.isPrimary === false || event.button !== 0) return;
            suppressDragClick = false;
            const target = event.target, handle = target.closest('.panel-title') || target.closest('header');
            if (drag || !handle || target.closest('button:not(.panel-title),input,select,textarea')) return;
            const rect = root.getBoundingClientRect(); drag = { id:event.pointerId, handle, x:event.clientX - rect.left, y:event.clientY - rect.top, startX:event.clientX, startY:event.clientY, moved:false };
            handle.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
        });
        on(root, 'pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
            drag.moved = true; prefs.docked = false;
            position(event.clientX - drag.x, event.clientY - drag.y);
        });
        const endDrag = event => {
            if (!drag || drag.id !== event.pointerId) return;
            if (drag.moved && event.type === 'pointerup' && visible(dockAnchor)) {
                const a = dockAnchor.getBoundingClientRect(), r = root.getBoundingClientRect();
                if (mobileLayout.matches
                    ? Math.abs(r.left - a.left) < 24 && Math.abs(r.top - a.bottom - 6) < 24
                    : Math.abs(r.left - a.right - 2) < 24 && Math.abs(r.top - a.top) < 24) prefs.docked = true;
            }
            const { id, handle, moved } = drag;
            drag = null; suppressDragClick = moved;
            if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
            if (!moved && event.type === 'pointerup' && event.pointerType === 'touch' && (handle.matches('.panel-title') || prefs.collapsed)) {
                handle.click(); suppressDragClick = true;
            }
            savePrefs(); scheduleLayout(false,true);
        };
        on(root, 'pointerup', endDrag); on(root, 'pointercancel', endDrag); on(root, 'lostpointercapture', endDrag);
        on(host, 'resize', () => scheduleLayout(true,true));
        if (host.visualViewport) for (const type of ['resize','scroll']) on(host.visualViewport,type,() => scheduleLayout(false,true));
        on(document,'visibilitychange',() => {
            if (document.hidden) return;
            if (planDeferred) replan(false,false,true); if (renderDeferred) render();
            scheduleLayout(true,true); watchGame(); scheduleSync();
        });
        poll = setInterval(() => {
            if (!document.hidden) { scheduleLayout(false,true,false); watchGame(); }
            void monitorTick();
            if (pruneMarketBooks()) { if (character) replan(); else render(); }
            queryMarketBooks();
            if (!document.hidden && !prefs.collapsed && character && live && Date.now() - priceAttempt >= priceInterval) void refreshPrices();
        }, 750);
    }
    function panelBounds() {
        const view = host.visualViewport;
        const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
        const right = left + (view?.width || innerWidth);
        let bottom = top + (view?.height || innerHeight);
        if (mobileLayout.matches && visible(layoutTabs)) {
            const rect = layoutTabs.getBoundingClientRect();
            if (rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom) bottom = Math.max(top,rect.top);
        }
        return {left,top,right,bottom};
    }
    function restoreMobileZoom() {
        if (!mobileZoom) return;
        const {node,parent,next,portal} = mobileZoom; mobileZoom = null;
        if (node.parentElement === portal) parent.insertBefore(node,next?.parentNode === parent ? next : null);
        portal.remove();
    }
    function syncMobileZoom(container) {
        const shell = container.querySelector('.m-shell'), view = shell?.querySelector('.m-view[data-view=world]');
        let changed = false;
        if (mobileZoom && (!mobileLayout.matches || mobileZoom.view !== view || mobileZoom.node.parentElement !== mobileZoom.portal || mobileZoom.portal.parentElement !== container)) {
            restoreMobileZoom(); changed = true;
        }
        if (!mobileLayout.matches || !view) return changed;
        if (!mobileZoom) {
            const node = view.querySelector('.m-zoom');
            if (!node) return changed;
            const portal = document.createElement('div'); portal.className = 'dvi-mastery-zoom';
            mobileZoom = {node,parent:node.parentNode,next:node.nextSibling,portal,shell,view,geometry:''};
            container.append(portal); portal.append(node); changed = true;
        }
        const {portal} = mobileZoom, shown = !shell.hidden && shell.dataset.mtab === 'world' && visible(view);
        portal.hidden = !shown;
        if (shown) {
            const rect = view.getBoundingClientRect(), geometry = [rect.left,rect.top,rect.width,rect.height].join(':');
            if (geometry !== mobileZoom.geometry) {
                mobileZoom.geometry = geometry;
                Object.assign(portal.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
            }
        }
        return changed;
    }
    function watchLayout() {
        if (!root || disposed || document.hidden) return;
        layoutDirty = false;
        const container = q('#app .shell') || document.documentElement;
        const moved = root.parentElement !== document.documentElement;
        if (moved) document.documentElement.append(root);
        const zoomChanged = syncMobileZoom(container);
        const mobileShell = mobileLayout.matches ? container.querySelector('.m-shell') : null;
        const overlays = mobileLayout.matches ? [...container.querySelectorAll('.veil,[data-m-sub],[role="dialog"],[data-buff-sheet],[data-hot-sheet],.routes')] : [];
        const overlaysChanged = overlays.length !== layoutOverlays.length || overlays.some((node,index) => node !== layoutOverlays[index]);
        const mobileTab = document.documentElement.dataset.mtab || mobileShell?.dataset.mtab;
        const blocked = mobileLayout.matches && (visible(mobileShell) && mobileTab && !['play','world'].includes(mobileTab)
            || overlays.some(node => node.matches('.routes') ? node.dataset.open === 'true' && visible(node.querySelector('.route-body')) : visible(node)));
        if (blocked !== mobilePanelBlocked) { mobilePanelBlocked = blocked; layoutPending = true; }
        const planAnchor = q('[data-plan]'), chip = mobileLayout.matches && !visible(planAnchor) ? q('[data-m-chip]') : null;
        const next = visible(chip) ? chip : planAnchor, tabs = mobileLayout.matches ? q('[data-m-tabs]') : null;
        const bounds = panelBounds(), state = [bounds.left,bounds.top,bounds.right,bounds.bottom].map(Math.round).join(':');
        if (state !== viewportState) { viewportState = state; panelFitDirty = layoutPending = true; }
        if (!drag && mobileLayout.matches && visible(next)) {
            const rect = next.getBoundingClientRect();
            const state = [Math.round(rect.left),Math.round(rect.bottom),document.documentElement.classList.contains('m-plan-open'),next.querySelector('[data-plan-fold],[data-m-chip-fold]')?.getAttribute('aria-expanded')].join(':');
            if (next !== dockAnchor || state !== mobileDockState) {
                prefs.docked = true; mobileDockState = state; layoutPending = true;
            }
        } else if (!mobileLayout.matches || !visible(next)) mobileDockState = '';
        if (next !== dockAnchor || tabs !== layoutTabs || mobileShell !== layoutMobileShell || overlaysChanged || moved || zoomChanged || !layoutFrame && !root.style.left) {
            dockAnchor = next; layoutTabs = tabs; layoutMobileShell = mobileShell; layoutOverlays = overlays; layoutResize.disconnect(); layoutChanges.disconnect();
            layoutResize.observe(root);
            layoutChanges.observe(document.documentElement, { attributes:true, attributeFilter:['class','style','data-theme','data-mtab'] });
            if (container !== document.documentElement) layoutChanges.observe(container, { attributes:true, attributeFilter:['class','style','hidden'], childList:true });
            if (mobileShell) layoutChanges.observe(mobileShell, { attributes:true, attributeFilter:['class','style','hidden','data-mtab'] });
            for (const overlay of overlays) layoutChanges.observe(overlay, { attributes:true, attributeFilter:['class','style','hidden','open','data-open','aria-hidden'] });
            if (mobileZoom) {
                layoutResize.observe(mobileZoom.view);
                layoutChanges.observe(mobileZoom.view, { attributes:true, attributeFilter:['class','style','hidden'] });
            }
            if (dockAnchor) {
                layoutResize.observe(dockAnchor);
                layoutChanges.observe(dockAnchor, { attributes:true, attributeFilter:['class','style','hidden'] });
            }
            if (layoutTabs) {
                layoutResize.observe(layoutTabs);
                layoutChanges.observe(layoutTabs, { attributes:true, attributeFilter:['class','style','hidden'] });
            }
            themeDirty = layoutPending = true;
        }
    }
    function scheduleLayout(theme = false, checkAnchor = false, reflow = true) {
        themeDirty ||= theme;
        layoutDirty ||= checkAnchor;
        layoutPending ||= reflow;
        if (disposed || !root || layoutFrame || document.hidden) return;
        layoutFrame = requestAnimationFrame(() => {
            layoutFrame = 0;
            if (disposed || document.hidden) return;
            if (layoutDirty) watchLayout();
            if (layoutPending) { layoutPending = false; placePanel(); }
        });
    }
    function placePanel() {
        if (disposed || !root || document.hidden) return;
        if (mobilePanelBlocked) { root.style.visibility = 'hidden'; return; }
        if (drag) return;
        if (themeDirty) {
            const themeSource = q('[data-plan]') || dockAnchor;
            const native = getComputedStyle(themeSource || document.documentElement);
            const values = new Map();
            for (const key of ['--ink','--ink-muted','--ink-faint','--panel-raised','--panel-sunken','--edge','--edge-bright','--brass','--brass-bright','--on-brass','--moss','--rust']) values.set(key,native.getPropertyValue(key).trim());
            values.set('color-scheme',themeSource ? native.colorScheme : 'dark');
            const text = themeSource?.querySelector('.plan-now .plan-text, .plan-text');
            const mainType = text ? getComputedStyle(text) : native;
            const titleType = themeSource ? getComputedStyle(themeSource,'::before') : null;
            const hasTitle = titleType && !['none','normal',''].includes(titleType.content);
            const scale = themeSource ? parseFloat(native.zoom) || 1 : 1;
            values.set('--mh-font',native.fontFamily);
            values.set('--mh-title-font',hasTitle ? titleType.fontFamily : native.fontFamily);
            values.set('--mh-weight-main',hasTitle ? titleType.fontWeight : mainType.fontWeight);
            values.set('--mh-weight-title',hasTitle ? titleType.fontWeight : '700');
            for (const [role,size] of [
                ['title',hasTitle ? titleType.fontSize : '24px'],
                ['body',text ? mainType.fontSize : native.getPropertyValue('--fs-md') || '13.5px'],
                ['small',native.getPropertyValue('--fs-sm') || '12px'],
                ['caption',native.getPropertyValue('--fs-xs') || '10.5px'],
                ['value',native.getPropertyValue('--fs-xl') || '20px']
            ]) values.set(`--mh-size-${role}`,`calc(${size.trim()} * ${scale})`);
            for (const [key,property] of [['background','background'],['border','border'],['radius','borderRadius'],['shadow','boxShadow']]) values.set(`--mh-${key}`,themeSource ? native[property] : '');
            const nextSignature = JSON.stringify([...values]);
            if (themeSignature !== nextSignature) {
                for (const [key,value] of values) { if (value) root.style.setProperty(key,value); else root.style.removeProperty(key); }
                themeSignature = nextSignature; panelFitDirty = true;
            }
            themeDirty = false;
        }
        const bounds = panelBounds(), viewportWidth = Math.max(0,bounds.right - bounds.left - 16);
        let expandedWidth = Math.min(380,opinionPopup.hidden ? viewportWidth : viewportWidth / 2);
        const mobileDock = mobileLayout.matches && prefs.docked && visible(dockAnchor);
        if (prefs.docked && visible(dockAnchor)) {
            const rect = dockAnchor.getBoundingClientRect(), native = getComputedStyle(dockAnchor);
            if (native.animationName.split(',').some(name => name.trim() === 'board-in') && native.transform !== 'none') {
                const shift = new DOMMatrixReadOnly(native.transform), scale = parseFloat(native.zoom) || 1;
                rect.x -= shift.m41 * scale; rect.y -= shift.m42 * scale;
            }
            const availableWidth = bounds.right - rect.right - 10;
            const canDockRight = !mobileDock && availableWidth >= 280;
            if (canDockRight) expandedWidth = Math.min(expandedWidth, availableWidth);
            root.style.width = prefs.collapsed ? 'max-content' : `${expandedWidth}px`;
            if (mobileDock) {
                const top = Math.min(rect.bottom + 6,Math.max(bounds.top + 8,bounds.bottom - 240));
                position(rect.left,top,top,bounds);
            } else if (canDockRight) position(rect.right + 2,rect.top,8,bounds);
            else position(rect.left,rect.bottom + 6,8,bounds);
        } else {
            root.style.width = prefs.collapsed ? 'max-content' : `${expandedWidth}px`;
            position(prefs.x,prefs.y,8,bounds);
        }
        root.style.visibility = canShowPanel() ? 'visible' : 'hidden';
    }
    function measurePanel() {
        if (mobileLayout.matches || prefs.collapsed) return;
        const area = shadow.querySelector('.route-scroll');
        if (!area || !panelFitDirty && panelFitWidth === root.clientWidth) return;
        const scrollTop = area.scrollTop;
        root.style.setProperty('--mh-ui-scale','1'); panel.style.maxHeight = 'none';
        const sample = document.createElement('div'); sample.className = 'route-entry'; sample.setAttribute('aria-hidden','true');
        sample.innerHTML = '<button type="button" class="route-row" tabindex="-1"><span class="route-text"><strong>0</strong><small>0<br>0</small><span class="route-efficiency">0</span></span></button>';
        area.append(sample);
        const rect = panel.getBoundingClientRect(), list = area.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(area.querySelector('.list')).gap) || 0;
        panelFitHeight = Math.ceil(rect.height - list.height + sample.getBoundingClientRect().height * 4 + gap * 3);
        const body = parseFloat(getComputedStyle(panel).fontSize) || 13.5;
        const small = parseFloat(getComputedStyle(sample.querySelector('small')).fontSize) || body * 10.5 / 13.5;
        panelMinScale = Math.min(1,Math.max(.6,10 / body,8 / small));
        panelFitWidth = root.clientWidth; panelFitDirty = false;
        sample.remove(); panel.style.removeProperty('max-height');
        return [area,scrollTop];
    }
    function position(x, y, minimumTop = 8, bounds = panelBounds()) {
        if (!root) return;
        const mobile = mobileLayout.matches;
        root.style.maxWidth = `${Math.max(0,bounds.right - bounds.left - 16)}px`;
        if (mobile || prefs.collapsed) root.style.setProperty('--mh-ui-scale','1');
        const heightLimit = (bounds.bottom - bounds.top) * .525;
        const compactDesktop = !mobile && heightLimit < 600;
        root.classList.toggle('compact-desktop',compactDesktop);
        if (!mobile && root.classList.contains('compact-height') !== compactDesktop) {
            root.classList.toggle('compact-height',compactDesktop); panelFitDirty = true;
        }
        const scroll = measurePanel();
        const rect = root.getBoundingClientRect();
        const minLeft = bounds.left + 8, minTop = Math.max(bounds.top + 8,minimumTop);
        const headerHeight = shadow.querySelector('header').getBoundingClientRect().height;
        const height = mobile ? headerHeight + rect.height - panel.clientHeight
            : prefs.collapsed ? rect.height : !prefs.docked ? headerHeight : Math.min(panelFitHeight * panelMinScale || rect.height,heightLimit,Math.max(0,bounds.bottom - minTop - 8));
        const reservePopup = !opinionPopup.hidden && bounds.right - bounds.left < 776;
        const left = Math.round(Math.max(minLeft,Math.min(Number.isFinite(x) ? x : 20,Math.max(minLeft,bounds.right - rect.width * (reservePopup ? 2 : 1) - 8))));
        const top = Math.round(Math.max(minTop,Math.min(Number.isFinite(y) ? y : 85,Math.max(minTop,bounds.bottom - height - 8))));
        const availableHeight = Math.min(Math.max(0,bounds.bottom - top - 8),mobile ? Infinity : heightLimit);
        const panelScale = mobile || prefs.collapsed || !panelFitHeight ? 1 : Math.max(panelMinScale,Math.min(1,Math.floor(availableHeight / panelFitHeight * 100) / 100));
        root.classList.toggle('compact-height',compactDesktop || mobile && availableHeight < 300);
        root.style.setProperty('--mh-ui-scale',String(panelScale));
        root.style.setProperty('--mh-available-height',`${availableHeight / panelScale}px`);
        if (scroll) scroll[0].scrollTop = scroll[1];
        if (prefs.x !== left || prefs.y !== top) {
            prefs.x = left; prefs.y = top;
            if (prefs.docked) savePrefs();
        }
        root.style.left = `${left}px`; root.style.top = `${top}px`;
        if (!opinionPopup.hidden) {
            const width = root.getBoundingClientRect().width;
            const before = Math.max(0,left - bounds.left - 8), after = Math.max(0,bounds.right - left - width - 8);
            const onRight = after >= width || after >= before;
            const popupWidth = Math.min(width,onRight ? after : before);
            root.style.setProperty('--mh-opinion-left',`${onRight ? width : -popupWidth}px`);
            root.style.setProperty('--mh-opinion-width',`${popupWidth}px`);
        }
    }
    function dispose() {
        if (disposed) return; disposed = true; navigationToken++; sessionGeneration++;
        rejectMount(new DOMException('助手已关闭','AbortError'));
        abort.abort(); updater?.dispose(); clearInterval(poll); for (const timer of timers) clearTimeout(timer); timers.clear();
        for (const finish of sleepers) finish();
        planChannel?.port1.close(); planChannel?.port2.close(); planTurns.length = 0;
        gameObserver.disconnect(); watched.clear(); layoutResize.disconnect(); layoutChanges.disconnect(); cancelAnimationFrame(layoutFrame); cancelAnimationFrame(rawFrame); cancelAnimationFrame(marketFrame);
        pendingRaw = lastRaw = null; pendingForgeEvents = [];
        combatSampler.reset('disposed');
        for (const entry of sockets) unwatchSocket(entry);
        exportRestore?.();
        if (host.WebSocket === wsProxy) host.WebSocket = nativeWebSocket;
        restoreMobileZoom();
        root?.remove(); root = panel = opinionPopup = shadow = dockAnchor = layoutTabs = drag = null;
        layoutMobileShell = null; layoutOverlays = []; mobilePanelBlocked = false;
        character = snapshot = active = prices = planSource = routeSource = null; plan = {tasks:[],summary:{}}; skipped.clear();
        signature = pointsSignature = renderedHTML = renderedTab = renderedOpinionHTML = planError = ''; derivedPointCache = null;
        planTimer = syncTimer = null; syncDueAt = 0; syncUrgent = false; layoutFrame = rawFrame = marketFrame = 0; mobileDockState = viewportState = '';
        endlessTargets.clear(); preparedEndless = null;
        presenceDays.clear();
        itemNames.clear(); workSources.clear(); renderedParts.clear(); listViews.clear(); routeCache.clear(); clearMarketBooks();
        namedZones.clear(); namedJobs.clear(); filterSkills.clear(); qualitySkills.clear();
        itemSearch.clear(); jobSearch.clear(); zoneSearch.clear(); monsterSearch.clear(); hiddenTasks.clear(); searchWords = [];
        if (host[KEY] === api) delete host[KEY];
        api.dispose = Function.prototype;
    }
    const handoff = () => {
        flushRaw();
        const native = host.deepvein?.session?.state;
        const raw = native?.name && native.collections && native.skills && native.equipment && native.bank && Array.isArray(native.pack) ? native : lastRaw;
        return {catalog:DATA,catalogVerified,nativeWebSocket,sockets:[...sockets].filter(entry => entry.socket.readyState < 2).map(entry => ({socket:entry.socket,url:entry.socket.url,frames:[]})),raw:raw && (live || !character) && (!character || samePerson(raw,character)) ? raw : null,forge:live ? snapshot?.character : null,character:live ? null : character};
    };
    const setCatalogState = (verified,message) => {
        if (disposed) return;
        catalogVerified = verified; catalogMessage = message || '任务数据正在更新';
        if (!verified) {
            endlessTargets.clear(); preparedEndless = null;
            planRevision++; planning = false; planDeferred = true;
            navigationToken++; active = null; complete = false; availablePoints = null; signature = ''; planError = '';
            plan = {tasks:[],summary:{}}; planSource = routeSource = null; routeCache.clear(); listViews.clear();
            if (tab === 'task') tab = taskListTab;
        }
        render();
    };
    const api = { dispose, handoff, ready, setCatalogState, get catalogVerified() { return catalogVerified; }, version:PLUGIN_VERSION, dataVersion:DATA.version, dataSource:DATA.sourceUrl };
    host[KEY] = api;
    const replay = earlySockets.map(entry => ({entry, listener:watchSocket(entry.socket,entry.url)}));
    for (const {entry,listener} of replay) {
        if (listener) for (const data of entry.frames) listener({data});
        entry.frames.length = 0;
    }
    earlySockets.length = 0;
    if (retained?.raw) {
        const normalized = CORE.normalizeCharacter(retained.raw,DATA,samePerson(retained.raw,host.deepvein?.session?.state) ? host.deepvein?.session?.context : null);
        if (normalized.ok) {
            const next = mergeForgeLog(normalized.character,retained.forge);
            snapshot = {character:next,at:Date.now()}; lastRaw = retained.raw;
            accept(next,'实时快照',true);
        }
    } else if (retained?.character) accept(retained.character,'导入文件',false);
    const mountReady = () => {
        try { mount(); resolveMount(api); }
        catch (error) { rejectMount(error); dispose(); }
    };
    if (document.readyState === 'loading') on(document,'DOMContentLoaded',mountReady,{once:true}); else mountReady();
    return api;
}
function startMasteryAssistant(CORE, LOADER) {
    'use strict';
    const host = typeof unsafeWindow === 'object' ? unsafeWindow : globalThis;
    const KEY = '__DVI_MASTERY_LOADER__', CACHE = 'dvi.mastery.game-data.v3', FORMAT = LOADER.DATA_FORMAT_VERSION;
    let retained = null;
    try { retained = host.__DVI_MASTERY_HELPER__?.handoff?.(); host[KEY]?.dispose(); } catch (_) {}
    const abort = new AbortController(), entries = new Set(), nativeWebSocket = retained?.nativeWebSocket || host.WebSocket;
    let disposed = false, running = false, status, requestTimer, retryTimer, proxy, newestEntry, failedSource;
    let retryCount = 0, activeSource = '', activeFingerprint = '', loadedSource = null, preparedSource = null, sourceTarget = '', sourceRevision = 0;
    const freshSources = new Set();
    let updater = null, sourceObserver = null, resourceObserver = null, sourceCheckTimer = null, sourcePollTimer = null, sourceProbeController = null, sourceProbeBusy = false, sourceSignature = '', sourcePrimary = '', sourceCandidates = [], sourcePending = false;
    const clearEntry = entry => {
        entry.socket.removeEventListener('message',entry.message);
        entry.socket.removeEventListener('close',entry.close);
    };
    const releaseSockets = () => {
        const result = [...entries].filter(entry => entry.socket.readyState < 2);
        for (const entry of entries) clearEntry(entry);
        entries.clear(); newestEntry = null;
        if (host.WebSocket === proxy) host.WebSocket = nativeWebSocket;
        return result;
    };
    if (typeof nativeWebSocket === 'function' && !host.__DVI_MASTERY_HELPER__) {
        proxy = new Proxy(nativeWebSocket, {
            construct(Target,args,NewTarget) {
                const socket = Reflect.construct(Target,args,NewTarget);
                try {
                    const url = new URL(String(args[0]),location.href);
                    if (!disposed && url.protocol === (location.protocol === 'https:' ? 'wss:' : 'ws:') && url.host === location.host && url.pathname === '/ws') {
                        for (const old of entries) { clearEntry(old); old.frames.length = 0; old.bytes = 0; }
                        entries.clear();
                        const entry = {socket,url:url.href,frames:[],bytes:0}; newestEntry = entry;
                        entry.message = event => {
                            if (disposed || newestEntry !== entry || typeof event.data !== 'string' || event.data.length > 4e6) return;
                            let messages;
                            try { const frame = JSON.parse(event.data); messages = Array.isArray(frame.m) ? frame.m : [frame]; } catch (_) { return; }
                            if (!messages.some(message => ['welcome','snapshot','batch','marketDepth'].includes(message?.t))) return;
                            if (messages.some(message => message?.you && ['welcome','snapshot'].includes(message.t))) {
                                entry.frames = []; entry.bytes = 0;
                            }
                            entry.frames.push(event.data); entry.bytes += event.data.length;
                            while (entry.frames.length > 128 || entry.bytes > 8e6) entry.bytes -= entry.frames.shift().length;
                        };
                        entry.close = () => {
                            clearEntry(entry); entries.delete(entry); entry.frames.length = 0; entry.bytes = 0;
                            if (newestEntry === entry) newestEntry = null;
                        };
                        entries.add(entry);
                        socket.addEventListener('message',entry.message);
                        socket.addEventListener('close',entry.close,{once:true});
                    }
                } catch (_) {}
                return socket;
            }
        });
        try { host.WebSocket = proxy; } catch (_) {}
    }
    const sourceFingerprint = source => {
        let hash = 2166136261;
        for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i),16777619);
        return `${source.length}:${(hash >>> 0).toString(16).padStart(8,'0')}`;
    };
    function sourceURLs() {
        const candidates = new Map();
        let order = 0;
        const add = (raw,weight) => {
            try {
                const url = new URL(raw,location.href);
                if (url.origin !== location.origin || !/\.(?:m?js)$/i.test(url.pathname)) return;
                const path = url.pathname.toLowerCase(), name = path.slice(path.lastIndexOf('/')+1);
                const entry = /(^|[-_.])(index|main|app|game|client)([-_.]|$)/.test(name);
                const hashedEntry = entry && /[-_.][\w-]{6,}\.(?:m?js)$/i.test(name);
                const score = weight + (entry ? 30 : 0) + (hashedEntry ? 20 : 0);
                const prior = candidates.get(url.href);
                if (!prior || score > prior.score) candidates.set(url.href,{url:url.href,score,order:order++});
            } catch (_) {}
        };
        for (const node of document.querySelectorAll('script[src]')) add(node.src,node.type === 'module' ? 100 : 50);
        for (const node of document.querySelectorAll('link[rel~="modulepreload"][href],link[rel="preload"][as="script"][href]')) add(node.href,30);
        const urls = [...candidates.values()].sort((a,b) => b.score-a.score || b.order-a.order).slice(0,8).map(item => item.url);
        return urls.length ? urls : null;
    }
    const sourceSignatureOf = urls => [...new Set(urls || [])].sort().join('\n');
    const observeSourceCandidates = (urls, trigger = false) => {
        const list = urls || [], signature = sourceSignatureOf(list), primary = list[0] || '';
        const changed = signature !== sourceSignature || primary !== sourcePrimary;
        const scripts = new Set([...document.querySelectorAll('script[src]')].map(node => node.src));
        const added = list.find(url => !sourceCandidates.includes(url) && scripts.has(url));
        sourceSignature = signature; sourcePrimary = primary; sourceCandidates = list;
        if (!trigger || !changed) return false;
        if (!primary) { reloadSource('',true); return true; }
        const next = !activeSource || !list.includes(activeSource) || primary !== activeSource ? primary : added;
        if (next && next !== activeSource) { reloadSource(next,true); return true; }
        return false;
    };
    function waitForReady(read, signal, timeout = Infinity) {
        return new Promise((resolve,reject) => {
            let timer, done = false;
            const until = performance.now()+timeout;
            const finish = (error,value) => {
                if (done) return; done = true;
                clearTimeout(timer); signal.removeEventListener('abort',stop);
                if (error) reject(error); else resolve(value);
            };
            const stop = () => finish(new DOMException('读取已取消','AbortError'));
            const check = () => {
                if (signal.aborted) { stop(); return; }
                try {
                    const value = read();
                    if (value) { finish(null,value); return; }
                    if (performance.now() >= until) { finish(failure('等待游戏资源超时',true)); return; }
                    timer = setTimeout(check,Number.isFinite(timeout) ? 250 : 1000);
                } catch (error) { finish(error); }
            };
            signal.addEventListener('abort',stop,{once:true}); check();
        });
    }
    function display(message, retry = false) {
        if (disposed) return;
        if (!status) {
            status = document.createElement('div'); status.id = 'dvi-mastery-loader';
            status.setAttribute('role','status');
            status.style.cssText = 'position:fixed;left:20px;top:85px;z-index:2147483647;padding:9px 12px;border:1px solid var(--edge,#7a5230);border-radius:6px;background:var(--panel-sunken,#25170d);color:var(--ink,#f5e6c8);font:13px var(--sans,system-ui,sans-serif);max-width:min(360px,calc(100vw - 40px))';
            document.documentElement.append(status);
        }
        status.replaceChildren(document.createTextNode(message));
        if (retry) {
            const button = document.createElement('button'); button.textContent = '重试';
            button.style.cssText = 'margin-left:10px;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;cursor:pointer';
            button.onclick = () => { retryCount = 0; void load(); }; status.append(button);
        }
    }
    const failure = (message,retryable = false) => Object.assign(new Error(message),{retryable});
    function clearSourceWatch() {
        sourceObserver?.disconnect(); sourceObserver = null;
        resourceObserver?.disconnect(); resourceObserver = null;
        clearTimeout(sourceCheckTimer); sourceCheckTimer = null;
        clearTimeout(sourcePollTimer); sourcePollTimer = null;
        sourceProbeController?.abort(); sourceProbeController = null; sourceProbeBusy = false;
        sourceSignature = ''; sourcePrimary = ''; sourceCandidates = []; sourcePending = false;
    }
    const reloadSource = (next, forceFresh = false) => {
        if (disposed) return;
        sourceTarget = next || '';
        if (next) {
            if (forceFresh || next !== activeSource) freshSources.add(next);
            if (freshSources.size > 16) freshSources.delete(freshSources.values().next().value);
        }
        if (forceFresh || next && next !== activeSource) host.__DVI_MASTERY_HELPER__?.setCatalogState?.(false,'游戏已更新，正在读取任务数据');
        sourceRevision++; failedSource = null; retryCount = 0;
        clearTimeout(retryTimer); retryTimer = null;
        if (running) sourcePending = true; else void load();
    };
    const scheduleSourceProbe = delay => {
        clearTimeout(sourcePollTimer);
        sourcePollTimer = disposed ? null : setTimeout(() => {
            sourcePollTimer = null; void probeActiveSource();
        }, delay);
    };
    async function probeActiveSource() {
        if (disposed || sourceProbeBusy) return;
        sourceProbeBusy = true;
        const controller = sourceProbeController = new AbortController();
        const timeout = setTimeout(() => controller.abort(),8000);
        try {
            const urls = sourceURLs() || [];
            if (observeSourceCandidates(urls,true)) return;
            if (document.hidden || running) return;
            const url = sourceTarget || activeSource || urls[0];
            if (!url) return;
            const response = await fetch(url,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/javascript'},signal:controller.signal});
            if (response.status === 304) return;
            if (response.ok) {
                const source = await response.text();
                if (source && source.length <= 12000000 && !/^\s*</.test(source)) {
                    const fingerprint = sourceFingerprint(source);
                    if (running || sourceTarget && sourceTarget !== url || !sourceTarget && activeSource && activeSource !== url) return;
                    if (failedSource?.url === url && failedSource.fingerprint === fingerprint) return;
                    if (url !== activeSource || !activeFingerprint || fingerprint !== activeFingerprint) {
                        preparedSource = {url,response,source};
                        reloadSource(url,true);
                    }
                }
            }
        } catch (_) {
        } finally {
            clearTimeout(timeout); sourceProbeController = null; sourceProbeBusy = false;
            if (!disposed) scheduleSourceProbe(300000);
        }
    }
    function watchSourceChanges() {
        if (disposed || sourceObserver || resourceObserver || sourcePollTimer) return;
        const initial = sourceURLs() || [];
        sourceSignature = sourceSignatureOf(initial); sourcePrimary = initial[0] || ''; sourceCandidates = initial;
        const check = () => {
            if (disposed || sourceCheckTimer) return;
            sourceCheckTimer = setTimeout(() => {
                sourceCheckTimer = null;
                if (disposed) return;
                observeSourceCandidates(sourceURLs() || [],true);
            },250);
        };
        try {
            const selector = 'script[src],link[rel~="modulepreload"][href],link[rel="preload"][as="script"][href]';
            const relevant = node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector));
            sourceObserver = new MutationObserver(records => {
                if (records.some(record => record.type === 'attributes' ? record.target.matches(selector) : [...record.addedNodes,...record.removedNodes].some(relevant))) check();
            });
            sourceObserver.observe(document.documentElement || document,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','rel','as','type']});
        } catch (_) { sourceObserver = null; }
        try {
            if (typeof PerformanceObserver === 'function') {
                resourceObserver = new PerformanceObserver(list => {
                    if (list.getEntries().some(entry => /\.(?:m?js)(?:[?#]|$)/i.test(entry.name))) check();
                });
                resourceObserver.observe({type:'resource',buffered:true});
            }
        } catch (_) { resourceObserver?.disconnect(); resourceObserver = null; }
        scheduleSourceProbe(300000);
    }
    function cachedCatalog(url) {
        try {
            const saved = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
            if (saved?.format === FORMAT && saved.url === url && typeof saved.fingerprint === 'string' && /^\d+:[a-f0-9]{8}$/.test(saved.fingerprint) && LOADER.validateGameData(saved.data)) return saved;
        } catch (_) {}
        return null;
    }
    async function mountCatalog(data,verified) {
        retained = host.__DVI_MASTERY_HELPER__?.handoff?.() || retained;
        const sockets = [...releaseSockets(),...(retained?.sockets || [])];
        updater?.dispose(); updater = startPluginUpdates(PLUGIN_VERSION);
        const previous = retained;
        const options = {verified,retry:() => reloadSource(sourceTarget || activeSource,true)};
        const uniqueSockets = [...new Map(sockets.map(entry => [entry.socket,entry])).values()];
        try {
            const helper = bootMasteryAssistant(CORE,data,uniqueSockets,updater,retained,options);
            await helper.ready;
        } catch (error) {
            const failed = host.__DVI_MASTERY_HELPER__;
            const recover = failed?.handoff?.() || previous;
            failed?.dispose();
            if (!disposed && previous?.catalog && LOADER.validateGameData(previous.catalog)) {
                updater = startPluginUpdates(PLUGIN_VERSION);
                const restored = bootMasteryAssistant(CORE,previous.catalog,recover?.sockets || [],updater,recover,{...options,verified:false});
                await restored.ready;
            }
            throw error;
        }
        retained = null;
    }
    async function ensurePanel() {
        await waitForReady(() => document.readyState !== 'loading',abort.signal);
        const existing = host.__DVI_MASTERY_HELPER__;
        if (existing) existing.setCatalogState(false,'正在验证当前游戏任务数据');
        if (existing?.version === PLUGIN_VERSION) {
            try { await existing.ready; }
            catch (_) { if (host.__DVI_MASTERY_HELPER__ === existing) existing.dispose(); return; }
            activeSource = existing.dataSource || '';
            activeFingerprint = '';
            return;
        }
    }
    async function catalog(url, signal, forceFresh = false) {
        signal.throwIfAborted();
        const saved = forceFresh ? null : cachedCatalog(url);
        const headers = {};
        if (!forceFresh) {
            if (typeof saved?.etag === 'string' && saved.etag.length <= 256) headers['If-None-Match'] = saved.etag;
            if (typeof saved?.lastModified === 'string' && saved.lastModified.length <= 128) headers['If-Modified-Since'] = saved.lastModified;
        }
        const request = new AbortController();
        let timedOut = false;
        const cancel = () => request.abort();
        signal.addEventListener('abort',cancel,{once:true});
        requestTimer = setTimeout(() => { timedOut = true; cancel(); },15000);
        try {
            for (const cache of ['no-cache','no-store']) {
                let response, source;
                try {
                    if (preparedSource?.url === url) {
                        ({response,source} = preparedSource); preparedSource = null;
                    } else response = await fetch(url,{credentials:'omit',cache,redirect:'error',headers,signal:request.signal});
                    if (response.status === 304) {
                        if (saved && !forceFresh && (headers['If-None-Match'] || headers['If-Modified-Since'])) {
                            loadedSource = {url,meta:{etag:saved.etag || '',lastModified:saved.lastModified || '',contentLength:saved.contentLength || ''},fingerprint:saved.fingerprint || ''};
                            return saved.data;
                        }
                        if (cache === 'no-cache') { delete headers['If-None-Match']; delete headers['If-Modified-Since']; continue; }
                        throw failure('游戏数据缓存已失效',true);
                    }
                    if (!response.ok) throw failure('游戏数据读取失败（HTTP ' + response.status + '）',[408,429].includes(response.status) || response.status >= 500);
                    if (Number(response.headers.get('content-length')) > 12000000) throw failure('游戏数据超出支持范围');
                    if (source === undefined) source = await response.text();
                } catch (error) {
                    signal.throwIfAborted();
                    if (error.retryable !== undefined) throw error;
                    throw failure(timedOut ? '游戏数据读取超时' : '游戏数据网络读取失败',true);
                }
                signal.throwIfAborted();
                if (request.signal.aborted) throw failure('游戏数据读取超时',timedOut);
                try {
                    if (!source) throw failure('游戏数据暂未就绪',true);
                    if (source.length > 12000000) throw failure('游戏数据超出支持范围');
                    if (/^\s*</.test(source)) throw failure('游戏数据暂时返回了网页',true);
                    const fingerprint = sourceFingerprint(source);
                    if (failedSource?.url === url && failedSource.fingerprint === fingerprint) throw failedSource.error;
                    const metaSource = {sourceUrl:url,bundle:new URL(url).pathname.split('/').pop(),retrievedDate:new Date().toISOString().slice(0,10)};
                    const known = saved?.fingerprint === fingerprint ? saved.data : null;
                    const data = known ? {...known,...metaSource} : LOADER.extractGameData(source,metaSource);
                    if (!LOADER.validateGameData(data)) throw failure('游戏数据结构已变化，请更新助手');
                    const meta = {etag:response.headers.get('etag') || '',lastModified:response.headers.get('last-modified') || '',contentLength:response.headers.get('content-length') || ''};
                    loadedSource = {url,meta,fingerprint};
                    failedSource = null;
                    try { sessionStorage.setItem(CACHE,JSON.stringify({format:FORMAT,url,data,fingerprint,...meta})); } catch (_) {}
                    return data;
                } catch (error) {
                    if (source && source.length <= 12000000 && !/^\s*</.test(source)) {
                        if (error.retryable === undefined && /Unterminated|Unclosed|Unexpected end|未闭合|不完整/i.test(error.message || '')) error.retryable = true;
                        failedSource = {url,fingerprint:sourceFingerprint(source),error};
                    }
                    if (cache === 'no-store') throw error;
                }
            }
        } finally { clearTimeout(requestTimer); requestTimer = null; signal.removeEventListener('abort',cancel); }
    }
    async function load() {
        if (disposed || running) return;
        running = true; clearTimeout(retryTimer); retryTimer = null; loadedSource = null;
        host.__DVI_MASTERY_HELPER__?.setCatalogState(false,'正在验证当前游戏任务数据');
        if (!updater) updater = startPluginUpdates(PLUGIN_VERSION);
        const revision = sourceRevision, target = sourceTarget;
        let retry = false, selectedUrl = '', targetFailed = false;
        const attempt = new AbortController(), stop = () => attempt.abort();
        abort.signal.addEventListener('abort',stop,{once:true});
        if (abort.signal.aborted) stop();
        try {
            await waitForReady(() => document.documentElement,attempt.signal,15000);
            if (!host.__DVI_MASTERY_HELPER__) display('正在读取当前游戏任务数据');
            watchSourceChanges();
            await ensurePanel();
            if (disposed || revision !== sourceRevision) return;
            const data = await waitForReady(sourceURLs,attempt.signal,15000).then(async urls => {
                let lastError, shouldRetry = false;
                const ordered = [urls[0]];
                for (const url of ordered) {
                    try {
                        const data = await catalog(url,attempt.signal,freshSources.has(url));
                        if (revision === sourceRevision) freshSources.delete(url);
                        selectedUrl = url;
                        return data;
                    } catch (error) {
                        if (error?.name === 'AbortError' || attempt.signal.aborted) throw error;
                        if (url === target) { targetFailed = true; retry ||= error?.retryable === true; }
                        lastError = error; shouldRetry ||= error?.retryable === true;
                    }
                }
                if (lastError && shouldRetry && lastError.retryable !== true) lastError.retryable = true;
                throw lastError || failure('未找到可读取的游戏资源',true);
            });
            if (disposed || revision !== sourceRevision) return;
            const latestSource = sourceURLs()?.[0];
            if (latestSource !== selectedUrl) { reloadSource(latestSource || '',true); return; }
            const current = host.__DVI_MASTERY_HELPER__;
            const changed = !current || !current.catalogVerified || current.version !== PLUGIN_VERSION || activeSource !== selectedUrl || activeFingerprint !== loadedSource?.fingerprint;
            if (changed) await mountCatalog(data,true);
            if (disposed || revision !== sourceRevision) return;
            const mountedSource = sourceURLs()?.[0];
            if (mountedSource !== selectedUrl) { reloadSource(mountedSource || '',true); return; }
            activeSource = loadedSource?.url || selectedUrl || activeSource;
            activeFingerprint = loadedSource?.fingerprint || activeFingerprint;
            if (revision === sourceRevision && !targetFailed) sourceTarget = '';
            status?.remove(); status = null; failedSource = null;
            const currentSources = sourceURLs() || [];
            sourceSignature = sourceSignatureOf(currentSources);
            sourcePrimary = currentSources[0] || ''; sourceCandidates = currentSources;
            watchSourceChanges();
        } catch (error) {
            retry = !disposed && error?.retryable === true;
            if (!disposed) {
                watchSourceChanges();
                const helper = host.__DVI_MASTERY_HELPER__;
                const message = error?.name === 'AbortError' ? '游戏数据读取超时' : String(error.message || '游戏数据读取失败');
                if (helper) {
                    if (!helper.catalogVerified || failedSource?.url === (sourceTarget || activeSource)) helper.setCatalogState(false,`${message}，请重试或更新助手`);
                    status?.remove(); status = null;
                } else display(`助手面板加载失败：${message}（${PLUGIN_VERSION}）`,true);
            }
        } finally {
            attempt.abort(); abort.signal.removeEventListener('abort',stop); running = false;
            if (sourcePending && !disposed) { sourcePending = false; clearTimeout(retryTimer); retryTimer = null; void load(); }
            else if (retry && !disposed) retryTimer = setTimeout(() => { retryTimer = null; retryCount = Math.min(retryCount+1,4); void load(); },[2000,5000,15000,30000,60000][Math.min(retryCount,4)]);
        }
    }
    function dispose() {
        if (disposed) return;
        disposed = true; abort.abort(); updater?.dispose(); retained = preparedSource = null; freshSources.clear(); clearTimeout(requestTimer); clearTimeout(retryTimer); failedSource = null; clearSourceWatch();
        for (const entry of entries) { entry.frames.length = 0; entry.bytes = 0; }
        releaseSockets(); status?.remove(); status = null;
        if (host[KEY] === api) delete host[KEY];
    }
    const api = {dispose}; host[KEY] = api;
    void load();
    return api;
}
if (typeof module === 'object' && module.exports) module.exports = {startMasteryAssistant};
startMasteryAssistant(CORE, GAME_DATA_LOADER);
})();
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
