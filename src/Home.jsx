import React, { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import { Poster, Rating } from './Poster.jsx';

const TILES = [
  { id: 'youtube', title: 'YouTube', icon: 'play' },
  { id: 'movies', title: 'Фильмы', icon: 'film' },
  { id: 'browser', title: 'Браузер', icon: 'globe' },
  { id: 'settings', title: 'Настройки', icon: 'sliders' },
  { id: 'exit', title: 'Выход', icon: 'power' },
];

const fmtLeft = (s) => {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return `осталось ${h ? `${h} ч ` : ''}${m % 60} мин`;
};

// Что показать в баннере: самая свежая недосмотренная серия или фильм, а для досмотренной серии — следующая за ней
function pickContinue(all) {
  const latest = new Map();
  for (const [key, e] of Object.entries(all)) {
    if (!e.movie || !e.duration) continue;
    const id = Number(key.split(':')[0]);
    const cur = latest.get(id);
    if (!cur || e.updatedAt > cur.updatedAt) latest.set(id, { ...e, id });
  }
  for (const e of [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!e.done) return e;
    if (e.episode && e.nextEpisode) return { ...e, upNext: true, season: e.nextEpisode.season, episode: e.nextEpisode.episode, position: 0 };
  }
  return null;
}

// Главная: баннер «Продолжить», плитки и подборки
export default function Home({ time, date, greeting, pad, update, onUpdate, onLaunch, onOpenMovie }) {
  const [cont, setCont] = useState(undefined); // undefined — ещё грузим, null — нечего продолжать
  const [rails, setRails] = useState({});
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    let alive = true;
    window.tv.getAllProgress?.().then((r) => alive && setCont(r?.ok ? pickContinue(r.data) : null)).catch(() => alive && setCont(null));
    // подборки берутся из кэша на 12 часов; без ключа или без сети ряд просто не показываем
    for (const id of ['newMovies', 'recSeries']) {
      window.tv
        .discover?.(id, '')
        .then((r) => alive && setRails((cur) => ({ ...cur, [id]: r?.ok ? r.data : [] })))
        .catch(() => alive && setRails((cur) => ({ ...cur, [id]: [] })));
    }
    return () => {
      alive = false;
    };
  }, []);

  // Данные пришли: фокус на главную кнопку баннера (если человек уже не выбрал что-то другое)
  useEffect(() => {
    if (cont === undefined) return;
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || !a.hasAttribute('data-focusable')) document.querySelector('.home2 [data-autofocus]')?.focus();
    });
  }, [cont]);

  // Подключён ли телефон-пульт
  useEffect(() => {
    const load = () => window.tv.remote?.status().then((r) => r?.ok && setPhone(r.data.devices.some((d) => d.online)));
    load();
    return window.tv.remote?.onChanged(load);
  }, []);

  const m = cont?.movie;
  const art = m?.backdrop || m?.posterFull || m?.poster;
  const sub = cont
    ? cont.upNext
      ? `Следующая серия · Сезон ${cont.season}, серия ${cont.episode}`
      : `${cont.episode ? `Сезон ${cont.season} · серия ${cont.episode} · ` : ''}${fmtLeft(cont.duration - cont.position)}`
    : '';
  const pct = cont && !cont.upNext ? Math.min(100, (cont.position / cont.duration) * 100) : 0;

  return (
    <div className="home2">
      <header className="h2-head">
        <div className="h2-hello">
          <div className="h2-clock">{time}</div>
          <div className="h2-date">
            {greeting} · {date}
          </div>
        </div>
        <div className="h2-chips">
          <span className={`h2-chip ${pad ? 'on' : ''}`}>
            <Icon name="gamepad" />
            {pad ? 'Геймпад' : 'Нажмите кнопку на геймпаде'}
          </span>
          {phone && (
            <span className="h2-chip on">
              <Icon name="phone" />
              Телефон
            </span>
          )}
          {update && (
            <button data-focusable className="h2-chip acc" onClick={onUpdate}>
              <Icon name="download" />
              Обновление {update.latest}
            </button>
          )}
        </div>
      </header>

      <section className="h2-hero">
        {art && <div className="h2-art" style={{ backgroundImage: `url("${art}")` }} />}
        <div className="h2-shade" />
        <div className="h2-info">
          {cont ? (
            <>
              <div className="h2-kick">{cont.upNext ? 'СЛЕДУЮЩАЯ СЕРИЯ' : 'ПРОДОЛЖИТЬ ПРОСМОТР'}</div>
              <div className="h2-title">{m.title}</div>
              <div className="h2-sub">{sub}</div>
              {pct > 0 && (
                <div className="h2-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="h2-acts">
                <button data-focusable data-autofocus className="h2-btn primary" onClick={() => onOpenMovie(m, 'resume')}>
                  <Icon name="play" />
                  {cont.upNext ? 'Следующая серия' : 'Продолжить'}
                </button>
                <button data-focusable className="h2-btn" onClick={() => onOpenMovie(m, 'open')}>
                  <Icon name="info" />
                  Подробнее
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="h2-kick">NOVA TV</div>
              <div className="h2-title">Что посмотрим сегодня?</div>
              <div className="h2-sub">Найдите фильм или сериал: ниже подборки новинок и рекомендации.</div>
              <div className="h2-acts">
                <button data-focusable data-autofocus className="h2-btn primary" onClick={() => onLaunch('movies')}>
                  <Icon name="film" />
                  Открыть фильмы
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <nav className="h2-tiles">
        {TILES.map((t) => (
          <button key={t.id} data-focusable className="h2-tile" onClick={() => onLaunch(t.id)}>
            <Icon name={t.icon} />
            {t.title}
          </button>
        ))}
      </nav>

      {[
        ['newMovies', 'Новинки', 'film'],
        ['recSeries', 'Рекомендуем · сериалы', 'star'],
      ].map(
        ([id, title, icon]) =>
          rails[id]?.length > 0 && (
            <section className="cont rail h2-rail" key={id}>
              <h3>
                <Icon name={icon} /> {title}
              </h3>
              <div className="cont-row rail-row">
                {rails[id].map((it, i) => (
                  <button key={it.id} data-focusable className="card" style={{ '--i': Math.min(i, 10) }} onClick={() => onOpenMovie(it, 'open')}>
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
          ),
      )}
    </div>
  );
}
