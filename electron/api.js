// Сетевая часть: поиск фильмов и торрентов. Работает в основном процессе,
// чтобы ключи не попадали в страницу и не мешал CORS.
const fs = require('fs');
const path = require('path');
const { parseRelease, classify } = require('./release');
const prowlarr = require('./prowlarr');
const { app, ipcMain, shell, dialog, session, BrowserWindow, screen } = require('electron');

const DEFAULTS = {
  kinopoiskToken: '',
  prowlarrUrl: 'http://127.0.0.1:9696',
  prowlarrKey: '',
  remoteEnabled: false, // пульт на телефоне (Nova TV Remote) включён
  setupDone: false, // пройден ли мастер первого запуска
  prowlarrBuiltin: false, // искать через встроенный Prowlarr (скачивается и запускается самим приложением)
  audioLang: 'rus', // предпочитаемая звуковая дорожка: rus / eng / пусто — первая
  maxHeight: 1080, // потолок разрешения при перекодировании
  hdrToneMap: true, // переводить HDR в обычное изображение
  introSkip: 90, // «Пропустить заставку» без глав в файле: на сколько секунд вперёд (60 / 90 / 120)
  autoPick: true, // кнопка «Смотреть» сама выбирает лучшую раздачу
  preferQuality: '1080P', // желаемое качество при автоподборе: 720P / 1080P / 2160P
  preferAudio: 'rus', // желаемый перевод: rus — русский (дубляж/озвучка), orig — оригинал
  discoverRegion: 'all', // подборки по мировым оценкам: all — российское тоже, если высоко оценено; foreign — без российских
  downloadDir: '', // куда качать раздачи; пусто — временная папка (нужно много места: фильм 1080p ≈ 10 ГБ, 4K ≈ 30–80 ГБ)
};

// Куда качать по умолчанию. В Windows это временная папка; на Linux «tmp» часто лежит в оперативной памяти
// и мал для фильмов, а на macOS её чистит система, поэтому там берём папку данных приложения.
const defaultDownloads = () => (process.platform === 'win32' ? app.getPath('temp') : path.join(app.getPath('userData'), 'cache'));

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (!('setupDone' in saved)) saved.setupDone = true; // файл остался от прошлой версии: мастер не нужен
    return { ...DEFAULTS, ...saved };
  } catch {
    // Первый запуск: сразу предлагаем встроенный Prowlarr, чтобы всё работало без отдельной установки
    const fresh = { ...DEFAULTS, prowlarrBuiltin: true };
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error('Неверный ключ доступа — проверьте настройки');
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  return res.json();
}

const normMovie = (m) => ({
  id: m.id,
  title: m.name || m.alternativeName || m.enName || '',
  original: m.alternativeName || m.enName || '',
  year: m.year || null,
  rating: Number(m.rating?.kp || m.rating?.imdb || 0),
  poster: m.poster?.previewUrl || m.poster?.url || '',
  posterFull: m.poster?.url || m.poster?.previewUrl || '',
  backdrop: m.backdrop?.url || '',
  description: m.description || m.shortDescription || '',
  genres: (m.genres || []).map((g) => g.name),
  length: m.movieLength || m.seriesLength || null,
  type: m.type || '',
  imdb: Number(m.rating?.imdb || 0),
  ageRating: m.ageRating || null,
  slogan: m.slogan || '',
  isSeries: typeof m.isSeries === 'boolean' ? m.isSeries : SERIES_TYPES.has(m.type),
  countries: (m.countries || []).map((c) => c.name).filter(Boolean),
  seasonsInfo: (m.seasonsInfo || []).filter((s) => s.number > 0).map((s) => ({ number: s.number, episodesCount: s.episodesCount || 0 })),
});

const SERIES_TYPES = new Set(['tv-series', 'animated-series']);

// Сезоны и серии (названия, даты, кадры) — для выбора серии
const seasonCache = new Map();
async function seasonsOf({ id, seasonsInfo = [] }) {
  const { kinopoiskToken } = loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  if (seasonCache.has(id)) return seasonCache.get(id);
  let seasons = [];
  try {
    const url = `https://api.poiskkino.dev/v1.4/season?page=1&limit=100&movieId=${encodeURIComponent(id)}&sortField=number&sortType=1`;
    const data = await getJson(url, { 'X-API-KEY': kinopoiskToken });
    seasons = (data.docs || [])
      .filter((s) => s.number > 0)
      .map((s) => ({
        number: s.number,
        episodes: (s.episodes || [])
          .map((e) => ({ number: e.number, title: e.name || e.enName || '', airDate: e.airDate || '', still: e.still?.previewUrl || e.still?.url || '' }))
          .sort((a, b) => a.number - b.number),
      }));
  } catch {
    /* ниже запасной вариант */
  }
  // Запасной вариант: известно только число серий — рисуем «Серия N»
  if (!seasons.length) {
    seasons = seasonsInfo.map((s) => ({
      number: s.number,
      episodes: Array.from({ length: s.episodesCount }, (_, i) => ({ number: i + 1, title: '', airDate: '', still: '' })),
    }));
  }
  // В списке серий бывают пропуски по данным — дополняем до заявленного числа
  for (const s of seasons) {
    const want = seasonsInfo.find((x) => x.number === s.number)?.episodesCount || 0;
    for (let n = 1; n <= want; n++) if (!s.episodes.some((e) => e.number === n)) s.episodes.push({ number: n, title: '', airDate: '', still: '' });
    s.episodes.sort((a, b) => a.number - b.number);
  }
  seasonCache.set(id, seasons);
  return seasons;
}

// Дневной лимит демо-токена маленький, поэтому повторные запросы берём из кэша.
const movieCache = new Map();

async function movieById(id) {
  const { kinopoiskToken } = loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  const data = await getJson(`https://api.poiskkino.dev/v1.4/movie/${encodeURIComponent(id)}`, { 'X-API-KEY': kinopoiskToken });
  return normMovie(data);
}

// ---- Подборки на главной «Фильмов»: рекомендации и новинки ----
// Кэшируем на диск на 12 часов: лимит запросов у ключа небольшой, а подборки меняются редко.
const DISCOVER_TTL = 12 * 3600 * 1000;
const discoverFile = () => path.join(app.getPath('userData'), 'discover.json');
const readDiscover = () => {
  try {
    return JSON.parse(fs.readFileSync(discoverFile(), 'utf8'));
  } catch {
    return {};
  }
};

async function discover({ row, genre = '' }) {
  const { kinopoiskToken, discoverRegion } = loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  const world = discoverRegion === 'foreign'; // исключать российское только по явной настройке
  const year = new Date().getFullYear();
  // Рекомендации «перелистываем» раз в сутки (страницы 1–3), чтобы список не был одним и тем же каждый день
  const page = row.startsWith('rec') ? (Math.floor(Date.now() / 86400000) % 3) + 1 : 1;
  const key = `${row}|${genre}|${page}|${year}|${world ? 'w' : 'a'}`;

  const cache = readDiscover();
  const hit = cache[key];
  if (hit && Date.now() - hit.at < DISCOVER_TTL) return hit.items;

  const recent = `${year - 1}-${year}`;
  const rows = {
    // Популярность и оценки берём международные (IMDb): голоса Кинопоиска в основном русскоязычные и перекашивают подборку
    newMovies: { type: 'movie', year: recent, 'votes.imdb': '20000-10000000', 'rating.imdb': '5.8-10' },
    newSeries: { type: 'tv-series', year: recent, 'votes.imdb': '10000-10000000', 'rating.imdb': '6-10' },
    recMovies: { type: 'movie', 'rating.imdb': '7.4-10', 'votes.imdb': '300000-10000000' },
    recSeries: { type: 'tv-series', 'rating.imdb': '7.8-10', 'votes.imdb': '100000-10000000' },
  };
  if (!rows[row]) throw new Error('Неизвестная подборка');

  const u = new URL('https://api.poiskkino.dev/v1.4/movie');
  u.searchParams.set('page', String(page));
  u.searchParams.set('limit', '24');
  u.searchParams.set('sortField', 'votes.imdb');
  u.searchParams.set('sortType', '-1');
  u.searchParams.append('notNullFields', 'poster.url');
  u.searchParams.append('notNullFields', 'name');
  for (const [k, v] of Object.entries(rows[row])) u.searchParams.append(k, v);
  if (genre && row.startsWith('rec')) u.searchParams.append('genres.name', `+${genre}`);
  if (world) {
    u.searchParams.append('countries.name', '!Россия');
    u.searchParams.append('countries.name', '!СССР');
  }

  const data = await getJson(u.toString(), { 'X-API-KEY': kinopoiskToken });
  const items = (data.docs || []).map(normMovie).filter((m) => m.title && m.poster);

  // Сохраняем и заодно выбрасываем протухшие записи
  const fresh = Object.fromEntries(Object.entries(cache).filter(([, v]) => Date.now() - v.at < 3 * DISCOVER_TTL));
  fresh[key] = { at: Date.now(), items };
  try {
    fs.writeFileSync(discoverFile(), JSON.stringify(fresh));
  } catch {
    /* кэш — не критично */
  }
  return items;
}

const detailsCache = new Map();
async function movieDetails(id) {
  const { kinopoiskToken } = loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  if (detailsCache.has(id)) return detailsCache.get(id);
  const d = await getJson(`https://api.poiskkino.dev/v1.4/movie/${encodeURIComponent(id)}`, { 'X-API-KEY': kinopoiskToken });
  const people = d.persons || [];
  const pick = (prof, n) =>
    people
      .filter((p) => p.enProfession === prof && p.name)
      .slice(0, n)
      .map((p) => ({ id: p.id, name: p.name, photo: p.photo || '' }));
  const details = {
    ...normMovie(d),
    cast: pick('actor', 10),
    directors: pick('director', 2),
    // у «похожих» в ответе нет жанров и признака сериала — их подгрузим при открытии
    similar: (d.similarMovies || [])
      .filter((m) => m.poster?.previewUrl)
      .map((m) => ({
        id: m.id,
        title: m.name || m.alternativeName || '',
        original: m.alternativeName || m.enName || '',
        year: m.year || null,
        rating: Number(m.rating?.kp || m.rating?.imdb || 0),
        poster: m.poster.previewUrl,
        posterFull: m.poster.url || m.poster.previewUrl,
      })),
  };
  detailsCache.set(id, details);
  return details;
}

// Страница актёра: имя, фото и фильмография (самые высоко оценённые работы)
const personCache = new Map();
async function personDetails(id) {
  const { kinopoiskToken } = loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  if (personCache.has(id)) return personCache.get(id);
  const headers = { 'X-API-KEY': kinopoiskToken };
  const p = await getJson(`https://api.poiskkino.dev/v1.4/person/${encodeURIComponent(id)}`, headers);
  const seen = new Set();
  const ids = (p.movies || [])
    .filter((m) => m.id && (m.enProfession === 'actor' || m.enProfession === 'director') && !seen.has(m.id) && seen.add(m.id))
    .slice(0, 100)
    .map((m) => m.id);
  let movies = [];
  if (ids.length) {
    const u = new URL('https://api.poiskkino.dev/v1.4/movie');
    u.searchParams.set('limit', '100');
    u.searchParams.append('notNullFields', 'poster.url');
    for (const i of ids) u.searchParams.append('id', String(i));
    const data = await getJson(u.toString(), headers);
    // сначала самые известные работы: по числу голосов, а не по оценке (иначе наверх лезут малоизвестные фильмы)
    const votes = (d) => (d.votes?.imdb || 0) + (d.votes?.kp || 0);
    movies = (data.docs || [])
      .filter((d) => normMovie(d).title)
      .sort((a, b) => votes(b) - votes(a))
      .slice(0, 40)
      .map(normMovie)
      .filter((m) => m.poster);
  }
  const fmtDate = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const bio = [];
  if (p.birthday) bio.push(`${fmtDate(p.birthday)}${p.age ? `, ${p.age} ${p.death ? 'лет на момент смерти' : 'лет'}` : ''}`);
  const place = (p.birthPlace || []).map((x) => x.value).filter(Boolean).join(', ');
  if (place) bio.push(place);
  if (p.countAwards) bio.push(`Наград: ${p.countAwards}`);
  const res = { id: p.id, name: p.name || p.enName || '', original: p.enName || '', photo: p.photo || '', bio, movies };
  personCache.set(id, res);
  return res;
}

async function searchMovies(query) {
  const { kinopoiskToken } = loadSettings();
  if (!kinopoiskToken) throw new Error('NO_TOKEN');
  const key = query.toLowerCase();
  if (movieCache.has(key)) return movieCache.get(key);
  const url = `https://api.poiskkino.dev/v1.4/movie/search?page=1&limit=24&query=${encodeURIComponent(query)}`;
  const data = await getJson(url, { 'X-API-KEY': kinopoiskToken });
  const movies = (data.docs || []).map(normMovie).filter((m) => m.title);
  movieCache.set(key, movies);
  return movies;
}

const QUALITY = /(2160p|4k|uhd|1080p|720p|480p)/i;

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const noThe = (s) => s.replace(/^the /, '');

// Год из карточки должен встречаться в названии раздачи.
const yearRe = (year) => new RegExp(`(^|\\D)${year}(\\D|$)`);

// Часть названия до года должна совпадать с названием фильма (русским или оригинальным):
// так отсекаются «Наука Интерстеллар», сиквелы, документалки и прочий шум.
function titleMatches(release, { title, original, year }) {
  const m = yearRe(year).exec(release);
  if (!m) return false;
  const names = [title, original].filter(Boolean).map(norm).map(noThe);
  const segments = release
    .slice(0, m.index + (m[1] ? m[1].length : 0))
    .split('/')
    .map((p) => noThe(norm(p)));
  return segments.some((seg) => names.some((n) => seg === n || seg.startsWith(n + ' ')));
}

// Название сериала в раздаче: берём часть до года/скобок/слова «сезон» и сверяем с названиями
function seriesTitleMatches(release, { title, original }) {
  const head = release.split(/[([]|(?<![\p{L}\p{N}])(?:(?:сезон|season)(?![\p{L}])|s\d{1,2}|e\d{1,3})/iu)[0];
  const names = [title, original].filter(Boolean).map(norm).map(noThe);
  const segments = head.split('/').map((p) => noThe(norm(p))).filter(Boolean);
  // Название должно совпасть целиком (допустим только год или страна в конце): «Шерлок и дочь» — другой сериал, не «Шерлок»
  const tail = /^( (19|20)\d\d| \d{1,2}| us| uk| usa| au| ca)?$/;
  return segments.some((seg) => names.some((n) => seg.startsWith(n) && tail.test(seg.slice(n.length))));
}

// Год в названии раздачи не должен быть далеко за пределами жизни сериала (ремейки и продолжения с тем же именем)
function seriesYearFits(release, { year, seasonsCount = 0 }) {
  if (!year) return true;
  const m = /[([]\s*((?:19|20)\d\d)(?:\s*[-–]\s*(?:(?:19|20)\d\d)?)?\s*[)\]]/.exec(release);
  if (!m) return true;
  const y = Number(m[1]);
  return y >= year - 1 && y <= year + Math.max(seasonsCount, 1) + 3;
}

const pad2 = (n) => String(n).padStart(2, '0');

// Раздачи сериала: размечаем (что внутри), отбираем под нужный сезон/серию и упорядочиваем.
// Порядок: сначала сезон целиком (дальше серии идут подряд), затем отдельные серии, потом паки на несколько сезонов.
const COUNTRY_CODES = {
  США: 'US', Великобритания: 'UK', Австралия: 'AU', Канада: 'CA', Германия: 'DE', Франция: 'FR', Италия: 'IT',
  Испания: 'ES', Россия: 'RU', Япония: 'JP', 'Корея Южная': 'KR', Швеция: 'SE', Дания: 'DK', Норвегия: 'NO',
};

// Раздача в названии обычно говорит, какой в ней перевод: «Дубляж», «MVO», «LostFilm», «| D |» и т.п.
const RUS_AUDIO = /дубляж|дублир|лицензи|многоголос|двухголос|одноголос|\b(MVO|DVO|AVO)\b|itunes|hdrezka|lostfilm|jaskier|кубик|пифагор|\|\s*(D|P|L)\s*\||\bRUS\b/i;
const BAD_SOURCE = /\b(CAMRip|CAM|TS|TeleSync|HDTS|TC|TeleCine|SCR|DVDScr|VHSRip)\b/i;
const QUALITY_RANK = { '2160P': 4, '1080P': 3, '720P': 2, '480P': 1, '': 0 };

/**
 * Оценка раздачи для автоподбора: чем больше, тем лучше. Учитывает здоровье раздачи (сиды), желаемое качество,
 * желаемый перевод и отсекает «экранки». Результат > 0 — раздача годится.
 */
function scoreTorrent(r, prefs, { isSeries, season }) {
  const dub = RUS_AUDIO.test(r.title);
  const cam = BAD_SOURCE.test(r.title);
  let score = 0;

  // здоровье: без сидов смотреть нечего
  if (r.seeders <= 0) return { dub, cam, score: -100 };
  score += r.seeders >= 30 ? 34 : r.seeders >= 10 ? 26 : r.seeders >= 4 ? 16 : r.seeders >= 2 ? 6 : 0;

  // качество: точное совпадение с желаемым — лучше всего, дальше штраф за каждую ступень
  const want = QUALITY_RANK[prefs.preferQuality] ?? 3;
  const have = QUALITY_RANK[r.quality] ?? 0;
  score += r.quality ? 40 - 16 * Math.abs(have - want) : -8;

  // перевод
  // Явная пометка («Дубляж», «MVO», «| D |») — надёжнее всего; название по-русски («Интерстеллар / …») — вероятно, русский звук
  const ruTitle = /^[А-Яа-яЁё]/.test(r.title);
  if (prefs.preferAudio === 'rus') score += dub ? 26 : ruTitle ? 12 : -6;
  else score += dub ? -4 : 10;

  // чем больше сидов, тем лучше (плавно, поверх ступеней выше)
  score += Math.min(10, Math.round(Math.log10(r.seeders + 1) * 4));
  if (/\bAV1\b/i.test(r.title)) score -= 6; // AV1 тяжелее для процессора при перекодировании

  // «экранки» и сверхтяжёлые ремуксы (качать десятки гигабайт ради стрима — лишнее)
  if (cam) score -= 200;
  if (!isSeries && r.size > 60e9) score -= 22;
  else if (!isSeries && r.size > 25e9) score -= 8;
  if (/h\.?264|\bavc\b|x264/i.test(r.title)) score += 5; // H.264 играет «копированием», без перекодирования

  // сериал: пак нужного сезона и общий пак хороши (качается только нужная серия)
  if (isSeries && season) {
    if (r.kind === 'pack' && r.seasons && r.seasons[0] === season) score += 14;
    else if (r.kind === 'multi') score += 8;
    else if (r.kind === 'single') score += 4;
  }
  return { dub, cam, score };
}

function annotate(list, ctx) {
  const prefs = loadSettings();
  return list.map((r) => ({ ...r, ...scoreTorrent(r, prefs, ctx) }));
}

function arrangeSeries(list, { title, original, season, episode, countries = [], year, seasonsCount }) {
  const named = list.filter((r) => seriesTitleMatches(r.title, { title, original }) && seriesYearFits(r.title, { year, seasonsCount }));
  let pool = named.length ? named : list; // если название не опознали — лучше показать всё, чем ничего

  // Ремейки с тем же названием («Shameless (US)» и «Shameless (UK)») — разные сериалы: отбрасываем раздачи с чужой страной
  const mine = countries.map((c) => COUNTRY_CODES[c]).filter(Boolean);
  if (mine.length) {
    const tag = /\((US|UK|AU|CA|DE|FR|IT|ES|RU|JP|KR|SE|DK|NO)\)/;
    const sameCountry = pool.filter((r) => {
      const m = tag.exec(r.title);
      return !m || mine.includes(m[1]);
    });
    if (sameCountry.length) pool = sameCountry;
  }
  const base = pool;

  const marked = base.map((r) => {
    const info = parseRelease(r.title);
    return { ...r, seasons: info.seasons, episodes: info.episodes, total: info.total, kind: classify(info) };
  });

  const fits = marked.filter((r) => {
    if (!season) return true; // сезон не выбран — показываем всё
    if (r.seasons && (season < r.seasons[0] || season > r.seasons[1])) return false; // другой сезон
    // отдельные серии и их диапазоны: нужная серия должна попадать внутрь
    if (episode && r.kind === 'single' && !(r.episodes[0] <= episode && episode <= r.episodes[1])) return false;
    return true;
  });

  const tier = (r) => {
    if (r.kind === 'pack' && r.seasons && r.seasons[0] === season) return 0;
    if (r.kind === 'single') return 1;
    if (r.kind === 'multi') return 2;
    return 3;
  };
  // Сначала «живые» раздачи (≥3 сидов), потом хилые, потом мёртвые; внутри — по виду, затем по сидам.
  // Пак на все сезоны тоже хорош: качается только файл нужной серии, размер архива не важен.
  const health = (r) => (r.seeders >= 3 ? 0 : r.seeders >= 1 ? 1 : 2);
  // Раздачи без признаков сезона/серии (чаще всего однофамильцы-фильмы) нужны, только если больше ничего не нашлось
  const known = fits.filter((r) => r.kind !== 'unknown');
  return (known.length >= 3 ? known : fits).sort((a, b) => health(a) - health(b) || (season ? tier(a) - tier(b) : 0) || b.seeders - a.seeders).slice(0, 80);
}

async function searchTorrents({ title, original, year, isSeries, season, episode, countries, seasonsInfo }) {
  await prowlarr.ensureRunning();
  const { url: base, key: prowlarrKey } = prowlarr.conn();
  if (!prowlarrKey || !base) throw new Error('NO_PROWLARR');

  // Для сериала год не добавляем (в паках он «2011-2021»), зато просим нужный сезон разными способами
  const names = [original, title].filter(Boolean);
  const queries = isSeries
    ? [...new Set(names.flatMap((n) => [n, ...(season ? [`${n} S${pad2(season)}`, `${n} сезон ${season}`] : [])]))]
    : [...new Set(names.map((n) => (year ? `${n} ${year}` : n)))];
  const settled = await Promise.allSettled(
    queries.map((q) =>
      getJson(`${base}/api/v1/search?type=search&query=${encodeURIComponent(q)}`, { 'X-Api-Key': prowlarrKey }),
    ),
  );
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;

  const seen = new Set();
  const out = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const r of s.value) {
      const key = r.guid || `${r.title}|${r.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: r.title,
        size: r.size || 0,
        seeders: r.seeders ?? 0,
        leechers: r.leechers ?? 0,
        indexer: r.indexer || '',
        quality: (r.title.match(QUALITY)?.[1] || '').toUpperCase().replace('4K', '2160P'),
        magnet: r.magnetUrl || '',
        infoHash: r.infoHash || '',
        download: r.downloadUrl || '',
      });
    }
  }
  if (isSeries) return annotate(arrangeSeries(out, { title, original, season, episode, countries, year, seasonsCount: (seasonsInfo || []).length }), { isSeries: true, season });

  // Сначала строгий фильтр (год + название), если пусто — только по году, иначе всё как есть.
  const strict = out.filter((r) => year && titleMatches(r.title, { title, original, year }));
  const byYear = out.filter((r) => year && yearRe(year).test(r.title));
  const list = strict.length ? strict : byYear.length ? byYear : out;
  // Фильм: лучшие по оценке (качество, перевод, сиды) сверху, «экранки» и раздачи без сидов внизу
  return annotate(list.sort((a, b) => b.seeders - a.seeders).slice(0, 60), { isSeries: false, season: 0 }).sort(
    (a, b) => b.score - a.score || b.seeders - a.seeders,
  );
}

// Прогресс просмотра: { [movieId]: { position, duration, torrent, updatedAt } }
const progressFile = () => path.join(app.getPath('userData'), 'progress.json');
const readProgress = () => {
  try {
    return JSON.parse(fs.readFileSync(progressFile(), 'utf8'));
  } catch {
    return {};
  }
};
function setProgress({ movieId, entry }) {
  const all = readProgress();
  if (entry) all[movieId] = { ...entry, updatedAt: entry.updatedAt ?? Date.now() };
  else delete all[movieId];
  fs.writeFileSync(progressFile(), JSON.stringify(all, null, 2));
}

const wrap = (fn) => async (_e, arg) => {
  try {
    return { ok: true, data: await fn(arg) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
};

// Какие настройки можно менять из интерфейса и какого они типа (всё остальное отбрасываем)
const SCHEMA = {
  kinopoiskToken: 'string',
  prowlarrUrl: 'string',
  prowlarrKey: 'string',
  prowlarrBuiltin: 'boolean',
  setupDone: 'boolean',
  remoteEnabled: 'boolean',
  downloadDir: 'string',
  audioLang: 'string',
  maxHeight: 'number',
  hdrToneMap: 'boolean',
  autoPick: 'boolean',
  introSkip: 'number',
  preferQuality: 'string',
  preferAudio: 'string',
  discoverRegion: 'string',
};

function patchSettings(patch) {
  const cur = loadSettings();
  for (const [key, type] of Object.entries(SCHEMA)) {
    if (!(key in patch) || typeof patch[key] !== type) continue;
    cur[key] = type === 'string' ? patch[key].trim() : patch[key];
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(cur, null, 2));
  return cur;
}

// Свободное место на диске, где лежит папка (папки может ещё не быть — идём вверх до существующей)
async function diskInfo(dir) {
  let p = path.resolve(dir || defaultDownloads());
  while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
  const s = await fs.promises.statfs(p);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize, path: p };
}

function registerApi() {
  loadSettings(); // создаст settings.json при первом запуске
  prowlarr.register({ loadSettings, patchSettings });
  ipcMain.handle('movies:search', wrap(searchMovies));
  ipcMain.handle('torrents:search', wrap(searchTorrents));
  ipcMain.handle('movies:get', wrap(movieById));
  ipcMain.handle('movies:details', wrap(movieDetails));
  ipcMain.handle('movies:person', wrap(personDetails));
  ipcMain.handle('movies:discover', wrap(discover));
  ipcMain.handle('series:seasons', wrap(seasonsOf));
  ipcMain.handle('settings:info', wrap(() => ({ path: settingsFile() })));
  ipcMain.handle('progress:get', wrap((movieId) => readProgress()[movieId] || null));
  ipcMain.handle('progress:all', wrap(() => readProgress()));
  ipcMain.handle('progress:set', wrap(setProgress));
  // Убрать из «Продолжить» фильм целиком: его запись и все серии сериала («id», «id:сезон:серия»)
  ipcMain.handle(
    'progress:clear',
    wrap((movieId) => {
      const all = readProgress();
      for (const k of Object.keys(all)) if (k === String(movieId) || k.startsWith(String(movieId) + ':')) delete all[k];
      fs.writeFileSync(progressFile(), JSON.stringify(all, null, 2));
    }),
  );
  ipcMain.handle('settings:get', wrap(() => loadSettings()));
  // Экран, на котором сейчас окно приложения: размер и частота обновления (для подсказки про плавность кино)
  ipcMain.handle(
    'system:display',
    wrap(() => {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
      return { width: d.size.width, height: d.size.height, hz: d.displayFrequency };
    }),
  );
  ipcMain.handle('settings:set', wrap(patchSettings));
  ipcMain.handle('settings:disk', wrap(diskInfo));
  ipcMain.handle(
    'settings:pick-dir',
    wrap(async () => {
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Папка для загрузок',
        properties: ['openDirectory', 'createDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    }),
  );
  // Выйти из аккаунта YouTube: стираем данные его отдельной сессии
  ipcMain.handle('youtube:signout', wrap(() => session.fromPartition('persist:youtube').clearStorageData()));
  ipcMain.on('settings:open', () => shell.openPath(settingsFile()));
}

module.exports = { registerApi, loadSettings, patchSettings, defaultDownloads };
