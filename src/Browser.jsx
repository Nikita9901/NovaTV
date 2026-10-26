import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import Osk from './Osk.jsx';

const SITES = [
  { title: 'Google', url: 'https://www.google.com', color: '#4285f4' },
  { title: 'Яндекс', url: 'https://ya.ru', color: '#fc3f1d' },
  { title: 'Википедия', url: 'https://ru.wikipedia.org', color: '#5b6577' },
  { title: 'Reddit', url: 'https://www.reddit.com', color: '#ff4500' },
  { title: 'Twitch', url: 'https://www.twitch.tv', color: '#9146ff' },
  { title: 'Хабр', url: 'https://habr.com', color: '#4a9fd9' },
  { title: 'GitHub', url: 'https://github.com', color: '#2b3137' },
  { title: 'Погода', url: 'https://yandex.ru/pogoda', color: '#2f9e6d' },
];

const readMarks = () => {
  try {
    return JSON.parse(localStorage.getItem('bookmarks') || '[]');
  } catch {
    return [];
  }
};
const host = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
};

// Браузер: страница рисуется отдельным слоем под панелью (см. electron/browser.js)
export default function Browser({ onBack, say }) {
  const [st, setSt] = useState({ open: false, url: '', title: '', loading: false, canBack: false, canForward: false, zoom: 1 });
  const [field, setField] = useState(null); // поле ввода на странице, которое выбрали геймпадом: { type, value }
  const [addr, setAddr] = useState(null); // текст адресной строки, пока человек её набирает
  const [toolbar, setToolbar] = useState(false); // геймпад отдан панели
  const [marks, setMarks] = useState(readMarks);
  const barRef = useRef(null);
  const oskRef = useRef(null);
  const stRef = useRef(st);
  stRef.current = st;

  const tv = window.tv.browser;
  const osk = !!field || addr !== null;
  const ui = osk || toolbar || !st.open;

  const openAddress = useCallback(() => {
    setField(null);
    setToolbar(false);
    setAddr('');
  }, []);

  // События от основного процесса
  useEffect(() => {
    tv.state().then((s) => s && setSt(s));
    return tv.on((m) => {
      if (m.state) setSt(m.state);
      if ('field' in m) {
        setField(m.field);
        if (!m.field) setToolbar(false);
      }
      if ('fieldValue' in m) setField((f) => (f ? { ...f, value: m.fieldValue } : f));
      if (m.event) {
        const n = m.event.name;
        if (n === 'toolbar') setToolbar(true);
        else if (n === 'address') openAddress();
        else if (n === 'empty-back') {
          tv.close();
          setToolbar(false);
        } else if (n === 'exit') onBack();
        else if (n === 'error') say(`Страница не открылась: ${m.event.text}`);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Закрываем страницу, когда уходим с экрана браузера
  useEffect(() => () => tv.close(), [tv]);

  // Сколько места нужно панели сверху и клавиатуре снизу: страница занимает всё остальное
  useLayoutEffect(() => {
    const top = barRef.current ? barRef.current.getBoundingClientRect().bottom : 0;
    const bottom = oskRef.current ? oskRef.current.getBoundingClientRect().height + 8 : 0;
    tv.layout({ top, bottom });
  });

  // Кто управляет геймпадом: страница (курсор) или наш интерфейс
  useEffect(() => {
    if (!st.open) return;
    tv.mode(ui ? 'ui' : 'page');
    if (ui) {
      requestAnimationFrame(() => {
        const target = osk ? '.browser [data-key]' : toolbar ? '.bbar [data-addr]' : '';
        if (target) document.querySelector(target)?.focus();
      });
    }
  }, [ui, osk, toolbar, st.open, tv]);

  // Открылась клавиатура — фокус сразу на её первую клавишу (и на стартовой странице тоже)
  useEffect(() => {
    if (osk) requestAnimationFrame(() => document.querySelector('.oskdock [data-key]')?.focus());
  }, [osk]);

  const go = (target) => {
    setAddr(null);
    setToolbar(false);
    if (stRef.current.open) tv.go(target);
    else tv.open(target);
  };

  // Назад (Ⓑ / Esc): закрыть клавиатуру → вернуться из панели к странице → выйти
  useEffect(() => {
    const back = () => {
      if (addr !== null) setAddr(null);
      else if (field) {
        tv.key('Blur');
        setField(null);
      } else if (toolbar && stRef.current.open) setToolbar(false);
      else onBack();
    };
    const onKey = (e) => e.key === 'Escape' && back();
    window.addEventListener('tv:back', back);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tv:back', back);
      window.removeEventListener('keydown', onKey);
    };
  }, [addr, field, toolbar, onBack, tv]);

  useEffect(() => {
    if (!st.open) requestAnimationFrame(() => !document.querySelector('.oskdock') && document.querySelector('.browser .site')?.focus());
  }, [st.open]);

  const marked = marks.some((m) => m.url === st.url);
  const toggleMark = () => {
    if (!st.url) return;
    const next = marked ? marks.filter((m) => m.url !== st.url) : [...marks, { title: st.title || host(st.url), url: st.url }];
    setMarks(next);
    localStorage.setItem('bookmarks', JSON.stringify(next));
    say(marked ? 'Убрано из закладок' : 'Добавлено в закладки');
  };

  const typeChar = (ch) => (addr !== null ? setAddr((a) => a + ch) : tv.type(ch));
  const backspace = () => (addr !== null ? setAddr((a) => a.slice(0, -1)) : tv.key('Backspace'));
  const enter = () => {
    if (addr !== null) {
      if (addr.trim()) go(addr);
      else setAddr(null);
    } else {
      tv.key('Enter');
      tv.key('Blur'); // отправили форму или закончили ввод: клавиатура больше не нужна
      setField(null);
    }
  };

  // Физическая клавиатура: символы идут в адресную строку или в поле на странице (раскладка любая, берём то, что набрано)
  const kbRef = useRef();
  const lastTyped = useRef(0); // когда последний раз печатали с физической клавиатуры
  kbRef.current = { addr, field, typeChar, backspace, enter };
  useEffect(() => {
    const onKey = (e) => {
      const k = kbRef.current;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.key === 'v' || e.key === 'м') && e.ctrlKey && (k.addr !== null || k.field)) {
          e.preventDefault();
          navigator.clipboard.readText().then((t) => t && k.typeChar(t.trim())).catch(() => {});
        }
        return;
      }
      const printable = e.key.length === 1 && e.key !== ' ';
      const typing = k.addr !== null || k.field;
      if (!typing && !printable) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        lastTyped.current = Date.now();
        k.backspace();
      } else if (e.key === 'Enter' && typing && Date.now() - lastTyped.current < 5000) {
        // Enter сразу после набора — отправить; иначе он нажимает выбранную клавишу, как обычно
        e.preventDefault();
        k.enter();
      } else if (e.key === ' ' && typing && Date.now() - lastTyped.current < 5000) {
        e.preventDefault();
        lastTyped.current = Date.now();
        k.typeChar(' ');
      } else if (printable) {
        e.preventDefault();
        lastTyped.current = Date.now();
        if (!typing) {
          // начали печатать на стартовой странице или на панели — это адрес
          setField(null);
          setToolbar(false);
          setAddr(e.key);
        } else k.typeChar(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sites = [...marks.map((m) => ({ ...m, color: '#6a4bf0' })), ...SITES];

  return (
    <div className="screen browser enter">
      <div className="bbar" ref={barRef}>
        <button data-focusable className="tbtn" disabled={!st.canBack} onClick={() => tv.back()} aria-label="Назад">
          <Icon name="back" />
        </button>
        <button data-focusable className="tbtn flip" disabled={!st.canForward} onClick={() => tv.forward()} aria-label="Вперёд">
          <Icon name="back" />
        </button>
        <button data-focusable className="tbtn" disabled={!st.open} onClick={() => tv.reload()} aria-label="Обновить">
          {st.loading ? '✕' : '⟳'}
        </button>
        <button data-focusable className="tbtn" disabled={!st.open} onClick={() => tv.close()} aria-label="Стартовая страница">
          ⌂
        </button>
        <button data-focusable data-addr className="addr" onClick={openAddress}>
          <Icon name="search" />
          <span>{addr !== null ? addr : st.open ? st.title || host(st.url) : 'Адрес или поисковый запрос'}</span>
          {addr !== null && <i className="caret" />}
        </button>
        <button data-focusable className={`tbtn ${marked ? 'on' : ''}`} disabled={!st.open} onClick={toggleMark} aria-label="Закладка">
          ★
        </button>
        <button data-focusable className="tbtn" disabled={!st.open} onClick={() => tv.zoom(-0.1)} aria-label="Уменьшить">
          A−
        </button>
        <button data-focusable className="tbtn" disabled={!st.open} onClick={() => tv.zoom(0.1)} aria-label="Увеличить">
          A+
        </button>
        <button data-focusable className="tbtn" onClick={onBack} aria-label="Закрыть браузер">
          ✕
        </button>
      </div>

      {st.open && st.loading && <div className="loadbar" />}

      {!st.open && (
        <div className="start" inert={osk || undefined}>
          <h2>
            <Icon name="globe" /> Быстрый доступ
          </h2>
          <div className="sites">
            {sites.map((s, i) => (
              <button key={s.url} data-focusable className="site" style={{ '--c': s.color, '--i': i }} onClick={() => go(s.url)}>
                <span className="site-ico">{(s.title || '?')[0].toUpperCase()}</span>
                <span className="site-t">{s.title}</span>
                <small>{host(s.url)}</small>
              </button>
            ))}
          </div>
          <p className="hint small">
            <kbd>Ⓐ</kbd> Открыть &nbsp; <kbd>Ⓑ</kbd> Выйти &nbsp; На странице: левый стик — курсор, Ⓐ — клик, правый стик — прокрутка, Ⓨ — адрес, Ⓧ — панель, LT / RT — масштаб
          </p>
        </div>
      )}

      {osk && (
        <div className="oskdock" ref={oskRef}>
          <div className="oskfield">{addr !== null ? addr || 'Адрес сайта или запрос' : field?.value || 'Текст на странице'}</div>
          <Osk onChar={typeChar} onBackspace={backspace} onEnter={enter} enterLabel={addr !== null ? 'Перейти' : 'Готово'} symbols={addr !== null} />
        </div>
      )}
    </div>
  );
}
