import React, { useEffect, useRef, useState } from 'react';
import { move, activate } from './nav.js';
import { startGamepad } from './gamepad.js';
import Movies from './Movies.jsx';
import Settings from './Settings.jsx';
import Setup from './Setup.jsx';
import Browser from './Browser.jsx';
import Home from './Home.jsx';
import UpdatePrompt from './UpdatePrompt.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { Icon } from './icons.jsx';
import { sfx, soundsEnabled, setSounds } from './sounds.js';
import { startRemote } from './remote.js';


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

  // Первый запуск: мастер настройки
  useEffect(() => {
    window.tv?.getSettings?.()?.then((r) => r?.ok && r.data.setupDone === false && setScreen('setup')).catch(() => {});
  }, []);

  // Новая версия: при запуске спрашиваем, ставить ли. «Пропустить» запоминает версию, «Позже» — до следующего запуска.
  // Просмотр можно свернуть (Start в плеере): меню, настройки и поиск доступны, а на паузе стоит фильм
  const [playback, setPlayback] = useState(null); // название идущего просмотра или null
  const playbackRef = useRef(null);
  playbackRef.current = playback;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [update, setUpdate] = useState(null); // открытое окно «Доступна новая версия»
  const [updateAvail, setUpdateAvail] = useState(null); // доступное обновление (для значка на главной)
  useEffect(() => {
    window.tv?.about?.checkUpdate().then((r) => {
      if (!r?.ok || !r.data.newer) return;
      setUpdateAvail(r.data);
      if (localStorage.getItem('update-skip') === r.data.latest) return;
      setUpdate(r.data);
    });
    // из «Настройки → О приложении» окно открывается и по требованию
    const show = (e) => setUpdate(e.detail);
    window.addEventListener('tv:show-update', show);
    return () => window.removeEventListener('tv:show-update', show);
  }, []);

  const trailerRef = useRef(false); // YouTube открыт ради трейлера (вернуться на экран фильма, а не на главную)

  // Открыть фильм из баннера или подборки на главной: action 'resume' сразу продолжает, 'open' показывает страницу
  const [intent, setIntent] = useState(null);
  const openMovie = (movie, action) => {
    if (!playbackRef.current) setIntent({ movie, action });
    setScreen('movies'); // если просмотр уже идёт, возвращаем к нему
  };

  const launch = (id) => {
    if (id === 'youtube') window.tv?.openYoutube();
    else if (id === 'exit') window.tv?.quit();
    else if (id === 'settings') setScreen('settings');
    else if (id === 'movies') setScreen('movies');
    else if (id === 'browser') setScreen('browser');
    else say('Скоро будет');
  };

  // Возвращаем фокус на плитки, когда вернулись на главную
  useEffect(() => {
    if (screen === 'home') setTimeout(() => (document.querySelector('.home2 [data-autofocus]') || document.querySelector('.h2-tile'))?.focus(), 120);
  }, [screen]);

  useEffect(() => {
    // Одни и те же действия приходят от геймпада и от телефона-пульта
    const onAction = (a) => {
      if (a === 'b') window.dispatchEvent(new Event('tv:back'));
      else if (a === 'home') {
        // кнопка «домой» на телефоне: в плеере сворачивает просмотр, иначе открывает главную
        if (document.body.dataset.player) window.dispatchEvent(new CustomEvent('tv:pad', { detail: 'start' }));
        else setScreen('home');
      } else if (a === 'start' && playbackRef.current && screenRef.current !== 'movies') setScreen('movies'); // Start вне плеера: вернуться к фильму
      else if (document.body.dataset.player || document.body.dataset.picker) window.dispatchEvent(new CustomEvent('tv:pad', { detail: a }));
      else if (a === 'a') activate();
      else if (['up', 'down', 'left', 'right'].includes(a)) move(a);
      else window.dispatchEvent(new CustomEvent('tv:pad', { detail: a })); // X / Y / LB / RB — для экранов
    };
    const stopPad = startGamepad(onAction);
    const stopRemote = window.tv?.remote ? startRemote({ onKey: onAction }) : () => {};

    const onKey = (e) => {
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
      if ((dir === 'left' || dir === 'right') && e.target.tagName === 'INPUT') return;
      if (dir && !document.body.dataset.player && !document.body.dataset.picker) {
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
      stopRemote();
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
      <main className="app" inert={!!update || undefined}>
        <ErrorBoundary resetKey={screen} onReset={() => setScreen('home')}>
        {screen === 'movies' ? null : screen === 'setup' ? (
          <div className="screen-wrap" key="setup">
            <Setup onDone={() => setScreen('home')} say={say} />
          </div>
        ) : screen === 'browser' ? (
          <div className="screen-wrap" key="browser">
            <Browser onBack={() => setScreen('home')} say={say} />
          </div>
        ) : screen === 'settings' ? (
          <div className="screen-wrap" key="settings">
            <Settings onBack={() => setScreen('home')} say={say} />
          </div>
        ) : (
          <div className="screen-wrap" key="home">
            <Home
              time={time}
              date={date}
              greeting={greeting(now.getHours())}
              pad={pad}
              update={updateAvail}
              onUpdate={() => updateAvail && setUpdate(updateAvail)}
              onLaunch={launch}
              onOpenMovie={openMovie}
            />
          </div>
        )}

        {(screen === 'movies' || playback) && (
          <div className="screen-wrap" key="movies" hidden={screen !== 'movies'} inert={screen !== 'movies' || undefined}>
            <Movies
              active={screen === 'movies'}
              onBack={() => setScreen('home')}
              onSettings={() => setScreen('settings')}
              onTrailer={(url) => {
                trailerRef.current = true;
                window.tv?.openYoutube(url);
              }}
              intent={intent}
              onIntentHandled={() => setIntent(null)}
              onPlayback={setPlayback}
              onMinimize={() => setScreen('home')}
              say={say}
            />
          </div>
        )}

        {playback && screen !== 'movies' && (
          <button data-focusable className="resume-pill" onClick={() => setScreen('movies')}>
            <Icon name="play" />
            <span>
              Вернуться к фильму <b>{playback}</b>
            </span>
            <kbd>Start</kbd>
          </button>
        )}

        {toast && (
          <div className="toast" key={toast.id}>
            {toast.msg}
          </div>
        )}
        </ErrorBoundary>
      </main>
      {update && (
        <UpdatePrompt
          info={update}
          onClose={() => {
            setUpdate(null);
            setTimeout(() => document.querySelector('.screen-wrap:not([hidden]) [data-autofocus]')?.focus(), 80); // фокус возвращается на экран под окном
          }}
          onSkip={() => {
            localStorage.setItem('update-skip', update.latest);
            setUpdate(null);
            setTimeout(() => document.querySelector('.screen-wrap:not([hidden]) [data-autofocus]')?.focus(), 80);
          }}
        />
      )}
    </>
  );
}
