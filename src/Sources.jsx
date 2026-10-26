import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

const FILTERS = [
  { v: 'ru', label: 'Русские публичные' },
  { v: 'public', label: 'Все публичные' },
  { v: 'login', label: 'С логином (RuTracker и др.)' },
];
const PAGE = 40;

const privacyLabel = (p) => (p === 'public' ? 'Публичный' : p === 'private' ? 'Нужен аккаунт' : 'Нужна регистрация');

// Настройка Prowlarr и трекеров прямо из приложения
export default function Sources({ onClose, say }) {
  const [st, setSt] = useState(null); // состояние Prowlarr
  const [list, setList] = useState(null); // мои трекеры
  const [listErr, setListErr] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [filter, setFilter] = useState('ru');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [form, setForm] = useState(null); // трекер, которому нужны логин/пароль
  const [values, setValues] = useState({});
  const [confirm, setConfirm] = useState('');
  const confirmTimer = useRef();
  const lastInput = useRef(null);
  const formRef = useRef(form);
  formRef.current = form;

  const api = window.tv.prowlarr;

  const refreshStatus = useCallback(async () => {
    const r = await api.status();
    if (r.ok) setSt(r.data);
    return r.ok ? r.data : null;
  }, [api]);

  const loadList = useCallback(async () => {
    setListErr('');
    const r = await api.indexers();
    if (r.ok) setList(r.data);
    else {
      setList([]);
      setListErr(r.error === 'NO_PROWLARR' ? 'Prowlarr не настроен' : r.error);
    }
  }, [api]);

  // Первый показ: узнаём состояние; если Prowlarr доступен — подгружаем трекеры
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await refreshStatus();
      if (alive && s?.running) loadList();
      else if (alive) setList([]);
      requestAnimationFrame(() => document.querySelector('.sources [data-focusable]')?.focus());
    })();
    const off = api.onProgress((p) => alive && setProgress(p));
    return () => {
      alive = false;
      off();
    };
  }, [api, refreshStatus, loadList]);

  // Назад: закрыть форму, иначе выйти из раздела (отдельный слушатель: Settings этот раздел не трогает)
  useEffect(() => {
    const back = () => (formRef.current ? setForm(null) : onClose());
    const onKey = (e) => e.key === 'Escape' && back();
    window.addEventListener('tv:back', back);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tv:back', back);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const needConfirm = (id, run) => () => {
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

  const setMode = async (builtin) => {
    await window.tv.setSettings({ prowlarrBuiltin: builtin });
    setList(null);
    setCatalog(null);
    const s = await refreshStatus();
    if (s?.running) loadList();
    else setList([]);
  };

  const install = async () => {
    setBusy('install');
    setProgress({ pct: 0, text: 'Начинаем…' });
    const r = await api.install();
    setProgress(null);
    setBusy('');
    if (!r.ok) return say(r.error || 'Не удалось установить');
    say('Prowlarr установлен');
    await window.tv.setSettings({ prowlarrBuiltin: true });
    startIt();
  };

  const startIt = async () => {
    setBusy('start');
    await refreshStatus();
    const r = await api.start();
    setBusy('');
    const s = await refreshStatus();
    if (!r.ok) say(r.error);
    if (s?.running) {
      say('Prowlarr запущен');
      loadList();
    }
  };

  const stopIt = async () => {
    await api.stop();
    await refreshStatus();
    setList([]);
  };

  const toggle = async (it) => {
    const r = await api.toggle({ id: it.id, enable: !it.enable });
    if (r.ok) setList((l) => l.map((x) => (x.id === it.id ? r.data : x)));
    else say(r.error);
  };
  const test = async (it) => {
    setBusy(`t${it.id}`);
    const r = await api.test(it.id);
    setBusy('');
    say(r.ok ? `${it.name}: работает` : `${it.name}: ${r.error}`);
  };
  const remove = async (it) => {
    const r = await api.remove(it.id);
    if (r.ok) {
      setList((l) => l.filter((x) => x.id !== it.id));
      say('Трекер удалён');
    } else say(r.error);
  };

  const openCatalog = async () => {
    if (catalog) return;
    setBusy('catalog');
    const r = await api.catalog();
    setBusy('');
    if (r.ok) setCatalog(r.data);
    else say(r.error);
  };

  const add = async (item, vals = {}) => {
    setBusy(`a${item.definitionName}`);
    const r = await api.add({ definitionName: item.definitionName, values: vals });
    setBusy('');
    if (!r.ok) return say(r.error);
    setForm(null);
    setList((l) => [...(l || []), r.data]);
    say(`Добавлен: ${item.name}`);
  };
  const onPick = (item) => {
    if (item.privacy !== 'public' || item.fields.length) {
      setValues({});
      setForm(item);
      setTimeout(() => document.querySelector('.modal input')?.focus(), 60);
    } else add(item);
  };

  const paste = async () => {
    const el = lastInput.current;
    if (!el) return say('Сначала выберите поле');
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setValues((v) => ({ ...v, [el.dataset.name]: text }));
    } catch {
      say('Не удалось прочитать буфер обмена');
    }
  };

  const have = new Set((list || []).map((i) => i.definitionName));
  const visible = (catalog || [])
    .filter((c) => !have.has(c.definitionName))
    .filter((c) => (filter === 'ru' ? c.privacy === 'public' && /^ru/i.test(c.language) : filter === 'public' ? c.privacy === 'public' : c.privacy !== 'public' && /^ru/i.test(c.language)));

  if (!st) {
    return (
      <div className="screen settings enter">
        <div className="empty big">
          <Icon name="sliders" />
          <p>Загружаем…</p>
        </div>
      </div>
    );
  }

  const installing = busy === 'install' || st.installing;
  const prog = progress || st.installing;

  return (
    <div className="screen settings sources enter">
      <div className="set-head">
        <div className="m-title">
          <Icon name="download" />
          Источники раздач
        </div>
        <span className="hint small">
          <kbd>Ⓑ</kbd> Назад
        </span>
      </div>

      <div className="set-list" inert={!!form}>
        <section className="set-group">
          <h3>Prowlarr</h3>
          <div className="srow choice">
            <span className="stext">
              <b>Какой Prowlarr использовать</b>
              <small>Встроенный приложение скачает и запустит само. Свой — уже установленный у вас (адрес и ключ в «Поиск и источники»)</small>
            </span>
            <span className="opts">
              <button data-focusable className={`opt ${st.builtin ? 'on' : ''}`} onClick={() => setMode(true)}>
                Встроенный
              </button>
              <button data-focusable className={`opt ${!st.builtin ? 'on' : ''}`} onClick={() => setMode(false)}>
                Свой
              </button>
            </span>
          </div>

          {st.builtin && !st.installed && (
            <button data-focusable className="srow" disabled={installing} onClick={install}>
              <span className="stext">
                <b>{installing ? 'Устанавливаем…' : 'Скачать и установить Prowlarr'}</b>
                <small>
                  {installing && prog
                    ? prog.text
                    : 'Загрузка около 130 МБ с GitHub (официальный выпуск), на диске займёт около 300 МБ. Делается один раз'}
                </small>
                {installing && prog && (
                  <span className="diskbar">
                    <i style={{ width: `${prog.pct}%` }} />
                  </span>
                )}
              </span>
              <span className="sval">{!installing && <Icon name="download" />}</span>
            </button>
          )}

          {st.builtin && st.installed && (
            <button
              data-focusable
              className="srow"
              onClick={st.running ? needConfirm('stop', stopIt) : startIt}
              disabled={busy === 'start'}
            >
              <span className="stext">
                <b>{busy === 'start' ? 'Запускаем… (до минуты)' : st.running ? 'Prowlarr работает' : 'Prowlarr остановлен'}</b>
                <small>
                  {st.error ||
                    (st.running
                      ? 'Запускается вместе с приложением и закрывается вместе с ним. Нажмите, чтобы остановить'
                      : 'Нажмите, чтобы запустить')}
                </small>
              </span>
              <span className="sval">{confirm === 'stop' ? 'Нажмите ещё раз' : st.running ? '● Работает' : '○ Остановлен'}</span>
            </button>
          )}

          {!st.builtin && (
            <div className={`srow info ${st.running ? '' : 'warn'}`}>
              <span className="stext">
                <b>{st.running ? 'Свой Prowlarr подключён' : 'Свой Prowlarr недоступен'}</b>
                <small>{st.running ? st.url : `Проверьте адрес и ключ (${st.url || 'адрес не задан'}) в разделе «Поиск и источники» или выберите встроенный`}</small>
              </span>
            </div>
          )}
        </section>

        {st.running && (
          <section className="set-group">
            <h3>Подключённые трекеры</h3>
            {list === null && <p className="hint">Загружаем…</p>}
            {listErr && <p className="hint warn">{listErr}</p>}
            {list && !list.length && !listErr && <p className="hint">Пока нет ни одного трекера. Добавьте ниже: без них поиск ничего не найдёт</p>}
            {(list || []).map((it) => (
              <div className="srow choice" key={it.id}>
                <span className="stext">
                  <b>{it.name}</b>
                  <small>
                    {privacyLabel(it.privacy)}
                    {it.language ? ` · ${it.language}` : ''}
                    {it.enable ? '' : ' · выключен'}
                  </small>
                </span>
                <span className="opts">
                  <button data-focusable className={`opt ${it.enable ? 'on' : ''}`} onClick={() => toggle(it)}>
                    {it.enable ? 'Включён' : 'Выключен'}
                  </button>
                  <button data-focusable className="opt" onClick={() => test(it)} disabled={busy === `t${it.id}`}>
                    {busy === `t${it.id}` ? 'Проверяем…' : 'Проверить'}
                  </button>
                  <button data-focusable className={`opt ${confirm === `d${it.id}` ? 'danger-on' : ''}`} onClick={needConfirm(`d${it.id}`, () => remove(it))}>
                    {confirm === `d${it.id}` ? 'Ещё раз' : 'Удалить'}
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}

        {st.running && (
          <section className="set-group">
            <h3>Добавить трекер</h3>
            {!catalog ? (
              <button data-focusable className="srow" onClick={openCatalog} disabled={busy === 'catalog'}>
                <span className="stext">
                  <b>{busy === 'catalog' ? 'Загружаем каталог…' : 'Открыть каталог трекеров'}</b>
                  <small>Для русских озвучек обычно берут RuTor, NoNaMe Club (публичные) и RuTracker, Kinozal, NNMClub (нужен аккаунт)</small>
                </span>
                <span className="sval">
                  <Icon name="back" />
                </span>
              </button>
            ) : (
              <>
                <div className="srow choice">
                  <span className="stext">
                    <b>Показать</b>
                  </span>
                  <span className="opts">
                    {FILTERS.map((f) => (
                      <button
                        key={f.v}
                        data-focusable
                        className={`opt ${filter === f.v ? 'on' : ''}`}
                        onClick={() => {
                          setFilter(f.v);
                          setShown(PAGE);
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </span>
                </div>
                {!visible.length && <p className="hint">В этом разделе всё уже добавлено или ничего нет</p>}
                {visible.slice(0, shown).map((c) => (
                  <button data-focusable className="srow" key={c.definitionName} onClick={() => onPick(c)} disabled={busy === `a${c.definitionName}`}>
                    <span className="stext">
                      <b>{c.name}</b>
                      <small>
                        {privacyLabel(c.privacy)} · {c.language || '—'}
                        {c.description ? ` · ${c.description.slice(0, 90)}` : ''}
                      </small>
                    </span>
                    <span className="sval">{busy === `a${c.definitionName}` ? 'Добавляем…' : '＋ Добавить'}</span>
                  </button>
                ))}
                {visible.length > shown && (
                  <button data-focusable className="srow" onClick={() => setShown((n) => n + PAGE)}>
                    <span className="stext">
                      <b>Показать ещё</b>
                      <small>
                        Показано {shown} из {visible.length}
                      </small>
                    </span>
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </div>

      {form && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setForm(null)}>
          <div className="modal-card">
            <h3>{form.name}</h3>
            {form.fields.length ? (
              form.fields.map((f) => (
                <label className="ffield" key={f.name}>
                  <small>{f.label}</small>
                  <input
                    data-focusable
                    data-name={f.name}
                    className="field"
                    type={f.secret ? 'password' : 'text'}
                    value={values[f.name] || ''}
                    spellCheck={false}
                    autoComplete="off"
                    onFocus={(e) => (lastInput.current = e.target)}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                </label>
              ))
            ) : (
              <p className="hint">Дополнительных данных не требуется</p>
            )}
            <div className="modal-actions">
              <button data-focusable className="btn primary" disabled={busy.startsWith('a')} onClick={() => add(form, values)}>
                {busy.startsWith('a') ? 'Проверяем…' : 'Добавить'}
              </button>
              {form.fields.length > 0 && (
                <button data-focusable className="btn" onClick={paste}>
                  Вставить из буфера
                </button>
              )}
              <button data-focusable className="btn ghost" onClick={() => setForm(null)}>
                Отмена
              </button>
            </div>
            <p className="hint small">Логин и пароль хранятся только в Prowlarr на этом компьютере. Поле можно набрать на клавиатуре или вставить из буфера</p>
          </div>
        </div>
      )}
    </div>
  );
}
