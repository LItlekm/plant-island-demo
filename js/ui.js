// ============================================================
// UI 层：DOM HUD、面板与弹窗（文档第 8 节核心 UI）。
// 只做展示与输入转发；规则判断在领域层。
// ============================================================
import * as D from './data.js';
import * as dm from './domain.js';

const RESOURCE_ICONS = { sun: '☀️', materials: '🪵' };

export class UI {
  constructor(root, cb) {
    this.cb = cb;       // 游戏控制器回调
    this.selectedSeed = null;
    root.insertAdjacentHTML('beforeend', `
      <div class="float-layer"></div>
      <div id="hud" class="hidden">
        <div class="hud-top-left panel">
          <div class="day-line"><span id="day-icon">🌞</span><b id="day-num">第 1 天</b></div>
          <div class="ap-line">行动点 <span id="ap-pips" class="pips"></span> <b id="ap-num">8</b></div>
        </div>
        <div class="hud-top-right panel">
          <span class="res" id="res-sun" title="阳光：种植、升级、进化与主城升级的资源；击杀敌人与夜间胜利获得">☀️ <b>0</b></span>
          <span class="res" id="res-mat" title="木材：收割成熟作战作物 + 夜战结算获得。用于在荒草地上建造农田、以及岛屿强化">🪵 <b>0</b></span>
          <button id="btn-mute" class="icon-btn" title="音效开关">🔊</button>
          <button id="btn-help" class="icon-btn" title="玩法说明">❓</button>
        </div>
        <div class="hud-forecast panel" id="forecast-chip">
          <span class="fc-label">今夜威胁</span><span id="forecast-brief">—</span>
          <button id="btn-forecast" class="mini-btn">查看</button>
        </div>
        <div class="hud-syn" id="syn-chips"></div>
        <div class="hud-city panel">
          <span>🏠 主城</span>
          <div class="bar"><div id="city-hp-fill" class="fill city-fill"></div></div>
          <b id="city-hp-num">100/100</b><span id="city-armor" class="armor-tag"></span>
        </div>
      </div>

      <div id="bottom-bar" class="hidden">
        <div class="panel seeds" id="seed-list"></div>
        <div class="panel global-actions">
          <button id="btn-expand" class="action-btn"></button>
          <button id="btn-greenhouse" class="action-btn"></button>
          <button id="btn-cityup" class="action-btn"></button>
        </div>
        <button id="btn-endday" class="endday-btn">结束白天 ⟶<small id="endday-sub">进入夜晚</small></button>
      </div>

      <div id="plant-panel" class="panel side-panel hidden"></div>
      <div id="city-panel" class="panel side-panel hidden"></div>
      <div id="tutorial-panel" class="panel hidden">
        <b>📖 第一天引导</b>
        <div id="tutorial-steps"></div>
      </div>

      <div id="night-hud" class="hidden">
        <div class="panel night-info">
          <span id="night-title">第 1 夜</span>
          <span id="night-wave">波次 —</span>
          <span id="night-enemies">敌人 —</span>
        </div>
        <div class="night-controls">
          <button class="speed-btn" data-speed="0">⏸</button>
          <button class="speed-btn active" data-speed="1">1×</button>
          <button class="speed-btn" data-speed="2">2×</button>
          <button class="speed-btn" data-speed="4">4×</button>
        </div>
      </div>

      <div id="banner" class="hidden"></div>
      <div id="toasts"></div>
      <div id="modal-root"></div>
      <pre id="event-log" class="hidden"></pre>
    `);
    this._bind();
  }

  _$(id) { return document.getElementById(id); }
  q(sel) { return document.querySelector(sel); }

  _bind() {
    this._$('btn-endday').onclick = () => this.cb.onEndDay();
    this._$('btn-expand').onclick = () => this.cb.onExpand();
    this._$('btn-greenhouse').onclick = () => this.cb.onGreenhouse();
    this._$('btn-cityup').onclick = () => this.cb.onCityUpgrade();
    this._$('btn-forecast').onclick = () => this.cb.onOpenForecast();
    this._$('btn-help').onclick = () => this.cb.onOpenHelp();
    this._$('btn-mute').onclick = (e) => this.cb.onMuteToggle(e.target);
    document.querySelectorAll('.speed-btn').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.speed-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.cb.onSpeed(Number(b.dataset.speed));
      };
    });
  }

  // ---------- 通用弹窗 ----------
  modal({ title, body, buttons = [], wide = false, closable = false }) {
    const root = this._$('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}">
        <h2>${title}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-btns"></div>
      </div>`;
    const btnRow = overlay.querySelector('.modal-btns');
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'modal-btn ' + (b.cls || '');
      btn.innerHTML = b.label;
      btn.onclick = () => b.onClick?.(overlay);
      btnRow.appendChild(btn);
    }
    root.appendChild(overlay);
    return overlay;
  }
  closeModal() { this._$('modal-root').innerHTML = ''; }

  toast(msg, type = 'info') {
    const box = this._$('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2400);
  }

  banner(html, dur = 2200) {
    const b = this._$('banner');
    b.innerHTML = html;
    b.classList.remove('hidden');
    b.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { b.classList.remove('show'); setTimeout(() => b.classList.add('hidden'), 500); }, dur);
  }

  // ---------- HUD ----------
  showGameHUD(show) {
    this._$('hud').classList.toggle('hidden', !show);
    this._$('bottom-bar').classList.toggle('hidden', !show);
  }
  showNightHUD(show) {
    this._$('night-hud').classList.toggle('hidden', !show);
    if (show) {
      document.querySelectorAll('.speed-btn').forEach(x => x.classList.toggle('active', x.dataset.speed === '1'));
    }
  }

  updateHUD(run) {
    const isNight = run.phase !== 'day';
    this._$('day-icon').textContent = isNight ? '🌙' : '🌞';
    this._$('day-num').textContent = `第 ${run.day} 天`;
    // AP 点阵
    const pips = [];
    for (let i = 0; i < 8; i++) pips.push(`<i class="${i < run.ap ? 'on' : ''}"></i>`);
    this._$('ap-pips').innerHTML = pips.join('');
    this._$('ap-num').textContent = run.ap;
    // 资源
    this._$('res-sun').innerHTML = `☀️ <b>${run.sun}</b>`;
    this._$('res-mat').innerHTML = `🪵 <b>${run.materials}</b>`;
    // 主城
    this._$('city-hp-fill').style.width = `${(run.city.hp / run.city.maxHp) * 100}%`;
    this._$('city-hp-num').textContent = `${run.city.hp}/${run.city.maxHp}`;
    this._$('city-armor').textContent = run.city.armor > 0 ? `护甲+${run.city.armor}` : '';
    // 威胁预告
    const fc = D.THREAT_FORECASTS[run.day];
    if (fc) this._$('forecast-brief').innerHTML = `<b>${fc.title}</b> <span class="tag-chip">${fc.level}</span>`;
    // 羁绊
    this.updateSynergy(run);
    // 白天操作区
    if (run.phase === 'day') this.updateDayBar(run);
    this._$('bottom-bar').classList.toggle('hidden', isNight);
  }

  updateSynergy(run) {
    const counts = {};
    for (const p of run.plants) {
      const def = D.CROPS[p.defId];
      if (p.growth >= def.maturityDays) for (const t of def.tags) counts[t] = (counts[t] || 0) + 1;
    }
    const activeIds = new Set();
    for (const s of D.SYNERGIES) if ((counts[s.school] || 0) >= s.need) activeIds.add(s.id);
    let html = '';
    for (const school of ['射击', '守护', '生长']) {
      const n = counts[school] || 0;
      if (n === 0) continue;
      const isActive = [...activeIds].some(id => D.SYNERGIES.find(s => s.id === id)?.school === school);
      const cls = isActive ? 'active' : '';
      html += `<span class="syn-chip ${cls}" data-school="${school}">${school}流 ×${n}<small>${isActive ? ' ●激活' : ''}</small></span>`;
    }
    this._$('syn-chips').innerHTML = html;
    // 流派 tooltip：悬停或点击查看各档效果与激活状态
    this._$('syn-chips').querySelectorAll('.syn-chip').forEach(chip => {
      const school = chip.dataset.school;
      const show = () => this.showSynTooltip(chip, school, counts[school] || 0, activeIds);
      chip.addEventListener('mouseenter', show);
      chip.addEventListener('click', show);
    });
  }

  showSynTooltip(chip, school, count, activeIds) {
    let tip = document.getElementById('syn-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'syn-tooltip';
      document.body.appendChild(tip);
    }
    const tiers = D.SYNERGIES.filter(s => s.school === school)
      .sort((a, b) => a.need - b.need)
      .map(s => {
        const on = (count >= s.need) && activeIds.has(s.id);
        return `<div class="syn-tier ${on ? 'on' : ''}">${on ? '✅' : '⬜'} ${s.need} 个：${s.desc}</div>`;
      }).join('');
    const next = D.SYNERGIES.filter(s => s.school === school && s.need > count).sort((a, b) => a.need - b.need)[0];
    tip.innerHTML = `
      <div class="syn-tip-title">${school}流 <b>${count}</b> 株参战成熟作物</div>
      ${tiers}
      <div class="syn-tip-note">${next ? `再种 1 株「${school}」标签作物到 ${next.need} 株可激活下一档` : '已达最高档'}</div>`;
    tip.classList.add('show');
    const rect = chip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 270, Math.max(8, rect.left + rect.width / 2 - 125)) + 'px';
    tip.style.top = (rect.bottom + 8) + 'px';
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => tip.classList.remove('show'), 4000);
  }

  updateDayBar(run) {
    // 种子按钮
    const list = this._$('seed-list');
    list.innerHTML = '';
    for (const seedId of run.unlockedSeeds) {
      const def = D.CROPS[seedId];
      const afford = run.sun >= def.cost && run.ap >= D.ACTION_COST.plant.ap;
      const btn = document.createElement('button');
      btn.className = 'seed-btn' + (this.selectedSeed === seedId ? ' selected' : '');
      btn.innerHTML = `${def.icon}<span>${def.name}</span><small>${def.cost}☀️</small>`;
      btn.disabled = !afford;
      btn.title = `${def.role}｜成熟 ${def.maturityDays} 天｜${def.desc}`;
      btn.onclick = () => { this.cb.onSelectSeed(seedId); };
      list.appendChild(btn);
    }
    const buildInfo = D.buildById(run.buildId);
    const hint = document.createElement('span');
    hint.className = 'seed-locked-hint';
    hint.textContent = `本局构筑：${buildInfo.name}｜种子池 ${run.unlockedSeeds.length} 种`;
    list.appendChild(hint);
    // 全局行动
    // V0.5：建造农田改为"放置式"——按钮只负责提示玩法，真正的建造发生在点击荒草地
    const farmsNow = dm.plotsUnlocked(run);
    const expandCost = D.plotBuildCost(farmsNow);
    const leftTiles = dm.buildableTiles(run).length;
    const atCap = leftTiles === 0;
    const anyOk = dm.canBuildAnyFarm(run);
    const lackWood = !atCap && run.materials < expandCost;
    this._$('btn-expand').innerHTML = `建造农田<small class="${lackWood ? 'lack' : ''}">${D.ACTION_COST.expand.ap}AP + ${expandCost}🪵</small>`;
    this._$('btn-expand').disabled = !anyOk.ok;
    this._$('btn-expand').title = atCap ? '12 格农田已全部建成'
      : lackWood ? `木材不足：现有 ${run.materials}🪵，需要 ${expandCost}🪵（收割成熟作物可获得木材）`
      : `点击任意一格荒草地即可建造农田（还剩 ${leftTiles} 格）`;
    const ghOk = run.features.greenhouse && !run.greenhoused;
    this._$('btn-greenhouse').innerHTML = `温室<small>${D.ACTION_COST.greenhouse.ap}AP + ${D.ACTION_COST.greenhouse.materials}🪵</small>`;
    this._$('btn-greenhouse').disabled = !ghOk;
    this._$('btn-greenhouse').title = ghOk ? '建造后所有作物每日自然成长 +1' : (run.features.greenhouse ? '已建造' : '第 8 天解锁');
    const cuCost = D.ACTION_COST.cityUpgrade.sunByLevel[run.city.level + 1];
    this._$('btn-cityup').innerHTML = `主城升级<small>${cuCost ? cuCost + '☀️' : '已满级'}</small>`;
    this._$('btn-cityup').disabled = !cuCost || run.sun < cuCost;
    this._$('btn-cityup').title = cuCost ? `升到 ${run.city.level + 1} 级：生命上限+50、护甲+1、完全修复` : '主城已达 3 级';
    this._$('endday-sub').textContent = run.ap > 0 ? `还有 ${run.ap} 行动点` : '进入夜晚';
  }

  // AP 消耗文案（0 AP 时省略）
  _apLabel(ap) { return ap > 0 ? `${ap} AP + ` : ''; }

  // ---------- 选中作物面板 ----------
  showPlantPanel(run, p, actions) {
    // actions: {cultivate, harvest, upgrade, evolve} 各含 {ok, reason, costLabel}
    const def = D.CROPS[p.defId];
    const stage = p.growth <= 0 ? '种子' : (p.growth >= def.maturityDays ? '成熟' : '幼苗');
    const branches = D.EVOLUTIONS[p.defId] || [];
    const ap = D.ACTION_COST;
    const btn = (id, label, sub, a, cls) => `
      <button class="panel-btn ${cls || ''}" data-act="${id}" ${a.ok ? '' : 'disabled'}>
        ${label}<small>${a.ok ? sub : a.reason}</small>
      </button>`;
    this._$('plant-panel').innerHTML = `
      <div class="pp-head">${def.icon} <b>${p.evolved ? (D.evolutionBranch(p.defId, p.evolvedId)?.name || def.name) : def.name}</b> <span class="lv">Lv.${p.level}</span></div>
      <div class="pp-sub">${p.evolved ? `进化体 · ${(D.evolutionBranch(p.defId, p.evolvedId) || {}).desc || ''}` : def.role} ｜ ${def.tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>
      <div class="pp-row">成长 ${stage} <span class="bar"><div class="fill grow-fill" style="width:${(p.growth / def.maturityDays) * 100}%"></div></span> ${p.growth}/${def.maturityDays}</div>
      <div class="pp-row dim">生命 ${this._plantHp(def, p)} ｜ ${def.attack > 0 ? `攻击 ${this._plantAtk(def, p)} · 间隔 ${def.attackInterval}s · 射程 ${def.range}` : (def.id === 'sunflower' ? `每日 +${this._plantSun(def, p, run)}☀️` : '嘲讽承伤')}</div>
      <div class="pp-btns">
        ${stage !== '成熟' ? btn('cultivate', '💧 培育', `+${this._cultivateGain(run)} 成长`, actions.cultivate) : ''}
        ${stage === '成熟' ? btn('harvest', this._harvestLabel(def, p, run), '1 AP', actions.harvest) : ''}
        ${stage === '成熟' && p.level < 3 ? btn('upgrade', '⬆ 升级', `${this._apLabel(ap.upgrade.ap)}${actions.upgrade.costLabel}☀️`, actions.upgrade, 'gold') : ''}
        ${stage === '成熟' && !p.evolved ? btn('evolve', `🧬 进化（二选一）`, actions.evolve.ok ? `${branches[0].cost}☀️ 起` : actions.evolve.reason, actions.evolve, 'gold') : ''}
      </div>
      <button class="panel-close" id="pp-close">✕</button>`;
    this._$('plant-panel').classList.remove('hidden');
    this._$('pp-close').onclick = () => this.hidePanels();
    this._$('plant-panel').querySelectorAll('[data-act]').forEach(b => {
      b.onclick = () => this.cb.onPlantAction(b.dataset.act, p.id);
    });
  }

  // ---------- 进化方向选择（V0.2：二选一，消耗阳光） ----------
  showEvolutionChoice(run, plant, onPick) {
    const def = D.CROPS[plant.defId];
    const branches = D.EVOLUTIONS[plant.defId] || [];
    const cards = branches.map((br, i) => {
      const afford = run.sun >= br.cost;
      return `
      <button class="pick-card evo-card" data-idx="${i}" ${afford ? '' : 'disabled style="opacity:0.45;cursor:not-allowed"'}>
        <div class="pc-icon">${br.icon}</div>
        <div class="pc-name">${br.name}</div>
        <div class="pc-desc">${br.desc}</div>
        <div class="pc-cost">🧬 ${br.cost}☀️</div>
      </button>`;
    }).join('');
    const overlay = this.modal({
      title: `🧬 ${def.name} 进化 · 选择方向`,
      body: `<div class="dim">进化不可撤销。选择一个方向，效果立即并在今晚生效。</div><div class="pick-grid">${cards}</div>`,
      buttons: [],
      wide: true,
    });
    overlay.querySelectorAll('.evo-card').forEach(btn => {
      btn.onclick = () => { this.closeModal(); onPick(branches[Number(btn.dataset.idx)]); };
    });
  }

  _evoBonus(p) {
    if (!p.evolved) return {};
    return D.evolutionBranch(p.defId, p.evolvedId)?.bonus || {};
  }
  _plantHp(def, p) {
    let hp = def.hp + (def.levelBonus?.hp || 0) * (p.level - 1);
    const e = this._evoBonus(p);
    if (e.hp) hp += e.hp;
    if (e.hpMul) hp = Math.round(hp * e.hpMul);
    return hp;
  }
  _plantAtk(def, p) {
    let atk = def.attack + (def.levelBonus?.attack || 0) * (p.level - 1);
    const e = this._evoBonus(p);
    if (e.attack) atk += e.attack;
    if (e.attackMul) atk = Math.round(atk * e.attackMul);
    return atk;
  }
  _plantSun(def, p, run) {
    let v = def.passiveSun + (def.levelBonus?.passiveSun || 0) * (p.level - 1);
    const e = this._evoBonus(p);
    if (e.passiveSun) v += e.passiveSun;
    return Math.round(v * (1 + run.mod.sunMul));
  }
  _plantHarvest(def, p, run) {
    let v = def.harvestSun;
    const e = this._evoBonus(p);
    if (e.harvestSun) v += e.harvestSun;
    return Math.round(v * (1 + run.mod.sunMul));
  }
  // V0.4：培育成长量（修复原先硬编码 +1，实际受根系网络 / 生长流加成影响）
  _cultivateGain(run) {
    return 1 + (run.mod?.cultivateBonus || 0);
  }
  // V0.4：收割产物文案（向日葵 → 阳光；战斗作物 → 木材）
  _harvestLabel(def, p, run) {
    const sun = this._plantHarvest(def, p, run);
    const mats = def.harvestMaterials
      ? def.harvestMaterials + Math.round(def.harvestMaterials * 0.15 * (p.level - 1))
      : 0;
    const parts = [];
    if (sun > 0) parts.push(`+${sun}☀️`);
    if (mats > 0) parts.push(`+${mats}🪵`);
    return `🧺 收获 ${parts.join(' ')}`;
  }

  showCityPanel(run) {
    const next = run.city.level < 3 ? D.ACTION_COST.cityUpgrade.sunByLevel[run.city.level + 1] : null;
    this._$('city-panel').innerHTML = `
      <div class="pp-head">🏠 <b>主城</b> <span class="lv">Lv.${run.city.level}</span></div>
      <div class="pp-row">生命 ${run.city.hp}/${run.city.maxHp} ｜ 护甲 ${run.city.armor}</div>
      <div class="pp-row dim">主城生命归零则当夜失败，可从当日白天重试。</div>
      <div class="pp-btns">
        ${next ? `<button class="panel-btn gold" id="cp-up" ${run.sun >= next ? '' : 'disabled'}>⬆ 升到 Lv.${run.city.level + 1}<small>${next}☀️ → 生命+50 护甲+1 完全修复</small></button>` : '<span class="dim">已达最高等级</span>'}
      </div>
      <button class="panel-close" id="cp-close">✕</button>`;
    this._$('city-panel').classList.remove('hidden');
    this._$('cp-close').onclick = () => this.hidePanels();
    const up = this._$('cp-up');
    if (up) up.onclick = () => this.cb.onCityUpgrade();
  }
  hidePanels() {
    this._$('plant-panel').classList.add('hidden');
    this._$('city-panel').classList.add('hidden');
  }
  setSelectedSeed(id) { this.selectedSeed = id; }

  // ---------- 引导 ----------
  showTutorial(show, steps) {
    this._$('tutorial-panel').classList.toggle('hidden', !show);
    if (show && steps) {
      this._$('tutorial-steps').innerHTML = steps.map(s =>
        `<div class="${s.done ? 'done' : ''}">${s.done ? '☑' : '☐'} ${s.text}</div>`).join('');
    }
  }

  // ---------- 威胁预告 ----------
  showForecast(run, onStart) {
    const fc = D.THREAT_FORECASTS[run.day];
    const script = D.DAY_SCRIPT[run.day] || {};
    const unlocks = [
      ...(script.unlockFeatures || []).map(f => ({
        expand: '🪓 解锁：<b>建造农田</b>', pick3: '🎲 解锁：<b>夜后三选一</b>',
        evolve: '🧬 解锁：<b>进化系统</b>', greenhouse: '🏡 解锁：<b>温室（岛屿强化）</b>',
      }[f])),
      ...(script.notes || []),
    ];
    const bonus = script.bonus ? `<div class="fc-bonus">🎁 ${script.bonus.label}</div>` : '';
    this.modal({
      title: `第 ${run.day} 天 · 威胁预告`,
      body: `
        <div class="fc-enemy">${fc.title}　<span class="tag-chip">${fc.level}</span>${fc.tags.map(t => `<span class="tag-chip warn">${t}</span>`).join('')}</div>
        <div class="fc-hint">💡 ${fc.hint}</div>
        ${unlocks.length ? `<div class="fc-unlocks">${unlocks.map(u => `<div>${u}</div>`).join('')}</div>` : ''}
        ${bonus}
        <div class="dim" style="margin-top:8px">剩余行动点 ${run.ap} ｜ 作好防守准备后结束白天</div>`,
      buttons: [{ label: '开始白天规划', cls: 'primary', onClick: () => { this.closeModal(); onStart(); } }],
    });
  }

  // ---------- 结束白天确认 ----------
  showEndDayConfirm(run, onConfirm) {
    const mature = run.plants.filter(p => p.growth >= D.CROPS[p.defId].maturityDays);
    const combat = mature.filter(p => D.CROPS[p.defId].attack > 0).length;
    const guards = mature.filter(p => D.CROPS[p.defId].id === 'wallnut').length;
    const support = mature.length - combat - guards;
    this.modal({
      title: `结束第 ${run.day} 天？`,
      body: `
        <div>夜晚参战阵容：<b>🛡 守护 ×${guards}　🏹 输出 ×${combat}　🌻 支援 ×${support}</b></div>
        <div class="dim">未成熟作物不参战；敌方将从海上登陆，自动战斗无法微操。</div>
        ${run.ap > 0 ? `<div class="fc-bonus">⚠ 还有 ${run.ap} 行动点未使用</div>` : ''}`,
      buttons: [
        { label: '再准备一下', onClick: () => this.closeModal() },
        { label: '☀️→🌙 进入夜晚', cls: 'primary', onClick: () => { this.closeModal(); onConfirm(); } },
      ],
    });
  }

  // ---------- 夜战横幅与 HUD ----------
  showNightBanner(day, fcName) {
    this.banner(`<div class="banner-title">🌙 第 ${day} 夜</div><div class="banner-sub">${fcName} 正在接近……</div>`, 2600);
  }
  updateNightHUD(b) {
    this._$('night-title').textContent = `第 ${b.day} 夜`;
    this._$('night-wave').textContent = `波次 ${Math.max(1, b.waveIdx + 1)}/${b.waves.length}`;
    this._$('night-enemies').textContent = `敌人 ${b.enemies.length + b.spawnQueue.length}`;
  }

  // ---------- 夜战结算 ----------
  showNightResult(run, rewards, onNext) {
    this.modal({
      title: `第 ${run.day} 夜 · 防守成功！`,
      body: `
        <div class="reward-list">
          <div>☀️ 阳光 <b>+${rewards.sun}</b>（含击杀赏金）</div>
          <div>🪵 木材 <b>+${rewards.materials}</b></div>
          <div>🏠 主城修复至 <b>${run.city.hp}/${run.city.maxHp}</b></div>
        </div>`,
      buttons: [{ label: run.day >= 10 ? '见证结局 ▶' : '继续 ▶', cls: 'primary', onClick: () => { this.closeModal(); onNext(); } }],
    });
  }

  showPickThree(run, choices, onPick) {
    const cards = choices.map((m, i) => `
      <button class="pick-card" data-idx="${i}">
        <div class="pc-icon">${m.icon}</div>
        <div class="pc-name">${m.name}</div>
        <div class="pc-desc">${m.desc}</div>
      </button>`).join('');
    const overlay = this.modal({
      title: '🎲 夜后强化 · 三选一',
      body: `<div class="dim">效果从明天开始生效，选择后进入下一天。</div><div class="pick-grid">${cards}</div>`,
      buttons: [],
      wide: true,
    });
    overlay.querySelectorAll('.pick-card').forEach(btn => {
      btn.onclick = () => { this.closeModal(); onPick(choices[Number(btn.dataset.idx)]); };
    });
  }

  // ---------- 开局构筑选择（V0.3） ----------
  showBuildSelect(builds, onPick, onCancel) {
    const cards = builds.map((b, i) => {
      const plants = b.plants.map(id => `${D.CROPS[id].icon}${D.CROPS[id].name}`).join(' ＋ ');
      return `
      <button class="pick-card build-card" data-idx="${i}">
        <div class="pc-icon">${b.icon}</div>
        <div class="pc-name">${b.name}</div>
        <div class="pc-tag">${b.tagline}</div>
        <div class="pc-desc">${b.desc}</div>
        <div class="pc-stat">起手　${plants}</div>
        <div class="pc-stat">资源　☀️${b.sun} · 🪵${b.materials} · 自带${b.plants.length}格农田</div>
        <div class="pc-cost">${b.perk.label}</div>
      </button>`;
    }).join('');
    const overlay = this.modal({
      title: '🌱 选择开局构筑',
      body: `<div class="dim">构筑决定起始作物、本局种子池、初始资源与专属特性。选定后本局内不可更换。</div>
        <div class="pick-grid">${cards}</div>`,
      buttons: onCancel ? [{ label: '返回标题', onClick: () => { this.closeModal(); onCancel(); } }] : [],
      wide: true,
    });
    overlay.querySelectorAll('.pick-card').forEach(btn => {
      btn.onclick = () => { this.closeModal(); onPick(builds[Number(btn.dataset.idx)]); };
    });
  }

  // ---------- 失败 / 胜利 ----------
  showDefeat(run, onRetry, onTitle) {
    this.modal({
      title: `💥 第 ${run.day} 夜 · 主城陷落`,
      body: `<div>防线被突破了。总结教训，从当日白天重新开始——作物与资源会回到早晨的状态。</div>`,
      buttons: [
        { label: '🔁 重试第 ' + run.day + ' 天', cls: 'primary', onClick: () => { this.closeModal(); onRetry(); } },
        { label: '回到标题', onClick: () => { this.closeModal(); onTitle(); } },
      ],
    });
  }

  showVictory(run, onRestart, onTitle) {
    this.modal({
      title: '🏝️ 幽灵船长被击败！小岛守住了！',
      body: `
        <div class="reward-list">
          <div>📅 坚守 <b>10</b> 天，胜利 <b>${run.stats.nightsWon}</b> 夜</div>
          <div>💀 累计击杀 <b>${run.stats.killed}</b> 个敌人</div>
          <div>🌱 累计种植 <b>${run.stats.planted}</b> 株，收获 <b>${run.stats.harvested}</b> 次</div>
          <div>🧬 完成进化 <b>${run.stats.evolvedCount}</b> 株</div>
          <div>🏠 主城剩余 <b>${run.city.hp}/${run.city.maxHp}</b></div>
        </div>
        <div class="fc-hint">十日 Demo 到此结束。欢迎尝试不同流派：射击 / 守护 / 生长。</div>`,
      buttons: [
        { label: '再来一局', cls: 'primary', onClick: () => { this.closeModal(); onRestart(); } },
        { label: '回到标题', onClick: () => { this.closeModal(); onTitle(); } },
      ],
    });
  }

  // ---------- 标题与帮助 ----------
  showTitle(hasSave, onNew, onContinue, onHelp) {
    this.modal({
      title: `<span class="title-big">🌻 植物守岛</span>`,
      body: `
        <div class="title-sub">白天种植培育 · 夜晚作物自动防守 · 十天守住小岛</div>
        <div class="dim">白天用 8 点行动点经营农田；夜晚敌人从海上登陆，你的作物自动迎战。
        胜利后获得阳光与三选一强化；成熟作物可消耗阳光进化（每类二选一方向），同标签作物激活流派羁绊。
        第 10 夜挑战 Boss 幽灵船长。滚轮缩放视角，右键拖动移动视角。</div>`,
      buttons: [
        ...(hasSave ? [{ label: '📖 继续旅程', cls: 'primary', onClick: () => { this.closeModal(); onContinue(); } }] : []),
        { label: hasSave ? '🌱 新的旅程' : '🌱 开始新的旅程', cls: hasSave ? '' : 'primary', onClick: () => { this.closeModal(); onNew(); } },
        { label: '❓ 玩法说明', onClick: () => { this.closeModal(); onHelp(() => this.showTitle(hasSave, onNew, onContinue, onHelp)); } },
      ],
    });
  }

  showHelp(back) {
    this.modal({
      title: '❓ 玩法说明',
      body: `
        <div class="help-grid">
          <div><b>☀️ 白天（8 行动点）</b><br>种植 1AP · 培育 1AP（+1成长）· 收获 1AP<br>升级 0AP+阳光（最高3级）· 建造农田 1AP+木材🪵<br>建造 = 点击任意一格荒草地，农田立刻放上去<br>收割作战作物可获得木材🪵<br>点地块/作物操作，点主城升级城防。</div>
          <div><b>🌙 夜晚（自动战斗）</b><br>成熟作物自动进入防守阵列：<br>坚果嘲讽承伤，豌豆/玉米远程输出。<br>清空敌人即胜；主城破则当日重试。</div>
          <div><b>🧬 进化与成长</b><br>成熟作物可花费阳光进化，每类二选一：<br>豌豆：巨弹溅射 / 连射；坚果：铁甲 / 尖刺反伤<br>向日葵：光耀产阳 / 翠光治疗；玉米：冰霜定身 / 爆裂。<br>同标签 2/3/4 株激活流派羁绊（顶部可查看）。</div>
          <div><b>🎥 视角与十天目标</b><br>滚轮缩放视角；按住右键拖动移动视角。<br>资源只有阳光☀️与木材🪵。<br>每天早上看威胁预告，第 10 夜击败 Boss。</div>
        </div>`,
      buttons: [{ label: '返回', cls: 'primary', onClick: () => { this.closeModal(); back?.(); } }],
    });
  }

  showEventLog(show, text) {
    const el = this._$('event-log');
    el.classList.toggle('hidden', !show);
    if (text) el.textContent = text;
  }
}
