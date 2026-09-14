// ============================================================
// 领域层：纯规则与状态（文档第 9 节）。不依赖 three.js / DOM，可单测。
// 所有行动执行前校验 AP、资源、地块与目标状态；失败不扣 AP。
// ============================================================
import * as D from './data.js';

// 可复现随机（文档：GameRunState 含随机种子）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRunState(seed = (Date.now() & 0xffffffff)) {
  const st = {
    seed, rngState: seed,
    day: 1, phase: 'dayStart', ap: 8,
    sun: D.INITIAL_STATE.sun, materials: D.INITIAL_STATE.materials,
    city: { level: 1, hp: D.CITY_LEVELS[1].maxHp, maxHp: D.CITY_LEVELS[1].maxHp, armor: D.CITY_LEVELS[1].armor },
    plants: [], nextPlantId: 1,
    unlockedSeeds: ['sunflower', 'wallnut'],
    features: { expand: false, pick3: false, greenhouse: false },
    greenhoused: false,
    modsTaken: [],              // 夜后三选一已选 id
    mod: { shootAtkMul: 0, throwAtkMul: 0, hpMul: 0, speedMul: 0, sunMul: 0, cultivateBonus: 0, thorns: 0, aoeMul: 0, regenPerSec: 0 },
    cultivateUsedToday: 0,
    stats: { planted: 0, harvested: 0, killed: 0, nightsWon: 0, evolvedCount: 0 },
    tutorial: { plant: false, cultivate: false, endDay: false },
  };
  // 初始盘面：3 株初始成熟作物（向日葵/豌豆射手/坚果），文档第 1 节
  const initial = [
    { defId: 'sunflower', plot: 0 },
    { defId: 'peashooter', plot: 4 },
    { defId: 'wallnut', plot: 2 },
  ];
  for (const it of initial) {
    st.plants.push({
      id: st.nextPlantId++, defId: it.defId, plot: it.plot,
      growth: CROPS(it.defId).maturityDays, level: 1, evolved: false, evolvedId: null,
    });
  }
  return st;
}
function CROPS(id) { return D.CROPS[id]; }

// ---------- 查询 ----------
export const plotOf = (st, idx) => st.plants.find(p => p.plot === idx && !p.dead) || null;
export function emptyPlots(st) {
  const list = [];
  for (let i = 0; i < plotsUnlocked(st); i++) if (!plotOf(st, i)) list.push(i);
  return list;
}
// 已解锁格数（存 runs 状态里，避免依赖视图）
export function plotsUnlocked(st) { return st._plotsUnlocked ?? D.INITIAL_PLOTS; }

export function isMature(p) { return p.growth >= CROPS(p.defId).maturityDays; }
export function maturePlants(st) { return st.plants.filter(isMature); }
export function combatPlants(st) { return maturePlants(st).filter(p => CROPS(p.defId).attack > 0); }

export function plantSunOutput(st, p) {
  const c = CROPS(p.defId);
  if (c.id !== 'sunflower') return 0;
  let v = c.passiveSun + c.levelBonus.passiveSun * (p.level - 1);
  if (p.evolved) {
    const br = D.evolutionBranch('sunflower', p.evolvedId);
    if (br?.bonus.passiveSun) v += br.bonus.passiveSun;
  }
  return Math.round(v * (1 + st.mod.sunMul));
}

export function upgradeCost(p) { return D.ACTION_COST.upgrade.sunByLevel[p.level + 1] ?? null; }
export function expandCost(st) {
  const count = plotsUnlocked(st) - D.INITIAL_PLOTS;
  return D.ACTION_COST.expand.materialsByCount[count] ?? null;
}

// ---------- 标签统计与羁绊（文档第 5 节） ----------
export function tagCounts(st) {
  const tags = { '射击': 0, '守护': 0, '生长': 0, '投掷': 0 };
  for (const p of maturePlants(st)) for (const t of CROPS(p.defId).tags) tags[t] = (tags[t] || 0) + 1;
  return tags;
}
export function activeSynergies(st) {
  const tags = tagCounts(st);
  return D.SYNERGIES.filter(s => (tags[s.school] || 0) >= s.need).map(s => s.id);
}

// ---------- 事件日志（便于复现平衡问题，文档第 9 节） ----------
export function logEvent(st, type, payload = {}) {
  if (!st.log) st.log = [];
  st.log.push({ day: st.day, phase: st.phase, t: Date.now(), type, ...payload });
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
}

// ---------- 通用校验 ----------
function check(ok, reason) { return ok ? { ok: true } : { ok: false, reason }; }

export function canPlant(st, plotIdx, seedId) {
  if (st.phase !== 'day') return check(false, '只能在白天种植');
  if (st.ap < D.ACTION_COST.plant.ap) return check(false, '行动点不足');
  const def = CROPS(seedId);
  if (!def) return check(false, '未知种子');
  if (!st.unlockedSeeds.includes(seedId)) return check(false, `${def.name}种子尚未解锁`);
  if (plotIdx == null || plotIdx < 0 || plotIdx >= plotsUnlocked(st)) return check(false, '地块未解锁');
  if (plotOf(st, plotIdx)) return check(false, '地块已被占用');
  if (st.sun < def.cost) return check(false, `阳光不足（需要 ${def.cost}）`);
  return check(true);
}
export function doPlant(st, plotIdx, seedId) {
  const v = canPlant(st, plotIdx, seedId);
  if (!v.ok) return v;
  st.ap -= D.ACTION_COST.plant.ap;
  st.sun -= CROPS(seedId).cost;
  st.plants.push({ id: st.nextPlantId++, defId: seedId, plot: plotIdx, growth: 0, level: 1, evolved: false, evolvedId: null });
  st.stats.planted++;
  if (st.tutorial) st.tutorial.plant = true;
  logEvent(st, 'plant', { seedId, plot: plotIdx });
  return { ok: true };
}

export function canCultivate(st, plantId) {
  if (st.phase !== 'day') return check(false, '只能在白天培育');
  if (st.ap < D.ACTION_COST.cultivate.ap) return check(false, '行动点不足');
  const p = st.plants.find(x => x.id === plantId);
  if (!p) return check(false, '作物不存在');
  if (isMature(p)) return check(false, '该作物已成熟');
  return check(true);
}
export function cultivateGain(st) {
  let g = 1;
  const syn = activeSynergies(st);
  if (syn.includes('grow3') && st.cultivateUsedToday === 0) g += 1;
  if (st.mod.cultivateBonus > 0 && st.cultivateUsedToday === 0) g += st.mod.cultivateBonus;
  return g;
}
export function doCultivate(st, plantId) {
  const v = canCultivate(st, plantId);
  if (!v.ok) return v;
  st.ap -= D.ACTION_COST.cultivate.ap;
  const p = st.plants.find(x => x.id === plantId);
  const gain = cultivateGain(st);
  p.growth = Math.min(CROPS(p.defId).maturityDays, p.growth + gain);
  st.cultivateUsedToday++;
  if (st.tutorial) st.tutorial.cultivate = true;
  logEvent(st, 'cultivate', { plantId, gain });
  return { ok: true, gain, matured: isMature(p) };
}

export function canHarvest(st, plantId) {
  if (st.phase !== 'day') return check(false, '只能在白天收获');
  if (st.ap < D.ACTION_COST.harvest.ap) return check(false, '行动点不足');
  const p = st.plants.find(x => x.id === plantId);
  if (!p) return check(false, '作物不存在');
  if (!isMature(p)) return check(false, '尚未成熟');
  return check(true);
}
export function harvestYield(st, p) {
  const c = CROPS(p.defId);
  if (c.id === 'sunflower') {
    let s = c.harvestSun;
    if (p.evolved) {
      const br = D.evolutionBranch('sunflower', p.evolvedId);
      if (br?.bonus.harvestSun) s += br.bonus.harvestSun;
    }
    return { sun: Math.round(s * (1 + st.mod.sunMul)) };
  }
  return {}; // 战斗作物收获后移除（文档第 4 节）
}
export function doHarvest(st, plantId) {
  const v = canHarvest(st, plantId);
  if (!v.ok) return v;
  const p = st.plants.find(x => x.id === plantId);
  st.ap -= D.ACTION_COST.harvest.ap;
  const y = harvestYield(st, p);
  st.sun += y.sun || 0;
  st.plants = st.plants.filter(x => x.id !== plantId);
  st.stats.harvested++;
  logEvent(st, 'harvest', { plantId, yield: y });
  return { ok: true, yield: y };
}

export function canUpgrade(st, plantId) {
  if (st.phase !== 'day') return check(false, '只能在白天升级');
  const p = st.plants.find(x => x.id === plantId);
  if (!p) return check(false, '作物不存在');
  if (!isMature(p)) return check(false, '只有成熟作物可以升级');
  if (p.level >= 3) return check(false, '已达到最高等级');
  const cost = upgradeCost(p);
  if (st.ap < D.ACTION_COST.upgrade.ap) return check(false, '行动点不足');
  if (st.sun < cost) return check(false, `阳光不足（需要 ${cost}）`);
  return check(true);
}
export function doUpgrade(st, plantId) {
  const v = canUpgrade(st, plantId);
  if (!v.ok) return v;
  const p = st.plants.find(x => x.id === plantId);
  st.ap -= D.ACTION_COST.upgrade.ap;
  st.sun -= upgradeCost(p);
  p.level++;
  logEvent(st, 'upgrade', { plantId, level: p.level });
  return { ok: true, level: p.level };
}

export function canExpand(st) {
  if (st.phase !== 'day') return check(false, '只能在白天扩张');
  if (!st.features.expand) return check(false, '扩张尚未解锁（第 3 天）');
  if (plotsUnlocked(st) >= D.PLOT_POSITIONS.length) return check(false, '农田已达上限');
  if (st.ap < D.ACTION_COST.expand.ap) return check(false, '行动点不足（需要 2）');
  const cost = expandCost(st);
  if (st.materials < cost) return check(false, `材料不足（需要 ${cost}）`);
  return check(true);
}
export function doExpand(st) {
  const v = canExpand(st);
  if (!v.ok) return v;
  st.ap -= D.ACTION_COST.expand.ap;
  st.materials -= expandCost(st);
  st._plotsUnlocked = plotsUnlocked(st) + 1;
  logEvent(st, 'expand', { plots: st._plotsUnlocked });
  return { ok: true, plots: st._plotsUnlocked };
}

export function canCityUpgrade(st) {
  if (st.phase !== 'day') return check(false, '只能在白天升级主城');
  if (st.city.level >= 3) return check(false, '主城已达最高等级');
  const cost = D.ACTION_COST.cityUpgrade.sunByLevel[st.city.level + 1];
  if (st.sun < cost) return check(false, `阳光不足（需要 ${cost}）`);
  return check(true);
}
export function doCityUpgrade(st) {
  const v = canCityUpgrade(st);
  if (!v.ok) return v;
  st.sun -= D.ACTION_COST.cityUpgrade.sunByLevel[st.city.level + 1];
  st.city.level++;
  const lv = D.CITY_LEVELS[st.city.level];
  st.city.maxHp = lv.maxHp; st.city.hp = lv.maxHp; st.city.armor = lv.armor;
  logEvent(st, 'cityUpgrade', { level: st.city.level });
  return { ok: true, level: st.city.level };
}

export function canGreenhouse(st) {
  if (st.phase !== 'day') return check(false, '只能在白天建造');
  if (!st.features.greenhouse) return check(false, '温室尚未解锁（第 8 天）');
  if (st.greenhoused) return check(false, '已建造温室');
  if (st.ap < D.ACTION_COST.greenhouse.ap) return check(false, '行动点不足（需要 2）');
  if (st.materials < D.ACTION_COST.greenhouse.materials) return check(false, `材料不足（需要 ${D.ACTION_COST.greenhouse.materials}）`);
  return check(true);
}
export function doGreenhouse(st) {
  const v = canGreenhouse(st);
  if (!v.ok) return v;
  st.ap -= D.ACTION_COST.greenhouse.ap;
  st.materials -= D.ACTION_COST.greenhouse.materials;
  st.greenhoused = true;
  logEvent(st, 'greenhouse', {});
  return { ok: true };
}

// ---------- 进化（V0.2：成熟作物 + 阳光，双方向二选一，无天数/等级/核心限制） ----------
export function canEvolve(st, plantId, branchId) {
  if (st.phase !== 'day') return check(false, '只能在白天进化');
  const p = st.plants.find(x => x.id === plantId);
  if (!p) return check(false, '作物不存在');
  if (p.evolved) return check(false, '已进化');
  if (!isMature(p)) return check(false, '只有成熟作物可以进化');
  const br = D.evolutionBranch(p.defId, branchId);
  if (!br) return check(false, '未知进化方向');
  if (st.sun < br.cost) return check(false, `阳光不足（需要 ${br.cost}）`);
  return check(true);
}
export function doEvolve(st, plantId, branchId) {
  const v = canEvolve(st, plantId, branchId);
  if (!v.ok) return v;
  const p = st.plants.find(x => x.id === plantId);
  const br = D.evolutionBranch(p.defId, branchId);
  st.sun -= br.cost;
  p.evolved = true;
  p.evolvedId = br.id;
  st.stats.evolvedCount++;
  logEvent(st, 'evolve', { plantId, to: br.name });
  return { ok: true, name: br.name };
}

// ---------- 夜后三选一（文档第 5/8 节：候选来自已解锁池，避免完全无效项） ----------
export function modCandidates(st) {
  const tags = tagCounts(st);
  const taken = {};
  for (const id of st.modsTaken) taken[id] = (taken[id] || 0) + 1;
  return D.NIGHT_MODS.filter(m => {
    if (m.minDay && st.day < m.minDay) return false;
    if (m.maxTaken && (taken[m.id] || 0) >= m.maxTaken) return false;
    if (m.id === 'aim' && (tags['射击'] || 0) === 0) return false;
    if (m.id === 'warhead' && (tags['投掷'] || 0) === 0) return false;
    if (m.id === 'thorns' && (tags['守护'] || 0) === 0) return false;
    if (m.id === 'battlement' && st.city.armor >= 4) return false;
    return true;
  });
}
export function pickThreeMods(st, rng) {
  const pool = modCandidates(st).slice();
  // 洗牌取 3
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}
export function applyNightMod(st, modId) {
  const m = D.NIGHT_MODS.find(x => x.id === modId);
  if (!m) return check(false, '未知强化');
  if (!modCandidates(st).some(x => x.id === modId)) return check(false, '该强化不可选');
  m.apply(st);
  st.modsTaken.push(modId);
  logEvent(st, 'nightMod', { id: modId });
  return { ok: true };
}

// ---------- 每日推进 ----------
export function applyDayStart(st, day) {
  st.day = day;
  st.phase = 'day';
  st.ap = 8;                          // 每日重置为 8，不可跨日（文档附录 A）
  st.cultivateUsedToday = 0;
  // 自然成长（温室 +1）
  const growth = 1 + (st.greenhoused ? 1 : 0);
  const maturedNow = [];
  for (const p of st.plants) {
    if (!isMature(p)) {
      p.growth = Math.min(CROPS(p.defId).maturityDays, p.growth + growth);
      if (isMature(p)) maturedNow.push(p);
    }
  }
  // 向日葵被动阳光
  let sunGain = 0;
  for (const p of maturePlants(st)) sunGain += plantSunOutput(st, p);
  st.sun += sunGain;
  // 当日解锁
  const script = D.DAY_SCRIPT[day] || {};
  for (const s of script.unlocks || []) if (!st.unlockedSeeds.includes(s)) st.unlockedSeeds.push(s);
  for (const f of script.unlockFeatures || []) st.features[f] = true;
  if (script.bonus) {
    if (script.bonus.materials) st.materials += script.bonus.materials;
    if (script.bonus.sun) st.sun += script.bonus.sun;
  }
  st.dayScript = script;
  logEvent(st, 'dayStart', { day, sunGain, matured: maturedNow.length });
  return { sunGain, maturedNow, script };
}

export function endDay(st) {
  if (st.phase !== 'day') return check(false, '已经是夜晚');
  st.phase = 'night';
  if (st.tutorial) st.tutorial.endDay = true;
  logEvent(st, 'endDay', { ap: st.ap });
  return { ok: true };
}

// ---------- 夜战结算 ----------
export function applyNightVictory(st, summary) {
  const rw = D.nightRewards(st.day, summary);
  const syn = activeSynergies(st);
  if (syn.includes('grow2')) rw.sun += D.GROW2_BONUS_SUN;
  st.sun += Math.round(rw.sun * (1 + st.mod.sunMul));
  st.materials += rw.materials;
  st.city.hp = Math.min(st.city.maxHp, st.city.hp + Math.round(st.city.maxHp * D.NIGHT_HEAL_PCT));
  st.stats.nightsWon++;
  logEvent(st, 'nightVictory', { day: st.day, rewards: rw });
  return rw;
}

// 夜战失败后从当日白天重试（文档第 3 节失败处理）
export function snapshot(st) { return JSON.parse(JSON.stringify(st)); }
export function restore(st, snap) { Object.keys(snap).forEach(k => { st[k] = snap[k]; }); }

// ---------- 存档（JSON 存档，文档第 9 节） ----------
export const SAVE_KEY = 'plant_island_save_v2';
export function saveRun(st) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); return true; } catch { return false; } }
export function loadRun() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const st = JSON.parse(raw);
    if (!st || !st.plants) return null;
    return st;
  } catch { return null; }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
