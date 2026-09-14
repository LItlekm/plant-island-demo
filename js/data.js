// ============================================================
// 数据层：全部静态定义与平衡参数（文档第 4/5/6/7/8 节）
// 规则：禁止把平衡常量散落在 View 脚本，全部集中于此。
// ============================================================

// ---------- 地图布局 ----------
// 12 个农田格位置（前 6 个为初始格）。x 横向，z 纵向（+z 朝海）。
export const PLOT_POSITIONS = [
  { x: -6.6, z: -6.4 }, { x: -4.6, z: -6.4 }, { x: -6.6, z: -4.2 }, { x: -4.6, z: -4.2 },
  { x:  4.6, z: -6.4 }, { x:  6.6, z: -6.4 }, { x:  4.6, z: -4.2 }, { x:  6.6, z: -4.2 },
  { x: -6.6, z: -2.0 }, { x: -4.6, z: -2.0 }, { x:  4.6, z: -2.0 }, { x:  6.6, z: -2.0 },
];
export const INITIAL_PLOTS = 6;
export const CITY_POSITION = { x: 0, z: -6.2 };
export const SEA_Z = 10.5;      // 敌人海上生成线
export const BEACH_Z = 6.8;     // 海岸线（登陆点）

// 夜间防守阵列槽位（自动摆放，玩家不微操 —— 文档第 3 节）
// 顺序为中心优先：只有 1 株时守在中央要道
export const DEFENSE_SLOTS = {
  guard:    [{ x: 0, z: 1.2 }, { x: -2.4, z: 1.2 }, { x: 2.4, z: 1.2 }, { x: -4.6, z: 1.2 }, { x: 4.6, z: 1.2 }],
  attacker: [{ x: 0, z: -0.8 }, { x: -2.6, z: -0.8 }, { x: 2.6, z: -0.8 }, { x: -5.0, z: -0.8 }, { x: 5.0, z: -0.8 }, { x: -1.3, z: -2.0 }, { x: 1.3, z: -2.0 }],
  support:  [{ x: -1.6, z: -2.8 }, { x: 1.6, z: -2.8 }, { x: 0, z: -3.6 }],
};

// ---------- 初始资源 ----------
// V0.2：经济重构为 阳光 + 木材 双资源（移除战利品与进化核心）
export const INITIAL_STATE = {
  sun: 60, materials: 0,
};

// ---------- 行动消耗 ----------
export const ACTION_COST = {
  plant:    { ap: 1 },
  cultivate:{ ap: 1 },
  harvest:  { ap: 1 },
  upgrade:  { ap: 0, sunByLevel: { 2: 30, 3: 60 } },  // V0.2：升级不再消耗 AP
  expand:   { ap: 2, materialsByCount: [20, 26, 32, 40, 50, 60] }, // 第 7..12 块地
  cityUpgrade: { ap: 0, sunByLevel: { 2: 120, 3: 240 } }, // V0.2：主城升级改用阳光
  greenhouse: { ap: 2, materials: 40 },  // 岛屿强化：每日自然成长 +1
};

export const CITY_LEVELS = {
  1: { maxHp: 100, armor: 0 },
  2: { maxHp: 150, armor: 1 },
  3: { maxHp: 200, armor: 2 },
};

// ---------- 作物定义（文档第 4 节） ----------
// maturityDays = 成长阈值（每日自然 +1，培育 +1）
export const CROPS = {
  sunflower: {
    id: 'sunflower', name: '向日葵', icon: '🌻', role: '资源与支援',
    maturityDays: 2, hp: 25, attack: 0, attackInterval: 0, range: 0,
    tags: ['生长'], cost: 20, unlockDay: 1,
    passiveSun: 15,       // 成熟后每天早晨产出阳光
    harvestSun: 30,       // 收获一次性阳光
    teamBuff: 0.08,       // 夜间全队攻击加成（每株）
    levelBonus: { hp: 5, passiveSun: 4, teamBuff: 0.02 },
    desc: '成熟时每天产出阳光；夜晚为全队提供攻击加成。',
  },
  peashooter: {
    id: 'peashooter', name: '豌豆射手', icon: '🫛', role: '单体远程输出',
    maturityDays: 2, hp: 30, attack: 8, attackInterval: 1.0, range: 4.5,
    tags: ['射击'], cost: 30, unlockDay: 2,
    levelBonus: { hp: 6, attack: 2 },
    desc: '自动攻击距离主城最近的敌人。',
  },
  wallnut: {
    id: 'wallnut', name: '坚果', icon: '🥔', role: '前排承伤',
    maturityDays: 3, hp: 150, attack: 0, attackInterval: 0, range: 0,
    tags: ['守护'], cost: 25, unlockDay: 1,
    levelBonus: { hp: 15 },
    tauntRadius: 8.0,     // 吸引周围敌人攻击自己（覆盖全部登陆航道）
    desc: '优先吸引敌人攻击，拥有高生命值。',
  },
  cornpitcher: {
    id: 'cornpitcher', name: '玉米投手', icon: '🌽', role: '范围控制',
    maturityDays: 3, hp: 40, attack: 6, attackInterval: 1.6, range: 5.0,
    aoeRadius: 2.2, slowChance: 0.35, slowDuration: 1.5, slowFactor: 0.5,
    tags: ['投掷'], cost: 40, unlockDay: 4,
    levelBonus: { hp: 6, attack: 2 },
    desc: '对小范围敌人造成伤害，并有概率短暂减速。',
  },
};

// ---------- 进化定义（V0.2 重构） ----------
// 条件：成熟作物 + 阳光（无天数限制、无核心、无等级要求）
// 每类作物 2 个进化方向，由玩家在选择弹窗中二选一
export const EVOLUTIONS = {
  peashooter: [
    {
      id: 'pea_big', name: '巨弹豌豆', icon: '🍈', cost: 90,
      desc: '发射巨大豌豆：单发伤害翻倍，并溅射周围的敌人',
      bonus: { hp: 10, attackMul: 2.0, splashRadius: 1.4, splashMul: 0.6 },
    },
    {
      id: 'pea_rapid', name: '连射豌豆', icon: '⚡', cost: 90,
      desc: '每次攻击发射两连发，攻击速度 +15%',
      bonus: { hp: 10, attack: 2, doubleShot: true, speedBonus: 0.15 },
    },
  ],
  wallnut: [
    {
      id: 'nut_iron', name: '铁甲坚果', icon: '🛡️', cost: 80,
      desc: '生命大幅提高，受伤减免 40%，嘲讽覆盖全场',
      bonus: { hp: 40, hpMul: 1.5, damageReduction: 0.4, tauntRadius: 999, battleShield: 80 },
    },
    {
      id: 'nut_thorn', name: '尖刺坚果', icon: '🌵', cost: 80,
      desc: '受到攻击时反弹 8 点伤害，开局获得护盾',
      bonus: { hp: 30, thorns: 8, battleShield: 60, tauntRadius: 10 },
    },
  ],
  sunflower: [
    {
      id: 'sun_radiant', name: '光耀向日葵', icon: '🌟', cost: 70,
      desc: '每日产出大量阳光，并为全队提供更高的攻击加成',
      bonus: { hp: 20, passiveSun: 20, harvestSun: 25, teamBuff: 0.12 },
    },
    {
      id: 'sun_heal', name: '翠光向日葵', icon: '💚', cost: 70,
      desc: '夜晚战斗时持续为全体作物回复生命',
      bonus: { hp: 30, healPerSec: 2.5, teamBuff: 0.05 },
    },
  ],
  cornpitcher: [
    {
      id: 'corn_frost', name: '冰霜玉米', icon: '❄️', cost: 100,
      desc: '攻击有 25% 概率冻住敌人 1.5 秒（不再减速）',
      bonus: { attack: 2, stunChance: 0.25, stunDuration: 1.5 },
    },
    {
      id: 'corn_burst', name: '爆裂玉米', icon: '💥', cost: 100,
      desc: '玉米弹的爆炸范围与范围伤害大幅提升',
      bonus: { attack: 4, aoeRadius: 3.2, aoeDamageMul: 1.35 },
    },
  ],
};
export function evolutionBranch(defId, branchId) {
  return (EVOLUTIONS[defId] || []).find(b => b.id === branchId) || null;
}

// ---------- 羁绊 / 流派（文档第 5 节） ----------
// 依据参战成熟作物的标签数量激活
export const SYNERGIES = [
  { id: 'shoot2', school: '射击', need: 2, desc: '攻击速度 +10%', icon: '🎯' },
  { id: 'shoot4', school: '射击', need: 4, desc: '首次攻击额外穿透 1 个敌人', icon: '🎯' },
  { id: 'guard2', school: '守护', need: 2, desc: '主城受到的伤害降低 10%', icon: '🛡️' },
  { id: 'guard3', school: '守护', need: 3, desc: '坚果开局获得护盾', icon: '🛡️' },
  { id: 'grow2',  school: '生长', need: 2, desc: '每夜胜利后额外获得 15 阳光', icon: '☀️' },
  { id: 'grow3',  school: '生长', need: 3, desc: '每日首次培育额外 +1 成长', icon: '☀️' },
];

// ---------- 夜后三选一强化池（第 4 天解锁） ----------
export const NIGHT_MODS = [
  { id: 'aim', name: '精准瞄准', icon: '🎯', desc: '全体射击作物攻击 +10%', apply: r => { r.mod.shootAtkMul += 0.10; } },
  { id: 'warhead', name: '重装弹头', icon: '💥', desc: '全体投掷作物攻击 +15%，范围 +10%', apply: r => { r.mod.throwAtkMul += 0.15; r.mod.aoeMul += 0.10; } },
  { id: 'stem', name: '强化茎干', icon: '🌿', desc: '全体作物生命 +12%', apply: r => { r.mod.hpMul += 0.12; } },
  { id: 'wall', name: '城墙加固', icon: '🏠', desc: '主城生命上限 +20 并回复 20', apply: r => { r.city.maxHp += 20; r.city.hp = Math.min(r.city.maxHp, r.city.hp + 20); } },
  { id: 'battlement', name: '城垛装甲', icon: '🧱', desc: '主城护甲 +1', maxTaken: 2, apply: r => { r.city.armor += 1; } },
  { id: 'reload', name: '快速装填', icon: '⏩', desc: '全体作物攻击速度 +8%', apply: r => { r.mod.speedMul += 0.08; } },
  { id: 'sunGift', name: '天降阳光', icon: '🌟', desc: '立即获得 80 阳光', maxTaken: 3, apply: r => { r.sun += 80; } },
  { id: 'photosynth', name: '光合过剩', icon: '☀️', desc: '阳光产出 +20%', apply: r => { r.mod.sunMul += 0.20; } },
  { id: 'roots', name: '根系网络', icon: '🌱', desc: '每日首次培育额外 +1 成长', maxTaken: 1, apply: r => { r.mod.cultivateBonus += 1; } },
  { id: 'thorns', name: '荆棘护壳', icon: '🌵', desc: '守护作物受击时反弹 3 点伤害', apply: r => { r.mod.thorns += 3; } },
  { id: 'medic', name: '战地园丁', icon: '💚', desc: '夜晚战斗中全体作物每秒回复 +1 生命', maxTaken: 2, apply: r => { r.mod.regenPerSec += 1; } },
];

// ---------- 敌人定义（文档第 6 节） ----------
// V0.2：全面增强（首轮测试反馈难度偏低），赏金改为阳光
export const ENEMIES = {
  crab: {
    id: 'crab', name: '漂流蟹', icon: '🦀', role: '基础近战', introDay: 1,
    hp: 30, damage: 8, speed: 1.35, attackInterval: 1.2, armor: 0, radius: 0.35,
    bounty: { sun: 5 },
    desc: '低生命，验证基础输出。',
  },
  sailor: {
    id: 'sailor', name: '海盗水手', icon: '🏴‍☠️', role: '标准近战', introDay: 2,
    hp: 78, damage: 15, speed: 1.05, attackInterval: 1.3, armor: 1, radius: 0.4,
    bounty: { sun: 9 },
    desc: '中等生命与稳定伤害。',
  },
  fish: {
    id: 'fish', name: '潮汐鱼群', icon: '🐟', role: '快速小怪', introDay: 3,
    hp: 18, damage: 7, speed: 2.7, attackInterval: 1.0, armor: 0, radius: 0.3,
    bounty: { sun: 4 },
    desc: '成群推进，检验范围与减速。',
  },
  giant: {
    id: 'giant', name: '礁石巨人', icon: '🗿', role: '重甲精英', introDay: 5,
    hp: 430, damage: 32, speed: 0.75, attackInterval: 2.0, armor: 5, radius: 0.8,
    bounty: { sun: 45 },
    desc: '高生命、低速度，检验持续输出与守护。',
  },
  boss: {
    id: 'boss', name: '幽灵船长', icon: '👻', role: '最终 Boss', introDay: 10,
    hp: 1150, damage: 48, speed: 0.55, attackInterval: 1.6, armor: 3, radius: 0.9,
    bounty: { sun: 150 },
    tauntImmune: true,   // 只受"进化嘲讽"影响
    phases: [
      { atHpPct: 0.66, summon: { fish: 4, crab: 2 }, label: '第一阶段：召集亡灵船员' },
      { atHpPct: 0.33, summon: { fish: 4, crab: 3 }, label: '第二阶段：风暴召唤' },
    ],
    desc: '分阶段召唤小怪并对主城造成高伤害。',
  },
};

// 敌人随天数成长（"下一天敌人升级"）—— V0.2 加快成长曲线
export function enemyDayScale(day) {
  return { hp: 1 + 0.11 * (day - 1), dmg: 1 + 0.08 * (day - 1) };
}

// ---------- 十夜波次脚本（文档第 7 节流程表） ----------
// V0.2：中后期波次加量
export const NIGHTS = {
  1:  [ { crab: 3 } ],
  2:  [ { crab: 4, sailor: 2 } ],
  3:  [ { fish: 6, crab: 2 }, { fish: 6 } ],
  4:  [ { crab: 4, sailor: 3 }, { fish: 6, sailor: 2 } ],
  5:  [ { giant: 1, crab: 4 }, { sailor: 3, fish: 5 } ],
  6:  [ { giant: 1, sailor: 4 }, { fish: 7, crab: 3 } ],
  7:  [ { fish: 9 }, { fish: 7, crab: 4 }, { sailor: 4 } ],
  8:  [ { giant: 2, sailor: 3, fish: 4 }, { crab: 5, sailor: 3 } ],
  9:  [ { giant: 1, fish: 7 }, { sailor: 5, crab: 4 }, { giant: 1 } ],
  10: [ { sailor: 4, fish: 5 }, { boss: 1 } ],
};

// ---------- 威胁预告文案（文档第 6 节：只给策略信息） ----------
export const THREAT_FORECASTS = {
  1:  { title: '漂流蟹来袭', level: '少', tags: ['基础近战'], hint: '成熟的作物会自动迎击。试试再种一株作物、或培育加速成熟。' },
  2:  { title: '海盗登陆', level: '少', tags: ['标准近战'], hint: '豌豆射手种子已解锁，远程输出是防线核心。' },
  3:  { title: '潮汐鱼群', level: '中', tags: ['快速敌群'], hint: '成群快速敌人！玉米投手（明日解锁）或更多射手可以应对。' },
  4:  { title: '混合掠夺者', level: '中', tags: ['近战混编'], hint: '解锁夜后三选一：胜利后可挑选构筑方向。' },
  5:  { title: '礁石巨人苏醒', level: '精英', tags: ['重甲目标'], hint: '重甲削减每次伤害！需要更高的单发攻击与坚果前排。' },
  6:  { title: '精英混合波', level: '精英', tags: ['重甲目标', '快速敌群'], hint: '扩张农田、凑齐同标签作物可激活流派羁绊。' },
  7:  { title: '快速敌群', level: '多', tags: ['快速敌群'], hint: '提示：成熟作物可消耗阳光进化（点击作物，二选一方向）。' },
  8:  { title: '重甲压境', level: '精英', tags: ['重甲目标', '近战混编'], hint: '检验阵容厚度：第二次扩张或岛屿强化（温室）已可用。' },
  9:  { title: 'Boss 前哨波', level: '大军', tags: ['重甲目标', 'Boss 先兆'], hint: '明日幽灵船长亲自登陆——完成进化或激活羁绊！' },
  10: { title: '幽灵船长', level: 'Boss', tags: ['Boss', '召唤', '高伤害'], hint: '最终决战！击败幽灵船长即可守下这座岛。' },
};

// ---------- 十天日程（新内容教学，文档第 7 节） ----------
export const DAY_SCRIPT = {
  1:  { unlocks: [], notes: ['引导：种植 → 培育 → 结束白天'], tutorial: true },
  2:  { unlocks: ['peashooter'], notes: ['解锁豌豆射手种子与收获行动'] },
  3:  { unlockFeatures: ['expand'], notes: ['解锁农田扩张'], bonus: { materials: 8, label: '岛屿补给（特殊预告奖励）' } },
  4:  { unlocks: ['cornpitcher'], unlockFeatures: ['pick3'], notes: ['解锁玉米投手与夜后三选一'] },
  5:  { unlocks: [], notes: ['警告：礁石巨人出现'] },
  6:  { unlockFeatures: [], notes: ['扩张节点与流派提示'], bonus: { materials: 8, label: '岛屿补给（特殊预告奖励）' } },
  7:  { unlockFeatures: [], notes: ['提示：成熟作物可消耗阳光进化（点击作物，二选一方向）'], bonus: { materials: 10, label: '进化支援补给' } },
  8:  { unlockFeatures: ['greenhouse'], notes: ['岛屿强化（温室）解锁'], bonus: { materials: 8, label: '岛屿补给（特殊预告奖励）' } },
  9:  { unlocks: [], notes: ['Boss 威胁完整预告'], bonus: { sun: 60, label: '决战储备（阳光）' } },
  10: { unlocks: [], notes: ['最终夜：击败幽灵船长！'] },
};

// ---------- 夜战胜利奖励（V0.2：阳光 + 木材双资源） ----------
export function nightRewards(day, summary) {
  // summary: { kills, giantsKilled, bossKilled, bountySun }
  const sun = 15 + day * 4 + summary.bountySun; // 击杀赏金 + 夜胜基础（V0.2 增幅）
  const materials = 6 + day + (summary.giantsKilled > 0 ? 4 : 0);
  return { sun, materials };
}
export const NIGHT_HEAL_PCT = 0.25; // 胜利后主城回复最大生命的 25%
export const GROW2_BONUS_SUN = 15;  // 生长流 2 件套：夜后额外阳光
export const WAVE_GAP = 2.5;        // 波次间隔秒
export const PREP_TIME = 3.0;       // 开战准备时间秒
