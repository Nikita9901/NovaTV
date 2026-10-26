// Разбор названий раздач и файлов сериалов: какие сезоны и серии внутри.
// Чистые функции без зависимостей — их можно проверять отдельно от приложения.

const toNum = (s) => (s == null || s === '' ? null : parseInt(s, 10));
const range = (a, b) => {
  const from = toNum(a);
  const to = b == null || b === '' ? from : toNum(b);
  return from == null ? null : [Math.min(from, to), Math.max(from, to)];
};

// Тире между числами: «1-8», «1 – 8», «1—8»
const D = String.raw`\s*[-–—]\s*`;
const re = (source, flags = 'i') => new RegExp(source, flags);

/**
 * Что внутри раздачи по её названию.
 * @returns {{ seasons: [number, number] | null, episodes: [number, number] | null, total: number | null }}
 *   seasons — какие сезоны; episodes — какие серии (внутри сезона); total — «из N»
 */
function parseRelease(title) {
  const t = String(title);
  let seasons = null;
  let episodes = null;
  let m;

  // S01E03, S01E01-E08, S1-11E1-134 (сезоны и серии одним куском)
  m = re(String.raw`\bS(\d{1,2})(?:${D}(\d{1,2}))?[ ._-]?E(\d{1,3})(?:${D}E?(\d{1,3}))?`).exec(t);
  if (m) {
    seasons = range(m[1], m[2]);
    episodes = range(m[3], m[4]);
  }

  // «2 сезон», «1-3 сезоны» — число стоит ПЕРЕД словом (проверяем первым, иначе «2 сезон 1-8 серии» разберётся как сезоны 1-8)
  if (!seasons) {
    m = re(String.raw`(\d{1,2})(?:${D}(\d{1,2}))?\s*сезон`).exec(t);
    if (m) seasons = range(m[1], m[2]);
  }
  // «Сезон: 1-8», «Сезоны 1-3», «Season 2»
  if (!seasons) {
    m = re(String.raw`(?:сезон[ыа]?|seasons?)[:\s]*(\d{1,2})(?:${D}(\d{1,2}))?`).exec(t);
    if (m) seasons = range(m[1], m[2]);
  }
  // S01 / S01-S03 / [S01-11]
  if (!seasons) {
    m = re(String.raw`\bS(\d{1,2})(?:${D}S?(\d{1,2}))?(?![\dE])`).exec(t);
    if (m) seasons = range(m[1], m[2]);
  }

  // «из N» / «of N» — всего серий
  const tot = re(String.raw`(?:из|of)\s*(\d{1,3})`).exec(t);
  const total = tot ? toNum(tot[1]) : null;

  // «(1-8 из 8)», «[01-10 of 10]»
  if (!episodes) {
    m = re(String.raw`(\d{1,3})(?:${D}(\d{1,3}))?\s*(?:из|of)\s*\d{1,3}`).exec(t);
    if (m) episodes = range(m[1], m[2]);
  }
  // «серия 5», «серии 1-4»
  if (!episodes) {
    m = re(String.raw`сери[ияй]\s*[:№]?\s*(\d{1,3})(?:${D}(\d{1,3}))?`).exec(t);
    if (m) episodes = range(m[1], m[2]);
  }
  // «5 серия», «1-8 серии»
  if (!episodes) {
    m = re(String.raw`(\d{1,3})(?:${D}(\d{1,3}))?\s*сери[яи]`).exec(t);
    if (m) episodes = range(m[1], m[2]);
  }

  return { seasons, episodes, total };
}

/**
 * Номер сезона и серии по пути к файлу внутри раздачи.
 * @returns {{ season: number | null, episode: number | null }}
 */
function parseFile(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  const name = parts[parts.length - 1].replace(/\.[a-z0-9]{2,4}$/i, '');
  let season = null;
  let episode = null;

  let m = re(String.raw`\bS(\d{1,2})[ ._-]?E(\d{1,3})`).exec(name) || re(String.raw`\b(\d{1,2})x(\d{2,3})\b`).exec(name);
  if (m) {
    season = toNum(m[1]);
    episode = toNum(m[2]);
  } else {
    m =
      re(String.raw`(?:сери[яи]|серия|episode|ep\.?|\bE)[ ._:№-]*(\d{1,3})\b`).exec(name) ||
      re(String.raw`(\d{1,3})[ ._-]*сери[яи]`).exec(name);
    if (m) episode = toNum(m[1]);
  }

  // Голый номер: «03 - Название», «[03]», «Show.03.1080p» (но не 1080, 720, x264…)
  if (episode == null) {
    const cleaned = name.replace(/\b(1080|720|480|2160|264|265)\b/g, '');
    m = re(String.raw`^\[?(\d{1,3})\]?(?=[\s._)\]-]|$)`).exec(name) || re(String.raw`[\s._\[(-](\d{2,3})(?=[\s._)\]-]|$)(?!p)`).exec(cleaned);
    if (m) episode = toNum(m[1]);
  }

  // Сезон по названию папки: «Season 2», «Сезон 02», «S02»
  if (season == null) {
    for (const dir of parts.slice(0, -1).reverse()) {
      const d = re(String.raw`(?:сезон|season|\bS)[ ._-]*(\d{1,2})\b`).exec(dir);
      if (d) {
        season = toNum(d[1]);
        break;
      }
    }
  }
  return { season, episode };
}

/** Выбрать файл нужной серии среди видеофайлов раздачи (files: [{ path, length }]). */
function pickEpisode(files, season, episode) {
  if (!files.length) return null;
  const parsed = files.map((f) => ({ f, ...parseFile(f.path) }));
  const hits = parsed.filter((p) => p.episode === episode && (p.season == null || season == null || p.season === season));
  // Если есть точное совпадение сезона — предпочитаем его
  const exact = hits.filter((p) => p.season === season);
  const pool = exact.length ? exact : hits;
  if (pool.length) return pool.sort((a, b) => b.f.length - a.f.length)[0].f;
  // Одна серия в раздаче без номера в названии файла
  if (files.length === 1) return files[0];
  return null;
}

/** Вид раздачи для списка: что именно в ней лежит. */
function classify({ seasons, episodes }) {
  if (seasons && seasons[1] > seasons[0]) return 'multi'; // несколько сезонов
  if (episodes && episodes[1] > episodes[0]) return 'pack'; // серии 1–8 одного сезона
  if (episodes && episodes[0] === episodes[1]) return 'single'; // одна серия
  if (seasons) return 'pack'; // «Сезон 1» без номеров серий — считаем сезоном целиком
  return 'unknown';
}

module.exports = { parseRelease, parseFile, pickEpisode, classify };
