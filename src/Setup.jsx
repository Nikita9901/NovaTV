import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

// Мастер первого запуска: автоматическая настройка или ручная
export default function Setup({ onDone, say }) {
  const [step, setStep] = useState('welcome'); // welcome | key | work | done
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, text: 'Начинаем…' });
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    window.tv.getSettings().then((r) => r.ok && setHasKey(!!r.data.kinopoiskToken));
    const off = window.tv.prowlarr.onProgress((p) => p && setProgress(p));
    return off;
  }, []);

  // фокус на первую кнопку каждого шага
  useEffect(() => {
    requestAnimationFrame(() => (step === 'key' ? inputRef.current : document.querySelector('.setup [data-autofocus]'))?.focus());
  }, [step, error, results]);

  const finish = async () => {
    await window.tv.setSettings({ setupDone: true });
    onDone();
  };

  const manual = async () => {
    await window.tv.setSettings({ setupDone: true });
    onDone();
  };

  const run = async () => {
    setStep('work');
    setError('');
    setResults(null);
    setProgress({ pct: 0, text: 'Начинаем…' });
    const r = await window.tv.prowlarr.autosetup();
    if (r.ok) {
      setResults(r.data);
      setStep('done');
    } else setError(r.error || 'Не удалось настроить');
  };

  const next = async () => {
    if (key.trim()) {
      const r = await window.tv.setSettings({ kinopoiskToken: key.trim() });
      if (!r.ok) say?.('Не удалось сохранить ключ');
    }
    run();
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setKey(text);
      else say?.('Буфер обмена пуст');
    } catch {
      say?.('Не удалось прочитать буфер обмена');
    }
  };

  const okCount = results?.filter((x) => x.ok).length || 0;

  return (
    <div className="screen setup enter">
      <div className="setup-card">
        <div className="setup-logo">
          <Icon name="play" />
        </div>

        {step === 'welcome' && (
          <>
            <h1>Добро пожаловать в Nova TV</h1>
            <p className="setup-sub">Как настроить приложение?</p>
            <div className="setup-choices">
              <button data-focusable data-autofocus className="choice-card primary" onClick={() => (hasKey ? run() : setStep('key'))}>
                <b>Автоматически</b>
                <small>Рекомендуется. Приложение само скачает и настроит поиск раздач и добавит трекеры (RuTor, NoNaMe Club и другие). Понадобится только бесплатный ключ поиска фильмов.</small>
              </button>
              <button data-focusable className="choice-card" onClick={manual}>
                <b>Настрою сам</b>
                <small>Все параметры можно задать в «Настройки»: ключи, свой Prowlarr, трекеры, папка загрузок.</small>
              </button>
            </div>
          </>
        )}

        {step === 'key' && (
          <>
            <h1>Ключ поиска фильмов</h1>
            <p className="setup-sub">
              Поиск и карточки фильмов работают через сервис <b>poiskkino.dev</b>. Ключ там бесплатный, но получить его можно только лично:
              зарегистрируйтесь на сайте и скопируйте ключ.
            </p>
            <input
              ref={inputRef}
              data-focusable
              className="field"
              type="text"
              value={key}
              placeholder="Вставьте или наберите ключ"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && next()}
            />
            <div className="modal-actions">
              <button data-focusable className="btn primary" disabled={!key.trim()} onClick={next}>
                Дальше
              </button>
              <button data-focusable className="btn" onClick={paste}>
                Вставить из буфера
              </button>
              <button data-focusable className="btn ghost" onClick={run}>
                Пропустить, добавлю позже
              </button>
            </div>
          </>
        )}

        {step === 'work' && !error && (
          <>
            <h1>Настраиваем…</h1>
            <p className="setup-sub">{progress.text}</p>
            <div className="diskbar big">
              <i style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="hint small">Первый раз нужно скачать Prowlarr (около 130 МБ). Это займёт несколько минут, окно закрывать не нужно</p>
          </>
        )}

        {step === 'work' && error && (
          <>
            <h1>Не получилось</h1>
            <p className="setup-sub warn">{error}</p>
            <div className="modal-actions">
              <button data-focusable data-autofocus className="btn primary" onClick={run}>
                Повторить
              </button>
              <button data-focusable className="btn ghost" onClick={finish}>
                Пропустить, настрою потом
              </button>
            </div>
          </>
        )}

        {step === 'done' && results && (
          <>
            <h1>Готово</h1>
            <p className="setup-sub">
              Трекеров добавлено: {okCount} из {results.length}
            </p>
            <ul className="setup-list">
              {results.map((x) => (
                <li key={x.name} className={x.ok ? 'ok' : 'bad'}>
                  <span>{x.ok ? '✓' : '✕'}</span> {x.name}
                  {!x.ok && <small> {x.error}</small>}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button data-focusable data-autofocus className="btn primary" onClick={finish}>
                Начать
              </button>
            </div>
            <p className="hint small">Остальные трекеры можно добавить в «Настройки → Источники раздач»</p>
          </>
        )}
      </div>
    </div>
  );
}
