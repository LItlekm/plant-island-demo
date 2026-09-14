// ============================================================
// 夜间自动战斗模拟（文档第 6 节）。纯逻辑，输出 FX 事件供表现层播放。
// V0.6 自走棋式规则：
//   战斗作物主动移动寻敌（守护贴脸 / 远程走到射程 85% 停下开火 / 支援留守），
//   敌人登陆后优先攻击嘲讽范围内的守护作物，
//   其次攻击攻击距离内贴脸的作物（顺路遇到就打），
//   最后才进攻主城；单位与敌人之间轻微挤位防重叠。
// 冷却计时器驱动；伤害最小为 1；范围攻击按半径命中。
// ============================================================
import * as D from './data.js';
import { isMature, maturePlants, activeSynergies } from './domain.js';

let nextId = 1;

export function createBattle(run) {
  const day = run.day;
  const waves = (D.NIGHTS[day] || []).map(w => ({ ...w }));
  const syn = activeSynergies(run);
  const scale = D.enemyDayScale(day);

  const b = {
    day, waves, waveIdx: -1, waveTimer: D.PREP_TIME, spawnQueue: [],
    t: 0, speed: 1, over: false, win: false, resultShown: false,
    // V0.7：难度倍率（spawnEnemy 时应用）
    diff: D.difficultyById(run.difficulty),
    enemies: [], units: [], projectiles: [], fx: [],
    city: {
      x: D.CITY_POSITION.x, z: D.CITY_POSITION.z,
      hp: run.city.hp, maxHp: run.city.maxHp, armor: run.city.armor,
      dr: syn.includes('guard2') ? 0.10 : 0,
    },
    summary: { kills: 0, giantsKilled: 0, bossKilled: 0, bountySun: 0 },
    stats: { waveCount: waves.length },
  };

  // 全队加成：向日葵攻击光环（上限 +100%）
  let teamBuff = 0;
  for (const p of maturePlants(run)) {
    const c = D.CROPS[p.defId];
    if (c.id === 'sunflower') {
      let v = c.teamBuff + (c.levelBonus.teamBuff || 0) * (p.level - 1);
      if (p.evolved) {
        const br = D.evolutionBranch('sunflower', p.evolvedId);
        if (br?.bonus.teamBuff) v += br.bonus.teamBuff;
      }
      teamBuff += v;
    }
  }
  b.teamBuff = Math.min(1.0, teamBuff);

  // 我方单位：成熟作物进入防守阵列（文档第 3 节，自动摆放）
  const mature = maturePlants(run).slice().sort((a, c) => a.id - c.id);
  const slotIdx = { guard: 0, attacker: 0, support: 0 };
  for (const p of mature) {
    const c = D.CROPS[p.defId];
    const role = c.id === 'wallnut' ? 'guard' : (c.attack > 0 ? 'attacker' : 'support');
    const slots = D.DEFENSE_SLOTS[role];
    const slot = slots[slotIdx[role] % slots.length];
    slotIdx[role]++;

    const lvB = c.levelBonus || {};
    let hp = c.hp + (lvB.hp || 0) * (p.level - 1);
    let atk = c.attack + (lvB.attack || 0) * (p.level - 1);
    let interval = c.attackInterval;
    let range = c.range;
    let aoeRadius = c.aoeRadius || 0;
    let slowChance = c.slowChance || 0;
    let slowDuration = c.slowDuration || 0;
    let slowFactor = c.slowFactor || 0.5;
    let dr = 0, shield = 0, tauntRadius = c.tauntRadius || 0, doubleShot = false;
    let attackMul = 1, speedBonus = 0, splashRadius = 0, splashMul = 0, stunChance = 0, stunDuration = 0;
    let healPerSec = 0, thornsUnit = 0;
    // V0.7：新作物机制字段
    let chainHops = c.chainHops || 0, chainFall = c.chainFall || 0.30, shockMark = 0;
    let summonInterval = c.summonInterval || 0, summonCap = c.summonCap || 0;
    let sporelingHp = 22, sporelingAtk = 5, deathBurst = 0;
    let gustInterval = c.gustInterval || 0, gustRadius = c.gustRadius || 0, gustPush = c.gustPush || 0;
    let gustPull = false, gustSlow = 0, gustSlowDur = 0;

    if (p.evolved) {
      const br = D.evolutionBranch(p.defId, p.evolvedId);
      const evo = br?.bonus || {};
      if (evo.attack) atk += evo.attack;
      if (evo.hp) hp += evo.hp;
      if (evo.hpMul) hp *= evo.hpMul;
      if (evo.attackMul) attackMul *= evo.attackMul;
      if (evo.damageReduction) dr += evo.damageReduction;
      if (evo.tauntRadius) tauntRadius = evo.tauntRadius;
      if (evo.battleShield) shield += evo.battleShield;
      if (evo.thorns) thornsUnit += evo.thorns;
      if (evo.aoeRadius) aoeRadius = evo.aoeRadius;
      if (evo.aoeDamageMul) attackMul *= evo.aoeDamageMul;
      if (evo.slowChance != null && evo.stunChance == null) slowChance = evo.slowChance;
      if (evo.slowDuration != null && evo.stunChance == null) slowDuration = evo.slowDuration;
      if (evo.stunChance != null) { slowChance = 0; stunChance = evo.stunChance; stunDuration = evo.stunDuration; }
      if (evo.doubleShot) doubleShot = true;
      if (evo.speedBonus) speedBonus += evo.speedBonus;
      if (evo.splashRadius) { splashRadius = evo.splashRadius; splashMul = evo.splashMul; }
      if (evo.healPerSec) healPerSec = evo.healPerSec;
      // V0.7：新作物进化键
      if (evo.chainHops) chainHops = evo.chainHops;
      if (evo.chainFall != null) chainFall = evo.chainFall;
      if (evo.shockMark) shockMark = evo.shockMark;
      if (evo.summonInterval) summonInterval = evo.summonInterval;
      if (evo.summonCap) summonCap = evo.summonCap;
      if (evo.sporelingHp) sporelingHp = evo.sporelingHp;
      if (evo.sporelingAtk) sporelingAtk = evo.sporelingAtk;
      if (evo.deathBurst) deathBurst = evo.deathBurst;
      if (evo.gustPush) gustPush = evo.gustPush;
      if (evo.gustPull) gustPull = true;
      if (evo.gustSlow) { gustSlow = evo.gustSlow; gustSlowDur = evo.gustSlowDur || 0; }
    }
    hp = Math.round(hp * (1 + run.mod.hpMul));
    if (c.tags.includes('射击')) atk *= 1 + run.mod.shootAtkMul;
    if (c.tags.includes('投掷')) { atk *= 1 + run.mod.throwAtkMul; aoeRadius *= 1 + run.mod.aoeMul; }
    // V0.7：投掷流羁绊（throw2 范围 / throw4 攻击）
    if (c.tags.includes('投掷') && syn.includes('throw2')) aoeRadius *= 1.15;
    if (c.tags.includes('投掷') && syn.includes('throw4')) atk *= 1.15;
    atk *= attackMul * (1 + b.teamBuff);
    let spd = 1 + run.mod.speedMul + speedBonus;
    if (c.tags.includes('射击') && syn.includes('shoot2')) spd += 0.10;
    interval = interval / spd;

    if (c.id === 'wallnut' && syn.includes('guard3')) shield += 60;
    const thorns = thornsUnit + (c.id === 'wallnut' ? (run.mod.thorns || 0) : 0);
    const regen = healPerSec + (healPerSec > 0 ? (run.mod.regenPerSec || 0) : 0);
    const globalRegen = run.mod.regenPerSec || 0; // 战地园丁：全队回复

    b.units.push({
      id: nextId++, plantId: p.id, defId: c.id, name: p.evolved ? (D.evolutionBranch(p.defId, p.evolvedId)?.name || c.name) : c.name,
      branchId: p.evolvedId || null,
      role, tags: c.tags,
      x: slot.x, z: slot.z, homeX: slot.x, homeZ: slot.z,
      // V0.6 自走棋式移动：守护 0.9 / 输出 1.1（比多数敌人慢，鱼群仍可包抄）；支援不移动
      // V0.7：风灵草站桩控场——旋风以自身为中心，追到射程边缘会让敌人永远进不了旋风圈
      moveSpeed: c.id === 'gustgrass' ? 0 : (role === 'guard' ? 0.9 : (role === 'attacker' ? 1.1 : 0)),
      radius: role === 'guard' ? 0.55 : 0.45,
      hp: Math.round(hp), maxHp: Math.round(hp), shield, dr, thorns,
      regen: regen > 0 ? regen : globalRegen,
      atk, interval, cd: interval * (0.3 + Math.random() * 0.5), range, aoeRadius,
      slowChance, slowDuration, slowFactor, stunChance, stunDuration,
      doubleShot, secondShotT: 0,
      splashRadius, splashMul,
      healTick: 0,
      tauntRadius, pierce: false, firedOnce: false, dead: false, hitFlash: 0,
      // V0.7：连锁 / 召唤 / 旋风字段
      chainHops, chainFall, shockMark,
      summonInterval, summonCap, summonCd: summonInterval > 0 ? summonInterval * 0.5 : 0,
      sporelingHp, sporelingAtk, deathBurst,
      gustInterval, gustRadius, gustPush, gustPull, gustSlow, gustSlowDur,
      gustCd: gustInterval > 0 ? gustInterval * 0.6 : 0,
    });
  }
  b.pierceArmed = syn.includes('shoot4');
  return b;
}

function emit(b, ev) { b.fx.push(ev); }

function spawnWave(b, wave) {
  const queue = [];
  for (const [type, count] of Object.entries(wave)) {
    for (let i = 0; i < count; i++) queue.push(type);
  }
  // 洗牌打散生成顺序，随机分配航道
  for (let i = queue.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  b.spawnQueue = queue.map((type, i) => ({ type, t: 0.3 + i * 0.4, lane: (Math.random() * 10 - 5) }));
  emit(b, { type: 'wave', idx: b.waveIdx, total: b.waves.length });
}

function spawnEnemy(b, type, lane) {
  const def = D.ENEMIES[type];
  const scale = D.enemyDayScale(b.day);
  const diff = b.diff || D.difficultyById('normal');   // V0.7：难度倍率
  const hp = Math.round(def.hp * scale.hp * diff.hpMul);
  b.enemies.push({
    id: nextId++, type, name: def.name,
    x: lane, z: D.SEA_Z + 1.5 + Math.random() * 2,
    hp, maxHp: hp,
    dmg: Math.round(def.damage * scale.dmg * diff.dmgMul),
    speed: def.speed, interval: def.attackInterval, cd: def.attackInterval * (0.4 + Math.random() * 0.4),
    armor: def.armor, radius: def.radius,
    bounty: { sun: Math.round((def.bounty?.sun || 0) * diff.bountyMul) },
    tauntImmune: !!def.tauntImmune, phases: def.phases ? def.phases.map(p => ({ ...p, done: false })) : null,
    slowT: 0, slowFactor: 1, stunT: 0, shockedT: 0, landed: false, dead: false, hitFlash: 0, attackAnim: 0,
  });
}

export function stepBattle(b, dtRaw) {
  if (b.over) return;
  const dt = dtRaw;

  // --- 波次推进：准备期 → 逐波生成 → 清空后进入下一波 / 胜利 ---
  if (b.waves.length === 0) {
    b.over = true; b.win = true;
    emit(b, { type: 'end', win: true });
    return;
  }
  if (b.waveIdx === -1) {
    b.waveTimer -= dt;
    if (b.waveTimer <= 0) { b.waveIdx = 0; b.waveTimer = D.WAVE_GAP; spawnWave(b, b.waves[0]); }
  } else if (b.spawnQueue.length > 0) {
    for (const s of b.spawnQueue) s.t -= dt;
    while (b.spawnQueue.length && b.spawnQueue[0].t <= 0) {
      const s = b.spawnQueue.shift();
      spawnEnemy(b, s.type, s.lane);
    }
  } else if (b.enemies.length === 0) {
    if (b.waveIdx >= b.waves.length - 1) {
      b.over = true; b.win = true;
      emit(b, { type: 'end', win: true });
      return;
    }
    b.waveTimer -= dt;
    if (b.waveTimer <= 0) {
      b.waveIdx++;
      b.waveTimer = D.WAVE_GAP;
      spawnWave(b, b.waves[b.waveIdx]);
    }
  }

  // --- 我方单位 ---
  for (const u of b.units) {
    if (u.dead) continue;
    u.hitFlash = Math.max(0, u.hitFlash - dt * 4);
    // 治疗光环（翠光向日葵 / 战地园丁）：每 0.5s 结算一次
    if (u.regen > 0 && u.hp < u.maxHp) {
      u.healTick += dt;
      if (u.healTick >= 0.5) {
        u.healTick = 0;
        const amount = Math.max(1, Math.round(u.regen * 0.5));
        u.hp = Math.min(u.maxHp, u.hp + amount);
        emit(b, { type: 'heal', x: u.x, z: u.z, amount });
      }
    }
    if (u.secondShotT > 0) {
      u.secondShotT -= dt;
      if (u.secondShotT <= 0) fireAt(b, u, pickCropTarget(b, u));
    }
    // --- V0.6 自走棋式移动：战斗作物主动寻敌，无敌人在场时缓步回位 ---
    // 守护贴脸接敌；远程走到射程 85% 处停下开火；支援（moveSpeed=0）留守后排。
    if (u.moveSpeed > 0) {
      const foe = nearestFoe(b, u);
      let moved = false;
      if (foe) {
        const dTo = Math.hypot(foe.x - u.x, foe.z - u.z);
        const stopAt = u.range > 0 ? (u.range * 0.85 + foe.radius) : (foe.radius + u.radius + 0.25);
        if (dTo > stopAt) {
          const sp = u.moveSpeed * dt, d = dTo || 1;
          u.x += ((foe.x - u.x) / d) * sp;
          u.z += ((foe.z - u.z) / d) * sp;
          moved = true;
        }
      }
      if (!moved && !foe) {
        const d = Math.hypot(u.homeX - u.x, u.homeZ - u.z);
        if (d > 0.05) {
          const sp = Math.min(u.moveSpeed * dt, d);
          u.x += ((u.homeX - u.x) / d) * sp;
          u.z += ((u.homeZ - u.z) / d) * sp;
        }
      }
      // 不下海：限制在岛屿范围内活动
      u.x = Math.max(-8.0, Math.min(8.0, u.x));
      u.z = Math.max(-11.6, Math.min(9.0, u.z));
    }
    // --- V0.7 菌母召唤：与攻击系统独立（菌母本身 atk=0，不走攻击循环） ---
    if (u.summonInterval > 0) {
      u.summonCd -= dt;
      if (u.summonCd <= 0) {
        const mine = b.units.filter(x => !x.dead && x.summonOwner === u.id).length;
        if (mine < u.summonCap) {
          u.summonCd = u.summonInterval;
          spawnSporeling(b, u);
        } else {
          u.summonCd = 0.5;   // 满员：短周期重试，蘑菇兵战死后尽快补位
        }
      }
    }
    // --- V0.7 风灵草旋风：定期吹退/拢聚周围敌人 ---
    if (u.gustInterval > 0) {
      u.gustCd -= dt;
      if (u.gustCd <= 0) { u.gustCd = u.gustInterval; doGust(b, u); }
    }
    if (u.atk <= 0 || u.interval <= 0) continue;
    u.cd -= dt;
    if (u.cd <= 0) {
      const target = pickCropTarget(b, u);
      if (target) {
        u.cd = u.interval;
        // V0.7：连锁电弧作物（弧光藤）即时结算，不走投射物
        if (u.chainHops > 0) chainZap(b, u, target);
        else {
          fireAt(b, u, target);
          if (u.doubleShot) u.secondShotT = 0.16;
        }
      }
    }
  }

  // --- 投射物 ---
  for (const pr of b.projectiles) {
    if (pr.done) continue;
    const tgt = pr.targetId ? b.enemies.find(e => e.id === pr.targetId && !e.dead) : null;
    const tx = tgt ? tgt.x : pr.lx, tz = tgt ? tgt.z : pr.lz;
    const dx = tx - pr.x, dz = tz - pr.z;
    const dist = Math.hypot(dx, dz);
    const step = pr.speed * dt;
    pr.t += dt;
    if (dist <= step || dist < 0.01) {
      pr.done = true;
      if (pr.kind === 'corn') cornImpact(b, pr, tx, tz);
      else if (tgt) bulletHit(b, pr, tgt);
    } else {
      pr.x += (dx / dist) * step;
      pr.z += (dz / dist) * step;
      pr.lx = tx; pr.lz = tz;
    }
  }
  b.projectiles = b.projectiles.filter(p => !p.done);

  // --- 敌人 ---
  for (const e of b.enemies) {
    if (e.dead) continue;
    e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
    e.attackAnim = Math.max(0, e.attackAnim - dt * 3);
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowFactor = 1; }
    if ((e.shockedT || 0) > 0) e.shockedT -= dt;   // V0.7 感电标记计时
    if (e.stunT > 0) { e.stunT -= dt; continue; }  // 被冻住：无法移动或攻击

    // 登陆反馈
    if (!e.landed && e.z <= D.BEACH_Z) { e.landed = true; emit(b, { type: 'land', x: e.x }); }

    // 目标选择优先级（V0.6）：
    //   1) 嘲讽范围内的守护作物（tauntImmune 只受进化嘲讽）
    //   2) 攻击距离内贴脸的任意作物 —— 去主城的路上遇到就打，不再无视防线直冲主城
    //   3) 主城
    let target = pickGuardFor(b, e);
    if (!target) {
      let bestD = Infinity;
      for (const u of b.units) {
        if (u.dead) continue;
        const d = Math.hypot(u.x - e.x, u.z - e.z);
        const reach = u.radius + e.radius + 0.35;
        if (d <= reach && d < bestD) { bestD = d; target = u; }
      }
    }
    const tx = target ? target.x : b.city.x;
    const tz = target ? target.z : b.city.z;
    const reach = target ? (target.radius + e.radius + 0.35) : 1.5;
    const dist = Math.hypot(tx - e.x, tz - e.z);

    if (dist > reach) {
      const sp = e.speed * (e.slowT > 0 ? e.slowFactor : 1);
      e.x += ((tx - e.x) / dist) * sp * dt;
      e.z += ((tz - e.z) / dist) * sp * dt;
    } else {
      e.cd -= dt;
      if (e.cd <= 0) {
        e.cd = e.interval;
        e.attackAnim = 1;
        if (target) {
          const dmg = Math.max(1, Math.round(e.dmg * (1 - (target.dr || 0))));
          applyGuardDamage(b, target, e, dmg);
        } else {
          const dmg = Math.max(1, Math.round(e.dmg * (1 - b.city.dr)) - b.city.armor);
          b.city.hp -= dmg;
          emit(b, { type: 'cityHit', dmg, x: b.city.x + (Math.random() - 0.5), z: b.city.z });
          if (b.city.hp <= 0) {
            b.city.hp = 0; b.over = true; b.win = false;
            emit(b, { type: 'end', win: false });
            return;
          }
        }
      }
    }

    // Boss 阶段召唤
    if (e.phases) {
      const pct = e.hp / e.maxHp;
      for (const ph of e.phases) {
        if (!ph.done && pct <= ph.atHpPct) {
          ph.done = true;
          let n = 0;
          for (const [type, count] of Object.entries(ph.summon)) {
            for (let i = 0; i < count; i++) {
              spawnEnemy(b, type, e.x + (Math.random() - 0.5) * 3);
              const spawned = b.enemies[b.enemies.length - 1];
              spawned.z = e.z - 1 - Math.random() * 2;
              n++;
            }
          }
          emit(b, { type: 'summon', x: e.x, z: e.z, label: ph.label });
        }
      }
    }
  }

  // 清理死亡敌人
  for (const e of b.enemies) {
    if (e.dead || e.hp > 0) continue;
    e.dead = true;
    b.summary.kills++;
    b.summary.bountySun += e.bounty.sun || 0;
    if (e.type === 'giant') b.summary.giantsKilled++;
    if (e.type === 'boss') b.summary.bossKilled++;
    emit(b, { type: 'death', x: e.x, z: e.z, etype: e.type, bountySun: e.bounty.sun || 0 });
  }
  b.enemies = b.enemies.filter(e => !e.dead);
  // V0.7：毒孢兵战损爆毒（在移除尸体前结算）
  for (const u of b.units) {
    if (!u.dead || !(u.deathBurst > 0)) continue;
    emit(b, { type: 'sporeBurst', x: u.x, z: u.z, r: 1.6 });
    for (const e of b.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - u.x, e.z - u.z) <= 1.6 + e.radius) {
        dealEnemyDamage(b, e, u.deathBurst);
      }
    }
  }
  // V0.6 自走棋式挤位：单位之间、敌人之间轻微推开，避免叠成一摞
  separateCircles(b.units.filter(u => !u.dead));
  separateCircles(b.enemies.filter(e => !e.dead));
  b.units = b.units.filter(u => !u.dead || u.role !== 'attacker'); // 死亡守护保留短暂尸体由视图处理
}

// --- V0.6 移动辅助 ---
function nearestFoe(b, u) {
  let best = null, bestD = Infinity;
  for (const e of b.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - u.x, e.z - u.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
function separateCircles(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      const dx = c.x - a.x, dz = c.z - a.z;
      const d = Math.hypot(dx, dz), min = a.radius + c.radius;
      if (d > 0.001 && d < min) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push;
        c.x += nx * push; c.z += nz * push;
      }
    }
  }
}

// --- 目标选择 ---
function pickCropTarget(b, u) {
  // 远程作物优先攻击距离主城最近的敌人（且在射程内）
  // V0.7：近战作物（range=0，丰穣木/蘑菇兵）用接触射程，否则永远够不到敌人
  let best = null, bestScore = Infinity;
  for (const e of b.enemies) {
    const dToCity = Math.hypot(e.x - b.city.x, e.z - b.city.z);
    const dToUnit = Math.hypot(e.x - u.x, e.z - u.z);
    const reach = u.range > 0 ? (u.range + e.radius) : (u.radius + e.radius + 0.35);
    if (dToUnit > reach) continue;
    if (dToCity < bestScore) { bestScore = dToCity; best = e; }
  }
  return best;
}
function pickGuardFor(b, e) {
  // V0.7：嘲讽判定不再限定守护角色——进化的活木守卫（attacker 持 tauntRadius）也能吸怪
  let best = null, bestD = Infinity;
  for (const g of b.units) {
    if (g.dead || g.tauntRadius <= 0) continue;
    const d = Math.hypot(g.x - e.x, g.z - e.z);
    const radius = (e.tauntImmune && g.tauntRadius < 999) ? 1.3 : g.tauntRadius;
    if (d <= radius && d < bestD) { bestD = d; best = g; }
  }
  return best;
}

// --- 开火与命中 ---
function fireAt(b, u, target) {
  if (!target) return;
  const kind = u.tags.includes('投掷') ? 'corn' : 'pea';
  const usePierce = b.pierceArmed && !u.firedOnce && u.tags.includes('射击');
  u.firedOnce = true;
  b.projectiles.push({
    x: u.x, z: u.z - 0.4, x0: u.x, z0: u.z - 0.4, y0: 0.8,
    targetId: target.id, lx: target.x, lz: target.z,
    speed: kind === 'corn' ? 6.5 : 10,
    rawAtk: u.atk, kind, aoeRadius: u.aoeRadius,
    slowChance: u.slowChance, slowDuration: u.slowDuration, slowFactor: u.slowFactor,
    stunChance: u.stunChance, stunDuration: u.stunDuration,
    splashRadius: u.splashRadius, splashMul: u.splashMul,
    pierce: usePierce, done: false, t: 0,
  });
  emit(b, { type: 'shoot', x: u.x, z: u.z, kind, defId: u.defId });
}

function bulletHit(b, pr, target) {
  const dmg = Math.max(1, Math.round(pr.rawAtk - (target.armor || 0)));
  dealEnemyDamage(b, target, dmg);
  emit(b, { type: 'hit', x: target.x, z: target.z + 0.3, color: pr.kind === 'corn' ? '#ffd94d' : '#7ee06a' });
  // 巨弹豌豆：溅射
  if (pr.splashRadius > 0) {
    for (const e of b.enemies) {
      if (e === target || e.dead) continue;
      if (Math.hypot(e.x - target.x, e.z - target.z) <= pr.splashRadius + e.radius) {
        dealEnemyDamage(b, e, Math.max(1, Math.round(pr.rawAtk * pr.splashMul - (e.armor || 0))));
      }
    }
    emit(b, { type: 'splash', x: target.x, z: target.z, r: pr.splashRadius });
  }
  if (pr.pierce) {
    // 射击流 4 件套：首次攻击额外穿透 1 个敌人
    let extra = null, bestD = Infinity;
    for (const e of b.enemies) {
      if (e === target || e.dead) continue;
      const d = Math.hypot(e.x - target.x, e.z - target.z);
      if (d < 2.4 && d < bestD) { bestD = d; extra = e; }
    }
    if (extra) {
      dealEnemyDamage(b, extra, Math.max(1, Math.round(pr.rawAtk - (extra.armor || 0))));
      emit(b, { type: 'pierce', x: extra.x, z: extra.z });
    }
  }
}

function cornImpact(b, pr, x, z) {
  const r = pr.aoeRadius;
  emit(b, { type: 'aoe', x, z, r });
  for (const e of b.enemies) {
    if (e.dead) continue;
    if (Math.hypot(e.x - x, e.z - z) <= r + e.radius) {
      dealEnemyDamage(b, e, Math.max(1, Math.round(pr.rawAtk - (e.armor || 0))));
      if (pr.stunChance > 0 && Math.random() < pr.stunChance) {
        e.stunT = Math.max(e.stunT, pr.stunDuration);
        emit(b, { type: 'stun', x: e.x, z: e.z });
      } else if (pr.slowChance > 0 && Math.random() < pr.slowChance) {
        e.slowT = pr.slowDuration; e.slowFactor = pr.slowFactor;
        emit(b, { type: 'slow', x: e.x, z: e.z });
      }
    }
  }
}

function dealEnemyDamage(b, e, dmg) {
  if (e.dead) return;
  let d = Math.max(1, dmg);
  // V0.7 感电标记：标记期间受到的所有伤害 +25%
  if ((e.shockedT || 0) > 0) d = Math.max(1, Math.round(d * 1.25));
  e.hp -= d;
  e.hitFlash = 1;
}

// ---------- V0.7：弧光藤连锁电弧 ----------
// 命中首选目标后，向 2.4 范围内最近的未命中敌人跳跃，每跳伤害按 chainFall 衰减。
function chainZap(b, u, first) {
  const hit = new Set();
  let cur = first;
  let dmg = u.atk;
  const pts = [{ x: u.x, z: u.z - 0.4 }];
  for (let hop = 0; hop < u.chainHops && cur; hop++) {
    if (hop > 0) dmg *= (1 - u.chainFall);
    dealEnemyDamage(b, cur, Math.max(1, Math.round(dmg - (cur.armor || 0))));
    if (u.shockMark > 0) cur.shockedT = Math.max(cur.shockedT || 0, u.shockMark);
    pts.push({ x: cur.x, z: cur.z });
    hit.add(cur.id);
    let next = null, bestD = Infinity;
    for (const e of b.enemies) {
      if (e.dead || hit.has(e.id)) continue;
      const d = Math.hypot(e.x - cur.x, e.z - cur.z);
      if (d <= 2.4 && d < bestD) { bestD = d; next = e; }
    }
    cur = next;
  }
  emit(b, { type: 'chain', pts, x: first.x, z: first.z });
}

// ---------- V0.7：风灵草旋风 ----------
// 吹退（或进化后拢聚）半径内敌人；巨人与 Boss 对位移有 50% 抗性。
function doGust(b, u) {
  let hitAny = false;
  for (const e of b.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - u.x, e.z - u.z);
    if (d > u.gustRadius + e.radius || d < 0.01) continue;
    const heavy = (e.type === 'giant' || e.type === 'boss') ? 0.5 : 1;
    const push = u.gustPush * heavy;
    if (u.gustPull) {
      // 拢聚：向风灵草拉，但保留 0.9 间距避免叠到身上
      const move = Math.max(0, Math.min(push, d - 0.9));
      if (move > 0.01) {
        e.x += ((u.x - e.x) / d) * move;
        e.z += ((u.z - e.z) / d) * move;
        hitAny = true;
      }
    } else {
      e.x += ((e.x - u.x) / d) * push;
      e.z += ((e.z - u.z) / d) * push;
      if (u.gustSlow > 0) {
        e.slowT = Math.max(e.slowT, u.gustSlowDur);
        e.slowFactor = Math.min(e.slowFactor, 1 - u.gustSlow);
      }
      hitAny = true;
    }
  }
  if (hitAny) emit(b, { type: 'gust', x: u.x, z: u.z, r: u.gustRadius, pull: !!u.gustPull });
}

// ---------- V0.7：菌母召唤蘑菇兵（临时单位，战败清场 / 阵亡即移除） ----------
function spawnSporeling(b, mother) {
  const ox = mother.x + (Math.random() - 0.5) * 0.9;
  const oz = mother.z + (Math.random() - 0.5) * 0.9;
  b.units.push({
    id: nextId++, plantId: null, defId: 'sporeling', name: '蘑菇兵',
    branchId: null, role: 'attacker', tags: ['生长'],
    summonOwner: mother.id, transient: true,
    x: ox, z: oz, homeX: ox, homeZ: oz,
    moveSpeed: 1.0, radius: 0.32,
    hp: Math.round(mother.sporelingHp * (1 + 0)),   // 蘑菇兵不吃 run.hpMul（属性由菌母携带）
    maxHp: Math.round(mother.sporelingHp),
    shield: 0, dr: 0, thorns: 0, regen: 0,
    atk: mother.sporelingAtk * (1 + b.teamBuff),    // 享受向日葵攻击光环
    interval: 1.2, cd: 0.6, range: 0, aoeRadius: 0,
    slowChance: 0, slowDuration: 0, slowFactor: 0.5, stunChance: 0, stunDuration: 0,
    doubleShot: false, secondShotT: 0, splashRadius: 0, splashMul: 0,
    healTick: 0, tauntRadius: 0, pierce: false, firedOnce: false, dead: false, hitFlash: 0,
    chainHops: 0, chainFall: 0.3, shockMark: 0,
    summonInterval: 0, summonCap: 0, summonCd: 0,
    sporelingHp: 0, sporelingAtk: 0,
    deathBurst: mother.deathBurst || 0,
    gustInterval: 0, gustRadius: 0, gustPush: 0, gustPull: false, gustSlow: 0, gustSlowDur: 0, gustCd: 0,
  });
  emit(b, { type: 'sporeSpawn', x: ox, z: oz });
}

function applyGuardDamage(b, guard, attacker, dmg) {
  if (guard.dead) return;   // 同帧内已被其他敌人击杀，避免重复结算/重复 FX
  if (guard.shield > 0) {
    const absorbed = Math.min(guard.shield, dmg);
    guard.shield -= absorbed;
    dmg -= absorbed;
  }
  if (dmg > 0) {
    guard.hp -= dmg;
    guard.hitFlash = 1;
  }
  emit(b, { type: 'guardHit', id: guard.id, x: guard.x, z: guard.z, dmg, shield: guard.shield > 0 });
  if (guard.thorns > 0 && !attacker.dead) {
    dealEnemyDamage(b, attacker, guard.thorns);
  }
  if (guard.hp <= 0) {
    guard.dead = true;
    emit(b, { type: 'guardDown', id: guard.id, x: guard.x, z: guard.z, role: guard.role });
  }
}

export function drainFx(b) { const fx = b.fx; b.fx = []; return fx; }
