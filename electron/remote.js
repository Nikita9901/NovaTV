// Пульт на телефоне (Nova TV Remote): телефон находит компьютер в локальной сети, один раз вводится PIN-код,
// дальше подключение запоминается. По сети идут короткие JSON-сообщения: наклон телефона (курсор), клики, прокрутка, кнопки, текст.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { app, ipcMain, BrowserWindow } = require('electron');

const PORT = 47800; // WebSocket
const DISCOVERY_PORT = 47801; // UDP: телефон кричит «NOVATV?», компьютер отвечает своим именем и портом
const MAX_WRONG_PINS = 5; // неверных кодов с одного адреса за минуту

let deps = null; // { loadSettings, browser }
let wss = null;
let udp = null;
let data = null; // { pin, devices: [{ id, name, hash, last }] }
const wrong = new Map(); // ip → [время неверных попыток]
const online = new Map(); // ws → { id, name }

const dataFile = () => path.join(app.getPath('userData'), 'remote.json');
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newPin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    data = { pin: newPin(), devices: [] };
  }
  data.pin ||= newPin();
  data.devices ||= [];
  return data;
}
const save = () => {
  try {
    fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2));
  } catch {
    /* не критично */
  }
};
const changed = () => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('remote:changed'));

// Адреса компьютера в домашних сетях: именно их телефону и нужно показать
function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) out.push(i.address);
    }
  }
  return out;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function tooManyWrong(ip) {
  const now = Date.now();
  const list = (wrong.get(ip) || []).filter((t) => now - t < 60_000);
  wrong.set(ip, list);
  return list.length >= MAX_WRONG_PINS;
}

// ---------- Сообщения от телефона ----------
function dispatch(m) {
  if (deps.browser.remote(m)) return; // страница в браузере забрала сообщение себе
  BrowserWindow.getAllWindows()[0]?.webContents.send('remote:msg', m);
}

function onConnection(ws, req) {
  const ip = req.socket.remoteAddress || '';
  let session = null;
  const timer = setTimeout(() => !session && ws.close(), 8000); // кто не представился за 8 секунд — отключаем

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    if (!session) {
      if (m.t === 'pair') {
        if (tooManyWrong(ip)) return ws.send(JSON.stringify({ t: 'denied', why: 'many' }));
        if (!safeEqual(m.pin, load().pin)) {
          wrong.get(ip).push(Date.now());
          return ws.send(JSON.stringify({ t: 'denied', why: 'pin' }));
        }
        const token = crypto.randomBytes(24).toString('hex');
        const dev = { id: crypto.randomBytes(6).toString('hex'), name: String(m.name || 'Телефон').slice(0, 40), hash: hash(token), last: Date.now() };
        load().devices.push(dev);
        data.pin = newPin(); // этим кодом больше не войти
        save();
        session = dev;
        online.set(ws, dev);
        ws.send(JSON.stringify({ t: 'paired', token, host: os.hostname() }));
        changed();
      } else if (m.t === 'hello') {
        const dev = load().devices.find((d) => safeEqual(d.hash, hash(m.token)));
        if (!dev) return ws.send(JSON.stringify({ t: 'denied', why: 'token' }));
        dev.last = Date.now();
        save();
        session = dev;
        online.set(ws, dev);
        ws.send(JSON.stringify({ t: 'ready', host: os.hostname() }));
        changed();
      }
      return;
    }
    if (m.t === 'ping') return ws.send('{"t":"pong"}');
    dispatch(m);
  });

  ws.on('close', () => {
    clearTimeout(timer);
    if (online.delete(ws)) changed();
  });
  ws.on('error', () => {});
}

// ---------- Включение и выключение ----------
function start() {
  if (wss) return;
  load();
  wss = new WebSocketServer({ port: PORT, host: '0.0.0.0', maxPayload: 16 * 1024 });
  wss.on('connection', onConnection);
  wss.on('error', (e) => console.warn('[пульт] ошибка сервера:', e.message));

  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('message', (msg, rinfo) => {
    if (String(msg).trim() !== 'NOVATV?') return;
    udp.send(JSON.stringify({ name: os.hostname(), port: PORT }), rinfo.port, rinfo.address);
  });
  udp.on('error', (e) => console.warn('[пульт] ошибка поиска:', e.message));
  udp.bind(DISCOVERY_PORT, '0.0.0.0');
  console.log('[пульт] включён: порт', PORT);
  changed();
}

function stop() {
  for (const ws of online.keys()) ws.close();
  online.clear();
  wss?.close();
  wss = null;
  try {
    udp?.close();
  } catch {
    /* уже закрыт */
  }
  udp = null;
  changed();
}

function status() {
  load();
  return {
    running: !!wss,
    pin: data.pin,
    port: PORT,
    addresses: addresses(),
    host: os.hostname(),
    devices: data.devices.map((d) => ({ id: d.id, name: d.name, last: d.last, online: [...online.values()].some((o) => o.id === d.id) })),
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
  ipcMain.handle('remote:status', wrap(status));
  ipcMain.handle('remote:enable', wrap((on) => {
    deps.patchSettings({ remoteEnabled: !!on });
    if (on) start();
    else stop();
    return status();
  }));
  ipcMain.handle('remote:forget', wrap((id) => {
    load();
    const dev = data.devices.find((x) => x.id === id);
    data.devices = data.devices.filter((x) => x.id !== id);
    for (const [ws, o] of online) if (o.id === id) ws.close();
    save();
    return dev ? status() : status();
  }));
  ipcMain.handle('remote:newpin', wrap(() => {
    load().pin = newPin();
    save();
    return status();
  }));
  app.whenReady().then(() => deps.loadSettings().remoteEnabled && start());
  app.on('before-quit', stop);
}

module.exports = { register };
