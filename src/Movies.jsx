import React, { useEffect, useRef, useState } from 'react';
import Player from './Player.jsx';
import { Icon } from './icons.jsx';
import { sfx } from './sounds.js';

const LAYOUTS = {
  ru: ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'],
  en: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
};

const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : `${Math.round(b / 1e6)} МБ`);

const fmtTime = (s) => {
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

// «осталось 1 ч 51 мин»
const fmtLeft = (s) => {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return `осталось ${h ? `${h} ч ` : ''}${m % 60} мин`;
};

// Озвучка, которую пользователь выбирал для этого фильма (чтобы не выбирать заново при продолжении)
const AUDIO_KEY = (id) => `audio:${id}`;
const readAudioPref = (id) => {
  try {
    return JSON.parse(localStorage.getItem(AUDIO_KEY(id)) || 'null');
  } catch {
    return null;
  }
};

const ratingClass = (r) => (r >= 7 ? 'good' : r >= 5.5 ? 'mid' : 'bad');

// ---- Подборки под «Продолжить просмотр» ----
const RAILS = [
  { id: 'recMovies', title: 'Рекомендуем · фильмы', icon: 'star', series: false },
  { id: 'recSeries', title: 'Рекомендуем · сериалы', icon: 'star', series: true },
  { id: 'newMovies', title: 'Новинки · фильмы', icon: 'film', series: false },
  { id: 'newSeries', title: 'Новинки · сериалы', icon: 'film', series: true },
];

// Самый частый жанр среди просмотренного — по нему подбираем рекомендации
const topGenre = (entries) => {
  const count = {};
  for (const e of entries) for (const g of e.movie?.genres || []) count[g] = (count[g] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

// ---- Сериалы ----
const span = (r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);
const epKey = (s, e) => `${s}:${e}`;
const epLabel = (s, e) => (s ? `S${s} · E${e}` : `Серия ${e}`);

// Что лежит в раздаче сериала — короткая подпись для значка
function kindLabel(t) {
  if (!t.kind || t.kind === 'unknown') return '';
  if (t.kind === 'single') return `Серия ${span(t.episodes)}`;
  if (t.kind === 'multi') return `Сезоны ${span(t.seasons)}`;
  const s = t.seasons ? `Сезон ${t.seasons[0]}` : 'Сезон';
  return t.episodes ? `${s} · серии ${span(t.episodes)}${t.total ? ` из ${t.total}` : ''}` : s;
}

// Фильтры списка раздач сериала
const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'pack', label: 'Сезон целиком' },
  { id: 'single', label: 'Отдельные серии' },
  { id: 'multi', label: 'Все сезоны' },
];

// Подходит ли раздача, которой пользовались раньше, под этот сезон (для быстрого перехода к следующей серии)
const coversSeason = (t, season) =>
  t && (t.kind === 'pack' || t.kind === 'multi') && (!t.seasons || (t.seasons[0] <= season && season <= t.seasons[1]));

// Фокус на первый найденный элемент после следующей отрисовки
const focusSoon = (...selectors) =>
  requestAnimationFrame(() => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.focus();
    }
  });

// Постер с плавным появлением, когда картинка загрузилась
function Poster({ src, className = '' }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={`poster ${className} ${ok ? 'loaded' : ''}`}>
      {src && (
        <img
          src={src}
          alt=""
          ref={(el) => el?.complete && el.naturalWidth && !ok && setOk(true)}
          onLoad={() => setOk(true)}
        />
      )}
    </div>
  );
}

function Rating({ value }) {
  if (!(value > 0)) return null;
  return (
    <span className={`rating ${ratingClass(value)}`}>
      <Icon name="star" />
      {value.toFixed(1)}
    </span>
  );
}

// Снимок данных фильма для списка «Продолжить просмотр»
const snapshot = (m) => ({
  id: m.id,
  title: m.title,
  original: m.original,
  year: m.year,
  rating: m.rating,
  poster: m.poster,
  posterFull: m.posterFull,
  backdrop: m.backdrop,
  description: m.description,
  genres: m.genres,
  length: m.length,
  type: m.type,
  isSeries: m.isSeries,
  seasonsInfo: m.seasonsInfo,
  countries: m.countries,
});

export default function Movies({ onBack, onSettings, onTrailer, say }) {
  const [view, setView] = useState('search'); // search | detail | torrents
  const [kbd, setKbd] = useState(true); // экранная клавиатура показана
  const [lang, setLang] = useState('ru');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(''); // loading | NO_TOKEN | текст ошибки | ''
  const [movie, setMovie] = useState(null);
  const [torrents, setTorrents] = useState(null);
  const [playing, setPlaying] = useState(null); // { text, pct, error, info }
  const [resume, setResume] = useState(null); // сохранённый прогресс текущего фильма
  const [cont, setCont] = useState([]); // «Продолжить просмотр»
  // Сериал: сезоны, выбранный сезон, прогресс по сериям, раздача, из которой смотрели раньше
  const [seasons, setSeasons] = useState(null); // null — ещё загружаем
  const [season, setSeason] = useState(1);
  const [epProg, setEpProg] = useState({}); // «сезон:серия» → запись прогресса
  const [lastTorrent, setLastTorrent] = useState(null);
  const [tctx, setTctx] = useState(null); // { season, episode } — для какой серии ищем раздачи
  const [tFilter, setTFilter] = useState('all');
  const [descOpen, setDescOpen] = useState(false); // описание развёрнуто
  const [extra, setExtra] = useState(null); // подробности фильма: актёры, похожие, возраст…
  const [prefs, setPrefs] = useState(null); // настройки (автоподбор раздачи)
  const [person, setPerson] = useState(null); // страница актёра: { id, name, photo, movies | null }
  const stack = useRef([]); // история открытых фильмов («Похожие» → назад возвращает к предыдущему)
  const autoRun = useRef(0); // номер текущего автоподбора (для отмены)
  const viaAuto = useRef(false); // просмотр начат автоподбором — по выходу возвращаемся на страницу фильма
  const [rails, setRails] = useState({}); // id подборки → список фильмов (undefined — ещё грузится)
  const reqId = useRef(0);
  const [tick, setTick] = useState(0); // принудительный перезапуск поиска (кнопка «Поиск»)
  const skipDelay = useRef(false); // не ждать паузу набора
  const pendingFocus = useRef(false); // после результатов перейти на карточки

  // ---------- Поиск «на лету» ----------
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setResults([]);
      setStatus('');
      return;
    }
    const id = ++reqId.current;
    setStatus('loading');
    const delay = skipDelay.current ? 0 : 900;
    skipDelay.current = false;
    const t = setTimeout(async () => {
      const res = await window.tv.searchMovies(query);
      if (id !== reqId.current) return;
      if (!res.ok) {
        setResults([]);
        setStatus(res.error === 'NO_TOKEN' ? 'NO_TOKEN' : res.error);
        pendingFocus.current = false;
      } else {
        setResults(res.data);
        setStatus(res.data.length ? '' : 'Ничего не найдено');
        if (pendingFocus.current && res.data.length) {
          setKbd(false);
          setTimeout(() => focusSoon('.card[data-id]'), 80); // карточки появятся после отрисовки
        }
        pendingFocus.current = false;
      }
    }, delay);
    return () => clearTimeout(t);
  }, [q, tick]);

  // Кнопка «Поиск» на клавиатуре: закрыть клавиатуру и перейти к фильмам
  const submit = () => {
    if (q.trim().length < 3) return say('Введите хотя бы 3 буквы');
    if (results.length && !status) {
      setKbd(false);
      focusSoon('.card[data-id]');
      return;
    }
    pendingFocus.current = true;
    skipDelay.current = true;
    setTick((n) => n + 1);
  };

  // ---------- «Продолжить просмотр» ----------
  // Подборки: рекомендации учитывают любимый жанр, уже просмотренное из них исключается
  const loadRails = async (all) => {
    const seen = all.filter((e) => e.movie);
    const watched = new Set(seen.map((e) => e.movie.id));
    const filmGenre = topGenre(seen.filter((e) => !e.movie.isSeries)) || topGenre(seen);
    const seriesGenre = topGenre(seen.filter((e) => e.movie.isSeries)) || topGenre(seen);
    await Promise.all(
      RAILS.map(async (r) => {
        const genre = r.id.startsWith('rec') ? (r.series ? seriesGenre : filmGenre) : '';
        const res = await window.tv.discover(r.id, genre);
        setRails((cur) => ({ ...cur, [r.id]: res.ok ? res.data.filter((x) => !watched.has(x.id)) : [] }));
      }),
    );
  };

  const loadContinue = async (retry = true) => {
    const res = await window.tv.getAllProgress();
    if (!res.ok) return;
    // Ключ записи: «id» для фильма и «id:сезон:серия» для серий сериала
    const all = Object.entries(res.data).map(([key, e]) => ({ ...e, key, id: Number(key.split(':')[0]) }));

    // У сериала в списке одна карточка — последняя незаконченная серия; законченные серии не показываем
    const latest = new Map();
    for (const e of all.filter((x) => x.movie && x.duration && !x.done)) {
      const cur = latest.get(e.id);
      if (!cur || e.updatedAt > cur.updatedAt) latest.set(e.id, e);
    }
    setCont([...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt));
    loadRails(all);

    // Записи, сохранённые до появления этого блока, без названия и постера — достраиваем по id один раз
    const legacy = all.filter((e) => !e.movie && e.duration);
    if (!legacy.length || !retry) return;
    let fixed = 0;
    for (const e of legacy) {
      const r = await window.tv.getMovie(e.id);
      if (!r.ok) continue;
      const { id, key, ...entry } = e;
      await window.tv.setProgress(key, { ...entry, movie: snapshot(r.data) });
      fixed++;
    }
    if (fixed) loadContinue(false);
  };
  useEffect(() => {
    if (view === 'search') loadContinue();
  }, [view]);

  const removeContinue = (id) => {
    // clearProgress убирает и сам фильм, и все серии сериала
    window.tv.clearProgress(id).then(() => {
      setCont((list) => list.filter((e) => e.movie.id !== id));
      say('Убрано из списка');
    });
  };

  // ---------- Назад: геймпад B / Esc ----------
  const stateRef = useRef();
  stateRef.current = { view, movie, playing, torrents, person };
  useEffect(() => {
    const back = () => {
      sfx.back();
      const { view, movie, playing, torrents } = stateRef.current;
      if (playing) {
        autoRun.current += 1; // отменяем подбор, если он ещё идёт
        window.tv.stopPlayer();
        setPlaying(null);
        const watching = !!playing.info;
        if ((viaAuto.current && watching) || torrents?.loading || !torrents) {
          // смотрели через «Смотреть», отменили поиск или запускали «Продолжить» — возвращаемся на страницу фильма
          setTorrents(null);
          setView('detail');
          focusSoon('[data-autofocus]');
        } else focusSoon('[data-torrent]');
      } else if (view === 'torrents') {
        setView('detail');
        focusSoon('[data-autofocus]');
      } else if (view === 'person') {
        const prev = stack.current.pop();
        if (prev?.__person) setPerson(prev.__person);
        else {
          if (prev) setMovie(prev);
          setView('detail');
        }
        focusSoon('[data-autofocus]', '[data-focusable]');
      } else if (view === 'detail') {
        if (stack.current.length) {
          // вернулись из «Похожих» или со страницы актёра к предыдущему
          const prev = stack.current.pop();
          if (prev.__person) {
            setPerson(prev.__person);
            setView('person');
            focusSoon('[data-autofocus]', '[data-focusable]');
            return;
          }
          setMovie(prev);
          setTorrents(null);
          focusSoon('[data-autofocus]');
          return;
        }
        setView('search');
        focusSoon(`[data-id="${movie.id}"]`, `[data-id="c${movie.id}"]`, '[data-key]', '[data-id]');
      } else onBack();
    };
    const onKey = (e) => e.key === 'Escape' && back();
    window.addEventListener('tv:back', back);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tv:back', back);
      window.removeEventListener('keydown', onKey);
    };
  }, [onBack]);

  // Вернулись из YouTube (трейлер) — возвращаем фокус на страницу фильма
  useEffect(() => window.tv.onHome(() => focusSoon('[data-autofocus]', '[data-focusable]')), []);

  // ---------- Статус воспроизведения из основного процесса ----------
  useEffect(
    () =>
      window.tv.onPlayerStatus((p) => {
        if (p.fatal) {
          setPlaying({ error: p.fatal });
        } else if (p.closed) {
          setPlaying(null);
          focusSoon('[data-torrent]');
        } else setPlaying((cur) => (cur && !cur.info ? { ...cur, text: p.text, pct: p.pct ?? cur.pct, hint: p.hint || '' } : cur));
      }),
    [],
  );

  // ---------- Клавиатура ----------
  const toggleKbd = () => {
    setKbd((k) => {
      focusSoon(k ? '[data-id]' : '[data-key]', '[data-kbd]');
      return !k;
    });
  };
  const toggleRef = useRef(toggleKbd);
  toggleRef.current = toggleKbd;

  useEffect(() => {
    if (view !== 'search') return;
    // Физическая клавиатура. Пробел всегда вводит пробел, а не нажимает выбранную кнопку.
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        sfx.key();
        setQ((s) => (s && !s.endsWith(' ') ? s + ' ' : s));
      } else if (e.key === 'Backspace') {
        sfx.key();
        setQ((s) => s.slice(0, -1));
      }
      else if (e.key === 'Delete') {
        const id = document.activeElement?.dataset?.cid;
        if (id) removeContinue(Number(id));
      } else if (e.key.length === 1) {
        sfx.key();
        setQ((s) => s + e.key);
      }
    };
    // Иначе браузер сочтёт отпускание пробела «нажатием» на кнопку
    const onKeyUp = (e) => e.key === ' ' && e.preventDefault();
    // Кнопки геймпада: Y — спрятать/показать клавиатуру, X — убрать фильм из «Продолжить»
    const onPad = (e) => {
      if (e.detail === 'y') toggleRef.current();
      else if (e.detail === 'x') {
        const id = document.activeElement?.dataset?.cid;
        if (id) removeContinue(Number(id));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('tv:pad', onPad);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('tv:pad', onPad);
    };
  }, [view]);

  useEffect(() => {
    focusSoon('[data-key]', '[data-kbd]');
  }, []);

  // Клавиатура скрывается сама, когда фокус уходит на карточки фильмов, и возвращается вместе с фокусом на строку поиска
  useEffect(() => {
    if (view !== 'search') return;
    const onFocus = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.card, .ccard')) setKbd(false);
      else if (t.closest('[data-search]')) setKbd(true);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [view]);

  // ---------- Страница фильма: сохранённый прогресс ----------
  useEffect(() => {
    if (view !== 'detail' || !movie) return;
    let alive = true;
    setResume(null);
    setEpProg({});
    setLastTorrent(null);
    setExtra(null);
    setDescOpen(false);
    document.querySelector('.screen.detail')?.scrollTo?.({ top: 0 });
    // Если приложение запущено до обновления, этих обработчиков в нём ещё нет — страница всё равно должна открыться
    window.tv.getDetails?.(movie.id)?.then((r) => alive && r?.ok && setExtra(r.data)).catch(() => {});
    window.tv.getSettings?.()?.then((r) => alive && r?.ok && setPrefs(r.data)).catch(() => {});

    (async () => {
      const res = await window.tv.getAllProgress();
      if (!alive) return;
      const mine = res.ok
        ? Object.entries(res.data)
            .filter(([k]) => k === String(movie.id) || k.startsWith(`${movie.id}:`))
            .map(([key, e]) => ({ ...e, key }))
        : [];
      if (movie.isSeries) {
        const map = {};
        for (const e of mine) if (e.episode) map[epKey(e.season || 0, e.episode)] = e;
        setEpProg(map);
        const newest = [...mine].sort((a, b) => b.updatedAt - a.updatedAt);
        setLastTorrent(newest[0]?.torrent || null);
        const open = newest.find((e) => !e.done); // последняя незаконченная серия
        setResume(open || null);
        if (open?.season) setSeason(open.season);
        if (open) focusSoon('[data-autofocus]');
      } else {
        const own = mine.find((e) => e.key === String(movie.id)) || null;
        setResume(own);
        if (own) focusSoon('[data-autofocus]');
      }
    })();

    // Сезоны и серии сериала
    if (movie.isSeries) {
      setSeasons(null);
      window.tv.getSeasons(movie).then((r) => {
        if (!alive) return;
        const list = r.ok ? r.data : [];
        setSeasons(list);
        setSeason((cur) => (list.some((s) => s.number === cur) ? cur : (list[0]?.number ?? 1)));
      });
    }
    return () => {
      alive = false;
    };
  }, [view, movie]);

  // Сохранение прогресса. Начало не запоминаем; конец у фильма стирает запись, у серии помечает её просмотренной.
  const saveProgress = (torrent, position, duration, ctx) => {
    if (!movie || !torrent || !duration) return;
    const key = ctx ? `${movie.id}:${ctx.season || 0}:${ctx.episode}` : String(movie.id);
    const extra = ctx ? { season: ctx.season || 0, episode: ctx.episode } : {};
    if (position > duration - 120) {
      if (ctx) window.tv.setProgress(key, { position: duration, duration, torrent, movie: snapshot(movie), done: true, ...extra });
      else window.tv.setProgress(key, null);
    } else if (position >= 30) {
      window.tv.setProgress(key, { position, duration, torrent, movie: snapshot(movie), ...extra });
    }
  };

  const openMovie = async (m, fromDetail = false) => {
    if (fromDetail && view === 'person' && person) stack.current.push({ __person: person });
    else if (fromDetail && movie) stack.current.push(movie);
    else stack.current = [];
    // Карточки из «Продолжить просмотр», сохранённые раньше, не знают, сериал это или нет — уточняем
    if (m.isSeries === undefined) {
      const r = await window.tv.getMovie(m.id);
      if (r.ok) m = { ...m, ...r.data };
    }
    setMovie(m);
    setTorrents(null);
    setView('detail');
    focusSoon('[data-autofocus]');
  };

  const openPerson = (p) => {
    if (movie) stack.current.push(movie);
    setPerson({ ...p, movies: null });
    setView('person');
    window.tv.getPerson?.(p.id)?.then((r) => setPerson((cur) => (cur?.id === p.id ? (r?.ok ? { ...cur, ...r.data } : { ...cur, movies: [] }) : cur))).catch(() => {});
    focusSoon('[data-autofocus]', '[data-focusable]');
  };

  const findTorrents = async (ctx = null) => {
    viaAuto.current = false;
    autoRun.current += 1;
    setTctx(ctx);
    setTFilter('all');
    setTorrents({ loading: true });
    setView('torrents');
    const res = await window.tv.searchTorrents({ ...movie, season: ctx?.season, episode: ctx?.episode });
    setTorrents(res.ok ? { list: res.data } : { error: res.error });
    focusSoon('[data-torrent]');
  };

  // Серия в фокусе: геймпад X или клавиша M (любая раскладка) — выбрать раздачу вручную
  const manualRef = useRef();
  manualRef.current = findTorrents;
  useEffect(() => {
    if (view !== 'detail') return;
    const go = () => {
      const d = document.activeElement?.dataset;
      if (d?.ep) manualRef.current({ season: Number(d.season), episode: Number(d.ep) });
    };
    const onPad = (e) => e.detail === 'x' && go();
    const onKey = (e) => e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && go();
    window.addEventListener('tv:pad', onPad);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tv:pad', onPad);
      window.removeEventListener('keydown', onKey);
    };
  }, [view]);

  // Лучшая раздача по оценке из основного процесса (сиды, качество, перевод); «экранки» и мёртвые отсечены
  const pickBest = (list) => list.filter((t) => t.score > 0).sort((a, b) => b.score - a.score)[0] || null;

  // «Смотреть»: найти раздачи, выбрать лучшую и сразу запустить. Если подходящей нет — покажем список.
  const watchBest = async (ctx = null) => {
    const run = ++autoRun.current;
    viaAuto.current = true;
    setTctx(ctx);
    setTFilter('all');
    setTorrents({ loading: true });
    setView('torrents');
    setPlaying({ text: 'Подбираем лучшую раздачу…', pct: 6 });
    const res = await window.tv.searchTorrents({ ...movie, season: ctx?.season, episode: ctx?.episode });
    if (autoRun.current !== run) return; // пользователь отменил
    if (!res.ok) {
      setPlaying(null);
      setTorrents({ error: res.error });
      focusSoon('[data-torrent]');
      return;
    }
    setTorrents({ list: res.data });
    const best = pickBest(res.data);
    if (!best) {
      setPlaying(null);
      say('Подходящей раздачи не нашлось — выберите вручную');
      focusSoon('[data-torrent]');
      return;
    }
    play(best, 0, ctx);
  };

  const play = async (t, startAt = 0, ctx = tctx) => {
    setPlaying({ text: 'Подключаемся к раздаче…', pct: 0 });
    const res = await window.tv.play({
      ...t,
      movieTitle: movie.title,
      movieLength: movie.length,
      season: ctx?.season || undefined,
      episode: ctx?.episode,
      prefAudio: readAudioPref(movie.id),
    });
    if (res.ok && ctx?.episode) setLastTorrent(t); // эта раздача — первая кандидатка для следующих серий
    if (res.ok) setPlaying((cur) => (cur ? { info: res.data, torrent: t, startAt, ctx } : cur)); // cur=null — пользователь отменил
    else if (res.error !== 'cancelled') setPlaying((cur) => (cur ? { error: res.error } : cur));
  };

  // Серия из сезона: если раньше смотрели эту серию — сразу продолжаем, иначе ищем раздачи именно для неё
  const watchEpisode = (s, e) => {
    const saved = epProg[epKey(s, e)];
    const ctx = { season: s, episode: e };
    if (saved && !saved.done && saved.torrent) {
      setTctx(ctx);
      setView('torrents');
      play(saved.torrent, saved.position, ctx);
    } else if (prefs?.autoPick === false) findTorrents(ctx);
    else if (coversSeason(lastTorrent, s)) {
      // следующая серия из той же раздачи (пака): без поиска, в два нажатия
      viaAuto.current = true;
      setTorrents(null);
      setTctx(ctx);
      setView('torrents');
      play(lastTorrent, 0, ctx);
    } else watchBest(ctx);
  };

  // Следующая серия из той же раздачи (по окончании или кнопкой Ⓨ)
  // Следующая серия по списку сезонов (если известен): в этом же сезоне, иначе первая серия следующего
  const nextEpisodeOf = (ctx) => {
    if (!ctx || !seasons) return null;
    const si = seasons.findIndex((s) => s.number === ctx.season);
    if (si < 0) return null;
    const eps = seasons[si].episodes;
    const ei = eps.findIndex((e) => e.number === ctx.episode);
    if (ei >= 0 && eps[ei + 1]) return { season: ctx.season, episode: eps[ei + 1].number };
    const nextSeason = seasons[si + 1];
    return nextSeason?.episodes?.[0] ? { season: nextSeason.number, episode: nextSeason.episodes[0].number } : null;
  };

  // Следующая серия: из этой же раздачи, если она там есть; иначе подбираем раздачу для неё (с приоритетом прежней)
  const playNext = () => {
    if (!playing?.info) return;
    const same = playing.info.next;
    if (same && playing.torrent) {
      setTctx(same);
      setPlaying(null);
      setTimeout(() => play(playing.torrent, 0, same), 50);
      return;
    }
    const n = nextEpisodeOf(playing.ctx);
    if (n) {
      setPlaying(null);
      setTimeout(() => watchEpisode(n.season, n.episode), 50);
    }
  };

  // ======================= Страница фильма / сериала =======================
  if (view === 'detail') {
    const art = movie.posterFull || movie.poster;
    const isSeries = !!movie.isSeries;
    const curSeason = isSeries ? seasons?.find((s) => s.number === season) : null;
    const firstSeason = seasons?.[0];
    const resumeCtx = resume && isSeries ? { season: resume.season || 0, episode: resume.episode } : null;
    const info = { ...movie, ...(extra || {}) }; // подробности (актёры, похожие, возраст…) подгружаются отдельно
    const auto = prefs?.autoPick !== false;
    const fmtDate = (d) => {
      const dt = new Date(d);
      return Number.isNaN(+dt) ? '' : dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    return (
      <div className={`screen detail enter ${isSeries ? 'series' : ''}`}>
        <div className="detail-bg" style={{ backgroundImage: art ? `url("${art}")` : undefined }} />
        <div className="d-top">
          <Poster className={isSeries ? 'big compact' : 'big'} src={art} />
          <div className="info">
            <h2>{movie.title}</h2>
            {movie.original && movie.original !== movie.title && <p className="orig">{movie.original}</p>}
            {info.slogan && <p className="slogan">«{info.slogan}»</p>}
            <div className="chips">
              <Rating value={movie.rating} />
              {info.imdb > 0 && <span className="chip-s imdb">IMDb {info.imdb.toFixed(1)}</span>}
              {info.ageRating != null && <span className="chip-s">{info.ageRating}+</span>}
              {movie.year && <span className="chip-s">{movie.year}</span>}
              {isSeries && seasons?.length > 0 && <span className="chip-s">Сезонов: {seasons.length}</span>}
              {!isSeries && movie.length && <span className="chip-s">{movie.length} мин</span>}
              {(info.countries || []).slice(0, 2).map((c) => (
                <span className="chip-s soft" key={c}>
                  {c}
                </span>
              ))}
              {movie.genres.slice(0, 3).map((g) => (
                <span className="chip-s soft" key={g}>
                  {g}
                </span>
              ))}
            </div>
            {info.directors?.length > 0 && (
              <p className="crew">
                Режиссёр: <b>{info.directors.map((p) => p.name).join(', ')}</b>
              </p>
            )}
            <p className={`descr${descOpen ? ' open' : ''}`}>{movie.description}</p>
            {(movie.description || '').length > 230 && (
              <button data-focusable className="more" onClick={() => setDescOpen((v) => !v)}>
                {descOpen ? 'Свернуть ▴' : 'Читать полностью ▾'}
              </button>
            )}

            {resume && (
              <div className="resume-line">
                <div className="rbar">
                  <i style={{ width: `${Math.min(100, (resume.position / resume.duration) * 100)}%` }} />
                </div>
                <span>
                  {resumeCtx ? `Сезон ${resume.season}, серия ${resume.episode}: ` : ''}остановились на {fmtTime(resume.position)} из{' '}
                  {fmtTime(resume.duration)} · {fmtLeft(resume.duration - resume.position)}
                </span>
              </div>
            )}

            <div className="actions">
              {resume && (
                <button
                  data-focusable
                  data-autofocus
                  className="btn primary"
                  onClick={() => {
                    viaAuto.current = false;
                    setTorrents(null);
                    setTctx(resumeCtx);
                    setView('torrents');
                    play(resume.torrent, resume.position, resumeCtx);
                  }}
                >
                  <Icon name="play" /> Продолжить{resumeCtx ? ` · ${epLabel(resume.season, resume.episode)}` : ' просмотр'}
                </button>
              )}
              {!isSeries && (
                <button
                  data-focusable
                  data-autofocus={resume ? undefined : true}
                  className={`btn${resume ? '' : ' primary'}`}
                  onClick={() => (auto ? watchBest() : findTorrents())}
                >
                  <Icon name={auto ? 'play' : 'download'} /> {auto ? 'Смотреть' : 'Искать торренты'}
                </button>
              )}
              {!isSeries && auto && (
                <button data-focusable className="btn" onClick={() => findTorrents()}>
                  <Icon name="download" /> Выбрать раздачу
                </button>
              )}
              {isSeries && !resume && firstSeason?.episodes?.[0] && (
                <button
                  data-focusable
                  data-autofocus
                  className="btn primary"
                  onClick={() => watchEpisode(firstSeason.number, firstSeason.episodes[0].number)}
                >
                  <Icon name="play" /> Смотреть с первой серии
                </button>
              )}
              {isSeries && auto && (resumeCtx || firstSeason?.episodes?.[0]) && (
                <button
                  data-focusable
                  className="btn"
                  onClick={() =>
                    findTorrents(resumeCtx || { season: firstSeason.number, episode: firstSeason.episodes[0].number })
                  }
                >
                  <Icon name="download" /> Выбрать раздачу
                </button>
              )}
              <button
                data-focusable
                className="btn"
                onClick={() => onTrailer(`https://www.youtube.com/tv#/results?search_query=${encodeURIComponent(`${movie.title} ${movie.year || ''} трейлер`)}`)}
              >
                <Icon name="film" /> Трейлер
              </button>
              <button data-focusable className="btn ghost" onClick={() => window.dispatchEvent(new Event('tv:back'))}>
                <Icon name="back" /> Назад
              </button>
            </div>
          </div>
        </div>

        {isSeries && (
          <section className="eps">
            {seasons === null && <p className="hint">Загружаем сезоны и серии…</p>}
            {seasons && !seasons.length && <p className="hint">Нет данных о сезонах этого сериала</p>}
            {seasons?.length > 0 && (
              <>
                <div className="season-tabs">
                  {seasons.map((s) => (
                    <button
                      key={s.number}
                      data-focusable
                      className={`opt ${s.number === season ? 'on' : ''}`}
                      onClick={() => setSeason(s.number)}
                    >
                      Сезон {s.number}
                    </button>
                  ))}
                </div>
                <div className="ep-row" key={season}>
                  {curSeason?.episodes.map((e, i) => {
                    const p = epProg[epKey(season, e.number)];
                    const pct = p ? Math.min(100, (p.position / p.duration) * 100) : 0;
                    return (
                      <button
                        key={e.number}
                        data-focusable
                        data-season={season}
                        data-ep={e.number}
                        className={`ep ${p?.done ? 'done' : ''}`}
                        style={{ '--i': Math.min(i, 10) }}
                        onClick={() => watchEpisode(season, e.number)}
                      >
                        <span className="ep-art" style={{ backgroundImage: e.still ? `url("${e.still}")` : undefined }}>
                          <b>{e.number}</b>
                          {p?.done && <span className="ep-check">✓</span>}
                        </span>
                        <span className="ep-title">{e.title || `Серия ${e.number}`}</span>
                        <span className="ep-meta">{fmtDate(e.airDate)}</span>
                        {p && (
                          <span className="ep-bar">
                            <i style={{ width: `${p.done ? 100 : pct}%` }} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="hint ep-hint">Выбрать раздачу для серии вручную: Ⓧ на геймпаде или клавиша M</p>
              </>
            )}
          </section>
        )}

        {extra?.cast?.length > 0 && (
          <section className="people">
            <h3>
              <Icon name="star" /> В ролях
            </h3>
            <div className="people-row">
              {extra.cast.map((p) => (
                <button data-focusable className="person" key={p.id} onClick={() => openPerson(p)}>
                  <span className="avatar" style={{ '--photo': p.photo ? `url("${p.photo}")` : 'none' }} />
                  <span className="pname">{p.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {extra?.similar?.length > 0 && (
          <section className="cont rail">
            <h3>
              <Icon name="film" /> Похожие
            </h3>
            <div className="cont-row rail-row">
              {extra.similar.map((it, i) => (
                <button
                  key={it.id}
                  data-focusable
                  data-id={`s${it.id}`}
                  className="card"
                  style={{ '--i': Math.min(i, 10) }}
                  onClick={() => openMovie(it, true)}
                >
                  <Poster src={it.poster} />
                  <span className="badge">
                    <Rating value={it.rating} />
                  </span>
                  <span className="ct">{it.title}</span>
                  <span className="cy">{it.year}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // ======================= Список раздач =======================
  if (view === 'person' && person) {
    return (
      <div className="screen detail person-page enter">
        <div className="pp-head">
          <span className="avatar big" style={{ '--photo': person.photo ? `url("${person.photo}")` : 'none' }} />
          <div>
            <h2>{person.name}</h2>
            {person.original && person.original !== person.name && <p className="orig">{person.original}</p>}
            {person.bio?.length > 0 && <p className="crew">{person.bio.join(' · ')}</p>}
            <button data-focusable data-autofocus className="btn ghost" onClick={() => window.dispatchEvent(new Event('tv:back'))}>
              <Icon name="back" /> Назад
            </button>
          </div>
        </div>
        <section className="people">
          <h3>
            <Icon name="film" /> Фильмография
          </h3>
          {person.movies === null && <p className="hint">Загружаем фильмы…</p>}
          {person.movies && !person.movies.length && <p className="hint">Нет данных о фильмах</p>}
          <div className="pgrid">
            {(person.movies || []).map((it, i) => (
              <button
                key={it.id}
                data-focusable
                className="card"
                style={{ '--i': Math.min(i, 10) }}
                onClick={() => openMovie(it, true)}
              >
                <Poster src={it.poster} />
                <span className="badge">
                  <Rating value={it.rating} />
                </span>
                <span className="ct">{it.title}</span>
                <span className="cy">{it.year}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (view === 'torrents') {
    const isSeries = !!movie.isSeries;
    const list = torrents?.list || [];
    const sameTorrent = (a, b) => (a.infoHash && a.infoHash === b.infoHash) || (a.download && a.download === b.download) || a.title === b.title;
    const countOf = (kind) => list.filter((t) => t.kind === kind).length;
    const shown = isSeries && tFilter !== 'all' ? list.filter((t) => t.kind === tFilter) : list;
    // Раздача, из которой смотрели раньше и в которой есть нужный сезон — предлагаем первой (так следующие серии открываются в два нажатия)
    const offer =
      isSeries && tctx && tFilter === 'all' && coversSeason(lastTorrent, tctx.season) && !list.some((t) => sameTorrent(t, lastTorrent))
        ? lastTorrent
        : null;
    const rows = offer ? [{ ...offer, __offer: true }, ...shown] : shown;
    const best = pickBest(list);
    const ctxLabel = tctx ? `Сезон ${tctx.season}, серия ${tctx.episode}` : '';
    const playingTitle = playing?.ctx ? `${movie.title} · ${epLabel(playing.ctx.season, playing.ctx.episode)}` : movie.title;

    return (
      <div className="screen torrents enter">
        {playing?.info && (
          <Player
            info={playing.info}
            title={playingTitle}
            startAt={playing.startAt}
            onProgress={(pos, dur) => saveProgress(playing.torrent, pos, dur, playing.ctx)}
            onNext={playNext}
            episode={!!movie.isSeries && !!playing.ctx}
            hasNext={!!playing.info.next || !!nextEpisodeOf(playing.ctx)}
            onAudio={(a) => localStorage.setItem(AUDIO_KEY(movie.id), JSON.stringify({ title: a.title, lang: a.lang }))}
          />
        )}
        {playing && !playing.info && <PlayOverlay
            playing={playing}
            movie={movie}
            label={playing.ctx ? epLabel(playing.ctx.season, playing.ctx.episode) : ''}
            onManual={() => findTorrents(tctx)}
          />}

        <div className="t-head" inert={!!playing || undefined}>
          <Poster className="mini" src={movie.poster} />
          <div>
            <h2>{movie.title}</h2>
            <p className="meta">
              {[ctxLabel, movie.year, torrents?.list ? `найдено раздач: ${list.length}` : ''].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {isSeries && list.length > 0 && (
          <div className="tfilters" inert={!!playing || undefined}>
            {FILTERS.filter((f) => f.id === 'all' || countOf(f.id) > 0).map((f) => (
              <button key={f.id} data-focusable className={`opt ${tFilter === f.id ? 'on' : ''}`} onClick={() => setTFilter(f.id)}>
                {f.label}
                {f.id !== 'all' && ` · ${countOf(f.id)}`}
              </button>
            ))}
          </div>
        )}

        {torrents?.loading && (
          <div className="trows">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="trow skeleton" key={i} style={{ '--i': i }} />
            ))}
          </div>
        )}
        {torrents?.error === 'NO_PROWLARR' && (
          <div className="empty">
            <p>Не подключён источник торрентов. В «Настройки → Поиск и источники → Источники раздач» нажмите «Скачать и установить Prowlarr» и добавьте трекеры.</p>
            <button data-focusable data-torrent className="btn primary" onClick={() => onSettings()}>
              Открыть настройки
            </button>
          </div>
        )}
        {torrents?.error && torrents.error !== 'NO_PROWLARR' && <p className="empty">Ошибка: {torrents.error}</p>}
        {torrents?.list && !rows.length && <p className="empty">Раздач не найдено</p>}

        <div className="trows" inert={!!playing || undefined}>
          {rows.map((t, i) => (
            <button
              key={`${t.__offer ? 'o' : 't'}${i}`}
              data-focusable
              data-torrent
              className={`trow ${t.__offer ? 'offer' : ''}`}
              style={{ '--i': Math.min(i, 12) }}
              onClick={() => play(t, 0, tctx)}
            >
              <span className={`q q-${(t.quality || 'x').toLowerCase()}`}>{t.quality || '—'}</span>
              <span className="tt">
                {t.title}
                <small>
                  {t === best && <em className="kind k-best">★ Лучший выбор</em>}
                  {t.__offer && <em className="kind k-offer">Смотрели отсюда раньше</em>}
                  {t.dub && <em className="kind k-dub">Рус. озвучка</em>}
                  {t.indexer}
                  {isSeries && kindLabel(t) && <em className={`kind k-${t.kind}`}>{kindLabel(t)}</em>}
                </small>
              </span>
              <span className="sz">{fmtSize(t.size)}</span>
              <span className="se">
                <span className="health">
                  <i style={{ width: `${Math.min(100, (Math.log10(t.seeders + 1) / 3) * 100)}%` }} />
                </span>
                {t.seeders}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ======================= Поиск =======================
  const searching = q.trim().length >= 3;
  return (
    <div className="screen search enter">
      <div className="m-head">
        <div className="m-title">
          <Icon name="film" />
          Фильмы
        </div>

        <div className="searchwrap">
          {/* Фокус на строке поиска возвращает клавиатуру; Ⓐ / Enter — перейти к вводу */}
          <div
            className={`searchbox ${q ? 'filled' : ''}`}
            tabIndex={0}
            data-focusable
            data-search
            onClick={() => focusSoon('[data-key]', '[data-id]')}
          >
            <Icon name="search" />
            <span className="qtext">{q || <em>Название фильма</em>}</span>
            <i className="caret" />
          </div>
          {q && (
            <button data-focusable className="clear" onClick={() => setQ('')} aria-label="Очистить">
              ✕
            </button>
          )}
        </div>

        <button data-focusable data-kbd className="btn ghost" onClick={toggleKbd}>
          <Icon name="keyboard" />
          {kbd ? 'Скрыть клавиатуру' : 'Показать клавиатуру'}
          <kbd>Y</kbd>
        </button>
      </div>

      <div className="m-body">
        {kbd && (
          <div className="left">
            <div className="osk">
              {LAYOUTS[lang].map((row) => (
                <div key={row} className="row">
                  {[...row].map((ch) => (
                    <button key={ch} data-focusable data-key className="key" onClick={() => setQ((s) => s + ch)}>
                      {ch}
                    </button>
                  ))}
                </div>
              ))}
              <div className="row">
                <button data-focusable className="key wide" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
                  {lang === 'ru' ? 'RU → EN' : 'EN → RU'}
                </button>
                <button data-focusable className="key wider" onClick={() => setQ((s) => s + ' ')}>
                  пробел
                </button>
                <button data-focusable className="key wide" onClick={() => setQ((s) => s.slice(0, -1))}>
                  ⌫
                </button>
                <button data-focusable className="key go" onClick={submit}>
                  <Icon name="search" /> Поиск
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="right">
          {status === 'NO_TOKEN' && (
            <div className="empty">
              <p>Для поиска нужен ключ доступа. Откройте настройки и впишите его в поле kinopoiskToken.</p>
              <button data-focusable className="btn primary" onClick={() => onSettings()}>
                Открыть настройки
              </button>
            </div>
          )}
          {status && status !== 'loading' && status !== 'NO_TOKEN' && <p className="empty">{status}</p>}

          {/* Продолжить просмотр — пока ничего не ищем (показываем всегда, чтобы блок был на виду) */}
          {!searching && status !== 'NO_TOKEN' && (
            <section className="cont">
              <h3>
                <Icon name="clock" /> Продолжить просмотр
              </h3>
              {cont.length ? (
                <>
                  <div className="cont-row">
                    {cont.map((e, i) => {
                      const m = e.movie;
                      const pct = Math.min(100, (e.position / e.duration) * 100);
                      const art = m.backdrop || m.posterFull || m.poster;
                      return (
                        <button
                          key={m.id}
                          data-focusable
                          data-id={`c${m.id}`}
                          data-cid={m.id}
                          className="ccard"
                          style={{ '--i': i }}
                          onClick={() => openMovie(m)}
                        >
                          <span className="cart" style={{ backgroundImage: art ? `url("${art}")` : undefined }} />
                          <span className="cshade" />
                          <span className="cplay">
                            <Icon name="play" />
                          </span>
                          <span className="cinfo">
                            <b>{m.title}{e.episode ? ' · ' + epLabel(e.season, e.episode) : ''}</b>
                            <span>
                              {fmtTime(e.position)} из {fmtTime(e.duration)} · {fmtLeft(e.duration - e.position)}
                            </span>
                          </span>
                          <span className="cbar">
                            <i style={{ width: `${pct}%` }} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="tip">
                    <kbd>Ⓧ</kbd> / <kbd>Del</kbd> — убрать из списка
                  </p>
                </>
              ) : (
                <div className="cont-empty">
                  <Icon name="film" />
                  <span>Здесь появятся фильмы, которые вы начали смотреть, с полоской просмотра и временем</span>
                </div>
              )}
            </section>
          )}

          {!searching && status !== 'NO_TOKEN' && <p className="hint center">Начните вводить название фильма — подойдёт и физическая клавиатура</p>}

          {!searching &&
            status !== 'NO_TOKEN' &&
            RAILS.map((r) => {
              const items = rails[r.id];
              if (items && !items.length) return null; // нет данных — ряд просто не показываем
              return (
                <section className="cont rail" key={r.id}>
                  <h3>
                    <Icon name={r.icon} /> {r.title}
                  </h3>
                  <div className="cont-row rail-row">
                    {items
                      ? items.map((it, i) => (
                          <button
                            key={it.id}
                            data-focusable
                            data-id={it.id}
                            className="card"
                            style={{ '--i': Math.min(i, 10) }}
                            onClick={() => openMovie(it)}
                          >
                            <Poster src={it.poster} />
                            <span className="badge">
                              <Rating value={it.rating} />
                            </span>
                            <span className="ct">{it.title}</span>
                            <span className="cy">{it.year}</span>
                          </button>
                        ))
                      : Array.from({ length: 8 }, (_, i) => (
                          <div className="card skeleton" key={i} style={{ '--i': i }}>
                            <div className="poster" />
                            <span className="ct" />
                          </div>
                        ))}
                  </div>
                </section>
              );
            })}

                    {status === 'loading' && (
            <div className="grid">
              {Array.from({ length: 10 }, (_, i) => (
                <div className="card skeleton" key={i} style={{ '--i': i }}>
                  <div className="poster" />
                  <span className="ct" />
                </div>
              ))}
            </div>
          )}

          {status !== 'loading' && results.length > 0 && (
            <div className="grid">
              {results.map((m, i) => (
                <button
                  key={m.id}
                  data-focusable
                  data-id={m.id}
                  className="card"
                  style={{ '--i': Math.min(i, 14) }}
                  onClick={() => openMovie(m)}
                >
                  <Poster src={m.poster} />
                  <span className="badge">
                    <Rating value={m.rating} />
                  </span>
                  <span className="ct">{m.title}</span>
                  <span className="cy">{m.year}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayOverlay({ playing, movie, label, onManual }) {
  const { text, pct, error } = playing;
  useEffect(() => {
    if (error) requestAnimationFrame(() => document.querySelector('.overlay .btn')?.focus());
  }, [error]);
  const art = movie.posterFull || movie.poster;
  return (
    <div className="overlay">
      <div className="overlay-bg" style={{ backgroundImage: art ? `url("${art}")` : undefined }} />
      <div className="overlay-card">
        <h2>
          {movie.title}
          {label && <small className="ovl-ep">{label}</small>}
        </h2>
        {error ? (
          <>
            <p className="hint">{error}</p>
            {onManual && (
              <button data-focusable className="btn primary" onClick={onManual}>
                Выбрать раздачу вручную
              </button>
            )}
          </>
        ) : (
          <>
            <div className="ring" />
            <p className="hint">{text}</p>
            <div className="bar">
              <i style={{ width: `${pct || 0}%` }} />
            </div>
            {playing.hint && <p className="hint warn">{playing.hint}</p>}
          </>
        )}
        <p className="hint small">
          <kbd>Ⓑ</kbd> Отмена
        </p>
      </div>
    </div>
  );
}
