// Журнал работы приложения и проверка обновлений.
// Журнал нужен, чтобы пользователь мог прислать отчёт об ошибке одной кнопкой, а не скриншотом терминала.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, ipcMain, shell, BrowserWindow } = require('electron');

const REPO = 'Nikita9901/NovaTV';
const MAX_LOG = 2 * 1024 * 1024; // после этого размера журнал начинается заново (старый остаётся как app.old.log)

const logDir = () => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logDir(), 'app.log');

let queue = [];
let written = 0;

function flush() {
  if (!queue.length) return;
  const text = queue.join('');
  queue = [];
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    if (written > MAX_LOG) {
      fs.rmSync(path.join(logDir(), 'app.old.log'), { force: true });
      fs.renameSync(logFile(), path.join(logDir(), 'app.old.log'));
      written = 0;
    }
    fs.appendFileSync(logFile(), text);
    written += text.length;
  } catch {
    /* журнал — не повод ронять приложение */
  }
}

const fmt = (args) =>
  args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');

function line(level, text) {
  queue.push(`${new Date().toISOString()} [${level}] ${text}\n`);
  if (queue.length > 200) flush();
}

// Всё, что приложение пишет в консоль основного процесса, дублируем в файл
function initLogging() {
  try {
    written = fs.existsSync(logFile()) ? fs.statSync(logFile()).size : 0;
  } catch {
    written = 0;
  }
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      line(level, fmt(args));
    };
  }
  setInterval(flush, 1500).unref();
  app.on('before-quit', flush);
  process.on('uncaughtException', (e) => {
    line('fatal', e.stack || String(e));
    flush();
  });
  line('info', `=== Nova TV ${app.getVersion()} запущен (${process.platform} ${process.arch}, Electron ${process.versions.electron}) ===`);
}

// Ошибки страницы интерфейса и падения её процесса — тоже в журнал
function watchWindow(win) {
  win.webContents.on('console-message', (e, ...rest) => {
    const level = e?.level ?? rest[0]; // в разных версиях Electron уровень приходит по-разному
    const message = e?.message ?? rest[1];
    const bad = level === 'error' || level === 'warning' || level === 2 || level === 3;
    if (bad && message) line('ui', String(message).slice(0, 600));
  });
  win.webContents.on('render-process-gone', (_e, d) => line('fatal', `процесс страницы завершился: ${d.reason} (код ${d.exitCode})`));
}

// ---------- Обновления ----------
const parts = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(latest, current) {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function checkUpdate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NovaTV' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { current: app.getVersion(), latest: null, newer: false };
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/i, '');
  return {
    current: app.getVersion(),
    latest,
    newer: !!latest && isNewer(latest, app.getVersion()),
    url: r.html_url,
    notes: String(r.body || '').slice(0, 1500),
  };
}

// ---------- Отчёт об ошибке ----------
function report() {
  flush();
  let tail = '';
  try {
    tail = fs.readFileSync(logFile(), 'utf8').split('\n').slice(-250).join('\n');
  } catch {
    tail = '(журнал пуст)';
  }
  const head = [
    `Nova TV ${app.getVersion()}`,
    `${os.type()} ${os.release()} ${process.arch}, Electron ${process.versions.electron}`,
    `Память: ${(os.freemem() / 1e9).toFixed(1)} из ${(os.totalmem() / 1e9).toFixed(1)} ГБ свободно`,
  ].join('\n');
  // Ключи и пути с именем пользователя в отчёт не попадают
  const clean = tail.split(os.homedir()).join('~');
  return `${head}\n\n--- журнал (последние строки) ---\n${clean}`;
}

function register() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    logDir: logDir(),
  }));
  ipcMain.handle('app:update', async () => {
    try {
      return { ok: true, data: await checkUpdate() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('app:report', () => ({ ok: true, data: report() }));
  ipcMain.handle('app:openLogs', async () => {
    fs.mkdirSync(logDir(), { recursive: true });
    const err = await shell.openPath(logDir());
    return err ? { ok: false, error: err } : { ok: true };
  });
  // Страницу загрузки открываем только если она принадлежит нашему репозиторию
  ipcMain.handle('app:openRelease', async (_e, url) => {
    if (typeof url !== 'string' || !url.startsWith(`https://github.com/${REPO}/`)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { initLogging, watchWindow, register };
