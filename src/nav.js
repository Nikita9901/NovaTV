import { sfx } from './sounds.js';

// Пространственная навигация: фокус прыгает на ближайший элемент с [data-focusable] в нужном направлении.
//
// Правила:
//  1. Расстояние считаем между краями элементов, а не центрами (высокая карточка иначе «кажется» дальше соседей).
//  2. Сначала элементы «в том же ряду/столбце» (перекрываются по перпендикулярной оси); если их нет —
//     просто ближайшие.
//  3. Элементы, скрытые за краем прокручиваемого списка, считаются, только если у нас с ними есть общий
//     список (прокрутка их покажет). Чужие скрытые элементы пропускаем.
//  5. Влево/вправо — только внутри своего ряда: на краю остаёмся на месте (звук «упёрся»), на другую строку не прыгаем.
//  4. Из прокручиваемого списка сначала двигаемся ВНУТРИ него и лишь когда внутри двигаться некуда — выходим
//     (иначе стрелка «вверх» из подборок перепрыгивала бы блок «Продолжить» прямо на кнопки в шапке).

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

// Все прокручиваемые предки элемента, от ближайшего к дальнему
function scrollAncestors(el) {
  const list = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) list.push(p);
  }
  return list;
}

// Какая часть элемента реально видна (с учётом обрезки всеми прокручиваемыми предками), 0..1
function visibleRatio(el, r) {
  let left = r.left;
  let right = r.right;
  let top = r.top;
  let bottom = r.bottom;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) continue;
    const pr = p.getBoundingClientRect();
    left = Math.max(left, pr.left);
    right = Math.min(right, pr.right);
    top = Math.max(top, pr.top);
    bottom = Math.min(bottom, pr.bottom);
  }
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  return (w * h) / (r.width * r.height);
}

export function move(dir) {
  const items = [...document.querySelectorAll('[data-focusable]')];
  const cur = document.activeElement?.hasAttribute('data-focusable') ? document.activeElement : null;
  if (!cur) {
    items.find((el) => !el.closest('[inert]') && visibleRatio(el, el.getBoundingClientRect()) > 0.3)?.focus();
    return;
  }
  const cr = cur.getBoundingClientRect();
  const c = center(cr);
  const horizontal = dir === 'left' || dir === 'right';
  const curScrollers = scrollAncestors(cur);
  const outer = curScrollers[curScrollers.length - 1] || null; // самый внешний список, в котором мы сидим

  // --- собираем кандидатов в нужном направлении ---
  const cands = [];
  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('[inert]')) continue;

    const ancestors = scrollAncestors(el);
    const sharesList = curScrollers.length > 0 && ancestors.some((a) => curScrollers.includes(a));
    if (!sharesList && visibleRatio(el, r) < 0.3) continue; // чужой и скрытый

    const p = center(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const along = { left: -dx, right: dx, up: -dy, down: dy }[dir];
    if (along <= 1) continue;

    const gap = { left: cr.left - r.right, right: r.left - cr.right, up: cr.top - r.bottom, down: r.top - cr.bottom }[dir];
    // Кандидат должен лежать по-настоящему «за» краем текущего: иначе соседний постер с чуть более высоким
    // заголовком (его центр ниже) сойдёт за «нижний» с нулевым расстоянием, и фокус останется в том же ряду.
    if (gap < -2) continue;
    cands.push({
      el,
      dist: Math.max(0, gap),
      across: horizontal ? Math.abs(dy) : Math.abs(dx),
      shared: horizontal ? overlap(cr.top, cr.bottom, r.top, r.bottom) : overlap(cr.left, cr.right, r.left, r.right),
      inside: !!outer && ancestors.includes(outer), // лежит в том же внешнем списке
    });
  }

  // Правило 4: есть куда двигаться внутри списка — остаёмся в нём
  const insideList = cands.filter((k) => k.inside);
  let pool = outer && insideList.length ? insideList : cands;

  // Влево/вправо двигаемся только по своему ряду: дойдя до края, остаёмся на месте (иначе фокус перескакивал бы на другие строки)
  if (horizontal) pool = pool.filter((k) => k.shared > 2);

  let aligned = null;
  let near = null;
  let any = null;
  let alignedScore = Infinity;
  let nearScore = Infinity;
  let anyScore = Infinity;
  for (const k of pool) {
    // «В том же ряду/столбце»: главное — расстояние, смещение центров лишь разруливает равные варианты
    if (k.shared > 2) {
      const s = k.dist + k.across * 0.03;
      if (s < alignedScore) {
        alignedScore = s;
        aligned = k;
      }
    }
    const n = k.dist + k.across * 0.3; // ближайший по расстоянию, пусть и не в том же ряду
    if (n < nearScore) {
      nearScore = n;
      near = k;
    }
    const a = k.dist + k.across * 2;
    if (a < anyScore) {
      anyScore = a;
      any = k;
    }
  }

  // Если «выровненный» элемент намного дальше, чем просто ближайший, идём на ближайший
  const pick = horizontal ? aligned : aligned && near && near !== aligned && near.dist < aligned.dist * 0.6 ? near : aligned || any;
  if (pick) {
    // Браузер сам прокручивает только к полностью скрытому элементу, а наполовину видимый оставляет обрезанным — доводим сами
    pick.el.focus({ preventScroll: true });
    pick.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // вернулись к кнопкам в шапке страницы фильма — показываем страницу с самого верха, чтобы не обрезалось название
    if (pick.el.closest('.d-top, .pp-head')) pick.el.closest('.detail')?.scrollTo({ top: 0 });
    sfx.move();
  } else sfx.bump();
}

export function activate() {
  document.activeElement?.click?.();
}
