// 轻量合成音效（Web Audio，无外部文件）。首次用户交互后激活。
let ctx = null;
let muted = false;

export function initAudio() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

function tone(freq, dur, type = 'sine', vol = 0.15, slide = 0, delay = 0) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.2, delay = 0) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const len = ctx.sampleRate * dur;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  src.connect(g).connect(ctx.destination);
  src.start(t0);
}

export const sfx = {
  click:    () => tone(660, 0.06, 'triangle', 0.1),
  plant:    () => { tone(330, 0.1, 'sine', 0.15); tone(440, 0.12, 'sine', 0.12, 0, 0.08); },
  cultivate:() => tone(520, 0.12, 'sine', 0.12, 200),
  harvest:  () => { tone(523, 0.1, 'triangle', 0.14); tone(659, 0.1, 'triangle', 0.14, 0, 0.09); tone(784, 0.14, 'triangle', 0.14, 0, 0.18); },
  upgrade:  () => { tone(392, 0.1, 'square', 0.08); tone(523, 0.14, 'square', 0.08, 0, 0.1); },
  evolve:   () => { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, 0, i * 0.09)); },
  error:    () => tone(180, 0.16, 'sawtooth', 0.08, -60),
  shoot:    () => tone(880, 0.05, 'square', 0.04, -300),
  corn:     () => tone(300, 0.1, 'square', 0.05, 120),
  hit:      () => noise(0.06, 0.08),
  die:      () => tone(220, 0.18, 'sawtooth', 0.08, -120),
  cityHit:  () => { noise(0.2, 0.25); tone(90, 0.25, 'sine', 0.25, -30); },
  night:    () => { tone(220, 0.5, 'sine', 0.1, -80); tone(110, 0.7, 'sine', 0.12, -30, 0.1); },
  morning:  () => { tone(523, 0.15, 'sine', 0.1); tone(659, 0.15, 'sine', 0.1, 0, 0.14); tone(784, 0.25, 'sine', 0.1, 0, 0.28); },
  win:      () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, 0, i * 0.13)); },
  lose:     () => { [330, 262, 196, 131].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.1, 0, i * 0.2)); },
  wave:     () => { tone(196, 0.3, 'sawtooth', 0.1, 40); noise(0.4, 0.1); },
};
