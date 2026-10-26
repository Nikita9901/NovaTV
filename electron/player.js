// Воспроизведение внутри приложения.
// Торрент стримится через WebTorrent по локальному HTTP, ffmpeg «на лету» собирает из него
// фрагментированный MP4 (H.264 + AAC), который играет обычный <video>:
//  - H.264 видео копируется без перекодирования, остальное (HEVC и т.п.) перекодируется;
//  - звук всегда в AAC (AC3/DTS в Chromium не играют);
//  - перемотка = перезапуск ffmpeg с нужной позиции (параметр start).
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');
const { spawn, execFileSync } = require('child_process');

// Измеряем, насколько «залипает» главный процесс (там же WebTorrent и раздача потока в плеер):
// если цикл событий блокируется на десятки миллисекунд, видео получает данные рывками.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
const { app, ipcMain } = require('electron');
const { loadSettings, defaultDownloads } = require('./api');
const { pickEpisode, parseFile } = require('./release');
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const VIDEO = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|wmv|webm|mpg|mpeg)$/i;
const METADATA_TIMEOUT = 60_000;
const BUFFER_TIMEOUT = 180_000; // сколько ждём начало файла
const HEAD_BYTES = 16e6;
const TAIL_BYTES = 4e6;

let client = null;
let torrentServer = null;
let streamServer = null;
let session = null; // { torrent, srcUrl, info, procs:Set, cancelled }

class PlayError extends Error {}

const gb = (n) => `${(n / 1e9).toFixed(1)} ГБ`;

// Папка кэша — только наша: чистим её при старте и после просмотра.
function cacheDir() {
  const custom = loadSettings().downloadDir?.trim();
  return path.join(custom || defaultDownloads(), 'google-tv-torrents');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => `${(n / 1e6).toFixed(0)} МБ`;

async function ensureTorrentClient() {
  if (client) return client;
  const { default: WebTorrent } = await import('webtorrent');
  client = new WebTorrent();
  client.on('error', (e) => console.error('[webtorrent]', e));
  torrentServer = client.createServer({ hostname: '127.0.0.1' });
  await new Promise((resolve) => torrentServer.listen(0, '127.0.0.1', resolve));
  return client;
}

// Открытые трекеры — добавляем к любой раздаче, чтобы пиры находились быстрее
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.dler.org:6969/announce',
];

// Что отдать WebTorrent. Порядок:
//  1. настоящий magnet (у Prowlarr в magnetUrl иногда лежит http-ссылка, поэтому проверяем схему);
//  2. .torrent-файл по ссылке Prowlarr — в нём списки трекеров, пиры находятся быстро;
//  3. запасной вариант — magnet из infoHash (искать придётся по DHT, это долго).
async function resolveSource(t) {
  const links = [t.magnet, t.download].filter(Boolean);
  const magnet = links.find((l) => l.startsWith('magnet:'));
  if (magnet) return magnet;

  const url = links.find((l) => /^https?:/.test(l));
  const byHash = t.infoHash ? `magnet:?xt=urn:btih:${t.infoHash}` : null;
  if (url) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      const location = res.headers.get('location') || '';
      if (location.startsWith('magnet:')) return location;
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (!byHash) throw new PlayError(`Не удалось получить торрент-файл (${res.status})`);
    } catch (err) {
      if (!byHash) throw err instanceof PlayError ? err : new PlayError(`Не удалось получить торрент-файл: ${err.message}`);
    }
  }
  if (byHash) return byHash;
  throw new PlayError('У раздачи нет ссылки');
}

// Создаёт пустой файл и помечает его sparse (NTFS). Если не вышло — работаем как раньше, только медленнее.
function markSparse(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.closeSync(fs.openSync(file, 'a'));
    if (process.platform === 'win32') execFileSync('fsutil', ['sparse', 'setflag', file], { stdio: 'ignore', windowsHide: true });
  } catch (err) {
    console.warn('[sparse] не удалось пометить файл разреженным:', err.message);
  }
}

function describeError(e) {
  if (e?.code === 'ENOSPC') return 'Закончилось место на диске. Укажите downloadDir в настройках (папка на диске с местом).';
  return `Ошибка загрузки: ${e?.message || e}`;
}

// ---------- озвучка отдельными файлами ----------

const AUDIO_EXT = /\.(mka|ac3|eac3|dts|aac|flac|mp3|ogg|opus|thd|m4a)$/i;

// Звуковые файлы, лежащие рядом с выбранным видео (та же верхняя папка раздачи). Для сериала — только нужной серии.
function findExternalAudio(files, video, t) {
  const norm = (p) => p.replace(/\\/g, '/');
  const top = norm(video.path).split('/')[0];
  const single = norm(video.path).split('/').length === 1;
  return files.filter((f) => {
    if (f === video || !AUDIO_EXT.test(f.name) || f.length < 5e6) return false;
    if (!single && norm(f.path).split('/')[0] !== top) return false;
    if (t.episode) {
      const e = parseFile(f.path).episode;
      if (e != null && e !== t.episode) return false;
    }
    return true;
  });
}

// Название озвучки из имени файла: убираем то, что совпадает с названием видео («Movie.2020.1080p.LostFilm.ac3» → «LostFilm»)
function externalLabel(file, video) {
  const base = (n) => n.replace(/\.[a-z0-9]{2,4}$/i, '');
  const a = base(file.name);
  const b = base(video.name);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const rest = a.slice(i).replace(/[._]+/g, ' ').replace(/^[\s\-–—[(]+|[\s\-–—\])]+$/g, '').trim();
  return rest || a.replace(/[._]+/g, ' ').trim() || 'Внешняя дорожка';
}

function guessLang(label) {
  if (/дубл|озвуч|\b(mvo|dvo|avo)\b|lostfilm|кубик|jaskier|hdrezka|нева|\brus(sian)?\b/i.test(label)) return 'rus';
  if (/\b(eng(lish)?|original|оригинал)\b/i.test(label)) return 'eng';
  return '';
}

// ---------- ffmpeg ----------

function probe(srcUrl, fallbackDuration, procs) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-rw_timeout', '90000000', '-i', srcUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
    procs.add(p); // чтобы «Отмена» останавливала и анализ
    p.on('close', () => procs.delete(p));
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill(), 100_000);
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(timer);
      const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      // У части mkv длительность не записана (Duration: N/A) — тогда берём из карточки фильма
      const duration = dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : fallbackDuration || 0;
      if (!duration || !/Stream #0/.test(err)) {
        console.error('[ffmpeg probe]', err.trim().split(/\r?\n/).slice(-6).join(' | '));
        return reject(new PlayError('Не удалось прочитать видео из раздачи'));
      }

      const audios = [];
      let last = null;
      for (const line of err.split(/\r?\n/)) {
        const a = /Stream #0:\d+(?:\((\w+)\))?.*?: Audio: (\w+)[^,]*, \d+ Hz, ([^,\s(]+)/.exec(line);
        if (a) {
          last = { lang: a[1] && a[1] !== 'und' ? a[1] : '', codec: a[2], title: '', ch: a[3] === 'stereo' ? '2.0' : a[3] === 'mono' ? '1.0' : a[3] };
          audios.push(last);
        } else if (/Stream #0:\d+/.test(line)) last = null;
        else if (last && /^\s+title\s*:/.test(line)) last.title = line.split(':').slice(1).join(':').trim();
      }
      // Копируем видео без перекодирования только для 8-битного H.264 — его гарантированно играет Chromium
      const copy = /Video: h264[^,]*, yuv420p\b/.test(err);
      // HDR (PQ или HLG): без преобразования картинка в SDR получается тёмной и блёклой
      const hdr = /Video:[^\n]*(smpte2084|arib-std-b67)/.test(err);
      // Главы файла («Intro», «Опенинг», «Титры»…) — по ним точно знаем, где заканчивается заставка
      const chapters = [];
      for (const line of err.split(/\r?\n/)) {
        const c = /Chapter #\d+:\d+: start ([\d.]+), end ([\d.]+)/.exec(line);
        if (c) chapters.push({ start: parseFloat(c[1]), end: parseFloat(c[2]), title: '' });
        else if (chapters.length && !chapters[chapters.length - 1].title && /^\s+title\s*:/.test(line)) {
          chapters[chapters.length - 1].title = line.split(':').slice(1).join(':').trim();
        }
      }
      resolve({ duration, audios, chapters, copy: copy && !hdr, hdr });
    });
  });
}

// Копирование видео (без перекодирования) допустимо только при старте с начала файла.
// При старте с середины (перемотка, «Продолжить») ffmpeg начинает с ближайшего ключевого кадра,
// и картинка уезжает от шкалы времени на интервал между ключевыми кадрами (до ~10 с) — поэтому перекодируем:
// так перемотка точная, а звук и видео начинаются в одной точке.
// Фильтр видео: уменьшаем до 1080p, а HDR переводим в SDR (tone mapping).
// npl=203 — «диффузный белый» HDR становится белым в SDR; mobius сохраняет середины и плавно сжимает блики.
// Параметры подобраны по замеру яркости на тестовых кадрах (тени / середины / белый / блики).
function videoFilter(hdr, { maxHeight = 1080, hdrToneMap = true } = {}) {
  const scale = `scale=-2:min(${maxHeight}\\,ih)`;
  if (!hdr || !hdrToneMap) return scale;
  return [
    scale,
    'zscale=t=linear:npl=203',
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=mobius:param=0.7:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');
}

function ffmpegArgs(srcUrl, { start, audio, copy, hdr, opts, ext }) {
  const reencode = !copy || start > 0;
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rw_timeout', '120000000', // при перемотке ffmpeg может долго ждать нужные куски
    '-fflags', '+genpts',
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-i', srcUrl,
    // Озвучка из отдельного файла раздачи — вторым входом (с тем же сдвигом по времени)
    ...(ext ? [...(start > 0 ? ['-ss', String(start)] : []), '-i', ext.url] : []),
    '-map', '0:v:0', '-map', ext ? '1:a:0?' : `0:a:${audio}?`,
    ...(reencode
      ? [
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
          '-vf', videoFilter(hdr, opts),
          '-g', '48', '-keyint_min', '48', // фрагменты по ~2 с, чтобы плеер начинал быстро
        ]
      : ['-c:v', 'copy']),
    '-af', 'aresample=async=1:first_pts=0', // звук строго по меткам времени
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-sn', '-dn',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+negative_cts_offsets',
    '-f', 'mp4', 'pipe:1',
  ];
}

async function ensureStreamServer() {
  if (streamServer) return streamServer;
  streamServer = http.createServer((req, res) => {
    const s = session;
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/play' || !s?.info) {
      res.writeHead(404);
      return res.end();
    }
    const start = Math.max(0, Number(u.searchParams.get('start')) || 0);
    const audio = Math.max(0, Number(u.searchParams.get('audio')) || 0);
    const t0 = Date.now();
    let sent = 0;
    console.log(
      `[stream] ${req.method} start=${start} с, звук #${audio}, видео: ${s.info.copy && start === 0 ? 'копия' : 'перекодирование'}, Range: ${req.headers.range || '—'}`,
    );
    const ext = audio >= s.info.audios.length ? s.externals[audio - s.info.audios.length] || null : null;
    const ff = spawn(ffmpegPath, ffmpegArgs(s.srcUrl, { start, audio, copy: s.info.copy, hdr: s.info.hdr, opts: loadSettings(), ext }), { stdio: ['ignore', 'pipe', 'pipe'] });
    s.procs.add(ff);
    ff.on('close', () => s.procs.delete(ff));
    // ffmpeg чуть уступает процессор: плеер и интерфейс важнее, иначе при перекодировании возможны рывки картинки
    try {
      os.setPriority(ff.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    ff.stderr.on('data', (d) => console.error('[ffmpeg]', d.toString().trim()));

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    ff.stdout.on('data', (d) => (sent += d.length));
    ff.stdout.pipe(res);
    res.on('close', () => {
      console.log(`[stream] соединение закрыто через ${((Date.now() - t0) / 1000).toFixed(1)} с, отправлено ${(sent / 1e6).toFixed(1)} МБ`);
      ff.kill();
    });
  });
  await new Promise((resolve) => streamServer.listen(0, '127.0.0.1', resolve));
  return streamServer;
}

// ---------- сессия ----------

async function play(t, send) {
  stop();
  const me = { torrent: null, file: null, srcUrl: '', info: null, externals: [], procs: new Set(), cancelled: false };
  session = me;
  const aborted = () => me.cancelled || session !== me;

  send({ text: 'Подключаемся к раздаче…' });
  const source = await resolveSource(t);
  if (aborted()) return null;

  const wt = await ensureTorrentClient();
  // Своя папка на каждый просмотр: остатки прошлого (файл может быть ещё занят процессом, который завершается) не мешают
  const dir = path.join(cacheDir(), `s${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  me.dir = dir;
  me.torrent = wt.add(source, { path: dir, announce: TRACKERS });
  const torrent = me.torrent;
  // Файлы делаем разреженными ДО первой записи, иначе Windows заполнит нулями всё до места записи
  // (запись куска в конец 10-гигабайтного файла блокирует диск на минуты).
  let sparseDone = false;
  const makeSparse = () => {
    if (sparseDone || !torrent.files?.length) return;
    sparseDone = true;
    for (const f of torrent.files) markSparse(path.join(dir, f.path));
  };
  makeSparse();
  torrent.once('metadata', makeSparse);
  let failure = null;
  torrent.on('error', (e) => {
    console.error('[torrent]', e);
    failure = e;
    // ошибка уже во время просмотра (например, кончилось место) — сообщаем интерфейсу
    if (me.info && !aborted()) send({ fatal: describeError(e) });
  });
  const check = () => {
    if (failure) throw new PlayError(describeError(failure));
  };

  // 1. Метаданные
  const started = Date.now();
  while (!torrent.ready) {
    if (aborted()) return null;
    check();
    if (Date.now() - started > METADATA_TIMEOUT) throw new PlayError('Не удалось подключиться: нет сидов или раздача недоступна');
    send({ text: `Ищем источники… (пиров: ${torrent.numPeers})` });
    await sleep(500);
  }

  // 2. Нужный видеофайл: для сериала — файл заданной серии, для фильма — самый большой
  const videos = torrent.files.filter((f) => VIDEO.test(f.name));
  if (!videos.length) throw new PlayError('В раздаче нет видеофайла');
  let file;
  if (t.episode) {
    file = pickEpisode(videos, t.season || null, t.episode);
    if (!file) {
      throw new PlayError(
        `В этой раздаче нет ${t.season ? `серии ${t.season}×${t.episode}` : `серии ${t.episode}`}. Выберите другую раздачу — например, на весь сезон.`,
      );
    }
  } else file = [...videos].sort((a, b) => b.length - a.length)[0];
  me.file = file;
  // Следующая серия в этой же раздаче (для автоперехода): сначала в том же сезоне, затем первая серия следующего
  let next = null;
  if (t.episode) {
    const sameSeason = pickEpisode(videos, t.season || null, t.episode + 1);
    if (sameSeason && sameSeason.path !== file.path) next = { season: t.season || null, episode: t.episode + 1 };
    else if (t.season && pickEpisode(videos, t.season + 1, 1)) next = { season: t.season + 1, episode: 1 };
  }
  me.next = next;
  // Хватит ли места: WebTorrent может скачать файл целиком
  const { bavail, bsize } = await fs.promises.statfs(dir);
  const free = bavail * bsize;
  if (free < file.length * 1.02 + 5e8) {
    throw new PlayError(
      `Недостаточно места на диске: для этой раздачи нужно ${gb(file.length)}, свободно ${gb(free)}. Укажите downloadDir в настройках (папка на другом диске) или выберите раздачу поменьше.`,
    );
  }
  for (const f of torrent.files) if (f !== file) f.deselect();
  file.select();

  // 3. Первыми качаем начало файла: оттуда ffmpeg читает заголовок. Конец (индекс mkv) нужен только при перемотке.
  // Маленький хвост тоже нужен: ffmpeg при открытии mkv заглядывает в теги и индекс в конце файла.
  const pl = torrent.pieceLength;
  const pieceOf = (byte) => Math.floor((file.offset + byte) / pl);
  const headFrom = pieceOf(0);
  const headTo = pieceOf(Math.min(HEAD_BYTES, file.length) - 1);
  const tailFrom = pieceOf(Math.max(0, file.length - TAIL_BYTES));
  const tailTo = pieceOf(file.length - 1);
  // Файл целиком качается подряд с приоритетом 0, и конец дошёл бы только в самом конце загрузки.
  // Обычные select() WebTorrent склеивает с общей выборкой и теряет приоритет, а «потоковые» остаются
  // отдельными — поэтому используем их (приватный API, версия библиотеки закреплена в package.json).
  torrent._select(headFrom, headTo, 2, undefined, true);
  torrent._select(tailFrom, tailTo, 1, undefined, true);
  // Ждём только начало файла. Конец (теги и индекс) качается параллельно с высоким приоритетом, и ffmpeg
  // дождётся его сам при анализе — на медленных раздачах с крупными кусками (8 МБ) это экономит минуты.
  const wanted = [];
  for (let i = headFrom; i <= headTo; i++) wanted.push(i);
  const headTotal = wanted.length;
  const bufferStart = Date.now();
  let lastLog = 0;
  for (;;) {
    if (aborted()) return null;
    check();
    const missing = wanted.filter((i) => !torrent.bitfield.get(i));
    const have = headTotal - missing.length;
    if (have === headTotal) break;
    if (Date.now() - lastLog > 3000) {
      lastLog = Date.now();
      const owners = (i) => torrent.wires.filter((w) => w.peerPieces?.get(i)).length;
      console.log(
        `[buffer] ${have}/${headTotal} кусков, ${mb(torrent.downloadSpeed)}/с, пиров ${torrent.numPeers}, кусок ${(pl / 1e6).toFixed(2)} МБ; ждём: ` +
          missing.slice(0, 8).map((i) => `#${i}(у ${owners(i)})`).join(' '),
      );
    }
    if (Date.now() - bufferStart > BUFFER_TIMEOUT) {
      throw new PlayError('Раздача слишком медленная: не удалось загрузить начало файла. Попробуйте другую раздачу с большим числом сидов.');
    }
    const pct = Math.round((have / headTotal) * 100);
    // Если за 20 секунд почти ничего не пришло — раздача слабая, говорим об этом прямо
    const slow = Date.now() - bufferStart > 20_000 && torrent.downloadSpeed < 5e5;
    send({
      text: `Буферизация ${pct}% · ${mb(torrent.downloadSpeed)}/с · пиров: ${torrent.numPeers}`,
      pct,
      hint: slow ? 'Раздача медленная: у неё мало сидов. Можно подождать или нажать Ⓑ и выбрать другую (лучше с большим числом сидов).' : '',
    });
    await sleep(500);
  }
  if (aborted()) return null;
  // Нужные куски получены: снимаем повышенный приоритет, дальше качаем по запросам плеера
  torrent._deselect(headFrom, headTo, true);
  // приоритет на конец файла снимаем только после анализа (ffmpeg читает оттуда теги)
  const releaseTail = () => {
    try {
      torrent._deselect(tailFrom, tailTo, true);
    } catch {}
  };

  // 4. Разбираем дорожки и готовим стрим
  me.srcUrl = `http://127.0.0.1:${torrentServer.address().port}${file.streamURL}`;
  const probeStart = Date.now();
  const tick = () =>
    send({
      text: `Анализируем видео… ${Math.round((Date.now() - probeStart) / 1000)} с · ${mb(torrent.downloadSpeed)}/с · пиров: ${torrent.numPeers}`,
      pct: 100,
    });
  tick();
  const ticker = setInterval(tick, 1000);
  try {
    me.info = await probe(me.srcUrl, t.movieLength ? t.movieLength * 60 : 0, me.procs);
  } finally {
    clearInterval(ticker);
    releaseTail();
  }
  console.log(`[probe] ${((Date.now() - probeStart) / 1000).toFixed(1)} с`);
  if (aborted()) return null;
  const server = await ensureStreamServer();

  // Озвучки отдельными файлами (Audio/…mka, .ac3, .dts): ffmpeg подмешает выбранную к видео
  me.externals = findExternalAudio(torrent.files, file, t).map((f) => ({
    url: `http://127.0.0.1:${torrentServer.address().port}${f.streamURL}`,
    label: externalLabel(f, file),
    codec: path.extname(f.name).slice(1).toLowerCase(),
  }));
  const allAudios = [
    ...me.info.audios,
    ...me.externals.map((e) => ({ lang: guessLang(e.label), codec: e.codec, title: e.label, ch: '', external: true })),
  ];
  const pref = t.prefAudio || {}; // выбор, который пользователь делал для этого фильма раньше
  const byPref = pref.title ? allAudios.findIndex((a) => a.title === pref.title) : -1;
  const byLang = (lang) => (lang ? allAudios.findIndex((a) => a.lang === lang) : -1);
  const prefAudio = [byPref, byLang(pref.lang), byLang(loadSettings().audioLang)].find((i) => i >= 0) ?? 0;

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    duration: me.info.duration,
    next: me.next, // следующая серия в этой же раздаче (или null)
    chapters: me.info.chapters, // главы файла: по ним ищем заставку и титры
    introSkip: loadSettings().introSkip, // на сколько секунд прыгать, если глав нет
    audios: allAudios,
    // какую дорожку включить: прежний выбор для этого фильма → язык из настроек → первая
    prefAudio,
    mode: me.info.copy ? 'copy' : me.info.hdr ? 'hdr' : 'transcode',
  };
}

function stop() {
  const s = session;
  session = null;
  if (!s) return;
  s.cancelled = true;
  for (const p of s.procs) p.kill();
  try {
    s.torrent?.destroy({ destroyStore: true });
  } catch {}
  // Пустую папку сессии убираем чуть позже, когда файлы уже удалены
  if (s.dir) setTimeout(() => fs.rm(s.dir, { recursive: true, force: true }, () => {}), 5000);
}

// Сколько фильма уже скачано впереди от позиции pos (секунды) — считаем непрерывные скачанные куски.
// Время получаем пропорционально размеру файла (средний битрейт), поэтому значение приблизительное.
function bufferAhead(pos) {
  const s = session;
  if (!s?.torrent || !s.file || !s.info) return null;
  const t = s.torrent;
  const f = s.file;
  const byte = Math.min(f.length - 1, Math.max(0, Math.floor((pos / s.info.duration) * f.length)));
  const pl = t.pieceLength;
  const abs = f.offset + byte;
  let p = Math.floor(abs / pl);
  const last = Math.floor((f.offset + f.length - 1) / pl);
  const first = p;
  while (p <= last && t.bitfield.get(p)) p++;
  const aheadBytes = p === first ? 0 : Math.min(f.length - byte, p * pl - abs);
  return {
    aheadSec: (aheadBytes / f.length) * s.info.duration,
    toEnd: p > last,
    speed: t.downloadSpeed,
    peers: t.numPeers,
    progress: f.progress,
  };
}

function registerPlayer(getWin) {
  // Остатки прошлых запусков (сбои, закрытие приложения во время просмотра)
  try {
    fs.rmSync(cacheDir(), { recursive: true, force: true });
  } catch (err) {
    console.warn('[cache] не удалось очистить кэш:', err.message); // файлы могут быть заняты — не критично
  }

  const send = (payload) => getWin()?.webContents.send('player:status', payload);

  ipcMain.handle('player:play', async (_e, torrent) => {
    try {
      const info = await play(torrent, send);
      return info ? { ok: true, data: info } : { ok: false, error: 'cancelled' };
    } catch (err) {
      stop();
      return { ok: false, error: err instanceof PlayError ? err.message : `Ошибка: ${err.message}` };
    }
  });
  ipcMain.on('player:stop', stop);
  ipcMain.handle('cache:clear', async () => {
    stop();
    try {
      fs.rmSync(cacheDir(), { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('player:buffer', (_e, pos) => bufferAhead(Number(pos) || 0));
  // Раз в 10 секунд плеер присылает статистику воспроизведения — пишем её в журнал вместе с нагрузкой главного процесса
  ipcMain.on('player:perf', (_e, p) => {
    const lag = { max: loopDelay.max / 1e6, p99: loopDelay.percentile(99) / 1e6 };
    loopDelay.reset();
    const s = session;
    console.log(
      `[perf] кадров: пропущено ${p.dropped} из ${p.total} | зависаний буфера: ${p.waits} | запас видео: ${p.ahead.toFixed(1)} с | ` +
        `пауза главного процесса: макс ${lag.max.toFixed(0)} мс, p99 ${lag.p99.toFixed(0)} мс | торрент ↓${mb(s?.torrent?.downloadSpeed || 0)}/с, пиров ${s?.torrent?.numPeers ?? 0} | ` +
        `режим: ${p.mode}`,
    );
  });
  app.on('before-quit', stop);
}

module.exports = { registerPlayer };
