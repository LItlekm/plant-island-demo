// ============================================================
// 夜间自动战斗模拟（文档第 6 节）。纯逻辑，输出 FX 事件供表现层播放。
// 规则：远程作物优先攻击距离主城最近的敌人；
//       敌人优先攻击嘲讽范围内的守护作物，否则攻击主城；
//       冷却计时器驱动；伤害最小为 1；范围攻击按半径命中。
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
    }
    hp = Math.round(hp * (1 + run.mod.hpMul));
    if (c.tags.includes('射击')) atk *= 1 + run.mod.shootAtkMul;
    if (c.tags.includes('投掷')) { atk *= 1 + run.mod.throwAtkMul; aoeRadius *= 1 + run.mod.aoeMul; }
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
      radius: role === 'guard' ? 0.55 : 0.45,
      hp: Math.round(hp), maxHp: Math.round(hp), shield, dr, thorns,
      regen: regen > 0 ? regen : globalRegen,
      atk, interval, cd: interval * (0.3 + Math.random() * 0.5), range, aoeRadius,
      slowChance, slowDuration, slowFactor, stunChance, stunDuration,
      doubleShot, secondShotT: 0,
      splashRadius, splashMul,
      healTick: 0,
      tauntRadius, pierce: false, firedOnce: false, dead: false, hitFlash: 0,
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
  const hp = Math.round(def.hp * scale.hp);
  b.enemies.push({
    id: nextId++, type, name: def.name,
    x: lane, z: D.SEA_Z + 1.5 + Math.random() * 2,
    hp, maxHp: hp,
    dmg: Math.round(def.damage * scale.dmg),
    speed: def.speed, interval: def.attackInterval, cd: def.attackInterval * (0.4 + Math.random() * 0.4),
    armor: def.armor, radius: def.radius,
    bounty: def.bounty, tauntImmune: !!def.tauntImmune, phases: def.phases ? def.phases.map(p => ({ ...p, done: false })) : null,
    slowT: 0, slowFactor: 1, stunT: 0, landed: false, dead: false, hitFlash: 0, attackAnim: 0,
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
    if (u.atk <= 0 || u.interval <= 0) continue;
    u.cd -= dt;
    if (u.cd <= 0) {
      const target = pickCropTarget(b, u);
      if (target) {
        u.cd = u.interval;
        fireAt(b, u, target);
        if (u.doubleShot) u.secondShotT = 0.16;
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
    if (e.stunT > 0) { e.stunT -= dt; continue; }  // 被冻住：无法移动或攻击

    // 登陆反馈
    if (!e.landed && e.z <= D.BEACH_Z) { e.landed = true; emit(b, { type: 'land', x: e.x }); }

    // 目标选择：嘲讽范围内的守护作物，否则主城
    const guard = pickGuardFor(b, e);
    const tx = guard ? guard.x : b.city.x;
    const tz = guard ? guard.z : b.city.z;
    const reach = guard ? (guard.radius + e.radius + 0.35) : 1.5;
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
        if (guard) {
          const dmg = Math.max(1, Math.round(e.dmg * (1 - (guard.dr || 0))));
          applyGuardDamage(b, guard, e, dmg);
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
  b.units = b.units.filter(u => !u.dead || u.role !== 'attacker'); // 死亡守护保留短暂尸体由视图处理
}

// --- 目标选择 ---
function pickCropTarget(b, u) {
  // 远程作物优先攻击距离主城最近的敌人（且在射程内）
  let best = null, bestScore = Infinity;
  for (const e of b.enemies) {
    const dToCity = Math.hypot(e.x - b.city.x, e.z - b.city.z);
    const dToUnit = Math.hypot(e.x - u.x, e.z - u.z);
    if (dToUnit > u.range + e.radius) continue;
    if (dToCity < bestScore) { bestScore = dToCity; best = e; }
  }
  return best;
}
function pickGuardFor(b, e) {
  let best = null, bestD = Infinity;
  for (const g of b.units) {
    if (g.dead || g.role !== 'guard') continue;
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
  e.hp -= Math.max(1, dmg);
  e.hitFlash = 1;
}

function applyGuardDamage(b, guard, attacker, dmg) {
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
    emit(b, { type: 'guardDown', id: guard.id, x: guard.x, z: guard.z });
  }
}

export function drainFx(b) { const fx = b.fx; b.fx = []; return fx; }
