import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { sfx, soundsEnabled, setSounds, getVolume, setVolume } from './sounds.js';
import { motionOn, setMotion } from './prefs.js';
import Sources from './Sources.jsx';

// Кино снимают в 23,976 кадра/с: ровно оно идёт на частотах, кратных 24 (24, 48, 72, 120, 144, 240 Гц)
const smoothFor24 = (hz) => {
  const k = Math.round(hz / 24);
  return k >= 1 && Math.abs(hz - k * 23.976) < 1.5 && hz !== 60;
};

const fmtGB = (b) => `${(b / 1e9).toFixed(1).replace('.', ',')} ГБ`;

// Секретные значения показываем сокращённо: •••• и последние 4 символа
const mask = (v) => (v ? `••••••${v.slice(-4)}` : 'не задан');

const VOLUMES = [
  { v: 0.45, label: 'Тихо' },
  { v: 0.9, label: 'Обычно' },
  { v: 1.6, label: 'Громко' },
];
const AUDIO = [
  { v: 'rus', label: 'Русская' },
  { v: 'eng', label: 'English' },
  { v: '', label: 'Первая в файле' },
];
const QUALITIES = [
  { v: '720P', label: '720p' },
  { v: '1080P', label: '1080p' },
  { v: '2160P', label: '4K' },
];
const TRANSLATIONS = [
  { v: 'rus', label: 'Русский' },
  { v: 'orig', label: 'Оригинал' },
];
const INTRO_SKIPS = [
  { v: 60, label: '60 с' },
  { v: 90, label: '90 с' },
  { v: 120, label: '120 с' },
];
const REGIONS = [
  { v: 'all', label: 'Мировые оценки' },
  { v: 'foreign', label: 'Без российских' },
];
const HEIGHTS = [
  { v: 720, label: '720p' },
  { v: 1080, label: '1080p' },
  { v: 1440, label: '1440p' },
  { v: 2160, label: '4K' },
];

// ---------- Строительные блоки ----------

function Switch({ title, sub, on, onChange }) {
  return (
    <button data-focusable className="srow" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="stext">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      <span className={`switch ${on ? 'on' : ''}`}>
        <i />
      </span>
    </button>
  );
}

function Choice({ title, sub, value, options, onChange }) {
  return (
    <div className="srow choice">
      <span className="stext">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      <span className="opts">
        {options.map((o) => (
          <button key={o.label} data-focusable className={`opt ${o.v === value ? 'on' : ''}`} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function Action({ title, sub, value, icon, danger, onClick }) {
  return (
    <button data-focusable className={`srow ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span className="stext">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      <span className="sval">
        {value}
        {icon && <Icon name={icon} />}
      </span>
    </button>
  );
}

export default function Settings({ onBack, say }) {
  const [s, setS] = useState(null); // настройки из settings.json
  const [disk, setDisk] = useState(null);
  const [edit, setEdit] = useState(null); // { key, label, secret }
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remote, setRemote] = useState(null); // состояние сервера для телефона-пульта
  const [about, setAbout] = useState(null);
  const [update, setUpdate] = useState(null); // результат проверки обновлений
  const [checking, setChecking] = useState(false);
  const [sub, setSub] = useState(null); // открыт вложенный раздел («Источники раздач»)
  const subRef = useRef(null);
  subRef.current = sub;
  const [confirm, setConfirm] = useState(''); // какое действие ждёт подтверждения
  const [, redraw] = useState(0); // настройки из localStorage меняются вне React
  const confirmTimer = useRef();
  const inputRef = useRef(null);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Если основной процесс запущен до обновления, getSettings в нём ещё нет — покажем подсказку, а не пустой экран
    const load = window.tv.getSettings ? window.tv.getSettings() : Promise.resolve({ ok: false });
    load.then((r) => (r.ok ? setS(r.data) : setFailed(true))).catch(() => setFailed(true));
    requestAnimationFrame(() => document.querySelector('[data-focusable]')?.focus());
  }, []);

  useEffect(() => {
    if (s) window.tv.diskInfo(s.downloadDir).then((r) => r.ok && setDisk(r.data));
  }, [s?.downloadDir]);

  useEffect(() => {
    window.tv.about?.info().then(setAbout);
    const load = () => window.tv.remote?.status().then((r) => r.ok && setRemote(r.data));
    load();
    return window.tv.remote?.onChanged(load);
  }, []);

  // Частота обновления экрана — от неё зависит плавность кино (24 кадра/с)
  const [display, setDisplay] = useState(null);
  useEffect(() => {
    window.tv.getDisplay?.().then((r) => r?.ok && setDisplay(r.data));
  }, []);

  const save = async (patch, note) => {
    const r = await window.tv.setSettings(patch);
    if (r.ok) {
      setS(r.data);
      if (note) say(note);
    } else say('Не удалось сохранить');
  };

  // Назад: закрыть редактор, если он открыт, иначе выйти на главную
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(() => {
    const back = () => (subRef.current ? null : editRef.current ? setEdit(null) : onBack());
    const onKey = (e) => e.key === 'Escape' && back();
    window.addEventListener('tv:back', back);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tv:back', back);
      window.removeEventListener('keydown', onKey);
    };
  }, [onBack]);

  // ---- редактор текстового значения ----
  const openEdit = (key, label, secret) => {
    setDraft(s[key] || '');
    setReveal(!secret);
    setEdit({ key, label, secret });
    setTimeout(() => inputRef.current?.focus(), 60);
  };
  const commitEdit = async () => {
    await save({ [edit.key]: draft }, 'Сохранено');
    setEdit(null);
    requestAnimationFrame(() => document.querySelector('.srow')?.focus());
  };
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setDraft(text);
      else say('Буфер обмена пуст');
    } catch {
      say('Не удалось прочитать буфер обмена');
    }
  };

  // Опасные действия — с подтверждением повторным нажатием
  const confirmed = (id, run) => () => {
    if (confirm === id) {
      clearTimeout(confirmTimer.current);
      setConfirm('');
      run();
    } else {
      setConfirm(id);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirm(''), 4000);
    }
  };

  if (!s) {
    return (
      <div className="screen settings enter">
        <div className="empty big">
          <Icon name="sliders" />
          <p>{failed ? 'Не удалось загрузить настройки' : 'Загружаем…'}</p>
          {failed && <small>Закройте приложение полностью и запустите его заново (npm run dev)</small>}
        </div>
      </div>
    );
  }

  if (sub === 'sources') {
    return (
      <Sources
        say={say}
        onClose={() => {
          setSub(null);
          window.tv.getSettings().then((r) => r.ok && setS(r.data));
          requestAnimationFrame(() => document.querySelector('.set-list [data-focusable]')?.focus());
        }}
      />
    );
  }

  const usedPct = disk ? Math.round(((disk.total - disk.free) / disk.total) * 100) : 0;

  return (
    <div className="screen settings enter">
      <div className="set-head">
        <div className="m-title">
          <Icon name="sliders" />
          Настройки
        </div>
        <span className="hint small">
          <kbd>Ⓑ</kbd> Назад
        </span>
      </div>

      <div className="set-list" inert={!!edit}>
        <section className="set-group">
          <h3>Интерфейс</h3>
          <Switch
            title="Звуки интерфейса"
            sub="Тихие сигналы при перемещении, выборе и вводе (F8 — быстро включить и выключить)"
            on={soundsEnabled()}
            onChange={(on) => {
              setSounds(on);
              redraw((n) => n + 1);
            }}
          />
          <Choice
            title="Громкость звуков"
            value={getVolume()}
            options={VOLUMES}
            onChange={(v) => {
              setVolume(v);
              redraw((n) => n + 1);
            }}
          />
          <Switch
            title="Анимации"
            sub="Плавные переходы и эффекты. Выключите, если интерфейс тормозит"
            on={motionOn()}
            onChange={(on) => {
              setMotion(on);
              redraw((n) => n + 1);
            }}
          />
        </section>

        <section className="set-group">
          <h3>Воспроизведение</h3>
          <Switch
            title="Кнопка «Смотреть» выбирает раздачу сама"
            sub="Подбирает лучшую раздачу по качеству, переводу и числу сидов. Выключите — всегда будет список"
            on={s.autoPick !== false}
            onChange={(on) => save({ autoPick: on })}
          />
          <Choice
            title="Желаемое качество"
            sub="Для автоподбора: ближайшее к выбранному, если точного нет"
            value={s.preferQuality}
            options={QUALITIES}
            onChange={(v) => save({ preferQuality: v })}
          />
          <Choice
            title="Желаемый перевод"
            sub="Русский — дубляж или озвучка; оригинал — без русского звука в приоритете"
            value={s.preferAudio}
            options={TRANSLATIONS}
            onChange={(v) => save({ preferAudio: v })}
          />
          <Choice
            title="Пропуск заставки"
            sub="Если в файле нет глав «Заставка/Intro», кнопка «Пропустить» прыгает вперёд на это время"
            value={s.introSkip || 90}
            options={INTRO_SKIPS}
            onChange={(v) => save({ introSkip: v })}
          />
          <Choice
            title="Звуковая дорожка по умолчанию"
            sub="Если такой дорожки в раздаче нет, берётся первая"
            value={s.audioLang}
            options={AUDIO}
            onChange={(v) => save({ audioLang: v })}
          />
          <Choice
            title="Максимальное разрешение при перекодировании"
            sub="Влияет на нагрузку на процессор при перемотке и для 4K / HEVC"
            value={s.maxHeight}
            options={HEIGHTS}
            onChange={(v) => save({ maxHeight: v })}
          />
          {display && display.hz > 0 && (
            <div className={`srow info ${smoothFor24(display.hz) ? '' : 'warn'}`}>
              <span className="stext">
                <b>Частота обновления экрана</b>
                <small>
                  {smoothFor24(display.hz)
                    ? 'Кино (24 кадра/с) идёт ровно: частота кратна 24.'
                    : 'Кино (24 кадра/с) на такой частоте идёт с лёгкими рывками при движении камеры. Лучше 120, 144 или 240 Гц: Windows → Дисплей → Дополнительные параметры дисплея → Частота обновления.'}
                </small>
              </span>
              <span className="sval">
                {display.hz} Гц · {display.width}×{display.height}
              </span>
            </div>
          )}
          <Switch
            title="Приводить HDR к обычной яркости"
            sub="Без этого HDR-фильмы выглядят тёмными и блёклыми"
            on={s.hdrToneMap}
            onChange={(on) => save({ hdrToneMap: on })}
          />
        </section>

        <section className="set-group">
          <h3>Поиск и источники</h3>
          <Choice
            title="Рекомендации и новинки"
            sub="Подбор по международным оценкам (IMDb): российское попадает, только если его высоко оценили во всём мире"
            value={s.discoverRegion === 'foreign' ? 'foreign' : 'all'}
            options={REGIONS}
            onChange={(v) => save({ discoverRegion: v })}
          />
          <Action
            title="Ключ поиска фильмов"
            sub="Нужен для поиска и карточек фильмов"
            value={mask(s.kinopoiskToken)}
            icon="back"
            onClick={() => openEdit('kinopoiskToken', 'Ключ поиска фильмов', true)}
          />
          <Action
            title="Источники раздач (Prowlarr)"
            sub="Встроенный Prowlarr, трекеры, логины: всё настраивается здесь"
            value={s.prowlarrBuiltin ? 'Встроенный' : 'Свой'}
            icon="back"
            onClick={() => setSub('sources')}
          />
          <Action
            title="Адрес своего Prowlarr"
            sub="Откуда берутся раздачи, обычно http://127.0.0.1:9696"
            value={s.prowlarrUrl || 'не задан'}
            icon="back"
            onClick={() => openEdit('prowlarrUrl', 'Адрес Prowlarr', false)}
          />
          <Action
            title="Ключ своего Prowlarr"
            sub="Prowlarr → Settings → General → API Key"
            value={mask(s.prowlarrKey)}
            icon="back"
            onClick={() => openEdit('prowlarrKey', 'Ключ Prowlarr', true)}
          />
        </section>

        <section className="set-group">
          <h3>Телефон-пульт</h3>
          <Switch
            title="Управление с телефона (Nova TV Remote)"
            sub="Телефон работает как указка и пульт: наклон двигает курсор. Нужны телефон и компьютер в одной сети Wi-Fi"
            on={!!s.remoteEnabled}
            onChange={async (on) => {
              const r = await window.tv.remote.enable(on);
              if (r.ok) {
                setRemote(r.data);
                setS((cur) => ({ ...cur, remoteEnabled: on }));
              } else say(r.error || 'Не удалось');
            }}
          />
          {s.remoteEnabled && remote && (
            <>
              <div className="srow info">
                <span className="stext">
                  <b>Код для подключения нового телефона</b>
                  <small>
                    В приложении Nova TV Remote выберите этот компьютер ({remote.host}) и введите код. Если компьютер не нашёлся, введите адрес:{' '}
                    {remote.addresses.length ? remote.addresses.map((a) => `${a}:${remote.port}`).join(' или ') : 'не удалось определить'}
                  </small>
                </span>
                <span className="sval pin">{remote.pin.replace(/(\d{3})(\d{3})/, '$1 $2')}</span>
              </div>
              {remote.devices.length === 0 && <p className="hint">Телефонов пока нет. Windows при первом включении спросит про доступ к сети: разрешите для частных сетей</p>}
              {remote.devices.map((d) => (
                <Action
                  key={d.id}
                  title={d.name}
                  sub={d.online ? 'Подключён сейчас' : 'Был подключён'}
                  value={confirm === `rm${d.id}` ? 'Нажмите ещё раз' : 'Забыть'}
                  icon="trash"
                  danger={confirm === `rm${d.id}`}
                  onClick={confirmed(`rm${d.id}`, async () => {
                    const r = await window.tv.remote.forget(d.id);
                    if (r.ok) setRemote(r.data);
                  })}
                />
              ))}
            </>
          )}
        </section>

        <section className="set-group">
          <h3>Хранилище</h3>
          <div className="srow disk">
            <span className="stext">
              <b>Папка загрузок</b>
              <small>{s.downloadDir || 'Папка по умолчанию (на системном диске может не хватить места)'}</small>
              {disk && (
                <span className="diskbar">
                  <i style={{ width: `${usedPct}%` }} />
                </span>
              )}
              {disk && (
                <small>
                  Свободно {fmtGB(disk.free)} из {fmtGB(disk.total)}
                </small>
              )}
            </span>
            <span className="opts">
              <button
                data-focusable
                className="opt"
                onClick={async () => {
                  const r = await window.tv.pickDir();
                  if (r.ok && r.data) save({ downloadDir: r.data }, 'Папка изменена');
                }}
              >
                Выбрать…
              </button>
              {s.downloadDir && (
                <button data-focusable className="opt" onClick={() => save({ downloadDir: '' }, 'Сброшено')}>
                  Сбросить
                </button>
              )}
            </span>
          </div>
          <Action
            title="Очистить кэш загрузок"
            sub="Удаляет недокачанные файлы просмотренных фильмов"
            value={confirm === 'cache' ? 'Нажмите ещё раз' : ''}
            icon="trash"
            danger={confirm === 'cache'}
            onClick={confirmed('cache', async () => {
              const r = await window.tv.clearCache();
              say(r.ok ? 'Кэш очищен' : 'Не удалось очистить кэш');
            })}
          />
        </section>

        <section className="set-group">
          <h3>Аккаунты</h3>
          <Action
            title="Выйти из аккаунта YouTube"
            sub="Войти снова можно в самом YouTube"
            value={confirm === 'yt' ? 'Нажмите ещё раз' : ''}
            icon="trash"
            danger={confirm === 'yt'}
            onClick={confirmed('yt', async () => {
              const r = await window.tv.signOutYoutube();
              say(r.ok ? 'Вы вышли из YouTube' : 'Не удалось выйти');
            })}
          />
        </section>

        <section className="set-group">
          <h3>О приложении</h3>
          <div className="srow info">
            <span className="stext">
              <b>Nova TV</b>
              <small>{update?.newer ? `Доступна новая версия ${update.latest}` : update ? 'Установлена последняя версия' : 'Версия приложения'}</small>
            </span>
            <span className="sval">{about?.version || '…'}</span>
          </div>
          <Action
            title={update?.newer ? `Скачать версию ${update.latest}` : 'Проверить обновления'}
            sub={update?.newer ? 'Откроется страница релиза на GitHub: выберите установщик или portable-файл' : 'Сравнивает с последним релизом на GitHub'}
            value={checking ? 'Проверяем…' : ''}
            icon={update?.newer ? 'download' : 'back'}
            onClick={async () => {
              if (update?.newer) return window.tv.about.openRelease(update.url);
              setChecking(true);
              const r = await window.tv.about.checkUpdate();
              setChecking(false);
              if (!r.ok) return say(`Не удалось проверить: ${r.error}`);
              setUpdate(r.data);
              say(r.data.newer ? `Доступна версия ${r.data.latest}` : r.data.latest ? 'У вас последняя версия' : 'Релизов пока нет');
            }}
          />
          <Action
            title="Скопировать отчёт об ошибке"
            sub="Версия, система и последние строки журнала: вставьте в сообщение, когда что-то сломалось"
            icon="back"
            onClick={async () => {
              const r = await window.tv.about.report();
              if (!r.ok) return say('Не удалось собрать отчёт');
              try {
                await navigator.clipboard.writeText(r.data);
                say('Отчёт скопирован в буфер обмена');
              } catch {
                say('Не удалось скопировать');
              }
            }}
          />
          <Action
            title="Открыть папку с журналами"
            sub="Файл app.log со всеми событиями и ошибками"
            icon="back"
            onClick={async () => {
              const r = await window.tv.about.openLogs();
              if (!r.ok) say('Не удалось открыть папку');
            }}
          />
        </section>

        <section className="set-group">
          <h3>Для опытных</h3>
          <Action title="Открыть файл settings.json" sub="Все значения в текстовом виде" icon="back" onClick={() => window.tv.openSettings()} />
        </section>
      </div>

      {edit && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setEdit(null)}>
          <div className="modal-card">
            <h3>{edit.label}</h3>
            <input
              ref={inputRef}
              data-focusable
              className="field"
              type={reveal ? 'text' : 'password'}
              value={draft}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
            />
            <div className="modal-actions">
              <button data-focusable className="btn primary" onClick={commitEdit}>
                Сохранить
              </button>
              <button data-focusable className="btn" onClick={paste}>
                Вставить из буфера
              </button>
              {edit.secret && (
                <button data-focusable className="btn ghost" onClick={() => setReveal((r) => !r)}>
                  {reveal ? 'Скрыть' : 'Показать'}
                </button>
              )}
              <button data-focusable className="btn ghost" onClick={() => setEdit(null)}>
                Отмена
              </button>
            </div>
            <p className="hint small">Можно набрать на клавиатуре или скопировать значение и нажать «Вставить из буфера»</p>
          </div>
        </div>
      )}
    </div>
  );
}
