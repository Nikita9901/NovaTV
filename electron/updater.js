// Обновление приложения из релизов GitHub: проверка, загрузка с проверкой контрольной суммы и установка.
//  * Windows (установщик): скачиваем Setup, проверяем sha256, запускаем тихую установку, приложение перезапускается само.
//  * Windows (portable), macOS, Linux: скачиваем нужный файл в «Загрузки» и показываем его (заменить файл на ходу нельзя).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, ipcMain, shell, BrowserWindow } = require('electron');

const REPO = 'Nikita9901/NovaTV';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

const parts = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(latest, current) {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

const portable = () => !!process.env.PORTABLE_EXECUTABLE_FILE;

// Какой файл релиза подходит этой копии приложения
function assetPattern() {
  if (process.platform === 'win32') return portable() ? /^NovaTV-Portable-.*\.exe$/ : /^NovaTV-Setup-.*\.exe$/;
  if (process.platform === 'darwin') return new RegExp(`^NovaTV-.*-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}\\.dmg$`);
  return /^NovaTV-.*-linux\.AppImage$/;
}

// Можно ли поставить обновление без участия человека
const silentInstall = () => process.platform === 'win32' && !portable() && app.isPackaged;

let cached = null; // последняя проверка: нужна, чтобы установка брала адрес файла у нас, а не из окна интерфейса

async function check() {
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NovaTV' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return { current: app.getVersion(), latest: null, newer: false };
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/i, '');
  const asset = (r.assets || []).find((a) => assetPattern().test(a.name) && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX));
  const sha = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest || '')?.[1] || '';
  cached = asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size, sha } : null;
  return {
    current: app.getVersion(),
    latest,
    newer: !!latest && isNewer(latest, app.getVersion()),
    url: r.html_url,
    notes: String(r.body || '').slice(0, 1500),
    // файл для этой системы есть в релизе: можно скачать прямо из приложения
    canDownload: !!cached,
    silent: !!cached && !!sha && silentInstall(),
  };
}

const notify = (payload) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('app:update-progress', payload));
let busy = false;
let ready = null; // скачанный и проверенный файл: { file, silent }

// Шаг 1: скачиваем и проверяем контрольную сумму
async function download() {
  if (busy) throw new Error('Обновление уже скачивается');
  if (!cached) throw new Error('Сначала проверьте обновления');
  const { name, url, size, sha } = cached;
  busy = true;
  try {
    const silent = !!sha && silentInstall();
    // Установщик кладём во временную папку, остальное — в «Загрузки»
    const dir = silent ? path.join(app.getPath('temp'), 'novatv-update') : app.getPath('downloads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    notify({ pct: 0, text: 'Скачиваем обновление…' });

    const res = await fetch(url, { headers: { 'User-Agent': 'NovaTV' } });
    if (!res.ok || !res.body) throw new Error(`Загрузка не удалась (${res.status})`);
    const total = Number(res.headers.get('content-length')) || size || 0;
    const hash = crypto.createHash('sha256');
    let got = 0;
    const src = Readable.fromWeb(res.body);
    let shown = -1;
    src.on('data', (c) => {
      hash.update(c);
      got += c.length;
      const pct = total ? Math.min(99, Math.round((got / total) * 100)) : 0;
      if (total && pct !== shown) {
        shown = pct; // сообщаем интерфейсу не чаще, чем меняется процент
        notify({ pct, text: `Скачиваем: ${(got / 1e6).toFixed(0)} из ${(total / 1e6).toFixed(0)} МБ` });
      }
    });
    await pipeline(src, fs.createWriteStream(file));

    // Контрольная сумма из GitHub: если файл подменили или он дошёл не целиком, запускать его нельзя
    if (sha && hash.digest('hex') !== sha.toLowerCase()) {
      fs.rmSync(file, { force: true });
      throw new Error('Контрольная сумма не совпала: файл повреждён, обновление отменено');
    }
    ready = { file, silent };
    return { silent, file };
  } finally {
    busy = false;
    notify(null);
  }
}

// Шаг 2: ставим. В Windows запускаем установщик и закрываемся, он сам запустит новую версию.
// На других системах показываем скачанный файл.
async function apply() {
  if (!ready) throw new Error('Обновление ещё не скачано');
  const { file, silent } = ready;
  if (silent) {
    // те же ключи, что использует electron-updater: тихая установка поверх и запуск после неё
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.quit(), 500);
    return { mode: 'installing' };
  }
  if (process.platform === 'darwin') await shell.openPath(file);
  else shell.showItemInFolder(file);
  return { mode: 'downloaded', path: file };
}

function register() {
  const wrap = (fn) => async () => {
    try {
      return { ok: true, data: await fn() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  ipcMain.handle('app:update', wrap(check));
  ipcMain.handle('app:update-download', wrap(download));
  ipcMain.handle('app:update-apply', wrap(apply));
  // Страницу релиза открываем, только если она принадлежит нашему репозиторию
  ipcMain.handle('app:openRelease', async (_e, url) => {
    if (typeof url !== 'string' || !url.startsWith(`https://github.com/${REPO}/`)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { register, isNewer };
