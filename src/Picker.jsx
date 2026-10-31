import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { sfx } from './sounds.js';

const ANSWER = { left: 'skip', right: 'like', watch: 'watch' };

// Длинное описание листается вверх/вниз
const scrollDescr = (dir) => {
  const el = document.querySelector('.pk-descr');
  if (el) el.scrollBy({ top: dir * el.clientHeight * 0.7, behavior: 'smooth' });
};

// Подбор по вкусу: карточки с постером, описанием и актёрами. ← не нравится, → интересно, но не сейчас, Enter / Ⓐ — смотреть.
export default function Picker({ kind, onWatch }) {
  const [queue, setQueue] = useState([]);
  const [info, setInfo] = useState({}); // id → подробности (актёры, возраст, страны…)
  const [fly, setFly] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const queueRef = useRef([]);
  queueRef.current = queue;
  const busy = useRef(false);
  const fetching = useRef(false);
  const answered = useRef(new Set());

  const more = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    const exclude = [...answered.current, ...queueRef.current.map((m) => m.id)];
    const r = await window.tv.pickNext({ kind, count: 8, exclude });
    fetching.current = false;
    setLoading(false);
    if (r.ok) setQueue((q) => [...q, ...r.data.filter((m) => !q.some((x) => x.id === m.id) && !answered.current.has(m.id))]);
    else if (!queueRef.current.length) setError(r.error === 'NO_TOKEN' ? 'Для подбора нужен ключ поиска фильмов: добавьте его в настройках.' : r.error);
  }, [kind]);

  useEffect(() => {
    window.tv.pickProfile().then((r) => r.ok && setProfile(r.data));
    more();
  }, [more]);

  // Подробности (описание, актёры) для текущей и двух следующих карточек
  useEffect(() => {
    for (const m of queue.slice(0, 3)) {
      if (info[m.id]) continue;
      window.tv.getDetails(m.id).then((r) => r?.ok && setInfo((cur) => ({ ...cur, [m.id]: r.data })));
    }
  }, [queue, info]);

  const cur = queue[0];

  const answer = useCallback(
    (dir) => {
      const card = queueRef.current[0];
      if (!card || busy.current) return;
      busy.current = true;
      const action = ANSWER[dir];
      (dir === 'left' ? sfx.back : sfx.select)();
      setFly(dir);
      window.tv.pickRecord({ movie: card, action }).then((r) => r?.ok && setProfile(r.data));
      setTimeout(() => {
        answered.current.add(card.id);
        setQueue((q) => q.filter((m) => m.id !== card.id));
        setFly(null);
        busy.current = false;
        if (action === 'watch') onWatch(card);
        else if (queueRef.current.length <= 5) more();
      }, 340);
    },
    [more, onWatch],
  );

  // Управление: стрелки клавиатуры, крестовина и кнопки геймпада, стрелки на телефоне. Ловим раньше остальных, чтобы не двигался фокус.
  useEffect(() => {
    document.body.dataset.picker = '1';
    const onKey = (e) => {
      const map = { ArrowLeft: 'left', ArrowRight: 'right', Enter: 'watch', ' ': 'watch' };
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.stopPropagation();
        e.preventDefault();
        scrollDescr(e.key === 'ArrowDown' ? 1 : -1);
      } else if (map[e.key]) {
        e.stopPropagation();
        e.preventDefault();
        answer(map[e.key]);
      }
    };
    const onPad = (e) => {
      const map = { left: 'left', right: 'right', a: 'watch' };
      if (map[e.detail]) answer(map[e.detail]);
      else if (e.detail === 'up' || e.detail === 'down') scrollDescr(e.detail === 'down' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('tv:pad', onPad);
    return () => {
      delete document.body.dataset.picker;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('tv:pad', onPad);
    };
  }, [answer]);

  const d = cur ? info[cur.id] : null;
  const m = { ...cur, ...(d || {}) };
  const cast = (d?.cast || []).slice(0, 6);
  const next = queue[1];
  const [longDescr, setLongDescr] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.querySelector('.pk-descr');
      setLongDescr(!!el && el.scrollHeight > el.clientHeight + 4);
    }, 80);
    return () => clearTimeout(t);
  }, [cur?.id, d]);

  return (
    <div className="screen picker enter">
      {cur && <div className="pk-bg" key={cur.id} style={{ backgroundImage: `url("${cur.posterFull || cur.poster}")` }} />}
      <header className="pk-head">
        <div className="m-title">
          <Icon name="cards" />
          Подбор {kind === 'movie' ? 'фильма' : 'сериала'}
        </div>
        <span className="pk-prof">
          {profile?.genres?.length ? `Вам близко: ${profile.genres.join(', ')}` : 'Отвечайте на карточки — приложение запомнит вкус'}
          {profile?.answers ? ` · ответов: ${profile.answers}` : ''}
        </span>
      </header>

      <div className="pk-stage">
        {loading && !cur && <div className="empty big"><div className="ring" /><p>Подбираем для вас…</p></div>}
        {error && !cur && <div className="empty big"><p>{error}</p></div>}
        {next && <div className="pk-card behind" aria-hidden="true"><div className="pk-poster" style={{ backgroundImage: `url("${next.poster}")` }} /></div>}
        {cur && (
          <div className={`pk-card ${fly ? `fly-${fly}` : ''}`} key={cur.id}>
            <div className="pk-poster" style={{ backgroundImage: `url("${cur.posterFull || cur.poster}")` }}>
              {m.rating > 0 && <span className="pk-rate">★ {m.rating.toFixed(1)}</span>}
            </div>
            <div className="pk-body">
              <h2>{m.title}</h2>
              {m.original && m.original !== m.title && <p className="pk-orig">{m.original}</p>}
              <div className="chips">
                {m.imdb > 0 && <span className="chip-s imdb">IMDb {m.imdb.toFixed(1)}</span>}
                {m.ageRating != null && <span className="chip-s">{m.ageRating}+</span>}
                {m.year && <span className="chip-s">{m.year}</span>}
                {m.isSeries && m.seasonsInfo?.length > 0 && <span className="chip-s">Сезонов: {m.seasonsInfo.length}</span>}
                {!m.isSeries && m.length && <span className="chip-s">{m.length} мин</span>}
                {(m.countries || []).slice(0, 2).map((c) => (
                  <span className="chip-s soft" key={c}>{c}</span>
                ))}
                {(m.genres || []).slice(0, 3).map((g) => (
                  <span className="chip-s soft" key={g}>{g}</span>
                ))}
              </div>
              <p className="pk-descr">{m.description || (d ? 'Описания нет.' : 'Загружаем описание…')}</p>
              {longDescr && <p className="pk-more">↑ ↓ — листать описание</p>}
              {d?.directors?.length > 0 && (
                <p className="crew">
                  Режиссёр: <b>{d.directors.map((p) => p.name).join(', ')}</b>
                </p>
              )}
              <div className="pk-cast">
                {cast.length
                  ? cast.map((p) => (
                      <div className="pk-actor" key={p.id}>
                        <span className="avatar" style={{ '--photo': p.photo ? `url("${p.photo}")` : 'none' }} />
                        <span className="pname">{p.name}</span>
                      </div>
                    ))
                  : !d && Array.from({ length: 5 }, (_, i) => <div className="pk-actor ghost" key={i}><span className="avatar" /></div>)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pk-actions">
        <button className="pk-btn no" onClick={() => answer('left')} disabled={!cur}>
          <i><Icon name="close" /></i>
          <b>Не нравится</b>
          <small>← · влево</small>
        </button>
        <button className="pk-btn go" onClick={() => answer('watch')} disabled={!cur}>
          <i><Icon name="play" /></i>
          <b>Смотреть</b>
          <small>Enter · Ⓐ</small>
        </button>
        <button className="pk-btn maybe" onClick={() => answer('right')} disabled={!cur}>
          <i><Icon name="star" /></i>
          <b>Интересно, но не сейчас</b>
          <small>→ · вправо</small>
        </button>
      </div>
    </div>
  );
}
