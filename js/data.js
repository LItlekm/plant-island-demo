// ============================================================
// 数据层：全部静态定义与平衡参数（文档第 4/5/6/7/8 节）
// 规则：禁止把平衡常量散落在 View 脚本，全部集中于此。
// ============================================================

// ---------- 地图布局（V0.5：4×4 网格） ----------
// 海岛是一张 4×4 的方格地（16 格），主城固定占据正中的 2×2（4 格），
// 其余 12 格是空地（初始为荒草地，玩家用木材把农田"放"上去）。
//
// 网格坐标：gx 0..3 横向（+x 向右），gz 0..3 纵向（+z 朝海，敌人从 +z 登陆）。
// 主城占 gz∈{1,2} × gx∈{1,2}，即格号 5、6、9、10（gridIdx = gz*4 + gx）。
//
// 世界坐标换算：以网格中心为原点，但整体沿 -z 后移 ORIGIN_Z，
// 目的是把 +z 一侧让出来做「沙滩登陆区 + 防守阵列」（战斗区不能压在农田上）。
export const GRID_SIZE = 4;          // 4×4
export const TILE = 3.0;             // 每格边长（世界单位）
export const GRID_ORIGIN_Z = -4.5;   // 网格中心的世界 z（主城就在这条线上）
// 主城占据的格号（gz*4 + gx）：(1,1)(2,1)(1,2)(2,2)
export const CITY_TILES = [5, 6, 9, 10];

const _toWorld = (gx, gz) => ({
  x: (gx - (GRID_SIZE - 1) / 2) * TILE,
  z: (gz - (GRID_SIZE - 1) / 2) * TILE + GRID_ORIGIN_Z,
});

// 12 个可建格的世界位置（row-major，跳过主城 4 格）。
// 索引即 plants[].plot 的取值空间，也是农田建造/占用的最小单位。
//   0..3  = 最里排（gz=0，离海最远，最安全）
//   4,5   = 主城所在排的左右两侧（gz=1）
//   6,7   = 同上（gz=2）
//   8..11 = 最靠海一排（gz=3，最先接敌）
export const PLOT_POSITIONS = (() => {
  const out = [];
  for (let gz = 0; gz < GRID_SIZE; gz++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      if (CITY_TILES.includes(gz * GRID_SIZE + gx)) continue;
      out.push(_toWorld(gx, gz));
    }
  }
  return out;
})();
export const BUILDABLE_TILES = PLOT_POSITIONS.length;   // 12

// 免费农田数：开局构筑自带的那几块地（= 起始作物数）。
// 其余地块都必须用木材建造 —— 见 domain.canBuildFarm。
export const INITIAL_PLOTS = 2;

export const CITY_POSITION = { x: 0, z: GRID_ORIGIN_Z };   // = 网格正中
export const CITY_FOOTPRINT = TILE * 2;                    // 主城占地 2×2

// 战斗区（+z 一侧的沙滩，在网格之外）
export const APRON_Z0 = GRID_ORIGIN_Z + (GRID_SIZE / 2) * TILE;  // 网格前排边缘 ≈ +1.5
export const SEA_Z = 13.0;      // 敌人海上生成线
export const BEACH_Z = 8.2;     // 海岸线（登陆点）

// 海岛外形（圆角矩形，把 4×4 网格 + 前排战斗区一起包住）
export const ISLAND = {
  minX: -8.6, maxX: 8.6,
  minZ: -12.4, maxZ: 9.6,
  corner: 3.4,
};

// 夜间防守阵列槽位（自动摆放，玩家不微操 —— 文档第 3 节）
// 顺序 = 中心优先，只有 1 株时守在中央要道。
// V0.5：全部重排到网格前排的沙滩战斗区（z 由大到小 = 由前到后），
//       容量 7 + 12 + 4 = 23，远高于 12 格农田的满编上限，杜绝槽位重叠。
export const DEFENSE_SLOTS = {
  // 前排堵口（承伤）：z ≈ 6.4 ~ 7.2
  guard: [
    { x: 0, z: 6.9 }, { x: -2.8, z: 6.9 }, { x: 2.8, z: 6.9 },
    { x: -5.4, z: 6.9 }, { x: 5.4, z: 6.9 },
    { x: -1.4, z: 5.8 }, { x: 1.4, z: 5.8 },
  ],
  // 中排输出：z ≈ 2.6 ~ 4.7
  attacker: [
    { x: 0, z: 4.7 }, { x: -2.8, z: 4.7 }, { x: 2.8, z: 4.7 },
    { x: -5.6, z: 4.7 }, { x: 5.6, z: 4.7 },
    { x: -1.4, z: 3.7 }, { x: 1.4, z: 3.7 }, { x: -4.2, z: 3.7 }, { x: 4.2, z: 3.7 },
    { x: 0, z: 2.7 }, { x: -2.8, z: 2.7 }, { x: 2.8, z: 2.7 },
  ],
  // 后排支援（向日葵）：贴着网格前排边缘
  support: [
    { x: -1.4, z: 1.7 }, { x: 1.4, z: 1.7 }, { x: -4.2, z: 1.7 }, { x: 4.2, z: 1.7 },
  ],
};

// ---------- 资源口径 ----------
// V0.2：经济重构为 阳光 + 木材 双资源（移除战利品与进化核心）
// V0.3：初始资源不再全局固定，改由开局构筑 STARTING_BUILDS 各自定义

// ---------- 行动消耗 ----------
export const ACTION_COST = {
  plant:    { ap: 1 },
  cultivate:{ ap: 1 },
  harvest:  { ap: 1 },
  upgrade:  { ap: 0, sunByLevel: { 2: 30, 3: 60 } },  // V0.2：升级不再消耗 AP
  // V0.4：农田定价从「解锁价」改为「建造价」（木材 = 建筑统一货币），价格按已建数量递增。
  // V0.5：地图切成 4×4 网格后，可自建格数 = 12 - 2（构筑自带）= 10 档。
  // 递增值曲线设计依据见 .workbuddy/docs/木材经济与农田定价方案_V0.4.md
  //
  // 曲线口径：前 3 档刻意压便宜（立住经济），中段线性增长（每天基本能买 1 格），
  //           尾段陡涨（第 9~10 格是"锦上添花"，不是通关必需）。
  //           合计 213 🪵 —— 目标让玩家在第 7 天左右买到第 7~8 档，
  //           剩下 2 档留给后续几天的容错资源。
  //
  // AP 从 2 降到 1：实测发现扩建与种植争抢同一个 AP 池——
  //   每天 8 AP，若扩张 2AP/格，连买 3 格就吃掉 6 AP，当天无法种植/培育/收割。
  //   扩建本身不产生战力，不该与"种植"等价消耗。
  expand:   { ap: 1, materialsByCount: [6, 8, 11, 14, 18, 22, 27, 32, 38, 45] },
  cityUpgrade: { ap: 0, sunByLevel: { 2: 120, 3: 240 } }, // V0.2：主城升级改用阳光
  greenhouse: { ap: 2, materials: 40 },  // 岛屿强化：每日自然成长 +1
};

export const CITY_LEVELS = {
  1: { maxHp: 100, armor: 0 },
  2: { maxHp: 150, armor: 1 },
  3: { maxHp: 200, armor: 2 },
};

// V0.4：农田建造价查表（单一数据源，domain 与 ui 都调它，避免两处索引逻辑不同步）。
// built = 已建成的农田数量（含构筑自带，故内部减掉 INITIAL_PLOTS 再查表）。
// 价格表用尽时回落到最后一档，而不是返回 null —— 兜底避免"无价可查"崩掉 UI。
export function plotBuildCost(built) {
  const table = ACTION_COST.expand.materialsByCount;
  if (!table || table.length === 0) return null;
  const i = Math.min(Math.max(0, built - INITIAL_PLOTS), table.length - 1);
  return table[i];
}

// ---------- 作物定义（文档第 4 节） ----------
// maturityDays = 成长阈值（每日自然 +1，培育 +1）
// V0.4：新增 harvestMaterials —— 收割战斗作物产出木材（木材 = 建筑统一货币）。
//   收割 = 主动换取：割掉后该地块清空，需重新种植 + 等待成熟，形成每日取舍。
//   向日葵不产木材（它是阳光泵，harvestSun 保持 30）。
export const CROPS = {
  sunflower: {
    id: 'sunflower', name: '向日葵', icon: '🌻', role: '资源与支援',
    maturityDays: 2, hp: 25, attack: 0, attackInterval: 0, range: 0,
    tags: ['生长'], cost: 20,
    passiveSun: 15,       // 成熟后每天早晨产出阳光
    harvestSun: 30,       // 收获一次性阳光
    harvestMaterials: 0,  // V0.4：向日葵不产木材
    teamBuff: 0.08,       // 夜间全队攻击加成（每株）
    levelBonus: { hp: 5, passiveSun: 4, teamBuff: 0.02 },
    desc: '成熟时每天产出阳光；夜晚为全队提供攻击加成。',
  },
  peashooter: {
    id: 'peashooter', name: '豌豆射手', icon: '🫛', role: '单体远程输出',
    maturityDays: 2, hp: 30, attack: 8, attackInterval: 1.0, range: 4.5,
    tags: ['射击'], cost: 30,
    harvestMaterials: 12, // V0.4：主战力即主木材源 → 制造真实取舍
    levelBonus: { hp: 6, attack: 2 },
    desc: '自动攻击距离主城最近的敌人。',
  },
  wallnut: {
    id: 'wallnut', name: '坚果', icon: '🥔', role: '前排承伤',
    maturityDays: 3, hp: 150, attack: 0, attackInterval: 0, range: 0,
    tags: ['守护'], cost: 25,
    harvestMaterials: 10, // V0.4：战力价值高，换木材回报略低
    levelBonus: { hp: 15 },
    tauntRadius: 8.0,     // 吸引周围敌人攻击自己（覆盖全部登陆航道）
    desc: '优先吸引敌人攻击，拥有高生命值。',
  },
  cornpitcher: {
    id: 'cornpitcher', name: '玉米投手', icon: '🌽', role: '范围控制',
    maturityDays: 3, hp: 40, attack: 6, attackInterval: 1.6, range: 5.0,
    aoeRadius: 2.2, slowChance: 0.35, slowDuration: 1.5, slowFactor: 0.5,
    tags: ['投掷'], cost: 40,
    harvestMaterials: 16, // V0.4：造价最贵，割掉回报最高
    levelBonus: { hp: 6, attack: 2 },
    desc: '对小范围敌人造成伤害，并有概率短暂减速。',
  },
  // ---------- V0.7：四个原创作物（围绕本作自身系统：连锁 / 召唤 / 木材经济 / 位移控场） ----------
  arcvine: {
    id: 'arcvine', name: '弧光藤', icon: '⚡', role: '连锁远程输出',
    maturityDays: 2, hp: 35, attack: 6, attackInterval: 1.5, range: 4.8,
    chainHops: 3, chainFall: 0.30,    // 电弧连锁：最多 3 跳，每跳伤害 -30%
    tags: ['射击'], cost: 45,
    harvestMaterials: 14,
    levelBonus: { hp: 6, attack: 2 },
    desc: '电弧在敌群间跳跃：命中后连锁最多 3 个敌人，每跳伤害 -30%。',
  },
  mycomother: {
    id: 'mycomother', name: '菌母', icon: '🍄', role: '召唤支援',
    maturityDays: 3, hp: 45, attack: 0, attackInterval: 0, range: 0,
    summonInterval: 6, summonCap: 2,  // 每 6 秒培育一个蘑菇兵，场上最多 2 个
    tags: ['生长'], cost: 55,
    harvestMaterials: 18,
    levelBonus: { hp: 8 },
    desc: '每 6 秒培育出一个蘑菇兵并肩作战（场上最多 2 个）。',
  },
  timberwood: {
    id: 'timberwood', name: '丰穣木', icon: '🌳', role: '近战输出 · 木材宝库',
    maturityDays: 3, hp: 90, attack: 10, attackInterval: 1.6, range: 0,
    tags: ['生长'], cost: 40,
    harvestMaterials: 45,             // 全场最高的收割木材回报 → 木材经济核心
    levelBonus: { hp: 12, attack: 3 },
    desc: '枝干如铁的近战树。收割它可获得全场最高的木材回报。',
  },
  gustgrass: {
    id: 'gustgrass', name: '风灵草', icon: '🌿', role: '控场辅助',
    maturityDays: 2, hp: 30, attack: 4, attackInterval: 2.0, range: 4.5,
    gustInterval: 3.5, gustRadius: 2.4, gustPush: 1.8,   // 定期旋风吹退周围敌人
    tags: ['投掷'], cost: 40,
    harvestMaterials: 12,
    levelBonus: { hp: 5, attack: 1 },
    desc: '定期掀起旋风，把周围敌人吹退，为防线争取时间。',
  },
};

// ---------- 开局构筑（V0.3 新增） ----------
// 玩家点「开始新游戏」后选择一个初始构筑，决定本局的起手。
// 每个构筑定义四件事：
//   plants  —— 起始就成熟的作物（放在 BUILD_START_PLOTS 指定的地块上，自带土地）
//   seeds   —— 本局可用种子池（V0.3 起不再按天解锁种子，整个种子池由构筑决定）
//   sun/materials —— 初始资源（materials = 木材，V0.5 起给少量启动木材，让建造机制开局就能用）
//   perk    —— 专属特性，直接写进 run.mod，复用夜间三选一的同一套乘区
// 注意：perk.mod 与 NIGHT_MODS 会叠加，调平衡时两边一起看。
// V0.5：构筑不再声明 plots（免费农田数）。免费农田数 = 起始作物数（自带土地），
//       其余 10 格一律用木材购买 —— 见 domain.canBuildFarm。
// V0.5：起始作物落在网格"最里排 + 主城左右"的格子上（索引见 PLOT_POSITIONS 注释），
//       这一排离海最远、最安全，符合"开局优先发育经济"的手感。
export const BUILD_START_PLOTS = [1, 2, 0, 3, 8, 9, 10, 11, 4, 5, 6, 7];
export const STARTING_BUILDS = [
  {
    id: 'balanced', name: '均衡开局', icon: '🌻', tagline: '容错最高',
    desc: '1 株向日葵 + 1 株豌豆射手。白天有稳定阳光产出，夜晚有基础火力，五种起始种子最全（含菌母与风灵草）。',
    plants: ['sunflower', 'peashooter'],
    seeds: ['sunflower', 'peashooter', 'wallnut', 'mycomother', 'gustgrass'],
    sun: 60, materials: 10,
    perk: { label: '全队作物生命 +12%', mod: { hpMul: 0.12 } },
  },
  {
    id: 'assault', name: '攻坚开局', icon: '🫛', tagline: '首夜最稳',
    desc: '1 株豌豆射手 + 1 株坚果。开局就能扛住第一夜，但没有阳光产出，经济全靠夜战赏金。种子池含连锁输出的弧光藤。',
    plants: ['peashooter', 'wallnut'],
    seeds: ['peashooter', 'wallnut', 'sunflower', 'arcvine'],
    sun: 50, materials: 12,
    perk: { label: '射击作物攻击 +15%', mod: { shootAtkMul: 0.15 } },
  },
  {
    id: 'economy', name: '经济开局', icon: '☀️', tagline: '滚雪球，但首夜最危险',
    desc: '2 株向日葵起步。白天阳光涨得最快，但第一夜没有任何输出——必须当天现种并培育出战力。种子池含木材宝库丰穣木。',
    plants: ['sunflower', 'sunflower'],
    seeds: ['sunflower', 'peashooter', 'timberwood'],
    sun: 100, materials: 8,
    perk: { label: '阳光产出 +25%', mod: { sunMul: 0.25 } },
  },
];
export function buildById(id) {
  return STARTING_BUILDS.find(b => b.id === id) || STARTING_BUILDS[0];
}

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
  // ---------- V0.7：四个新作物的进化方向 ----------
  arcvine: [
    {
      id: 'arc_overload', name: '过载电弧', icon: '🌩️', cost: 85,
      desc: '伤害大幅提升，连锁增至 4 跳，且每跳衰减更小（-20%）',
      bonus: { hp: 10, attack: 4, chainHops: 4, chainFall: 0.20 },
    },
    {
      id: 'arc_mark', name: '感电标记', icon: '✴️', cost: 85,
      desc: '被电弧击中的敌人被标记 3 秒，期间受到的所有伤害 +25%',
      bonus: { hp: 10, attack: 2, shockMark: 3 },
    },
  ],
  mycomother: [
    {
      id: 'myco_tide', name: '菌潮', icon: '🍄', cost: 90,
      desc: '培育更快（4.5 秒），可同时存在 3 个更强的蘑菇兵',
      bonus: { hp: 15, summonInterval: 4.5, summonCap: 3, sporelingHp: 30 },
    },
    {
      id: 'myco_toxic', name: '毒孢兵', icon: '☣️', cost: 90,
      desc: '蘑菇兵攻击更高，阵亡时爆出毒孢伤害周围敌人',
      bonus: { hp: 10, sporelingAtk: 8, deathBurst: 12 },
    },
  ],
  timberwood: [
    {
      id: 'tim_rings', name: '厚木年轮', icon: '🪵', cost: 85,
      desc: '树皮硬化：生命大幅提高、受伤减免 25%，收割木材 +15',
      bonus: { hp: 60, hpMul: 1.35, damageReduction: 0.25, harvestMaterials: 15 },
    },
    {
      id: 'tim_guardian', name: '活木守卫', icon: '🛡️', cost: 85,
      desc: '挥舞枝干吸引敌人（嘲讽半径 6），受击反弹 6 点伤害',
      bonus: { hp: 40, tauntRadius: 6, thorns: 6 },
    },
  ],
  gustgrass: [
    {
      id: 'gust_pull', name: '狂风拢聚', icon: '🌪️', cost: 85,
      desc: '旋风反转为拢聚：把周围敌人拉向自己集中（重甲减半），方便范围伤害收割',
      bonus: { attack: 2, gustPull: true },
    },
    {
      id: 'gust_wall', name: '逆风哨位', icon: '🌬️', cost: 85,
      desc: '风力增强：吹退距离 2.6，被吹退的敌人减速 40% 持续 2 秒',
      bonus: { attack: 2, gustPush: 2.6, gustSlow: 0.4, gustSlowDur: 2 },
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
  { id: 'throw2', school: '投掷', need: 2, desc: '投掷作物范围 +15%', icon: '🌀' },
  { id: 'throw4', school: '投掷', need: 4, desc: '投掷作物攻击 +15%', icon: '🌀' },
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

// ---------- 难度选择（V0.7 新增） ----------
// 在开局时选择，写入 run.difficulty；spawnEnemy 按倍率强化敌人。
// hard 的 bounty 补偿让困难局的经济不至于落后太多。
export const DIFFICULTIES = {
  normal: {
    id: 'normal', name: '正常', icon: '🌊', tagline: '标准强度',
    desc: '标准敌人强度，适合首次游玩与熟悉经营节奏。',
    hpMul: 1, dmgMul: 1, bountyMul: 1,
  },
  hard: {
    id: 'hard', name: '困难', icon: '⛈️', tagline: '敌人全面强化',
    desc: '敌人生命 +35%、伤害 +30%；作为补偿，击杀赏金 +20%。',
    hpMul: 1.35, dmgMul: 1.30, bountyMul: 1.20,
  },
};
export function difficultyById(id) { return DIFFICULTIES[id] || DIFFICULTIES.normal; }

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
  2:  { title: '海盗登陆', level: '少', tags: ['标准近战'], hint: '远程输出是防线核心——确保有足够射击作物在今晚成熟。' },
  3:  { title: '潮汐鱼群', level: '中', tags: ['快速敌群'], hint: '成群快速敌人！范围伤害（玉米投手）或更多射手可以应对。' },
  4:  { title: '混合掠夺者', level: '中', tags: ['近战混编'], hint: '解锁夜后三选一：胜利后可挑选构筑方向。' },
  5:  { title: '礁石巨人苏醒', level: '精英', tags: ['重甲目标'], hint: '重甲削减每次伤害！需要更高的单发攻击与坚果前排。' },
  6:  { title: '精英混合波', level: '精英', tags: ['重甲目标', '快速敌群'], hint: '木材富余就继续铺农田、凑齐同标签作物激活流派羁绊。' },
  7:  { title: '快速敌群', level: '多', tags: ['快速敌群'], hint: '提示：成熟作物可消耗阳光进化（点击作物，二选一方向）。' },
  8:  { title: '重甲压境', level: '精英', tags: ['重甲目标', '近战混编'], hint: '检验阵容厚度：农田应已铺得差不多，温室（岛屿强化）也已可用。' },
  9:  { title: 'Boss 前哨波', level: '大军', tags: ['重甲目标', 'Boss 先兆'], hint: '明日幽灵船长亲自登陆——完成进化或激活羁绊！' },
  10: { title: '幽灵船长', level: 'Boss', tags: ['Boss', '召唤', '高伤害'], hint: '最终决战！击败幽灵船长即可守下这座岛。' },
};

// ---------- 十天日程（新内容教学，文档第 7 节） ----------
// V0.3：种子不再按天解锁（改由开局构筑决定），此处只保留「功能解锁」与教学文案。
// unlockFeatures 仍然按天开：expand（第 3 天）/ pick3（第 4 天）/ greenhouse（第 8 天）
export const DAY_SCRIPT = {
  1:  { notes: ['引导：种植 → 培育 → 结束白天'], tutorial: true },
  2:  { notes: ['提示：远程输出是防线核心，确保有足够射击作物成熟'] },
  3:  { notes: ['提示：木材用来在空地上「建造农田」——点击荒草地即可放置'], bonus: { materials: 12, label: '岛屿补给（特殊预告奖励）' } },
  4:  { unlockFeatures: ['pick3'], notes: ['解锁夜后三选一：胜利后可挑选构筑方向'] },
  5:  { notes: ['警告：礁石巨人出现——重甲削减每次伤害'] },
  6:  { notes: ['提示：木材富余时优先铺满农田——每天 8 AP 是真正的瓶颈'] },
  7:  { notes: ['提示：成熟作物可消耗阳光进化（点击作物，二选一方向）'], bonus: { materials: 10, label: '进化支援补给' } },
  8:  { unlockFeatures: ['greenhouse'], notes: ['岛屿强化（温室）解锁'], bonus: { materials: 8, label: '岛屿补给（特殊预告奖励）' } },
  9:  { notes: ['Boss 威胁完整预告'], bonus: { sun: 60, label: '决战储备（阳光）' } },
  10: { notes: ['最终夜：击败幽灵船长！'] },
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
