// Опрос геймпада (Standard Gamepad mapping: Xbox, DualSense и т.п. по Bluetooth).
const BTN = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const REPEATING = new Set(['up', 'down', 'left', 'right']);
const DEAD = 0.6;
const FIRST_DELAY = 400;
const REPEAT = 130;

export function startGamepad(onAction) {
  const held = new Map(); // action -> время следующего повтора
  let raf;

  function tick(now) {
    const active = new Set();
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      for (const [i, action] of Object.entries(BTN)) if (pad.buttons[i]?.pressed) active.add(action);
      const [x = 0, y = 0] = pad.axes;
      if (x < -DEAD) active.add('left');
      if (x > DEAD) active.add('right');
      if (y < -DEAD) active.add('up');
      if (y > DEAD) active.add('down');
    }

    for (const action of active) {
      const next = held.get(action);
      if (next === undefined) {
        onAction(action);
        held.set(action, now + FIRST_DELAY);
      } else if (now >= next && REPEATING.has(action)) {
        onAction(action);
        held.set(action, now + REPEAT);
      }
    }
    for (const action of [...held.keys()]) if (!active.has(action)) held.delete(action);

    raf = requestAnimationFrame(tick);
  }

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
