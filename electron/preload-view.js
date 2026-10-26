// Preload для встроенных страниц (YouTube/TV): превращает геймпад в клавиши.
const { ipcRenderer } = require('electron');

const KEYS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', a: 'Return', b: 'Escape' };
const BTN = { 0: 'a', 1: 'b', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const HOME_BUTTONS = [8, 9, 16]; // Select/View, Start/Menu, Guide
const DEAD = 0.6;
const FIRST_DELAY = 400;
const REPEAT = 130;

const held = new Map(); // action -> время следующего срабатывания

function press(action) {
  ipcRenderer.send('view:key', KEYS[action]);
}

function tick(now) {
  const active = new Set();
  let home = false;
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue;
    for (const [i, action] of Object.entries(BTN)) if (pad.buttons[i]?.pressed) active.add(action);
    const [x = 0, y = 0] = pad.axes;
    if (x < -DEAD) active.add('left');
    if (x > DEAD) active.add('right');
    if (y < -DEAD) active.add('up');
    if (y > DEAD) active.add('down');
    if (HOME_BUTTONS.some((i) => pad.buttons[i]?.pressed)) home = true;
  }

  for (const action of active) {
    const next = held.get(action);
    if (next === undefined) {
      press(action);
      held.set(action, now + FIRST_DELAY);
    } else if (now >= next && action !== 'a' && action !== 'b') {
      press(action);
      held.set(action, now + REPEAT);
    }
  }
  for (const action of [...held.keys()]) if (!active.has(action)) held.delete(action);

  if (home) {
    if (!held.has('home')) ipcRenderer.send('tv:home');
    held.set('home', Infinity);
  } else held.delete('home');

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
