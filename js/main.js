// 入口：装配世界、UI 与控制器，驱动主循环。
import { World } from './scene.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const app = document.getElementById('app');
const world = new World(app);
const ui = new UI(app, {});
const game = new Game(world, ui);

// 调试句柄（控制台可用）
window.__world = world;
window.__game = game;

game.showTitle();

// 调试：?autostart=<buildId> 直接进白天（便于无头截图/回归验证，正常游玩不会触发）
// 附加 &clean=1 则不弹威胁预告，用于纯净的取景截图
const _q = new URLSearchParams(location.search);
const _auto = _q.get('autostart');
if (_auto) {
  import('./domain.js').then((dm) => {
    game.run = dm.createRunState(_auto === '1' ? undefined : Number(_auto) || undefined, 'balanced');
    game._enterDay(game.run.day, true);
    if (_q.get('clean')) setTimeout(() => ui.closeModal?.(), 60);
  });
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.tick(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
