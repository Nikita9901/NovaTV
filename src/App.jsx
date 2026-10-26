import React, { useEffect, useRef, useState } from 'react';
import { move, activate } from './nav.js';
import { startGamepad } from './gamepad.js';
import Movies from './Movies.jsx';
import Settings from './Settings.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { Icon } from './icons.jsx';
import { sfx, soundsEnabled, setSounds } from './sounds.js';

const TILES = [
  { id: 'youtube', title: 'YouTube', sub: 'Видео и каналы', icon: 'play', from: '#ff5a4d', to: '#a1110c' },
  { id: 'movies', title: 'Фильмы', sub: 'Поиск и просмотр', icon: 'film', from: '#6a93ff', to: '#2b2fb0' },
  { id: 'browser', title: 'Браузер', sub: 'Скоро', icon: 'globe', from: '#34d6a3', to: '#0b6a69' },
  { id: 'settings', title: 'Настройки', sub: 'Звук, источники, плеер', icon: 'sliders', from: '#98a2bd', to: '#394058' },
  { id: 'exit', title: 'Выход', sub: 'Закрыть приложение', icon: 'power', from: '#7b8494', to: '#2b303c' },
];

const padCount = () => [...(navigator.getGamepads?.() || [])].filter(Boolean).length;

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Подключён ли геймпад (браузер сообщает о нём после первого нажатия кнопки)
function useGamepadConnected() {
  const [n, setN] = useState(padCount());
  useEffect(() => {
    const update = () => setN(padCount());
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    return () => {
      window.removeEventListener('gamepadconnected', update);
      window.removeEventListener('gamepaddisconnected', update);
    };
  }, []);
  return n > 0;
}

const greeting = (h) => (h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер');

export default function App() {
  const [screen, setScreen] = useState('home');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const now = useClock();
  const pad = useGamepadConnected();

  const say = (msg) => {
    setToast({ msg, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const trailerRef = useRef(false); // YouTube открыт ради трейлера (вернуться на экран фильма, а не на главную)

  const launch = (id) => {
    if (id === 'youtube') window.tv?.openYoutube();
    else if (id === 'exit') window.tv?.quit();
    else if (id === 'settings') setScreen('settings');
    else if (id === 'movies') setScreen('movies');
    else say('Скоро будет');
  };

  // Возвращаем фокус на плитки, когда вернулись на главную
  useEffect(() => {
    if (screen === 'home') requestAnimationFrame(() => document.querySelector('.tile')?.focus());
  }, [screen]);

  useEffect(() => {
    const stopPad = startGamepad((a) => {
      if (a === 'b') window.dispatchEvent(new Event('tv:back'));
      else if (document.body.dataset.player) window.dispatchEvent(new CustomEvent('tv:pad', { detail: a }));
      else if (a === 'a') activate();
      else if (['up', 'down', 'left', 'right'].includes(a)) move(a);
      else window.dispatchEvent(new CustomEvent('tv:pad', { detail: a })); // X / Y / LB / RB — для экранов
    });

    const onKey = (e) => {
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
      if ((dir === 'left' || dir === 'right') && e.target.tagName === 'INPUT') return;
      if (dir && !document.body.dataset.player) {
        e.preventDefault();
        move(dir);
      }
    };
    window.addEventListener('keydown', onKey);

    // Звук нажатия на любой выбираемый элемент — одним обработчиком (Enter, пробел, геймпад, мышь)
    const onClick = (e) => {
      const el = e.target.closest?.('[data-focusable]');
      if (el) (el.dataset.key !== undefined ? sfx.key : sfx.select)();
    };
    document.addEventListener('click', onClick, true);

    // F8 — звуки вкл/выкл
    const onSound = (e) => {
      if (e.key !== 'F8') return;
      const on = !soundsEnabled();
      setSounds(on);
      setToast({ msg: on ? 'Звуки включены' : 'Звуки выключены', id: Date.now() });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2200);
    };
    window.addEventListener('keydown', onSound);

    // Возврат из YouTube на главную
    // Если YouTube открыт ради трейлера из «Фильмов», по закрытию остаёмся на странице фильма, а не уходим на главную
    const offHome = window.tv?.onHome(() => {
      if (trailerRef.current) trailerRef.current = false;
      else setScreen('home');
    });

    return () => {
      stopPad();
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onSound);
      offHome?.();
    };
  }, []);

  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <div className="ambient" />
      <main className="app">
        <ErrorBoundary resetKey={screen} onReset={() => setScreen('home')}>
        {screen === 'movies' ? (
          <div className="screen-wrap" key="movies">
            <Movies
              onBack={() => setScreen('home')}
              onSettings={() => setScreen('settings')}
              onTrailer={(url) => {
                trailerRef.current = true;
                window.tv?.openYoutube(url);
              }}
              say={say}
            />
          </div>
        ) : screen === 'settings' ? (
          <div className="screen-wrap" key="settings">
            <Settings onBack={() => setScreen('home')} say={say} />
          </div>
        ) : (
          <div className="home screen-wrap" key="home">
            <header className="home-head">
              <div className="hello">
                <div className="clock">{time}</div>
                <div className="date">
                  {greeting(now.getHours())} · {date}
                </div>
              </div>
              <div className={`chip ${pad ? 'on' : ''}`}>
                <Icon name="gamepad" />
                {pad ? 'Геймпад подключён' : 'Нажмите кнопку на геймпаде'}
              </div>
            </header>

            <section className="tiles">
              {TILES.map((t, i) => (
                <button
                  key={t.id}
                  data-focusable
                  className="tile"
                  style={{ '--from': t.from, '--to': t.to, '--i': i }}
                  onClick={() => launch(t.id)}
                >
                  <span className="tile-art">
                    <Icon name={t.icon} />
                  </span>
                  <span className="tile-text">
                    <span className="title">{t.title}</span>
                    <span className="sub">{t.sub}</span>
                  </span>
                </button>
              ))}
            </section>

            <footer className="hints">
              <span><kbd>Ⓐ</kbd> Выбрать</span>
              <span><kbd>Ⓑ</kbd> Назад</span>
              <span><kbd>Start</kbd> На главную</span>
              <span><kbd>F11</kbd> Окно / полный экран</span>
              <span><kbd>F8</kbd> Звуки</span>
            </footer>
          </div>
        )}

        {toast && (
          <div className="toast" key={toast.id}>
            {toast.msg}
          </div>
        )}
        </ErrorBoundary>
      </main>
    </>
  );
}
