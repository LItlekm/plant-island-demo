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

export function createRunState(seed = (Date.now() & 0xffffffff), buildId = D.STARTING_BUILDS[0].id, difficulty = 'normal', seedPicks = null) {
  const build = D.buildById(buildId);
  const st = {
    seed, rngState: seed,
    buildId: build.id,
    // V0.7：难度（'normal' | 'hard'），未知值回落 normal（旧存档兼容）
    difficulty: D.DIFFICULTIES[difficulty] ? difficulty : 'normal',
    day: 1, phase: 'dayStart', ap: 8,
    sun: build.sun, materials: build.materials,
    city: { level: 1, hp: D.CITY_LEVELS[1].maxHp, maxHp: D.CITY_LEVELS[1].maxHp, armor: D.CITY_LEVELS[1].armor },
    plants: [], nextPlantId: 1,
    // V0.8：种子池由玩家在开局时携带（最多 5 种，来自构筑起手作物之外的作物）；
    // 未提供（旧存档 / 继续）时回落到构筑自带的种子池。
    unlockedSeeds: Array.isArray(seedPicks) && seedPicks.length
      ? seedPicks.filter(id => D.CROPS[id]).slice(0, D.MAX_CARRY_SEEDS)
      : build.seeds.slice(),
    // V0.5：农田改为「放置式」—— farms 是已建成农田的格号集合（无序）。
    //   · 初始为空，随后由起始作物自动落位建造（自带土地）。
    //   · 其余格必须调 canBuildFarm / doBuildFarm 才能变成农田。
    farms: [],
    freeFarms: build.plants.length,       // 构筑自带的免费农田数（= 起始作物数）
    features: { expand: true, pick3: false, greenhouse: false },  // V0.5：建造农田不再按天解锁（木材本身即门槛）
    greenhoused: false,
    modsTaken: [],              // 夜后三选一已选 id
    mod: {
      shootAtkMul: 0, throwAtkMul: 0, hpMul: 0, speedMul: 0, sunMul: 0,
      cultivateBonus: 0, thorns: 0, aoeMul: 0, regenPerSec: 0,
      ...build.perk.mod,        // 构筑专属特性（复用同一套乘区，与三选一叠加）
    },
    cultivateUsedToday: 0,
    stats: { planted: 0, harvested: 0, killed: 0, nightsWon: 0, evolvedCount: 0 },
    tutorial: { plant: false, cultivate: false, buildFarm: false, endDay: false },
  };
  // 起始盘面：由开局构筑决定（V0.3），起始作物直接以成熟状态落位，
  // 并且"自带土地"—— 落位的同时把该格标记为已建农田（V0.5）。
  build.plants.forEach((defId, i) => {
    const tile = D.BUILD_START_PLOTS[i];
    if (tile == null) return;
    if (!st.farms.includes(tile)) st.farms.push(tile);
    st.plants.push({
      id: st.nextPlantId++, defId, plot: tile,
      growth: CROPS(defId).maturityDays, level: 1, evolved: false, evolvedId: null,
    });
  });
  return st;
}
function CROPS(id) { return D.CROPS[id]; }

// ---------- 查询 ----------
export const plotOf = (st, idx) => st.plants.find(p => p.plot === idx && !p.dead) || null;

// V0.5：某格是否已建成农田
export function isFarmBuilt(st, idx) {
  return Array.isArray(st.farms) && st.farms.includes(idx);
}
// 已建成农田数（含构筑自带的 freeFarms）
export function plotsUnlocked(st) {
  if (Array.isArray(st.farms)) return st.farms.length;
  return st._plotsUnlocked ?? D.INITIAL_PLOTS;   // 兼容旧存档（v2 save）
}
// 已建且为空的格（可种植的格）
export function emptyPlots(st) {
  const list = [];
  for (let i = 0; i < D.PLOT_POSITIONS.length; i++) {
    if (isFarmBuilt(st, i) && !plotOf(st, i)) list.push(i);
  }
  return list;
}
// 未建但可建造的格
export function buildableTiles(st) {
  const list = [];
  for (let i = 0; i < D.PLOT_POSITIONS.length; i++) if (!isFarmBuilt(st, i)) list.push(i);
  return list;
}

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
// V0.4/V0.5：农田建造价。查表逻辑集中在 data.plotBuildCost（内部已扣掉 freeFarms）。
export function expandCost(st) {
  return D.plotBuildCost(plotsUnlocked(st));
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
  if (plotIdx == null || plotIdx < 0 || plotIdx >= D.PLOT_POSITIONS.length) return check(false, '地块不存在');
  if (!isFarmBuilt(st, plotIdx)) return check(false, '这里还没有农田：先用木材建造农田');
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
  const out = {};
  // 进化加成（V0.7 泛化：不再只查向日葵分支，如厚木年轮的 harvestMaterials +15）
  const evo = p.evolved ? (D.evolutionBranch(p.defId, p.evolvedId)?.bonus || {}) : {};
  // 向日葵：收获一次性阳光（阳光泵）
  if (c.harvestSun) {
    let s = c.harvestSun;
    if (evo.harvestSun) s += evo.harvestSun;
    out.sun = Math.round(s * (1 + st.mod.sunMul));
  }
  // V0.4：战斗作物收割产出木材（木材 = 建筑统一货币，是白天的主动收入来源）
  // 取舍：割掉 → 得木材 → 地块清空，需重新种植 + 等待成熟
  if (c.harvestMaterials) {
    const lvB = c.levelBonus || {};
    // 等级越高，割掉越可惜 → 木材回报略高，但永远低于「继续培养」的价值
    const bonus = Math.round(c.harvestMaterials * 0.15 * (p.level - 1));
    out.materials = c.harvestMaterials + bonus + (evo.harvestMaterials || 0);
  }
  return out;
}
export function doHarvest(st, plantId) {
  const v = canHarvest(st, plantId);
  if (!v.ok) return v;
  const p = st.plants.find(x => x.id === plantId);
  st.ap -= D.ACTION_COST.harvest.ap;
  const y = harvestYield(st, p);
  st.sun += y.sun || 0;
  st.materials += y.materials || 0;   // V0.4：收割木材
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

// ---------- 建造农田（V0.5：放置式，取代原来的"解锁下一格"） ----------
// tileIdx = PLOT_POSITIONS 的下标；玩家点哪一格就把农田放在哪一格。
export function canBuildFarm(st, tileIdx) {
  if (st.phase !== 'day') return check(false, '只能在白天建造');
  if (tileIdx == null || tileIdx < 0 || tileIdx >= D.PLOT_POSITIONS.length) return check(false, '地块不存在');
  if (isFarmBuilt(st, tileIdx)) return check(false, '这一格已经有农田了');
  if (plotsUnlocked(st) >= D.PLOT_POSITIONS.length) return check(false, '农田已达上限');
  if (st.ap < D.ACTION_COST.expand.ap) return check(false, `行动点不足（需要 ${D.ACTION_COST.expand.ap}）`);
  const cost = expandCost(st);
  if (st.materials < cost) return check(false, `木材不足（需要 ${cost}）`);
  return check(true);
}
// 是否还有任何一格可建（用于按钮置灰 / 文案判断）
export function canBuildAnyFarm(st) {
  if (buildableTiles(st).length === 0) return check(false, '农田已达上限');
  if (st.phase !== 'day') return check(false, '只能在白天建造');
  if (st.ap < D.ACTION_COST.expand.ap) return check(false, `行动点不足（需要 ${D.ACTION_COST.expand.ap}）`);
  const cost = expandCost(st);
  if (st.materials < cost) return check(false, `木材不足（需要 ${cost}）`);
  return check(true);
}
export function doBuildFarm(st, tileIdx) {
  const v = canBuildFarm(st, tileIdx);
  if (!v.ok) return v;
  const cost = expandCost(st);          // 必须在改动 farms 之前取价（取价依赖已建数量）
  st.ap -= D.ACTION_COST.expand.ap;
  st.materials -= cost;
  if (!Array.isArray(st.farms)) st.farms = [];
  st.farms.push(tileIdx);
  if (st.tutorial) st.tutorial.buildFarm = true;
  logEvent(st, 'buildFarm', { tile: tileIdx, farms: st.farms.length, cost });
  return { ok: true, tile: tileIdx, farms: st.farms.length, cost };
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
  if (st.ap < D.ACTION_COST.greenhouse.ap) return check(false, `行动点不足（需要 ${D.ACTION_COST.greenhouse.ap}）`);
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

// ---------- V0.8：伐木（1 AP → 固定木材，白天稳定的木材来源） ----------
export function canChop(st) {
  if (st.phase !== 'day') return check(false, '只能在白天伐木');
  if (st.ap < D.ACTION_COST.plant.ap) return check(false, '行动点不足');
  return check(true);
}
export function doChop(st) {
  const v = canChop(st);
  if (!v.ok) return v;
  st.ap -= D.ACTION_COST.plant.ap;
  const got = D.CHOP_YIELD;
  st.materials += got;
  logEvent(st, 'chop', { got });
  return { ok: true, got };
}

// ---------- 进化（V0.7：成熟 + 升到 3 级 + 阳光，双方向二选一） ----------
export function canEvolve(st, plantId, branchId) {
  if (st.phase !== 'day') return check(false, '只能在白天进化');
  const p = st.plants.find(x => x.id === plantId);
  if (!p) return check(false, '作物不存在');
  if (p.evolved) return check(false, '已进化');
  if (!isMature(p)) return check(false, '只有成熟作物可以进化');
  if ((p.level || 1) < 3) return check(false, '需先升到 3 级');
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
  // 当日解锁（V0.3：种子池已由开局构筑决定，这里只处理功能解锁）
  const script = D.DAY_SCRIPT[day] || {};
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
    // V0.7：旧存档没有 difficulty 字段 → 回落正常难度
    if (!st.difficulty || !D.DIFFICULTIES[st.difficulty]) st.difficulty = 'normal';
    return st;
  } catch { return null; }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
