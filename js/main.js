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

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.tick(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
