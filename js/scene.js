// ============================================================
// 表现层：Three.js 场景与全部程序化生成的低多边形素材。
// 不保存核心规则；消费 run / battle 状态并播放反馈（文档第 9 节）。
// ============================================================
import * as THREE from '../lib/three.module.js';
import * as D from './data.js';

const C = {
  daySky: 0x8ec9ef, nightSky: 0x0d1330,
  dayFog: 0xa8d4ee, nightFog: 0x101838,
  sand: 0xe6d294, grass: 0x69b04b, grass2: 0x5c9c42, dirt: 0xc09a62,
  soil: 0x8a5a33, soilDark: 0x6e4526,
  water: 0x2a8fbd, waterNight: 0x143a66,
  trunk: 0x8a6642, leaf: 0x3f9142,
  stone: 0x9aa5ad, cityWall: 0xd8c9a8, cityRoof: 0xc75b4a,
};

const matCache = new Map();
function M(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true, ...opts });
  matCache.set(key, m);
  return m;
}
function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}

// ---------- 画布精灵（血条 / 图标） ----------
function makeCanvasSprite(draw, w = 64, h = 12, scale = [0.9, 0.17]) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(scale[0], scale[1], 1);
  spr.renderOrder = 10;
  spr.userData = { canvas, tex, draw, w, h };
  return spr;
}
function drawBar(spr, ratio, opts = {}) {
  const { canvas, tex, w, h } = spr.userData;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10,12,18,0.75)';
  ctx.fillRect(0, 0, w, h);
  const pad = 1.5, iw = (w - pad * 2) * Math.max(0, Math.min(1, ratio));
  const color = opts.color || (ratio > 0.5 ? '#6fd05f' : ratio > 0.25 ? '#e8c14a' : '#e0604d');
  ctx.fillStyle = color;
  ctx.fillRect(pad, pad, iw, h - pad * 2);
  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.strokeRect(pad - 0.5, pad - 0.5, w - pad * 2 + 1, h - pad * 2 + 1);
  tex.needsUpdate = true;
}
function makeIconSprite(char, scale = 0.5) {
  return makeCanvasSprite(null, 64, 64, [scale, scale]);
}
function drawIcon(spr, char, fontSize = 44) {
  const { canvas, tex, w, h } = spr.userData;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(char, w / 2, h / 2 + 2);
  tex.needsUpdate = true;
}

// ============================================================
export class World {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.daySky);
    this.scene.fog = new THREE.Fog(C.dayFog, 34, 90);

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 200);
    this.camTarget = new THREE.Vector3(0, 0.2, -0.6);
    this.baseCamOffset = new THREE.Vector3(0, 13.6, 17.4); // 相机相对视点的基础偏移
    this.camDist = 1.0; this.camDistTarget = 1.0;          // 缩放系数
    this.camera.position.copy(this.camTarget).add(this.baseCamOffset);
    this.camera.lookAt(this.camTarget);
    this.shakeAmt = 0;
    this._bindCameraControls();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.nightFactor = 0; this.nightTarget = 0;
    this.time = 0;

    // 视图注册表与根组（需先于构建函数初始化）
    this.plotMeshes = [];           // 12 个地块网格
    this.plantViews = new Map();    // plantId -> {group, defId, stage, evolved}
    this.unitViews = new Map();     // unitId -> {group, bar, defId, role}
    this.enemyViews = new Map();    // enemyId -> {group, bar, type, parts}
    this.projViews = new Set();     // {mesh, proj}
    this.particles = [];
    this.cropRoot = new THREE.Group();
    this.unitRoot = new THREE.Group();
    this.fxRoot = new THREE.Group();
    this.scene.add(this.cropRoot, this.unitRoot, this.fxRoot);
    this.hoverPlot = null;
    this.hoverCrop = null;

    this._buildLights();
    this._buildIsland();
    this._buildCity();
    this._buildPlots();
    this._buildWater();
    this._initParticlePool();

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ---------- 相机控制：滚轮缩放 + 右键/中键拖动平移（限制在岛屿范围） ----------
  _bindCameraControls() {
    const dom = this.renderer.domElement;
    dom.style.touchAction = 'none';
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = Math.sign(e.deltaY);
      this.camDistTarget = Math.max(0.45, Math.min(2.1, this.camDistTarget * (1 + dir * 0.12)));
    }, { passive: false });

    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        this._panning = true;
        this._panLast = { x: e.clientX, y: e.clientY };
        dom.style.cursor = 'grabbing';
        dom.setPointerCapture?.(e.pointerId);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._panning) return;
      const dx = e.clientX - this._panLast.x, dy = e.clientY - this._panLast.y;
      this._panLast = { x: e.clientX, y: e.clientY };
      this._panBy(dx, dy);
    });
    const endPan = (e) => {
      if (this._panning && (e.button === 2 || e.button === 1 || e.type === 'pointercancel')) {
        this._panning = false;
        dom.style.cursor = '';
      }
    };
    dom.addEventListener('pointerup', endPan);
    dom.addEventListener('pointercancel', endPan);
  }

  _panBy(dx, dy) {
    const q = this.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q); right.y = 0; right.normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
    const k = 0.0026 * this.camDist * this.baseCamOffset.length();
    this.camTarget.addScaledVector(right, -dx * k);
    this.camTarget.addScaledVector(fwd, dy * k);
    // 地图边界限制
    this.camTarget.x = Math.max(-15, Math.min(15, this.camTarget.x));
    this.camTarget.z = Math.max(-13, Math.min(10, this.camTarget.z));
  }

  // ---------- 灯光 ----------
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe5ff, 0x40603a, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
    this.sun.position.set(9, 16, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 2, far: 50 });
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.moon = new THREE.DirectionalLight(0x8fb2ff, 0.0);
    this.moon.position.set(-7, 14, -3);
    this.scene.add(this.moon);
    this.cityLamp = new THREE.PointLight(0xffc966, 0, 9, 2);
    this.cityLamp.position.set(D.CITY_POSITION.x, 2.4, D.CITY_POSITION.z);
    this.scene.add(this.cityLamp);
  }

  // ---------- 岛屿 ----------
  _buildIsland() {
    const island = new THREE.Group();
    // 沙底
    const sand = mesh(new THREE.CylinderGeometry(11.4, 12.6, 1.6, 36), M(C.sand), 0, -0.8, 0, false);
    sand.receiveShadow = true;
    island.add(sand);
    // 草地
    const grass = mesh(new THREE.CylinderGeometry(10.9, 11.15, 0.9, 36), M(C.grass), 0, 0.05, 0, false);
    grass.receiveShadow = true;
    island.add(grass);
    // 泥土小径：主城 → 海滩
    const path = mesh(new THREE.PlaneGeometry(2.6, 13), M(C.dirt), 0, 0.52, 1.5, false);
    path.rotation.x = -Math.PI / 2;
    island.add(path);
    const path2 = mesh(new THREE.PlaneGeometry(12, 1.8), M(C.dirt), 0, 0.52, -3.4, false);
    path2.rotation.x = -Math.PI / 2;
    island.add(path2);
    // 棕榈树与岩石点缀
    const rng = () => Math.random();
    const palmSpots = [[-9.2, 3.4], [9.4, 2.6], [-8.4, -6.8], [8.8, -7.6], [-3.4, 8.6], [4.2, 8.9], [-10.2, -1.4], [10.4, -2.2]];
    for (const [x, z] of palmSpots) {
      const t = new THREE.Group();
      const h = 1.6 + rng() * 0.9;
      t.add(mesh(new THREE.CylinderGeometry(0.12, 0.18, h, 6), M(C.trunk), 0, h / 2, 0));
      for (let i = 0; i < 5; i++) {
        const leaf = mesh(new THREE.ConeGeometry(0.16, 1.5, 4), M(C.leaf), 0, h + 0.1, 0);
        leaf.rotation.z = 0.9; leaf.rotation.y = (i / 5) * Math.PI * 2;
        leaf.translateY(0.5); leaf.translateX(0.45);
        t.add(leaf);
      }
      t.position.set(x, 0.5, z);
      t.rotation.y = rng() * 6;
      island.add(t);
    }
    const rockSpots = [[-6.2, 6.4], [7.2, 5.8], [-9.6, 5.2], [9.8, 6.6]];
    for (const [x, z] of rockSpots) {
      const r = mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.3), M(C.stone), x, 0.6, z);
      r.rotation.set(rng() * 3, rng() * 3, 0);
      island.add(r);
    }
    this.scene.add(island);
  }

  // ---------- 水面 ----------
  _buildWater() {
    const geo = new THREE.PlaneGeometry(220, 220, 64, 64);
    this.waterMat = new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.94 });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.42;
    this.water.receiveShadow = false;
    this.scene.add(this.water);
    this.waterBase = geo.attributes.position.array.slice();
    // 海岸泡沫圈
    const foam = new THREE.Mesh(new THREE.RingGeometry(12.2, 13.6, 48),
      new THREE.MeshBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.35 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.28;
    this.scene.add(foam);
    this.foam = foam;
  }

  // ---------- 主城 ----------
  _buildCity() {
    const g = new THREE.Group();
    const { x, z } = D.CITY_POSITION;
    const base = mesh(new THREE.BoxGeometry(3.0, 1.5, 2.6), M(C.cityWall), 0, 0.75, 0);
    g.add(base);
    const roof = mesh(new THREE.ConeGeometry(2.4, 1.4, 4), M(C.cityRoof), 0, 2.2, 0);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const door = mesh(new THREE.BoxGeometry(0.7, 0.95, 0.1), M(0x6e4526), 0, 0.48, 1.32);
    g.add(door);
    // 塔楼
    this.tower = mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.6, 8), M(C.cityWall), 1.75, 1.3, -0.4);
    g.add(this.tower);
    this.towerRoof = mesh(new THREE.ConeGeometry(0.75, 0.9, 8), M(C.cityRoof), 1.75, 3.05, -0.4);
    g.add(this.towerRoof);
    // 旗帜
    this.flagPole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 5), M(0x777777), 0, 3.3, 0);
    g.add(this.flagPole);
    this.flag = mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: 0xe8b23a, side: THREE.DoubleSide }), 0.45, 3.65, 0, false);
    g.add(this.flag);
    // 等级装饰：L2 副塔，L3 金顶
    this.deco2 = mesh(new THREE.CylinderGeometry(0.4, 0.5, 2.0, 8), M(C.cityWall), -1.7, 1.0, -0.3);
    this.deco2.visible = false;
    this.deco2roof = mesh(new THREE.ConeGeometry(0.62, 0.8, 8), M(C.cityRoof), -1.7, 2.4, -0.3);
    this.deco2roof.visible = false;
    this.deco3 = mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 18), M(0xf0c04a, { metalness: 0.6, roughness: 0.3 }), 0, 1.55, 0);
    this.deco3.rotation.x = Math.PI / 2;
    this.deco3.visible = false;
    g.add(this.deco2, this.deco2roof, this.deco3);

    // 主城受击闪光板
    this.cityFlash = new THREE.PointLight(0xff5533, 0, 7, 2);
    this.cityFlash.position.set(0, 2, 0);
    g.add(this.cityFlash);

    // 主城血条
    this.cityBar = makeCanvasSprite(null, 128, 14, [2.6, 0.28]);
    this.cityBar.position.set(0, 4.6, 0);
    g.add(this.cityBar);
    this.cityIcon = makeCanvasSprite(null, 64, 64, [0.55, 0.55]);
    this.cityIcon.position.set(-1.8, 4.6, 0);
    g.add(this.cityIcon);
    drawIcon(this.cityIcon, '🏠');

    g.position.set(x, 0.5, z);
    this.cityGroup = g;
    this.scene.add(g);
  }

  setCityLevel(level) {
    this.deco2.visible = this.deco2roof.visible = level >= 2;
    this.deco3.visible = level >= 3;
  }
  setCityBar(hp, maxHp) {
    drawBar(this.cityBar, hp / maxHp, { color: hp / maxHp > 0.35 ? '#7fd4ff' : '#e0604d' });
  }

  // ---------- 农田 ----------
  _buildPlots() {
    this.plotRoot = new THREE.Group();
    D.PLOT_POSITIONS.forEach((pos, i) => {
      const g = new THREE.Group();
      const soil = mesh(new THREE.BoxGeometry(1.8, 0.22, 1.8), M(C.soil), 0, 0.11, 0);
      g.add(soil);
      const inner = mesh(new THREE.BoxGeometry(1.55, 0.1, 1.55), M(C.soilDark), 0, 0.2, 0, false);
      g.add(inner);
      // 锁定幽灵
      const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 1.8),
        new THREE.MeshStandardMaterial({ color: C.soil, transparent: true, opacity: 0.14, roughness: 1 }));
      ghost.position.y = 0.11;
      g.add(ghost);
      const lock = makeCanvasSprite(null, 64, 64, [0.5, 0.5]);
      lock.position.y = 0.9;
      drawIcon(lock, '🔒', 40);
      g.add(lock);
      g.position.set(pos.x, 0.5, pos.z);
      g.userData = { plotIndex: i, soil, inner, ghost, lock, baseMat: soil.material };
      this.plotRoot.add(g);
      this.plotMeshes.push(g);
    });
    this.scene.add(this.plotRoot);
  }

  setPlotStates(run) {
    const unlocked = run._plotsUnlocked ?? D.INITIAL_PLOTS;
    this.plotMeshes.forEach((g, i) => {
      const locked = i >= unlocked;
      g.userData.ghost.visible = locked;
      g.userData.lock.visible = locked;
      g.userData.soil.visible = !locked;
      g.userData.inner.visible = !locked;
      g.userData.soil.material = locked ? g.userData.soil.material : M(C.soil);
    });
  }

  // ---------- 作物模型 ----------
  _buildCropModel(defId, stage, evolved) {
    const g = new THREE.Group();
    const addParts = (full) => {
      if (defId === 'sunflower') {
        g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.85, 6), M(0x4c9a3f), 0, 0.42, 0));
        const leafGeo = new THREE.SphereGeometry(0.16, 6, 4);
        const l1 = mesh(leafGeo, M(0x4c9a3f), 0.14, 0.18, 0); l1.scale.set(1.5, 0.4, 0.8);
        const l2 = mesh(leafGeo, M(0x4c9a3f), -0.14, 0.26, 0); l2.scale.set(1.5, 0.4, 0.8);
        g.add(l1, l2);
        if (full) {
          const head = new THREE.Group();
          head.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10), M(0x7a4a21), 0, 0, 0));
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const petal = mesh(new THREE.SphereGeometry(0.09, 5, 4), M(evolved ? 0xffe066 : 0xffd23f), Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0);
            petal.scale.set(1.6, 0.8, 0.5);
            head.add(petal);
          }
          head.position.set(0, 0.95, 0.02);
          head.rotation.x = -0.35;
          g.add(head);
          g.userData.head = head;
        }
      } else if (defId === 'peashooter') {
        g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6), M(0x3f8f3a), 0, 0.3, 0));
        const leaf = mesh(new THREE.SphereGeometry(0.14, 6, 4), M(0x3f8f3a), 0.13, 0.16, 0);
        leaf.scale.set(1.5, 0.4, 0.8);
        g.add(leaf);
        if (full) {
          const head = mesh(new THREE.SphereGeometry(0.3, 8, 6), M(evolved ? 0x6fd05f : 0x57b04b), 0, 0.78, 0);
          g.add(head);
          const snout = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.42, 8), M(0x3d8a3a), 0, 0.78, 0.3);
          snout.rotation.x = Math.PI / 2;
          g.add(snout);
          g.userData.head = head;
          g.userData.snout = snout;
        }
      } else if (defId === 'wallnut') {
        if (full) {
          const body = mesh(new THREE.SphereGeometry(0.5, 9, 8), M(evolved ? 0xa8b6c2 : 0xb5803c), 0, 0.52, 0);
          body.scale.set(1, 1.18, 0.92);
          g.add(body);
          g.userData.body = body;
          for (const sx of [-0.16, 0.16]) {
            const eye = mesh(new THREE.SphereGeometry(0.07, 6, 5), M(0x2b2b2b, { roughness: 0.4 }), sx, 0.62, 0.43);
            g.add(eye);
          }
          g.add(mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.16, 5), M(0x8a6642), 0, 1.12, 0));
          if (evolved) {
            const band = mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 16), M(0x9fb6c8, { metalness: 0.7, roughness: 0.3 }), 0, 0.52, 0);
            band.rotation.x = Math.PI / 2;
            g.add(band);
          }
        } else {
          const body = mesh(new THREE.SphereGeometry(0.3, 8, 6), M(0xb5803c), 0, 0.3, 0);
          g.add(body);
        }
      } else if (defId === 'cornpitcher') {
        g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.95, 6), M(0x4c9a3f), 0, 0.47, 0));
        if (full) {
          const cob = mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), M(0xf4d03f), 0.08, 0.95, 0.12);
          cob.rotation.z = -0.4;
          g.add(cob);
          g.userData.cob = cob;
          for (const s of [-1, 0, 1]) {
            const husk = mesh(new THREE.ConeGeometry(0.1, 0.42, 5), M(0x3f8f3a), 0.08 + s * 0.12, 0.72, 0.1);
            husk.rotation.z = -0.4 + s * 0.35;
            g.add(husk);
          }
        }
      }
      if (evolved && full) {
        const ring = mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 22),
          new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.85 }), 0, 0.35, 0);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        g.userData.ring = ring;
      }
    };
    if (stage === 'seed') {
      g.add(mesh(new THREE.SphereGeometry(0.22, 7, 5), M(C.soilDark), 0, 0.08, 0));
      g.add(mesh(new THREE.ConeGeometry(0.05, 0.22, 5), M(0x6fd05f), 0.05, 0.22, 0));
      g.add(mesh(new THREE.ConeGeometry(0.04, 0.16, 5), M(0x6fd05f), -0.06, 0.18, 0.03));
    } else if (stage === 'seedling') {
      addParts(false);
      g.add(mesh(new THREE.ConeGeometry(0.12, 0.35, 5), M(0x6fd05f), 0, 0.35, 0));
      g.scale.setScalar(0.85);
    } else {
      addParts(true);
    }
    g.traverse(o => { if (o.isMesh) o.userData.baseEmissive = o.material.emissive ? o.material.emissive.getHex() : null; });
    return g;
  }

  stageOf(p) {
    const def = D.CROPS[p.defId];
    if (p.growth <= 0) return 'seed';
    if (p.growth >= def.maturityDays) return 'mature';
    return 'seedling';
  }

  // 同步白天农田作物视图
  refreshRun(run) {
    this.setPlotStates(run);
    this.setCityLevel(run.city.level);
    this.setCityBar(run.city.hp, run.city.maxHp);
    const seen = new Set();
    for (const p of run.plants) {
      seen.add(p.id);
      const stage = this.stageOf(p);
      let v = this.plantViews.get(p.id);
      if (!v || v.stage !== stage || v.evolved !== p.evolved) {
        if (v) { this.cropRoot.remove(v.group); }
        const group = this._buildCropModel(p.defId, stage, p.evolved);
        const pos = D.PLOT_POSITIONS[p.plot];
        group.position.set(pos.x, 0.55, pos.z);
        group.userData.plantId = p.id;
        // 成熟指示（图标 + 形状双通道表达，文档第 8 节）
        if (stage === 'mature') {
          const ready = makeCanvasSprite(null, 64, 64, [0.42, 0.42]);
          ready.position.y = 1.75;
          drawIcon(ready, p.evolved ? '🌟' : '✅', 46);
          group.add(ready);
          group.userData.readyIcon = ready;
        }
        this.cropRoot.add(group);
        v = { group, stage, evolved: p.evolved, defId: p.defId, plot: p.plot };
        this.plantViews.set(p.id, v);
      } else if (v.plot !== p.plot) {
        const pos = D.PLOT_POSITIONS[p.plot];
        v.group.position.set(pos.x, 0.55, pos.z);
        v.plot = p.plot;
      }
    }
    for (const [id, v] of this.plantViews) {
      if (!seen.has(id)) { this.cropRoot.remove(v.group); this.plantViews.delete(id); }
    }
  }

  // ---------- 敌人模型 ----------
  _buildEnemyModel(type) {
    const g = new THREE.Group();
    const parts = {};
    if (type === 'crab') {
      const body = mesh(new THREE.SphereGeometry(0.34, 8, 6), M(0xe05243), 0, 0.3, 0);
      body.scale.set(1.2, 0.75, 0.95);
      g.add(body);
      for (const s of [-1, 1]) {
        const claw = mesh(new THREE.SphereGeometry(0.13, 6, 5), M(0xc7402f), s * 0.42, 0.3, 0.18);
        claw.scale.set(1, 0.8, 1.3);
        g.add(claw);
        for (let i = 0; i < 3; i++) {
          const leg = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4), M(0xc7402f), s * 0.3, 0.16, -0.15 + i * 0.15);
          leg.rotation.z = s * 1.0;
          g.add(leg);
        }
      }
      for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.05, 5, 4), M(0x2b2b2b), s * 0.1, 0.5, 0.22));
      parts.body = body;
    } else if (type === 'sailor') {
      const body = mesh(new THREE.CapsuleGeometry(0.24, 0.34, 4, 8), M(0x2c3e66), 0, 0.42, 0);
      g.add(body);
      const head = mesh(new THREE.SphereGeometry(0.2, 8, 6), M(0xf0c8a0), 0, 0.88, 0);
      g.add(head);
      const bandana = mesh(new THREE.SphereGeometry(0.21, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M(0xc7402f), 0, 0.9, 0);
      g.add(bandana);
      const sword = mesh(new THREE.BoxGeometry(0.06, 0.5, 0.12), M(0xcfd6dd), 0.3, 0.5, 0.12);
      sword.rotation.z = -0.5;
      g.add(sword);
      parts.body = body; parts.sword = sword;
    } else if (type === 'fish') {
      const body = mesh(new THREE.SphereGeometry(0.26, 7, 6), M(0x4fa3d9), 0, 0.3, 0);
      body.scale.set(0.8, 0.85, 1.35);
      g.add(body);
      const tail = mesh(new THREE.ConeGeometry(0.14, 0.3, 4), M(0x3b7fb0), 0, 0.32, -0.38);
      tail.rotation.x = -Math.PI / 2;
      g.add(tail);
      for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.045, 5, 4), M(0x14222e), s * 0.11, 0.38, 0.26));
      parts.body = body; parts.tail = tail;
    } else if (type === 'giant') {
      const body = mesh(new THREE.DodecahedronGeometry(0.62), M(0x7d8a93), 0, 0.62, 0);
      g.add(body);
      const head = mesh(new THREE.DodecahedronGeometry(0.34), M(0x8d99a2), 0, 1.42, 0.06);
      g.add(head);
      const moss = mesh(new THREE.SphereGeometry(0.36, 7, 5), M(0x4c8f43), 0, 1.55, 0);
      moss.scale.set(1.1, 0.5, 1.1);
      g.add(moss);
      for (const s of [-1, 1]) {
        const arm = mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), M(0x6e7a83), s * 0.72, 0.65, 0);
        arm.rotation.z = s * 0.25;
        g.add(arm);
        const eye = mesh(new THREE.SphereGeometry(0.055, 5, 4), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }), s * 0.13, 1.48, 0.32);
        g.add(eye);
      }
      parts.body = body; parts.head = head;
    } else if (type === 'boss') {
      const cloak = mesh(new THREE.ConeGeometry(0.52, 1.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x232a4d, roughness: 0.6, flatShading: true, transparent: true, opacity: 0.92 }), 0, 0.75, 0);
      g.add(cloak);
      const head = mesh(new THREE.SphereGeometry(0.26, 8, 6), new THREE.MeshStandardMaterial({ color: 0xcfd8ff, emissive: 0x4455aa, emissiveIntensity: 0.8, roughness: 0.4 }), 0, 1.62, 0.04);
      g.add(head);
      const hat = mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 8), M(0x1a1f38), 0, 1.9, 0);
      g.add(hat);
      const brim = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), M(0x1a1f38), 0, 1.75, 0);
      g.add(brim);
      const sword = mesh(new THREE.BoxGeometry(0.08, 0.9, 0.16), new THREE.MeshStandardMaterial({ color: 0xa7f0e8, emissive: 0x2a8f85, emissiveIntensity: 0.9 }), 0.42, 0.85, 0.1);
      sword.rotation.z = -0.4;
      g.add(sword);
      const lamp = new THREE.PointLight(0x88a2ff, 1.2, 4, 2);
      lamp.position.set(0, 1.4, 0);
      g.add(lamp);
      for (const s of [-1, 1]) {
        const eye = mesh(new THREE.SphereGeometry(0.05, 5, 4), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }), s * 0.1, 1.66, 0.26);
        g.add(eye);
      }
      parts.body = cloak; parts.sword = sword; parts.head = head;
    }
    return { group: g, parts };
  }

  // ---------- 粒子 ----------
  _initParticlePool() {
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false }));
      m.visible = false;
      this.fxRoot.add(m);
      this.particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: 1 });
    }
  }
  burst(x, y, z, color, n = 8, spread = 2.2, up = 2.4) {
    let spawned = 0;
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.life = p.maxLife = 0.5 + Math.random() * 0.25;
      p.mesh.visible = true;
      p.mesh.material.color.set(color);
      p.mesh.material.opacity = 1;
      p.mesh.position.set(x + (Math.random() - 0.5) * 0.3, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.3);
      p.vel.set((Math.random() - 0.5) * spread, up * (0.5 + Math.random() * 0.7), (Math.random() - 0.5) * spread);
      p.mesh.scale.setScalar(0.7 + Math.random() * 0.8);
      if (++spawned >= n) break;
    }
  }

  // 漂浮文字（DOM 投影）
  floatTexts = [];
  floatText(x, y, z, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'float-text ' + cls;
    el.textContent = text;
    document.querySelector('.float-layer')?.appendChild(el);
    this.floatTexts.push({ el, pos: new THREE.Vector3(x, y, z), life: 1.1 });
  }
  _project(pos) {
    const v = pos.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.container.clientHeight,
      behind: v.z > 1,
    };
  }

  // ---------- 昼夜过渡 ----------
  setNight(target) { this.nightTarget = target ? 1 : 0; }

  // ---------- 相机震动 ----------
  shake(a) { this.shakeAmt = Math.min(0.6, this.shakeAmt + a); }

  // ============================================================
  // 每帧更新
  // ============================================================
  update(dt) {
    this.time += dt;
    const t = this.time;

    // 昼夜过渡
    if (this.nightFactor !== this.nightTarget) {
      const dir = Math.sign(this.nightTarget - this.nightFactor);
      this.nightFactor = Math.max(0, Math.min(1, this.nightFactor + dir * dt * 0.7));
      this._applyDayNight();
    }

    // 水面波动
    const pos = this.water.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.waterBase[i * 3], by = this.waterBase[i * 3 + 1];
      pos.setZ(i, Math.sin(bx * 0.35 + t * 1.2) * 0.14 + Math.cos(by * 0.28 + t * 0.9) * 0.12);
    }
    pos.needsUpdate = true;
    this.foam.scale.setScalar(1 + Math.sin(t * 1.4) * 0.008);

    // 主城旗帜
    if (this.flag) this.flag.rotation.y = Math.sin(t * 3) * 0.2;

    // 作物待机摇摆
    for (const [, v] of this.plantViews) {
      const g = v.group;
      g.rotation.z = Math.sin(t * 1.6 + g.position.x) * 0.035;
      if (g.userData.head) g.userData.head.rotation.y = Math.sin(t * 0.8 + g.position.z) * 0.12;
      if (g.userData.ring) g.userData.ring.rotation.z = t * 1.2;
      if (g.userData.readyIcon) g.userData.readyIcon.position.y = 1.75 + Math.sin(t * 3 + g.position.x) * 0.08;
    }
    this.processPops(dt);

    // 粒子
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= 5.2 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7; }
      p.mesh.material.opacity = p.life / p.maxLife;
      p.mesh.lookAt(this.camera.position);
    }

    // 漂浮文字
    for (const f of this.floatTexts) {
      f.life -= dt;
      f.pos.y += dt * 1.1;
      const s = this._project(f.pos);
      if (f.life <= 0 || s.behind) { f.el.remove(); f.el.dataset.dead = '1'; continue; }
      f.el.style.left = s.x + 'px';
      f.el.style.top = s.y + 'px';
      f.el.style.opacity = Math.min(1, f.life / 0.4);
    }
    this.floatTexts = this.floatTexts.filter(f => !f.el.dataset.dead);

    // 相机：平滑缩放 + 平移 + 震动
    this.camDist += (this.camDistTarget - this.camDist) * Math.min(1, dt * 8);
    const look = this.camTarget;
    this.camera.position.copy(look).addScaledVector(this.baseCamOffset, this.camDist);
    if (this.shakeAmt > 0.001) {
      this.shakeAmt *= Math.pow(0.001, dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
    }
    this.camera.lookAt(look);

    this.renderer.render(this.scene, this.camera);
  }

  _applyDayNight() {
    const n = this.nightFactor;
    const sky = new THREE.Color(C.daySky).lerp(new THREE.Color(C.nightSky), n);
    this.scene.background = sky;
    this.scene.fog.color = new THREE.Color(C.dayFog).lerp(new THREE.Color(C.nightFog), n);
    this.hemi.intensity = 0.85 - 0.62 * n;
    this.sun.intensity = 1.7 - 1.45 * n;
    this.sun.color.setHex(n > 0.5 ? 0xbfd4ff : 0xfff1d6);
    this.moon.intensity = 0.55 * n;
    this.cityLamp.intensity = 2.2 * n;
    this.waterMat.color = new THREE.Color(C.water).lerp(new THREE.Color(C.waterNight), n);
  }

  // ============================================================
  // 夜战视图同步
  // ============================================================
  syncBattle(b, dt) {
    // 我方单位：作物从农田滑向防守槽位
    for (const u of b.units) {
      let v = this.unitViews.get(u.id);
      if (!v) {
        const pv = [...this.plantViews.values()].find(p => p.group.userData.plantId === u.plantId);
        const group = pv ? pv.group : this._buildCropModel(u.defId, 'mature', false);
        if (pv) this.cropRoot.remove(pv.group);
        // 血条（守护单位）
        let bar = null;
        if (u.role === 'guard') {
          bar = makeCanvasSprite(null, 64, 10, [1.0, 0.15]);
          bar.position.y = 1.6;
          group.add(bar);
        }
        this.unitRoot.add(group);
        v = { group, bar, unit: u, plantId: u.plantId, home: pv ? { x: pv.group.position.x, z: pv.group.position.z } : { x: u.x, z: u.z } };
        // 从农田位置出发
        group.position.set(v.home.x, 0.55, v.home.z);
        this.unitViews.set(u.id, v);
      }
      // 平滑移动到战斗位置
      v.group.position.x += (u.x - v.group.position.x) * Math.min(1, dt * 4);
      v.group.position.z += (u.z - v.group.position.z) * Math.min(1, dt * 4);
      v.group.position.y = 0.55 + Math.abs(Math.sin(this.time * 2 + u.id)) * 0.03;
      v.group.rotation.z = Math.sin(this.time * 2.2 + u.id) * 0.03;
      // 受击闪红
      if (u.hitFlash > 0.05) {
        v.group.traverse(o => { if (o.isMesh && o.material.emissive && !o.userData.flashed) { o.material = o.material.clone(); o.material.emissive.setHex(0xaa2200); o.userData.flashed = true; } });
      } else if (v._wasHit) {
        v.group.traverse(o => { if (o.isMesh && o.material.emissive && o.userData.flashed) { o.material.emissive.setHex(0x000000); o.userData.flashed = false; } });
      }
      v._wasHit = u.hitFlash > 0.05;
      if (v.bar) drawBar(v.bar, Math.max(0, u.hp / u.maxHp));
      // 死亡倒下
      const targetRot = u.dead ? Math.PI / 2 : 0;
      v.group.rotation.x += (targetRot - v.group.rotation.x) * Math.min(1, dt * 3);
      if (u.dead) v.group.position.y = Math.max(0.15, v.group.position.y - dt * 0.5);
    }

    // 敌人
    const alive = new Set();
    for (const e of b.enemies) {
      alive.add(e.id);
      let v = this.enemyViews.get(e.id);
      if (!v) {
        const { group, parts } = this._buildEnemyModel(e.type);
        const bar = makeCanvasSprite(null, 64, 10, [0.95, 0.15]);
        bar.position.y = e.type === 'boss' ? 2.6 : (e.type === 'giant' ? 2.1 : 1.0);
        group.add(bar);
        group.position.set(e.x, -0.2, e.z); // 从海里冒出
        this.unitRoot.add(group);
        v = { group, bar, type: e.type, parts, spawnY: -0.2 };
        this.enemyViews.set(e.id, v);
      }
      // 入场：从水下浮出
      v.group.position.y = Math.min(0.18, v.group.position.y + dt * 1.4);
      v.group.position.x = e.x;
      v.group.position.z = e.z;
      // 朝向移动方向
      const dx = (e._lastX !== undefined ? e.x - e._lastX : 0), dz = (e._lastZ !== undefined ? e.z - e._lastZ : 0);
      if (Math.hypot(dx, dz) > 0.001) v.group.rotation.y = Math.atan2(dx, dz);
      e._lastX = e.x; e._lastZ = e.z;
      // 动画
      const walkPhase = this.time * (e.type === 'fish' ? 9 : 6) + e.id;
      if (e.type === 'fish') {
        v.group.position.y = 0.18 + Math.abs(Math.sin(walkPhase)) * 0.22;
        v.group.rotation.z = Math.sin(walkPhase) * 0.15;
      } else if (e.type === 'boss') {
        v.group.position.y = 0.3 + Math.sin(this.time * 2) * 0.08;
        v.group.rotation.y = Math.sin(this.time * 1.2) * 0.15;
      } else {
        v.group.rotation.z = Math.sin(walkPhase) * 0.07;
        v.group.position.y = 0.18;
      }
      // 攻击前倾
      if (e.attackAnim > 0.5) v.group.rotation.x = -0.3 * (e.attackAnim - 0.5) * 2;
      else v.group.rotation.x = 0;
      // 受击
      if (e.hitFlash > 0.05 && !v._wasHit) {
        v.group.traverse(o => { if (o.isMesh && o.material.emissive) { if (!o.userData.origMat) o.userData.origMat = o.material; o.material = o.material.clone(); o.material.emissive.setHex(0xffffff); } });
        v._wasHit = true;
      } else if (e.hitFlash <= 0.05 && v._wasHit) {
        v.group.traverse(o => { if (o.isMesh && o.userData.origMat) o.material = o.userData.origMat; });
        v._wasHit = false;
      }
      drawBar(v.bar, Math.max(0, e.hp / e.maxHp));
    }
    for (const [id, v] of this.enemyViews) {
      if (!alive.has(id)) {
        this.unitRoot.remove(v.group);
        this.enemyViews.delete(id);
      }
    }

    // 投射物
    const projSeen = new Set();
    for (const pr of b.projectiles) {
      projSeen.add(pr);
      let v = [...this.projViews].find(pv => pv.proj === pr);
      if (!v) {
        const isCorn = pr.kind === 'corn';
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(isCorn ? 0.17 : 0.11, 6, 5),
          new THREE.MeshBasicMaterial({ color: isCorn ? 0xffd94d : 0x8be86a }));
        this.fxRoot.add(m);
        v = { mesh: m, proj: pr };
        this.projViews.add(v);
      }
      const total = Math.hypot(pr.lx - pr.x0, pr.lz - pr.z0) || 1;
      const progress = Math.min(1, Math.hypot(pr.x - pr.x0, pr.z - pr.z0) / total);
      v.mesh.position.set(pr.x, pr.kind === 'corn' ? 0.6 + Math.sin(progress * Math.PI) * 1.5 : 0.75, pr.z);
    }
    for (const v of [...this.projViews]) {
      if (!projSeen.has(v.proj)) {
        this.fxRoot.remove(v.mesh);
        this.projViews.delete(v);
      }
    }
  }

  clearBattleViews() {
    for (const [, v] of this.unitViews) {
      if (v.bar) v.group.remove(v.bar);
      // 来自农田的作物视图归位（作物夜间受损次日恢复）
      const pv = v.plantId ? this.plantViews.get(v.plantId) : null;
      if (pv) {
        const pos = D.PLOT_POSITIONS[pv.plot];
        v.group.position.set(pos.x, 0.55, pos.z);
        v.group.rotation.set(0, 0, 0);
        v.group.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0x000000); });
        this.unitRoot.remove(v.group);
        this.cropRoot.add(v.group);
      } else {
        this.unitRoot.remove(v.group);
      }
    }
    this.unitViews.clear();
    for (const [, v] of this.enemyViews) this.unitRoot.remove(v.group);
    this.enemyViews.clear();
    for (const v of this.projViews) this.fxRoot.remove(v.mesh);
    this.projViews.clear();
  }

  // ---------- 交互拾取 ----------
  _setPointer(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }
  pick(ev) {
    this._setPointer(ev);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [];
    for (const g of this.plotMeshes) targets.push(g);
    for (const [, v] of this.plantViews) targets.push(v.group);
    targets.push(this.cityGroup);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.plotIndex !== undefined) return { type: 'plot', index: o.userData.plotIndex };
        if (o.userData && o.userData.plantId !== undefined) return { type: 'crop', plantId: o.userData.plantId };
        if (o === this.cityGroup) return { type: 'city' };
        o = o.parent;
      }
    }
    return null;
  }
  setHoverPlot(index) {
    if (this.hoverPlot === index) return;
    if (this.hoverPlot != null) {
      const g = this.plotMeshes[this.hoverPlot];
      g.position.y = 0.5;
    }
    this.hoverPlot = index;
    if (index != null) this.plotMeshes[index].position.y = 0.62;
  }

  // 行动反馈动画
  popCrop(plantId) {
    const v = this.plantViews.get(plantId);
    if (!v) return;
    v.popT = 0.35;
  }
  // 每帧处理 pop（在 update 中调用前先检查）
  processPops(dt) {
    for (const [, v] of this.plantViews) {
      if (v.popT > 0) {
        v.popT -= dt;
        const k = Math.max(0, v.popT) / 0.35;
        v.group.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.18);
      }
    }
  }
}
