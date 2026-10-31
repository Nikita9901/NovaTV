// Подбор фильмов и сериалов по вкусу: показываем карточки, человек отвечает («не нравится», «интересно, но не сейчас», «смотреть»),
// а по ответам мы запоминаем, что ему близко (жанры, страны, эпоха, актёры, режиссёры, похожие фильмы), и показываем дальше то, что подходит лучше.
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

// Насколько ответ меняет интересы
const SIGNAL = { skip: -1, like: 0.6, watch: 1.5, seen: 0.8 };
// Вес признаков разного рода: жанр говорит о вкусе больше всего, эпоха меньше
const KIND = { g: 1, c: 0.5, d: 0.4, p: 0.7 };
const MAX_SEEN = 3000;

let deps = null;
let state = null; // { w: {g,c,d,p}, sim: {id: баллы}, seen: [id], seeded: [id], n: {skip, like, watch} }
const pools = { movie: [], series: [] };
let poolLoading = {};

const file = () => path.join(app.getPath('userData'), 'taste.json');

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    state = null;
  }
  state ||= {};
  state.w ||= { g: {}, c: {}, d: {}, p: {} };
  for (const k of Object.keys(KIND)) state.w[k] ||= {};
  state.sim ||= {};
  state.seen ||= [];
  state.seeded ||= [];
  state.n ||= { skip: 0, like: 0, watch: 0 };
  return state;
}
const save = () => {
  try {
    fs.writeFileSync(file(), JSON.stringify(state));
  } catch {
    /* не критично */
  }
};

const decade = (y) => (y ? String(Math.floor(y / 10) * 10) : '');

// Признаки фильма: [вид, значение]
function features(m, details) {
  const out = [];
  for (const g of m.genres || []) out.push(['g', g]);
  for (const c of m.countries || []) out.push(['c', c]);
  if (decade(m.year)) out.push(['d', decade(m.year)]);
  if (details) {
    for (const p of [...(details.directors || []), ...(details.cast || []).slice(0, 5)]) out.push(['p', String(p.id)]);
  }
  return out;
}

function learn(m, details, signal) {
  const s = load();
  const fs_ = features(m, details);
  const perKind = {};
  for (const [k] of fs_) perKind[k] = (perKind[k] || 0) + 1;
  for (const [k, v] of fs_) {
    // чем больше признаков одного рода у фильма, тем слабее вклад каждого
    const delta = (signal * KIND[k]) / Math.sqrt(perKind[k]);
    s.w[k][v] = Math.max(-6, Math.min(8, (s.w[k][v] || 0) * 0.98 + delta));
  }
  // «Похожие» из сервиса: подтягиваем или отодвигаем их
  for (const sim of details?.similar || []) s.sim[sim.id] = Math.max(-3, Math.min(5, (s.sim[sim.id] || 0) + signal * 0.8));
  // словарь похожих не должен расти бесконечно
  const keys = Object.keys(s.sim);
  if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 3000)) delete s.sim[k];
}

function seenSet() {
  const s = load();
  const set = new Set(s.seen);
  // всё, что уже смотрели или начали смотреть
  try {
    for (const key of Object.keys(deps.readProgress())) set.add(Number(key.split(':')[0]));
  } catch {
    /* прогресса может не быть */
  }
  return set;
}

// Оценка кандидата: чем больше совпадений с интересами, тем выше
function score(m) {
  const s = load();
  const perKind = {};
  const sums = {};
  for (const [k, v] of features(m, deps.detailsCache.get(m.id))) {
    perKind[k] = (perKind[k] || 0) + 1;
    sums[k] = (sums[k] || 0) + (s.w[k][v] || 0);
  }
  let total = 0;
  for (const k of Object.keys(sums)) total += (sums[k] / Math.sqrt(perKind[k])) * KIND[k];
  total += s.sim[m.id] || 0;
  total += ((m.rating || 6) - 6.5) * 0.35; // хорошие оценки в плюс
  return total + Math.random() * 0.35; // чуть случайности, чтобы не крутить одно и то же
}

const TYPES = { movie: 'movie', series: 'tv-series' };

// Запрос к сервису фильмов с фильтрами
async function query(kind, { genre, years, page = 1, sort = 'votes.imdb' } = {}) {
  const { kinopoiskToken } = deps.loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  const u = new URL('https://api.poiskkino.dev/v1.4/movie');
  u.searchParams.set('page', String(page));
  u.searchParams.set('limit', '30');
  u.searchParams.set('sortField', sort);
  u.searchParams.set('sortType', '-1');
  u.searchParams.append('notNullFields', 'poster.url');
  u.searchParams.append('notNullFields', 'name');
  u.searchParams.append('type', TYPES[kind]);
  u.searchParams.append('rating.imdb', '6.3-10');
  u.searchParams.append('votes.imdb', kind === 'movie' ? '30000-10000000' : '15000-10000000');
  if (genre) u.searchParams.append('genres.name', `+${genre}`);
  if (years) u.searchParams.append('year', years);
  const data = await deps.getJson(u.toString(), { 'X-API-KEY': kinopoiskToken });
  return (data.docs || []).map(deps.normMovie).filter((m) => m.title && m.poster);
}

const topKeys = (obj, n) =>
  Object.entries(obj)
    .filter(([, w]) => w > 0.4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Пополняем запас кандидатов. Сначала подборки сервиса, потом запросы под интересы человека.
async function refill(kind) {
  if (poolLoading[kind]) return poolLoading[kind];
  poolLoading[kind] = (async () => {
    const s = load();
    const have = new Set(pools[kind].map((m) => m.id));
    const seen = seenSet();
    const add = (list) => {
      for (const m of list) if (!have.has(m.id) && !seen.has(m.id)) {
        have.add(m.id);
        pools[kind].push(m);
      }
    };
    const cold = s.n.skip + s.n.like + s.n.watch < 3;
    try {
      if (!pools[kind].length) {
        // подборки сервиса, которые уже есть на главной (кэшируются на 12 часов)
        const rows = kind === 'movie' ? ['recMovies', 'newMovies'] : ['recSeries', 'newSeries'];
        for (const row of rows) add(await deps.discover({ row }).catch(() => []));
      }
      if (!cold || pools[kind].length < 8) {
        const genres = topKeys(s.w.g, 3);
        const decades = topKeys(s.w.d, 2);
        const tries = [];
        for (let i = 0; i < 3; i++) {
          const dec = decades.length ? pick(decades) : '';
          tries.push({
            genre: genres.length && Math.random() < 0.8 ? pick(genres) : '',
            years: dec ? `${dec}-${Number(dec) + 9}` : '',
            page: 1 + Math.floor(Math.random() * 5),
            sort: pick(['votes.imdb', 'rating.imdb']),
          });
        }
        for (const t of tries) add(await query(kind, t).catch(() => []));
      }
      // нечего показать (или всё уже видели): берём общий список подальше
      if (pools[kind].length < 4) add(await query(kind, { page: 1 + Math.floor(Math.random() * 20) }).catch(() => []));
    } finally {
      poolLoading[kind] = null;
    }
  })();
  return poolLoading[kind];
}

// Следующая порция карточек, лучшие под вкус — первыми
async function next({ kind = 'movie', count = 8, exclude = [] } = {}) {
  load();
  if (pools[kind].length < count + 4) await refill(kind);
  const seen = seenSet();
  for (const id of exclude) seen.add(Number(id));
  pools[kind] = pools[kind].filter((m) => !seen.has(m.id));
  const cold = load().n.skip + load().n.like + load().n.watch < 3;
  const ranked = cold ? pools[kind].slice() : pools[kind].map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s).map((x) => x.m);
  const chosen = ranked.slice(0, count);
  if (!chosen.length) throw new Error('Больше нечего предложить: попробуйте позже или поменяйте тип');
  // чтобы фоновое пополнение шло заранее, пока человек смотрит карточки
  if (pools[kind].length < 16) refill(kind).catch(() => {});
  return chosen;
}

// Ответ человека: 'skip' (не нравится), 'like' (интересно, но не сейчас), 'watch' (смотреть)
async function record({ movie, action }) {
  const s = load();
  if (!movie?.id || !SIGNAL[action]) return profile();
  if (!s.seen.includes(movie.id)) s.seen.push(movie.id);
  if (s.seen.length > MAX_SEEN) s.seen.splice(0, s.seen.length - MAX_SEEN);
  s.n[action] = (s.n[action] || 0) + 1;
  const details = await deps.movieDetails(movie.id).catch(() => null); // актёры, режиссёры, похожие
  learn(details || movie, details, SIGNAL[action]);
  for (const k of Object.keys(pools)) pools[k] = pools[k].filter((m) => m.id !== movie.id);
  save();
  return profile();
}

// Один раз учитываем то, что человек уже смотрел
function seedFromHistory() {
  const s = load();
  try {
    const all = deps.readProgress();
    for (const [key, e] of Object.entries(all)) {
      const id = Number(key.split(':')[0]);
      if (!e.movie || s.seeded.includes(id)) continue;
      // начатое и досмотренное — это интерес
      if (e.done || e.position > 600) {
        learn(e.movie, null, SIGNAL.seen);
        s.seeded.push(id);
      }
    }
    save();
  } catch {
    /* истории может не быть */
  }
}

function profile() {
  const s = load();
  return {
    genres: topKeys(s.w.g, 4),
    answers: s.n.skip + s.n.like + s.n.watch,
    n: s.n,
  };
}

function register(d) {
  deps = d;
  const wrap = (fn) => async (_e, arg) => {
    try {
      return { ok: true, data: await fn(arg) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  };
  ipcMain.handle('pick:next', wrap((arg) => {
    seedFromHistory();
    return next(arg);
  }));
  ipcMain.handle('pick:record', wrap(record));
  ipcMain.handle('pick:profile', wrap(() => profile()));
  ipcMain.handle('pick:reset', wrap(() => {
    state = { w: { g: {}, c: {}, d: {}, p: {} }, sim: {}, seen: [], seeded: [], n: { skip: 0, like: 0, watch: 0 } };
    pools.movie = [];
    pools.series = [];
    save();
    return profile();
  }));
}

module.exports = { register };
