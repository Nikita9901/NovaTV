import React, { useCallback, useEffect, useRef, useState } from 'react';
import { attachStream } from './mse.js';

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

const LANGS = { rus: 'Русский', eng: 'English', ukr: 'Українська', jpn: '日本語', ger: 'Deutsch', fre: 'Français' };
const audioName = (a, i) => a.title || LANGS[a.lang] || a.lang || `Дорожка ${i + 1}`;
const audioSub = (a) =>
  [a.title ? LANGS[a.lang] || a.lang : '', a.codec.toUpperCase(), a.ch, a.external ? 'отдельный файл' : ''].filter(Boolean).join(' · ');
const audioLabel = (a, i) => [audioName(a, i), audioSub(a)].filter(Boolean).join(' · ');

// «12 мин 30 с», «45 с»
const fmtAhead = (s) => {
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин ${sec} с`;
  return `${sec} с`;
};

const SEEK_STEP = 10;
const SEEK_BIG = 60;

const INTRO_PILL_MS = 8000; // сколько секунд висит «Пропустить заставку»
const INTRO_RE = /intro|opening|заставк|опенинг|вступлен|\bop\b/i;
const CREDITS_RE = /credits|ending|титры|эндинг|\bed\b/i;

// episode — это серия сериала (есть смысл пропускать заставку); hasNext — есть следующая серия
export default function Player({ info, title, startAt = 0, onProgress, onNext, onAudio, onMinimize, suspended = false, episode = false, hasNext = false }) {
  const { base, duration, audios } = info;
  const video = useRef(null);
  const [start, setStart] = useState(Math.floor(startAt)); // с какой секунды запущен текущий поток
  const [audio, setAudio] = useState(info.prefAudio || 0); // дорожка по умолчанию — из настроек
  const [pos, setPos] = useState(startAt); // абсолютная позиция, с
  const [paused, setPaused] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState('');
  const [osd, setOsd] = useState(true);
  const [note, setNote] = useState('');
  const osdTimer = useRef();
  const seekTimer = useRef();
  const target = useRef(null); // накопленная цель перемотки
  const volume = useRef(1);
  const [net, setNet] = useState(null); // сколько загружено вперёд
  const [menu, setMenu] = useState(null); // меню выбора озвучки: null — закрыто, число — выбранная строка
  const menuRef = useRef(null);
  menuRef.current = menu;

  const wake = useCallback(() => {
    setOsd(true);
    clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => setOsd(false), 3500);
  }, []);

  const tell = useCallback(
    (msg) => {
      setNote(msg);
      wake();
    },
    [wake],
  );

  // Абсолютное время = смещение потока + позиция в нём
  const absNow = () => start + (video.current?.currentTime || 0);

  // Перемотка: внутри уже загруженного — сдвигаем currentTime, иначе перезапускаем поток
  const applySeek = useCallback(() => {
    const t = Math.min(Math.max(0, target.current), Math.max(0, duration - 3));
    target.current = null;
    const v = video.current;
    const rel = t - start;
    const buf = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    if (rel >= 0 && rel < buf - 1) v.currentTime = rel;
    else {
      setWaiting(true);
      setStart(Math.floor(t));
    }
    setPos(t);
  }, [duration, start]);

  const seekBy = useCallback(
    (delta) => {
      target.current = (target.current ?? absNow()) + delta;
      setPos(target.current);
      wake();
      clearTimeout(seekTimer.current);
      seekTimer.current = setTimeout(applySeek, 450);
    },
    [applySeek, wake], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const togglePause = useCallback(() => {
    const v = video.current;
    if (v.paused) v.play();
    else v.pause();
    wake();
  }, [wake]);

  const openAudioMenu = useCallback(() => {
    if (audios.length < 2) return tell('Другой звуковой дорожки нет');
    setMenu(audio);
  }, [audio, audios.length, tell]);

  // Выбрать дорожку: поток перезапускается с текущей позиции, выбор запоминаем для этого фильма
  const chooseAudio = useCallback(
    (i) => {
      setMenu(null);
      if (i === audio) return;
      const at = Math.floor(target.current ?? absNow());
      target.current = null;
      setAudio(i);
      setWaiting(true);
      setStart(at);
      setPos(at);
      onAudio?.(audios[i]);
      tell(`Звук: ${audioLabel(audios[i], i)}`);
    },
    [audio, audios, start, onAudio, tell], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const changeVolume = useCallback(
    (d) => {
      const v = video.current;
      v.volume = volume.current = Math.min(1, Math.max(0, +(v.volume + d).toFixed(2)));
      tell(`Громкость ${Math.round(v.volume * 100)}%`);
    },
    [tell],
  );

  // ---- Пропуск заставки и следующая серия (для сериалов) ----
  // Заставка: если в файле есть глава «Intro/Опенинг/Заставка» — пропускаем точно до её конца;
  // иначе в начале серии предлагаем прыгнуть вперёд на заданное в настройках число секунд.
  const introCh = episode
    ? (info.chapters || []).find((c) => c.start < 300 && c.end - c.start >= 15 && c.end - c.start <= 240 && INTRO_RE.test(c.title))
    : null;
  const introJump = info.introSkip || 90;
  const inIntro = !!episode && menu === null && duration > 600 && pos >= (introCh ? introCh.start : 4) && pos < (introCh ? introCh.end - 3 : 170);
  // Кнопка висит 8 секунд с момента, когда заставка началась, и исчезает, если её не нажали
  const [introGone, setIntroGone] = useState(false);
  useEffect(() => {
    if (!inIntro) {
      setIntroGone(false); // вернулись к началу — предложим снова
      return undefined;
    }
    const t = setTimeout(() => setIntroGone(true), INTRO_PILL_MS);
    return () => clearTimeout(t);
  }, [inIntro]);
  const showIntro = inIntro && !introGone;

  const skipIntro = () => {
    const t = introCh ? introCh.end : Math.min(absNow() + introJump, 400);
    target.current = t;
    setPos(t);
    wake();
    clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(applySeek, 150);
    tell('Заставка пропущена');
  };

  // Конец серии: по главе «Титры», а без неё — за 40 секунд до конца
  const creditsCh = (info.chapters || []).find((c) => c.start > duration * 0.6 && CREDITS_RE.test(c.title));
  const nextAt = creditsCh ? Math.min(creditsCh.start, duration - 20) : duration - 40;
  const remaining = duration - pos;
  const showNext = hasNext && menu === null && !showIntro && pos >= nextAt && remaining > 0.5;

  // Просмотр свёрнули (открыли меню, настройки, поиск): ставим на паузу, а при возвращении сами продолжаем, если шло воспроизведение
  const resumeAfter = useRef(false);
  useEffect(() => {
    const v = video.current;
    if (suspended) {
      resumeAfter.current = !!v && !v.paused;
      v?.pause();
      delete document.body.dataset.player; // пока свёрнуто, остальные экраны управляются как обычно
    } else {
      document.body.dataset.player = '1';
      if (resumeAfter.current) v?.play().catch(() => {});
      resumeAfter.current = false;
      wake();
    }
  }, [suspended]); // eslint-disable-line react-hooks/exhaustive-deps

  // Свежие значения для обработчиков клавиш (они подписываются один раз)
  const ctrl = useRef({});
  ctrl.current = { showIntro, skipIntro, hasNext, onNext, onMinimize, suspended };

  // Геймпад и клавиатура
  useEffect(() => {
    if (!ctrl.current.suspended) document.body.dataset.player = '1'; // свёрнутый просмотр флаг не ставит
    const act = (a) => {
      if (ctrl.current.suspended) return; // просмотр свёрнут: кнопки принадлежат меню приложения
      // Пока открыто меню озвучки, кнопки управляют только им
      if (menuRef.current !== null) {
        if (a === 'up') setMenu((m) => Math.max(0, m - 1));
        else if (a === 'down') setMenu((m) => Math.min(audios.length - 1, m + 1));
        else if (a === 'a') chooseAudio(menuRef.current);
        else if (a === 'x' || a === 'y') setMenu(null);
        return;
      }
      switch (a) {
        case 'a': return togglePause();
        // Start / Tab: свернуть просмотр и открыть меню приложения (фильм встаёт на паузу и ждёт)
        case 'start': return ctrl.current.onMinimize ? ctrl.current.onMinimize() : togglePause();
        case 'left': return seekBy(-SEEK_STEP);
        case 'right': return seekBy(SEEK_STEP);
        case 'lb': return seekBy(-SEEK_BIG);
        case 'rb': return seekBy(SEEK_BIG);
        case 'up': return changeVolume(0.1);
        case 'down': return changeVolume(-0.1);
        case 'x': return openAudioMenu();
        // Ⓨ / N: пропустить заставку, если она идёт; иначе — следующая серия, если есть
        case 'y': {
          const c = ctrl.current;
          if (c.showIntro) return c.skipIntro();
          if (c.hasNext && c.onNext) return c.onNext();
          return wake();
        }
        case 'skip': return ctrl.current.showIntro ? ctrl.current.skipIntro() : undefined;
        default:
      }
    };
    const onPad = (e) => act(e.detail);
    const onKey = (e) => {
      const byKey = { ' ': 'a', Enter: 'a', Tab: 'start', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', PageUp: 'lb', PageDown: 'rb' };
      // A — озвучка, N — следующая серия (физические клавиши: на русской раскладке это Ф и Т)
      const byCode = { KeyA: 'x', KeyN: 'y', KeyS: 'skip' };
      const action = byKey[e.key] || byCode[e.code];
      if (action) {
        e.preventDefault();
        act(action);
      }
    };
    window.addEventListener('tv:pad', onPad);
    window.addEventListener('keydown', onKey);
    return () => {
      delete document.body.dataset.player;
      window.removeEventListener('tv:pad', onPad);
      window.removeEventListener('keydown', onKey);
    };
  }, [togglePause, seekBy, changeVolume, openAudioMenu, chooseAudio, audios.length, wake]);

  useEffect(() => {
    const closeMenu = (e) => {
      if (menuRef.current === null || ctrl.current.suspended) return;
      e.stopImmediatePropagation();
      e.preventDefault?.();
      setMenu(null);
    };
    const onEsc = (e) => e.key === 'Escape' && closeMenu(e);
    // capture: наш обработчик срабатывает раньше, чем обработчик «назад» в списке фильмов
    window.addEventListener('tv:back', closeMenu, true);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      window.removeEventListener('tv:back', closeMenu, true);
      window.removeEventListener('keydown', onEsc, true);
    };
  }, []);

  useEffect(() => {
    wake();
    return () => {
      clearTimeout(osdTimer.current);
      clearTimeout(seekTimer.current);
    };
  }, [wake]);

  // Сохраняем прогресс раз в 5 секунд и при выходе
  const posRef = useRef(pos);
  posRef.current = pos;
  const report = useRef(onProgress);
  report.current = onProgress;
  useEffect(() => {
    const send = () => report.current?.(posRef.current, duration);
    const id = setInterval(send, 5000);
    return () => {
      clearInterval(id);
      send();
    };
  }, [duration]);

  // Статистика плавности: раз в 10 секунд отправляем в журнал, сколько кадров пропущено и сколько раз видео ждало данные
  const waits = useRef(0);
  const lastQ = useRef({ dropped: 0, total: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const v = video.current;
      if (!v || v.paused || !v.getVideoPlaybackQuality) return;
      const q = v.getVideoPlaybackQuality();
      const ahead = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
      window.tv.perf?.({
        dropped: Math.max(0, q.droppedVideoFrames - lastQ.current.dropped),
        total: Math.max(0, q.totalVideoFrames - lastQ.current.total),
        waits: waits.current,
        ahead,
        mode: start > 0 ? `${info.mode} (после перемотки)` : info.mode,
      });
      lastQ.current = { dropped: q.droppedVideoFrames, total: q.totalVideoFrames };
      waits.current = 0;
    }, 10000);
    return () => clearInterval(id);
  }, [info.mode, start]);

  // Раз в секунду спрашиваем у основного процесса, сколько уже скачано вперёд
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const res = await window.tv.getBuffer(posRef.current);
      if (alive && res) setNet(res);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Сбой потока посреди просмотра (оборвалось соединение, ffmpeg перезапустился): если картинка уже шла,
  // тихо подключаемся заново с текущего места, а ошибку показываем, только когда не помогло
  const retries = useRef({ n: 0, t: 0 });
  const recover = (e) => {
    console.warn('[поток] сбой:', e?.message || e);
    const v = video.current;
    const r = retries.current;
    if (Date.now() - r.t > 60_000) r.n = 0;
    if (v && v.currentTime > 1 && r.n < 4) {
      r.n += 1;
      r.t = Date.now();
      setWaiting(true);
      setStart(Math.floor(start + v.currentTime));
    } else setError('Не удалось воспроизвести этот файл');
  };

  // Поток подключаем через MediaSource (см. mse.js): сами читаем его и держим запас в пару минут.
  // При перемотке за пределы запаса или смене звука меняется start/audio — подключаем новый поток.
  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    const handle = attachStream(v, `${base}/play?start=${start}&audio=${audio}`, {
      onError: (e) => recover(e),
    });
    return () => handle.stop();
  }, [base, start, audio]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = Math.min(pos, duration);

  return (
    <div className={`player ${osd || paused || waiting ? 'osd' : ''}`}>
      <video
        ref={video}
        autoPlay
        onLoadedData={(e) => {
          e.currentTarget.volume = volume.current;
        }}
        onTimeUpdate={(e) => target.current === null && setPos(start + e.currentTarget.currentTime)}
        onWaiting={() => {
          waits.current += 1;
          setWaiting(true);
        }}
        onPlaying={() => {
          setError('');
          setWaiting(false);
          setPaused(false);
        }}
        onPause={() => setPaused(true)}
        onError={() => recover(video.current?.error)}
        onEnded={() => (ctrl.current.hasNext && ctrl.current.onNext ? ctrl.current.onNext() : window.dispatchEvent(new Event('tv:back')))}
      />

      {menu !== null && (
        <div className="amenu">
          <div className="amenu-title">Озвучка и звуковые дорожки</div>
          {audios.map((a, i) => (
            <div key={i} className={`amenu-item ${i === menu ? 'sel' : ''}`}>
              <span className="amenu-check">{i === audio ? '✓' : ''}</span>
              <span className="amenu-text">
                <b>{audioName(a, i)}</b>
                <small>{audioSub(a)}</small>
              </span>
            </div>
          ))}
          <div className="amenu-hint">▲▼ Выбор · Enter/Ⓐ Включить · Esc/Ⓑ Закрыть</div>
        </div>
      )}

      {showIntro && (
        <div className="skip timed" style={{ '--t': `${INTRO_PILL_MS}ms` }}>
          <span className="skip-in">
            <kbd>Ⓨ</kbd> Пропустить заставку <small>S</small>
          </span>
        </div>
      )}
      {showNext && (
        <div className="skip next">
          <kbd>Ⓨ</kbd> Следующая серия · через {Math.ceil(remaining)} с <small>N</small>
        </div>
      )}

      {waiting && !error && <div className="spinner" />}
      {error && <div className="perror">{error}</div>}

      <div className="hud">
        <div className="top">
          <span className="ptitle">{title}</span>
          {note && <span className="pnote">{note}</span>}
        </div>
        <div className="foot">
          {net && (
            <div className="loaded">
              <span>
                Загружено вперёд ≈ <strong>{net.toEnd ? 'до конца фильма' : net.aheadSec > 0 ? fmtAhead(net.aheadSec) : '0 с'}</strong>
              </span>
              <span>
                ↓ {(net.speed / 1e6).toFixed(1)} МБ/с · пиров {net.peers} · файл {Math.round(net.progress * 100)}%
              </span>
            </div>
          )}
          <div className="bottom">
            <span className="state">{paused ? '❚❚' : '▶'}</span>
            <span className="time">{fmt(shown)}</span>
            <div className="seek">
              {net && net.aheadSec > 0 && (
                <b
                  style={{
                    left: `${(shown / duration) * 100}%`,
                    width: `${(Math.min(net.aheadSec, duration - shown) / duration) * 100}%`,
                  }}
                />
              )}
              <i style={{ width: `${(shown / duration) * 100}%` }} />
            </div>
            <span className="time">{fmt(duration)}</span>
          </div>
          <div className="keys">Пробел/Ⓐ Пауза · ◀ ▶ ±10с · PgUp/PgDn ±1м · ▲▼ Громкость · A/Ⓧ Озвучка · {hasNext ? 'N/Ⓨ Следующая серия · ' : ''}{episode ? 'S Заставка · ' : ''}Start/Tab Меню · Esc/Ⓑ Выход</div>
        </div>
      </div>
    </div>
  );
}
