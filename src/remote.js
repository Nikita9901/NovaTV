// Пульт на телефоне внутри интерфейса приложения: «лазерная указка», кнопки и текст.
// (Когда открыта страница в браузере, сообщения забирает сам браузер: см. electron/browser.js.)

const FOCUSABLE = '[data-focusable]';

// Прокручиваемый предок элемента
function scroller(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) return p;
  }
  return null;
}

// Вставка текста: в поле ввода напрямую, иначе как набор на клавиатуре (так его понимают поиск фильмов и браузер)
function typeText(s) {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setRangeText(s, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  for (const ch of s) window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
}
function pressKey(key) {
  const el = document.activeElement;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && key === 'Backspace') {
    const a = el.selectionStart ?? el.value.length;
    const b = el.selectionEnd ?? a;
    if (a !== b) el.setRangeText('', a, b, 'end');
    else if (a > 0) el.setRangeText('', a - 1, a, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(ev);
  // Enter, который никто не обработал как «отправить», нажимает выбранную кнопку, как настоящая клавиша
  if (key === 'Enter' && !ev.defaultPrevented && el instanceof HTMLElement && el.matches('button, [data-focusable]')) el.click();
}

export function startRemote({ onKey, say }) {
  const dot = document.createElement('div');
  dot.className = 'laser';
  document.body.appendChild(dot);
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let hideTimer;
  let hovered = null;

  const show = () => {
    dot.style.transform = `translate(${x}px, ${y}px)`;
    dot.classList.add('on');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => dot.classList.remove('on'), 2500);
  };
  const under = () => {
    dot.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    dot.style.display = '';
    return el;
  };

  const off = window.tv.remote.onMessage((m) => {
    if (m.t === 'm') {
      const k = window.innerHeight / 1080;
      x = Math.min(window.innerWidth - 2, Math.max(0, x + (Number(m.dx) || 0) * k));
      y = Math.min(window.innerHeight - 2, Math.max(0, y + (Number(m.dy) || 0) * k));
      show();
      // наведённая кнопка получает фокус, как при наведении мышью
      const target = under()?.closest?.(FOCUSABLE);
      if (target && target !== hovered && !target.disabled && !target.closest('[inert]')) {
        hovered = target;
        target.focus({ preventScroll: true });
      } else if (!target) hovered = null;
    } else if (m.t === 'c') {
      show();
      const el = under();
      const target = el?.closest?.(FOCUSABLE) || el?.closest?.('input, textarea, button, a');
      if (target && !target.disabled) {
        target.focus({ preventScroll: true });
        target.click();
      }
    } else if (m.t === 's') {
      const sc = scroller(under());
      sc?.scrollBy({ left: Number(m.dx) || 0, top: Number(m.dy) || 0 });
    } else if (m.t === 'k') onKey(m.k);
    else if (m.t === 't' && typeof m.s === 'string') typeText(m.s.slice(0, 200));
    else if (m.t === 'bs') pressKey('Backspace');
    else if (m.t === 'en') pressKey('Enter');
  });

  return () => {
    off();
    dot.remove();
  };
}
