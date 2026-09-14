// ============================================================
// 应用层：状态机 DayStart → DayPlanning → NightPreview → NightBattle → NightResult
// （外加 DefeatRetry / Victory）。广播事件给 UI 与场景。
// ============================================================
import * as D from './data.js';
import * as dm from './domain.js';
import { createBattle, stepBattle, drainFx } from './battle.js';
import { sfx, initAudio, setMuted } from './sfx.js';

export class Game {
  constructor(world, ui) {
    this.world = world;
    this.ui = ui;
    this.run = null;
    this.battle = null;
    this.mode = 'title';           // title | day | night | done
    this.daySnapshot = null;
    this.battleSpeed = 1;
    this.nightBannerPending = false;

    // 画布交互
    const canvas = world.renderer.domElement;
    canvas.addEventListener('pointermove', (ev) => {
      if (this.mode !== 'day') { world.setHoverPlot(null); return; }
      const hit = world.pick(ev);
      world.setHoverPlot(hit?.type === 'plot' ? hit.index : null);
    });
    canvas.addEventListener('click', (ev) => {
      initAudio();
      if (this.mode !== 'day') return;
      this._handleClick(ev);
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (this.mode === 'day') { this.ui.setSelectedSeed(null); this.ui.hidePanels(); this.ui.updateDayBar(this.run); }
      } else if (ev.key === 'F1') {
        ev.preventDefault();
        this.logVisible = !this.logVisible;
        this.ui.showEventLog(this.logVisible, JSON.stringify(this.run?.log?.slice(-40) ?? [], null, 1));
      }
    });

    // UI 回调
    this.ui.cb = {
      onSelectSeed: (id) => this._selectSeed(id),
      onEndDay: () => this._endDay(),
      onExpand: () => this._globalAction(() => dm.doExpand(this.run), '🌱 农田扩张完成'),
      onGreenhouse: () => this._globalAction(() => dm.doGreenhouse(this.run), '🏡 温室建成：所有作物每日自然成长 +1'),
      onCityUpgrade: () => this._globalAction(() => dm.doCityUpgrade(this.run), '🏠 主城升级成功'),
      onPlantAction: (act, plantId) => this._plantAction(act, plantId),
      onOpenForecast: () => this.ui.showForecast(this.run, () => {}),
      onOpenHelp: () => this.ui.showHelp(() => {}),
      onMuteToggle: (btn) => {
        const muting = btn.textContent === '🔊';
        setMuted(muting);
        btn.textContent = muting ? '🔇' : '🔊';
      },
      onSpeed: (v) => { this.battleSpeed = v; if (this.battle) this.battle.speed = v; },
    };
  }

  // ---------- 开局 ----------
  showTitle() {
    this.mode = 'title';
    this.ui.showGameHUD(false);
    this.ui.showNightHUD(false);
    this.ui.showTitle(!!dm.loadRun(), () => this.newGame(), () => this.continueGame(), (back) => this.ui.showHelp(back));
  }

  newGame() {
    dm.clearSave();
    this.run = dm.createRunState();
    this._enterDay(this.run.day, true);
  }

  continueGame() {
    const st = dm.loadRun();
    if (!st) { this.newGame(); return; }
    this.run = st;
    this.daySnapshot = dm.snapshot(st);
    this._enterDay(this.run.day, false);
  }

  // ---------- 白天 ----------
  _enterDay(day, fresh) {
    this.mode = 'day';
    this.battle = null;
    this.battleSpeed = 1;
    this.world.clearBattleViews();
    this.world.setNight(false);
    let morning = null;
    if (fresh) {
      morning = dm.applyDayStart(this.run, day);
      this.daySnapshot = dm.snapshot(this.run);
      dm.saveRun(this.run);
    }
    this.world.refreshRun(this.run);
    this.ui.showGameHUD(true);
    this.ui.showNightHUD(false);
    this.ui.hidePanels();
    this.ui.updateHUD(this.run);
    if (morning) {
      sfx.morning();
      if (morning.sunGain > 0) this.world.floatText(D.CITY_POSITION.x, 3, D.CITY_POSITION.z, `☀️ +${morning.sunGain}`, 'sun');
      if (this.run.dayScript?.bonus) this.ui.toast(`🎁 ${this.run.dayScript.bonus.label}`, 'good');
    }
    // 威胁预告每天白天首次打开（文档第 8 节）
    this.ui.showForecast(this.run, () => {});
    // 第一天引导
    this.ui.showTutorial(this.run.day === 1, [
      { text: '在下方选择种子，点击空地种植', done: this.run.tutorial.plant },
      { text: '点击幼苗进行培育（加速成熟）', done: this.run.tutorial.cultivate },
      { text: '点击「结束白天」，看作物自动迎战', done: this.run.tutorial.endDay },
    ]);
  }

  _retryDay() {
    dm.restore(this.run, this.daySnapshot);
    this._enterDay(this.run.day, false);
    this.ui.toast(`🔁 回到第 ${this.run.day} 天白天`, 'info');
  }

  _spend(result, successMsg, worldPos) {
    if (result.ok) {
      sfx.click();
      if (successMsg) this.ui.toast(successMsg, 'good');
      this.world.refreshRun(this.run);
      this.ui.updateHUD(this.run);
      this._updateTutorial();
    } else {
      sfx.error();
      this.ui.toast('❌ ' + result.reason, 'bad');
    }
    return result.ok;
  }

  _updateTutorial() {
    if (this.run.day === 1) {
      this.ui.showTutorial(true, [
        { text: '在下方选择种子，点击空地种植', done: this.run.tutorial.plant },
        { text: '点击幼苗进行培育（加速成熟）', done: this.run.tutorial.cultivate },
        { text: '点击「结束白天」，看作物自动迎战', done: this.run.tutorial.endDay },
      ]);
    } else {
      this.ui.showTutorial(false);
    }
  }

  _selectSeed(id) {
    this.ui.setSelectedSeed(this.ui.selectedSeed === id ? null : id);
    this.ui.updateDayBar(this.run);
    sfx.click();
  }

  _globalAction(fn, okMsg) {
    const r = fn();
    if (r.ok) this._spend({ ok: true }, okMsg);
    else this._spend(r);
    if (r.ok) this.ui.hidePanels();
  }

  _handleClick(ev) {
    const hit = this.world.pick(ev);
    if (!hit) { this.ui.hidePanels(); return; }
    if (hit.type === 'city') { sfx.click(); this.ui.showCityPanel(this.run); return; }
    if (hit.type === 'plot') {
      const idx = hit.index;
      const unlocked = idx < dm.plotsUnlocked(this.run);
      if (!unlocked) { sfx.error(); this.ui.toast('🔒 地块未解锁：消耗材料扩张后可用', 'bad'); return; }
      const plant = dm.plotOf(this.run, idx);
      if (!plant) {
        const seed = this.ui.selectedSeed;
        if (!seed) { sfx.error(); this.ui.toast('先在下方选择一颗种子，再点击空地种植', 'bad'); return; }
        const r = dm.doPlant(this.run, idx, seed);
        if (r.ok) {
          const def = D.CROPS[seed];
          this.world.floatText(D.PLOT_POSITIONS[idx].x, 1.6, D.PLOT_POSITIONS[idx].z, `-${def.cost}☀️`, 'sun');
          this.ui.setSelectedSeed(null);
        }
        this._spend(r, r.ok ? `🌱 ${D.CROPS[seed].name} 种下了（自然成熟需 ${D.CROPS[seed].maturityDays} 天，培育可加速）` : '');
      } else {
        this._selectPlant(plant);
      }
      return;
    }
    if (hit.type === 'crop') {
      const plant = this.run.plants.find(p => p.id === hit.plantId);
      if (plant) this._selectPlant(plant);
    }
  }

  _selectPlant(plant) {
    sfx.click();
    const actions = {
      cultivate: dm.canCultivate(this.run, plant.id),
      harvest: dm.canHarvest(this.run, plant.id),
      upgrade: dm.canUpgrade(this.run, plant.id),
      evolve: { ok: !plant.evolved && dm.isMature(plant), reason: '' },
    };
    if (plant.evolved) actions.evolve.reason = '已进化';
    else if (!dm.isMature(plant)) actions.evolve.reason = '需先成熟';
    else {
      const minCost = Math.min(...(D.EVOLUTIONS[plant.defId] || [{ cost: Infinity }]).map(b => b.cost));
      if (this.run.sun < minCost) actions.evolve.reason = `阳光不足（需 ${minCost}）`;
    }
    if (plant.level < 3) actions.upgrade.costLabel = `${dm.upgradeCost(plant)}`;
    else actions.upgrade.costLabel = '';
    this.world.popCrop(plant.id);
    this.ui.showPlantPanel(this.run, plant, actions);
  }

  _plantAction(act, plantId) {
    let r, msg, pos = null;
    const p = this.run.plants.find(x => x.id === plantId);
    if (!p) return;
    pos = D.PLOT_POSITIONS[p.plot];
    if (act === 'cultivate') {
      r = dm.doCultivate(this.run, plantId);
      msg = r.ok ? `💧 成长 +${r.gain}${r.matured ? '，已成熟！' : ''}` : '';
      if (r.ok) {
        sfx.cultivate();
        this.world.floatText(pos.x, 1.8, pos.z, `+${r.gain}🌱`, 'good');
        this.world.popCrop(plantId);
      }
    } else if (act === 'harvest') {
      const y = dm.harvestYield(this.run, p);
      r = dm.doHarvest(this.run, plantId);
      msg = r.ok ? (y.sun ? `🧺 收获 +${y.sun}☀️` : '🧺 已收获，地块空出') : '';
      if (r.ok) {
        sfx.harvest();
        if (y.sun) this.world.floatText(pos.x, 1.8, pos.z, `+${y.sun}☀️`, 'sun');
      }
    } else if (act === 'upgrade') {
      r = dm.doUpgrade(this.run, plantId);
      msg = r.ok ? `⬆ 升到 ${r.level} 级！` : '';
      if (r.ok) { sfx.upgrade(); this.world.floatText(pos.x, 1.8, pos.z, 'Lv.' + r.level, 'good'); this.world.popCrop(plantId); }
    } else if (act === 'evolve') {
      // 打开方向选择弹窗（V0.2：二选一，消耗阳光）
      if (!p.evolved && dm.isMature(p)) {
        sfx.click();
        this.ui.showEvolutionChoice(this.run, p, (branch) => {
          r = dm.doEvolve(this.run, plantId, branch.id);
          if (r.ok) {
            sfx.evolve();
            this.world.floatText(pos.x, 2.0, pos.z, `✨ ${branch.name}`, 'evolve');
            this._spend(r, `🧬 进化为 ${r.name}！`);
            const np = this.run.plants.find(x => x.id === plantId);
            if (np) this._selectPlant(np);
          } else {
            this._spend(r);
          }
        });
      } else {
        r = { ok: false, reason: p.evolved ? '已进化' : '需先成熟' };
        this._spend(r);
      }
      return;
    }
    this._spend(r, msg);
    if (r.ok) {
      const np = this.run.plants.find(x => x.id === plantId);
      if (np && act !== 'harvest') this._selectPlant(np);
      else this.ui.hidePanels();
    }
  }

  _endDay() {
    this.ui.showEndDayConfirm(this.run, () => {
      const r = dm.endDay(this.run);
      if (!r.ok) { this.ui.toast(r.reason, 'bad'); return; }
      this._startNight();
    });
  }

  // ---------- 夜晚 ----------
  _startNight() {
    this.mode = 'night';
    this.ui.hidePanels();
    this.ui.showTutorial(false);
    this.ui.setSelectedSeed(null);
    this.world.setNight(true);
    this.battle = createBattle(this.run);
    this.battle.speed = this.battleSpeed = 1;
    this.nightBannerPending = true;
    sfx.night();
    const fc = D.THREAT_FORECASTS[this.run.day];
    this.ui.showNightBanner(this.run.day, fc ? fc.title : '敌人');
    this.ui.updateHUD(this.run);
    this.ui.showNightHUD(true);
    dm.logEvent(this.run, 'nightStart', { day: this.run.day });
  }

  _handleFx(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot':
          ev.kind === 'corn' ? sfx.corn() : sfx.shoot();
          break;
        case 'hit':
          this.world.burst(ev.x, 0.9, ev.z, ev.color || '#aef08a', 4, 1.6, 1.6);
          sfx.hit();
          break;
        case 'aoe':
          this.world.burst(ev.x, 0.6, ev.z, '#ffe28a', 12, 3.4, 2.6);
          break;
        case 'pierce':
          this.world.burst(ev.x, 0.9, ev.z, '#bdf0ff', 5, 1.6, 1.8);
          break;
        case 'slow':
          this.world.burst(ev.x, 0.7, ev.z, '#9fd8ff', 3, 1.0, 1.2);
          break;
        case 'death':
          this.world.burst(ev.x, 0.7, ev.z, ev.etype === 'boss' ? '#bda8ff' : '#ff8a70', ev.etype === 'boss' ? 26 : 9, 3, 2.6);
          sfx.die();
          if (ev.bountySun > 0) this.world.floatText(ev.x, 1.2, ev.z, `+${ev.bountySun}☀️`, 'sun');
          break;
        case 'heal':
          this.world.burst(ev.x, 0.9, ev.z, '#8ef0a0', 3, 0.8, 1.2);
          break;
        case 'stun':
          this.world.burst(ev.x, 1.0, ev.z, '#bfe9ff', 5, 1.0, 1.6);
          break;
        case 'splash':
          this.world.burst(ev.x, 0.7, ev.z, '#c9f08a', 6, 2.0, 1.8);
          break;
        case 'guardHit':
          this.world.burst(ev.x, 0.9, ev.z, ev.shield ? '#9fd8ff' : '#e8c14a', 3, 1.2, 1.4);
          break;
        case 'guardDown':
          this.world.burst(ev.x, 0.8, ev.z, '#caa06a', 12, 2.4, 2.4);
          this.ui.toast('🛡 守护作物倒下了！', 'bad');
          break;
        case 'cityHit':
          this.world.shake(0.12 + Math.min(0.25, ev.dmg * 0.006));
          this.world.burst(D.CITY_POSITION.x, 1.6, D.CITY_POSITION.z + 1.2, '#ff6a55', 6, 2.0, 2.2);
          this.world.setCityBar(this.battle.city.hp, this.battle.city.maxHp);
          this.world.floatText(D.CITY_POSITION.x, 3.4, D.CITY_POSITION.z, `-${ev.dmg}`, 'dmg');
          sfx.cityHit();
          break;
        case 'land':
          this.world.burst(ev.x, 0.2, D.BEACH_Z, '#cfeeff', 5, 2.0, 1.8);
          break;
        case 'summon':
          this.ui.banner(`<div class="banner-sub">👻 ${ev.label}</div>`, 1600);
          this.world.burst(ev.x, 1.2, ev.z, '#88a2ff', 16, 3.0, 3.0);
          sfx.wave();
          break;
        case 'wave':
          if (ev.idx > 0) { this.ui.toast(`⚔ 第 ${ev.idx + 1} 波来袭！`, 'warn'); sfx.wave(); }
          break;
        case 'end':
          this._onBattleEnd(ev.win);
          break;
      }
    }
  }

  _onBattleEnd(win) {
    const b = this.battle;
    if (win) {
      this.run.stats.killed += b.summary.kills;
      const rewards = dm.applyNightVictory(this.run, b.summary);
      this.world.setCityBar(this.run.city.hp, this.run.city.maxHp);
      this.world.refreshRun(this.run);
      this.ui.updateHUD(this.run);
      this.ui.updateNightHUD(b);
      sfx.win();
      setTimeout(() => {
        this.ui.showNightResult(this.run, rewards, () => this._afterResult());
      }, 900);
    } else {
      sfx.lose();
      this.world.shake(0.5);
      setTimeout(() => {
        this.ui.showDefeat(this.run, () => this._retryDay(), () => this.showTitle());
      }, 1000);
    }
  }

  _afterResult() {
    // 夜后三选一（第 4 天解锁）
    if (this.run.features.pick3 && this.run.day >= 4) {
      const rng = dm.mulberry32(this.run.seed + this.run.day * 7919);
      const choices = dm.pickThreeMods(this.run, rng);
      if (choices.length) {
        this.ui.showPickThree(this.run, choices, (mod) => {
          dm.applyNightMod(this.run, mod.id);
          this.ui.toast(`🎲 已选择：${mod.name}`, 'good');
          this._nextDayOrVictory();
        });
        return;
      }
    }
    this._nextDayOrVictory();
  }

  _nextDayOrVictory() {
    if (this.run.day >= 10) {
      dm.clearSave();
      this.mode = 'done';
      sfx.win();
      setTimeout(() => {
        this.ui.showVictory(this.run, () => this.newGame(), () => this.showTitle());
      }, 600);
    } else {
      this._enterDay(this.run.day + 1, true);
    }
  }

  // ---------- 每帧 ----------
  tick(dt) {
    if (this.mode === 'night' && this.battle) {
      if (this.nightBannerPending) {
        // 战斗准备期：等横幅结束后开打（battle 内部有 PREP_TIME）
        this.nightBannerPending = false;
      }
      if (!this.battle.over && this.battleSpeed > 0) {
        const total = dt * this.battleSpeed;
        const steps = Math.min(6, Math.ceil(this.battleSpeed));
        for (let i = 0; i < steps && !this.battle.over; i++) {
          stepBattle(this.battle, total / steps);
          this._handleFx(drainFx(this.battle));
        }
      }
      this.world.syncBattle(this.battle, dt);
      this.ui.updateNightHUD(this.battle);
    }
    this.world.update(dt);
  }
}
