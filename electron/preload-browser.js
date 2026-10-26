// Preload страницы в браузере: геймпад → курсор, клик, прокрутка. Страница этот код не видит (изолированный мир).
const { ipcRenderer, webFrame } = require('electron');

const DEAD = 0.18;
const CURSOR_SPEED = 1500; // пикселей в секунду при полном отклонении стика
const SCROLL_SPEED = 2200;
const STEP = 140; // шаг прокрутки крестовиной
const REPEAT = 120;

let mode = 'page'; // page — управляем страницей; ui — геймпад отдан панели в основном окне
let x = 400;
let y = 300;
let lastPadClick = 0;
let cursor = null;

// Курсор двигает телефон: берём положение из основного процесса
ipcRenderer.on('browser:cursor', (_e, p) => {
  x = p.x;
  y = p.y;
  drawCursor();
});
ipcRenderer.on('browser:remote-click', () => {
  lastPadClick = Date.now();
});

ipcRenderer.on('browser:mode', (_e, m) => {
  mode = m;
  if (cursor) cursor.style.display = m === 'page' ? 'block' : 'none';
});

// ---- курсор ----
function ensureCursor() {
  if (cursor && cursor.isConnected) return;
  cursor = document.createElement('div');
  cursor.setAttribute('style', 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));');
  cursor.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 17 L13 25 L17 23.4 L13.4 15.6 L21 15.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  cursor.style.display = mode === 'page' ? 'block' : 'none';
  (document.documentElement || document.body).appendChild(cursor);
}

const zoom = () => webFrame.getZoomFactor() || 1;
// Размер области страницы в «экранных» пикселях (то, что понимает sendInputEvent): CSS-пиксели × масштаб
const viewW = () => window.innerWidth * zoom();
const viewH = () => window.innerHeight * zoom();

function drawCursor() {
  ensureCursor();
  const z = zoom();
  cursor.style.transform = `translate(${x / z}px, ${y / z}px) scale(${1 / z})`;
  cursor.style.transformOrigin = '0 0';
}

// ---- поля ввода: после клика геймпадом просим основное окно показать клавиатуру ----
const editable = (el) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type)) ||
  el?.isContentEditable;

function reportField(el) {
  ipcRenderer.send('browser:field', el ? { type: el.type || 'text', value: String(el.value ?? el.textContent ?? '').slice(0, 300), multiline: el instanceof HTMLTextAreaElement } : null);
}
window.addEventListener(
  'focusin',
  (e) => {
    if (editable(e.target) && Date.now() - lastPadClick < 700) reportField(e.target);
  },
  true,
);
window.addEventListener(
  'input',
  (e) => {
    if (editable(e.target)) ipcRenderer.send('browser:field-value', String(e.target.value ?? e.target.textContent ?? '').slice(0, 300));
  },
  true,
);
window.addEventListener(
  'focusout',
  () => {
    // фокус может просто перейти на другое поле: проверим чуть позже
    setTimeout(() => {
      if (mode === 'page' && !editable(document.activeElement)) reportField(null);
    }, 150);
  },
  true,
);

// ---- опрос геймпада ----
const pressed = new Set(); // кнопки, которые уже обработаны (срабатывают один раз при нажатии)
const nextRepeat = new Map();
let lastT = performance.now();
let wheelAcc = { dx: 0, dy: 0 };
let aDown = false;
let lastMove = 0;

function once(name, isDown, fn) {
  if (isDown && !pressed.has(name)) {
    pressed.add(name);
    fn();
  } else if (!isDown) pressed.delete(name);
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  requestAnimationFrame(tick);
  if (mode !== 'page') return;

  const pad = [...navigator.getGamepads()].find(Boolean);
  if (!pad) return;
  const b = (i) => !!pad.buttons[i]?.pressed;
  const ax = (i) => {
    const v = pad.axes[i] || 0;
    return Math.abs(v) < DEAD ? 0 : (Math.abs(v) - DEAD) / (1 - DEAD) * Math.sign(v);
  };

  // Левый стик: курсор (чем сильнее наклон, тем быстрее)
  const lx = ax(0);
  const ly = ax(1);
  if (lx || ly) {
    x = Math.min(viewW() - 2, Math.max(0, x + lx * Math.abs(lx) * CURSOR_SPEED * dt));
    y = Math.min(viewH() - 2, Math.max(0, y + ly * Math.abs(ly) * CURSOR_SPEED * dt));
    if (now - lastMove > 30) {
      lastMove = now;
      ipcRenderer.send('browser:mouse', { type: 'move', x, y });
    }
  }
  drawCursor();

  // Правый стик: плавная прокрутка
  const rx = ax(2);
  const ry = ax(3);
  wheelAcc.dy += -ry * Math.abs(ry) * SCROLL_SPEED * dt;
  wheelAcc.dx += -rx * Math.abs(rx) * SCROLL_SPEED * dt;
  if (Math.abs(wheelAcc.dy) >= 8 || Math.abs(wheelAcc.dx) >= 8) {
    ipcRenderer.send('browser:mouse', { type: 'wheel', x, y, dx: wheelAcc.dx, dy: wheelAcc.dy });
    wheelAcc = { dx: 0, dy: 0 };
  }

  // Крестовина: прокрутка шагами (с повтором, пока зажата)
  for (const [btn, dx, dy] of [[12, 0, STEP], [13, 0, -STEP], [14, STEP, 0], [15, -STEP, 0]]) {
    if (b(btn)) {
      if (!(nextRepeat.get(btn) > now)) {
        ipcRenderer.send('browser:mouse', { type: 'wheel', x, y, dx, dy });
        nextRepeat.set(btn, now + (nextRepeat.has(btn) ? REPEAT : 380));
      }
    } else nextRepeat.delete(btn);
  }

  // Ⓐ — левая кнопка мыши (нажатие и отпускание отдельно: работает перетаскивание)
  if (b(0) && !aDown) {
    aDown = true;
    lastPadClick = Date.now();
    ipcRenderer.send('browser:mouse', { type: 'down', x, y });
  } else if (!b(0) && aDown) {
    aDown = false;
    lastPadClick = Date.now();
    ipcRenderer.send('browser:mouse', { type: 'up', x, y });
  }

  once('b', b(1), () => ipcRenderer.send('browser:cmd', 'back'));
  once('x', b(2), () => ipcRenderer.send('browser:cmd', 'toolbar'));
  once('y', b(3), () => ipcRenderer.send('browser:cmd', 'address'));
  once('lb', b(4), () => ipcRenderer.send('browser:cmd', 'back'));
  once('rb', b(5), () => ipcRenderer.send('browser:cmd', 'forward'));
  once('lt', b(6), () => ipcRenderer.send('browser:cmd', 'zoomOut'));
  once('rt', b(7), () => ipcRenderer.send('browser:cmd', 'zoomIn'));
  once('start', b(9) || b(16), () => ipcRenderer.send('browser:cmd', 'exit'));
  once('stickclick', b(10), () => ipcRenderer.send('browser:cmd', 'reload'));
}

window.addEventListener('DOMContentLoaded', () => {
  x = Math.max(20, viewW() / 2);
  y = Math.max(20, viewH() / 2);
  ensureCursor();
  drawCursor();
  ipcRenderer.send('browser:mouse', { type: 'move', x, y }); // основной процесс должен знать, где курсор
});
requestAnimationFrame(tick);
