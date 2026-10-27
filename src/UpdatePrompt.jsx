import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

// Уведомление о новой версии: спросить → скачать → установить и перезапустить
export default function UpdatePrompt({ info, onClose, onSkip }) {
  const [step, setStep] = useState('ask'); // ask | download | ready | saved | error
  const [progress, setProgress] = useState({ pct: 0, text: 'Начинаем…' });
  const [error, setError] = useState('');
  const [silent, setSilent] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => window.tv.about.onUpdateProgress((p) => p && setProgress(p)), []);

  // фокус на главную кнопку каждого шага
  useEffect(() => {
    requestAnimationFrame(() => document.querySelector('.upd [data-autofocus]')?.focus());
  }, [step]);

  // Ⓑ / Esc — «Позже» (пока идёт скачивание, закрыть нельзя)
  useEffect(() => {
    const back = () => stepRef.current !== 'download' && onClose();
    const onKey = (e) => e.key === 'Escape' && back();
    window.addEventListener('tv:back', back);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tv:back', back);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const download = async () => {
    setStep('download');
    setError('');
    setProgress({ pct: 0, text: 'Начинаем…' });
    const r = await window.tv.about.downloadUpdate();
    if (!r.ok) {
      setError(r.error || 'Не удалось скачать');
      return setStep('error');
    }
    setSilent(!!r.data.silent);
    setStep(r.data.silent ? 'ready' : 'saved');
  };

  const apply = async () => {
    const r = await window.tv.about.applyUpdate();
    if (!r.ok) {
      setError(r.error || 'Не удалось установить');
      setStep('error');
    } else if (r.data.mode === 'installing') setProgress({ pct: 100, text: 'Устанавливаем и перезапускаем…' });
  };

  const notes = String(info.notes || '')
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className="upd-backdrop">
      <div className="upd">
        <div className="upd-ico">
          <Icon name="download" />
        </div>

        {step === 'ask' && (
          <>
            <h2>Доступна новая версия</h2>
            <p className="upd-ver">
              Nova TV {info.latest} <small>(у вас {info.current})</small>
            </p>
            {notes.length > 0 && (
              <ul className="upd-notes">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              {info.canDownload ? (
                <button data-focusable data-autofocus className="btn primary" onClick={download}>
                  Установить сейчас
                </button>
              ) : (
                <button
                  data-focusable
                  data-autofocus
                  className="btn primary"
                  onClick={() => {
                    window.tv.about.openRelease(info.url);
                    onClose();
                  }}
                >
                  Открыть страницу загрузки
                </button>
              )}
              <button data-focusable className="btn" onClick={onClose}>
                Позже
              </button>
              <button data-focusable className="btn ghost" onClick={onSkip}>
                Пропустить эту версию
              </button>
            </div>
          </>
        )}

        {step === 'download' && (
          <>
            <h2>Скачиваем обновление</h2>
            <p className="upd-ver">{progress.text}</p>
            <div className="diskbar big">
              <i style={{ width: `${progress.pct}%` }} />
            </div>
            <p className="hint small">Окно закрывать не нужно</p>
          </>
        )}

        {step === 'ready' && (
          <>
            <h2>Обновление готово</h2>
            <p className="upd-ver">
              Приложение закроется, поставит версию {info.latest} и запустится снова. Это займёт меньше минуты.
              {progress.pct === 100 && progress.text.startsWith('Устанавливаем') && <small> {progress.text}</small>}
            </p>
            <div className="modal-actions">
              <button data-focusable data-autofocus className="btn primary" onClick={apply}>
                Перезапустить и установить
              </button>
              <button data-focusable className="btn ghost" onClick={onClose}>
                Позже
              </button>
            </div>
          </>
        )}

        {step === 'saved' && (
          <>
            <h2>Файл скачан</h2>
            <p className="upd-ver">В этой версии приложения нельзя заменить себя на ходу. Файл сохранён в «Загрузки»: запустите его, чтобы обновить.</p>
            <div className="modal-actions">
              <button data-focusable data-autofocus className="btn primary" onClick={apply}>
                Показать файл
              </button>
              <button data-focusable className="btn ghost" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <h2>Не получилось обновить</h2>
            <p className="upd-ver warn">{error}</p>
            <div className="modal-actions">
              <button data-focusable data-autofocus className="btn primary" onClick={download}>
                Повторить
              </button>
              <button
                data-focusable
                className="btn"
                onClick={() => {
                  window.tv.about.openRelease(info.url);
                  onClose();
                }}
              >
                Открыть страницу загрузки
              </button>
              <button data-focusable className="btn ghost" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
