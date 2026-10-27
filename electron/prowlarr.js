// Встроенный Prowlarr: скачиваем, запускаем как фоновый процесс и настраиваем трекеры прямо из приложения.
// Можно и работать со своим Prowlarr — тогда используются адрес и ключ из настроек.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, ipcMain, BrowserWindow } = require('electron');
const { resolveDownload } = require('./prowlarr-download');

const PORT = 9797; // не 9696, чтобы не пересекаться с установленным отдельно Prowlarr
const WIN = process.platform === 'win32';
const OS = WIN ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch === 'arm64' && !WIN ? 'arm64' : 'x64';
const UPDATE_FEED = `https://prowlarr.servarr.com/v1/update/master/changes?os=${OS}&runtime=netcore&arch=${ARCH}`;

let deps = null; // { loadSettings, patchSettings }
let child = null;
let startPromise = null;
let installState = null; // { pct, text } пока идёт установка
let lastError = '';

const root = () => path.join(app.getPath('userData'), 'prowlarr');
const exePath = () => path.join(root(), 'Prowlarr', WIN ? 'Prowlarr.exe' : 'Prowlarr');
const dataDir = () => path.join(root(), 'data');
const configPath = () => path.join(dataDir(), 'config.xml');

const installed = () => fs.existsSync(exePath());

// Ключ доступа создаём сами и записываем в config.xml: так он известен до первого запуска
function ensureConfig() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(configPath())) return;
  const key = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(
    configPath(),
    `<Config>
  <BindAddress>127.0.0.1</BindAddress>
  <Port>${PORT}</Port>
  <ApiKey>${key}</ApiKey>
  <AuthenticationMethod>External</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
  <LaunchBrowser>False</LaunchBrowser>
  <UpdateMechanism>BuiltIn</UpdateMechanism>
  <Branch>master</Branch>
</Config>
`
  );
}

function builtinKey() {
  try {
    return /<ApiKey>([^<]+)<\/ApiKey>/.exec(fs.readFileSync(configPath(), 'utf8'))?.[1] || '';
  } catch {
    return '';
  }
}

// Куда ходить за раздачами: во встроенный Prowlarr или в тот, что указан в настройках
function conn() {
  const s = deps.loadSettings();
  if (s.prowlarrBuiltin) return { url: `http://127.0.0.1:${PORT}`, key: builtinKey(), builtin: true };
  return { url: (s.prowlarrUrl || '').replace(/\/+$/, ''), key: s.prowlarrKey, builtin: false };
}

async function call(method, route, body, timeout = 30_000) {
  const c = conn();
  if (!c.key) throw new Error('NO_PROWLARR');
  const res = await fetch(`${c.url}/api/v1${route}`, {
    method,
    headers: { 'X-Api-Key': c.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    let msg = `Prowlarr ответил ${res.status}`;
    try {
      const j = await res.json();
      const list = Array.isArray(j) ? j : [j];
      const text = list.map((e) => e.errorMessage || e.message).filter(Boolean).join('; ');
      if (text) msg = text;
    } catch {
      /* тело не JSON */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function reachable() {
  try {
    await call('GET', '/system/status', null, 3000);
    return true;
  } catch {
    return false;
  }
}

const notify = (channel, payload) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload));

// ---------- Установка ----------
async function install() {
  if (installState) throw new Error('Установка уже идёт');
  installState = { pct: 0, text: 'Узнаём последнюю версию…' };
  const push = (pct, text) => {
    installState = { pct, text };
    notify('prowlarr:progress', installState);
  };
  try {
    fs.mkdirSync(root(), { recursive: true });
    const { url } = await resolveDownload(fetch, { os: OS, arch: ARCH, feedUrl: UPDATE_FEED });

    push(1, 'Скачиваем Prowlarr…');
    const zip = path.join(root(), WIN ? 'prowlarr.zip' : 'prowlarr.tar.gz');
    const res = await fetch(url, { headers: { 'User-Agent': 'NovaTV' } });
    if (!res.ok || !res.body) throw new Error(`Загрузка не удалась (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const src = Readable.fromWeb(res.body);
    src.on('data', (c) => {
      got += c.length;
      if (total) push(Math.min(88, Math.round((got / total) * 88)), `Скачиваем Prowlarr: ${(got / 1e6).toFixed(0)} из ${(total / 1e6).toFixed(0)} МБ`);
    });
    await pipeline(src, fs.createWriteStream(zip));

    push(90, 'Распаковываем…');
    fs.rmSync(path.join(root(), 'Prowlarr'), { recursive: true, force: true });
    // В Windows архив zip: tar из состава системы его умеет (в отличие от tar из Git Bash); на macOS и Linux — tar.gz
    const tar = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tar, [WIN ? '-xf' : '-xzf', zip, '-C', root()], { windowsHide: true });
    if (r.status !== 0) throw new Error('Не удалось распаковать архив');
    if (!WIN) {
      try {
        fs.chmodSync(exePath(), 0o755);
      } catch {
        /* права выставит система */
      }
    }
    fs.rmSync(zip, { force: true });
    if (!installed()) throw new Error('В архиве нет Prowlarr.exe');
    ensureConfig();
    fs.rmSync(path.join(root(), '.mac-fixed-v1'), { force: true });
    push(96, 'Готовим файлы…');
    fixMac();
    push(100, 'Готово');
  } finally {
    installState = null;
    notify('prowlarr:progress', null);
  }
}

// ---------- Запуск и остановка ----------
// macOS: файлы из архива без подписи. На Apple Silicon ядро убивает неподписанный код («Killed: 9»), а Gatekeeper может
// остановить программы с пометкой карантина (её наследуют файлы, которые создаёт приложение, скачанное из интернета).
// Снимаем карантин и ставим «ad-hoc» подпись (достаточно для запуска) на исполняемый файл и библиотеки. Делается один раз.
function fixMac() {
  if (process.platform !== 'darwin') return;
  const marker = path.join(root(), '.mac-fixed-v1');
  if (fs.existsSync(marker)) return;
  const dir = path.join(root(), 'Prowlarr');
  try {
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', dir]);
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(dylib|so)$/.test(e.name) || e.name === 'Prowlarr' || (fs.statSync(f).mode & 0o111) !== 0) files.push(f);
      }
    };
    walk(dir);
    for (const f of files) spawnSync('codesign', ['--force', '--sign', '-', f]);
    fs.writeFileSync(marker, new Date().toISOString());
    console.log(`[prowlarr] macOS: подписано файлов: ${files.length}`);
  } catch (e) {
    console.warn('[prowlarr] macOS: не удалось подготовить файлы:', e.message);
  }
}

const runLog = () => path.join(root(), 'run.log');
const tailLog = (n = 12) => {
  try {
    return fs.readFileSync(runLog(), 'utf8').trim().split('\n').slice(-n).join('\n');
  } catch {
    return '';
  }
};

function start() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    lastError = '';
    if (!installed()) throw new Error('Prowlarr ещё не установлен');
    ensureConfig();
    fixMac();
    if (await reachable()) return; // уже работает
    let exited = false;
    let exitInfo = '';
    // Вывод Prowlarr пишем в файл: если не запустится, причина будет видна в отчёте об ошибке
    const out = fs.openSync(runLog(), 'a');
    // В Windows ключи через «/», в macOS и Linux через «-»
    const args = WIN ? [`/data=${dataDir()}`, '/nobrowser'] : [`-data=${dataDir()}`, '-nobrowser'];
    child = spawn(exePath(), args, { windowsHide: true, stdio: ['ignore', out, out] });
    child.on('exit', (code, signal) => {
      exited = true;
      exitInfo = signal ? `сигнал ${signal}` : `код ${code}`;
      child = null;
    });
    child.on('error', (e) => {
      exited = true;
      exitInfo = e.message;
    });
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await reachable()) return;
      if (exited) {
        const log = tailLog();
        console.warn(`[prowlarr] завершился (${exitInfo}):\n${log}`);
        const another = /Another instance|already running/i.test(log);
        lastError = another
          ? 'Уже запущен другой Prowlarr: закройте его (значок в трее → Exit) или переключитесь на «Свой Prowlarr»'
          : `Prowlarr закрылся сразу после запуска (${exitInfo}).${process.platform === 'darwin' ? ' На macOS это бывает из-за защиты системы: откройте «Настройки → О приложении → Скопировать отчёт об ошибке» и пришлите его.' : ''}${log ? `\n${log.split('\n').slice(-3).join('\n')}` : ''}`;
        throw new Error(lastError);
      }
    }
    stop();
    throw new Error('Prowlarr не запустился за 90 секунд');
  })().finally(() => {
    startPromise = null;
  });
  return startPromise;
}

function stop() {
  if (!child) return;
  try {
    if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  } catch {
    child.kill();
  }
  child = null;
}

// Для поиска: при встроенном режиме убеждаемся, что он запущен
async function ensureRunning() {
  const c = conn();
  if (!c.builtin) return;
  if (!installed()) throw new Error('NO_PROWLARR');
  if (!(await reachable())) await start();
}

// ---------- Трекеры ----------
const profileId = async () => (await call('GET', '/appprofile').catch(() => []))?.[0]?.id ?? 1;

const shortIndexer = (i) => ({
  id: i.id,
  name: i.name,
  enable: !!i.enable,
  privacy: i.privacy,
  language: i.language || '',
  definitionName: i.definitionName,
});

async function indexers() {
  await ensureRunning();
  const list = await call('GET', '/indexer');
  return list.filter((i) => i.protocol === 'torrent').map(shortIndexer);
}

let schemaCache = null;
async function schemas() {
  await ensureRunning();
  if (!schemaCache || Date.now() - schemaCache.at > 10 * 60_000) {
    schemaCache = { at: Date.now(), list: (await call('GET', '/indexer/schema', null, 60_000)).filter((s) => s.protocol === 'torrent') };
  }
  return schemaCache.list;
}

// Поля, которые человеку имеет смысл заполнять (логин, пароль, ключ), без служебных
const userFields = (s) =>
  (s.fields || [])
    .filter((f) => !f.advanced && (f.type === 'textbox' || f.type === 'password') && !/^(definitionFile|baseUrl|baseSettings\.|torrentBaseSettings\.)/.test(f.name))
    .map((f) => ({ name: f.name, label: f.label || f.name, secret: f.type === 'password', help: f.helpText || '' }));

async function catalog() {
  const list = await schemas();
  return list.map((s) => ({
    definitionName: s.definitionName,
    name: s.name,
    privacy: s.privacy,
    language: s.language || '',
    description: s.description || '',
    fields: userFields(s),
  }));
}

async function addIndexer({ definitionName, values = {} }) {
  const list = await schemas();
  const s = list.find((x) => x.definitionName === definitionName);
  if (!s) throw new Error('Такого трекера нет в каталоге');
  const body = {
    ...s,
    enable: true,
    appProfileId: await profileId(),
    tags: [],
    fields: s.fields.map((f) => (f.name in values ? { ...f, value: values[f.name] } : f)),
  };
  const added = await call('POST', '/indexer', body, 60_000);
  return shortIndexer(added);
}

async function removeIndexer(id) {
  await call('DELETE', `/indexer/${Number(id)}`);
}

async function toggleIndexer({ id, enable }) {
  const cur = await call('GET', `/indexer/${Number(id)}`);
  const upd = await call('PUT', `/indexer/${Number(id)}`, { ...cur, enable: !!enable });
  return shortIndexer(upd);
}

async function testIndexer(id) {
  const cur = await call('GET', `/indexer/${Number(id)}`);
  await call('POST', '/indexer/test', cur, 60_000);
}

// ---------- Автоматическая настройка при первом запуске ----------
// Публичные трекеры, которые работают без аккаунта: два русских (озвучки) и три международных
const DEFAULT_TRACKERS = ['rutor', 'noname-club', 'thepiratebay', 'yts', 'eztv'];

async function autosetup() {
  const push = (pct, text) => notify('prowlarr:progress', { pct, text });
  deps.patchSettings({ prowlarrBuiltin: true });
  if (!installed()) await install();
  push(92, 'Запускаем Prowlarr…');
  await start();

  push(94, 'Добавляем трекеры…');
  const have = new Set((await indexers()).map((i) => i.definitionName.toLowerCase()));
  const catalogList = await schemas();
  const results = [];
  for (const [i, def] of DEFAULT_TRACKERS.entries()) {
    const item = catalogList.find((s) => s.definitionName.toLowerCase() === def);
    const name = item?.name || def;
    if (have.has(def)) {
      results.push({ name, ok: true });
      continue;
    }
    push(94 + Math.round(((i + 1) / DEFAULT_TRACKERS.length) * 5), `Добавляем: ${name}`);
    try {
      await addIndexer({ definitionName: item?.definitionName || def });
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  push(100, 'Готово');
  return results;
}

// ---------- Состояние для окна настроек ----------
async function status() {
  const s = deps.loadSettings();
  const builtin = !!s.prowlarrBuiltin;
  const ok = await reachable();
  return {
    builtin,
    installed: installed(),
    running: ok,
    starting: !!startPromise,
    installing: installState,
    error: lastError,
    url: conn().url,
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
  ipcMain.handle('prowlarr:status', wrap(status));
  ipcMain.handle('prowlarr:install', wrap(install));
  ipcMain.handle('prowlarr:autosetup', wrap(autosetup));
  ipcMain.handle('prowlarr:start', wrap(start));
  ipcMain.handle('prowlarr:stop', wrap(async () => stop()));
  ipcMain.handle('prowlarr:indexers', wrap(indexers));
  ipcMain.handle('prowlarr:catalog', wrap(catalog));
  ipcMain.handle('prowlarr:add', wrap(addIndexer));
  ipcMain.handle('prowlarr:remove', wrap(removeIndexer));
  ipcMain.handle('prowlarr:toggle', wrap(toggleIndexer));
  ipcMain.handle('prowlarr:test', wrap(testIndexer));

  // Встроенный Prowlarr поднимаем вместе с приложением, чтобы первый поиск не ждал запуска
  app.whenReady().then(() => {
    const s = deps.loadSettings();
    if (s.prowlarrBuiltin && installed()) start().catch(() => {});
  });
  app.on('before-quit', stop);
}

module.exports = { register, conn, ensureRunning };
