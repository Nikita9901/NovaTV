// Звуки интерфейса. Синтезируются на лету через Web Audio — никаких файлов.
// Тихие и короткие, чтобы не раздражать; включаются/выключаются клавишей F8 (настройка запоминается).

let ctx = null;
let master = null;
let enabled = localStorage.getItem('sfx') !== '0';
let volume = Number(localStorage.getItem('sfxVol')) || 0.9;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Один тон с быстрой огибающей (атака ~5 мс, плавное затухание), чтобы не было щелчков
function tone(freq, { dur = 0.08, type = 'sine', gain = 0.06, delay = 0, slide = 0 } = {}) {
  if (!enabled) return;
  const c = audio();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** фокус сдвинулся */
  move: () => tone(560, { dur: 0.05, type: 'triangle', gain: 0.035 }),
  /** упёрлись в край */
  bump: () => tone(150, { dur: 0.07, type: 'sine', gain: 0.05, slide: -40 }),
  /** выбор / подтверждение */
  select: () => {
    tone(660, { dur: 0.08, type: 'sine', gain: 0.06 });
    tone(990, { dur: 0.12, type: 'sine', gain: 0.05, delay: 0.06 });
  },
  /** клавиша экранной клавиатуры */
  key: () => tone(1250, { dur: 0.035, type: 'triangle', gain: 0.04 }),
  /** назад */
  back: () => tone(540, { dur: 0.1, type: 'sine', gain: 0.05, slide: -200 }),
  /** переключатель */
  toggle: () => {
    tone(480, { dur: 0.06, type: 'triangle', gain: 0.04 });
    tone(720, { dur: 0.06, type: 'triangle', gain: 0.04, delay: 0.05 });
  },
};

export const soundsEnabled = () => enabled;
export const getVolume = () => volume;

export function setVolume(v) {
  volume = v;
  localStorage.setItem('sfxVol', String(v));
  if (master) master.gain.value = v;
  sfx.select(); // пример нового уровня
}

export function setSounds(on) {
  enabled = on;
  localStorage.setItem('sfx', on ? '1' : '0');
  if (on) sfx.toggle(); // подтверждающий звук при включении
}
