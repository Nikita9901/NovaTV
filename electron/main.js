const { app, BrowserWindow, WebContentsView, ipcMain, net } = require('electron');
const path = require('path');
const { registerApi } = require('./api');
const { registerPlayer } = require('./player');
const diagnostics = require('./diagnostics');
const browser = require('./browser');

const isDev = process.argv.includes('--dev');
// Папка данных одна и та же в разработке и в собранной версии (название продукта у собранной другое)
app.setPath('userData', process.env.NOVATV_USER_DATA || path.join(app.getPath('appData'), 'google-tv-win'));
diagnostics.initLogging();
// Leanback (youtube.com/tv) отдаёт TV-интерфейс только при TV user-agent.
const TV_UA =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.0 TV Safari/537.36';

// Недоступные трекеры торрентов роняют промисы внутри библиотеки — это не повод падать.
process.on('unhandledRejection', (err) => console.warn('[unhandledRejection]', err?.message || err));

let win = null;
let ytView = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !isDev,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'Nova TV',
    // в собранной версии значок лежит рядом с ресурсами, в разработке — в build/
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('resize', fitYoutube);
  win.webContents.on('before-input-event', (e, input) => hotkeys(e, input));
}

function hotkeys(e, input) {
  if (input.type !== 'keyDown') return;
  if (input.key === 'F11') {
    win.setFullScreen(!win.isFullScreen());
    e.preventDefault();
  } else if (input.key === 'F10') {
    closeYoutube();
    e.preventDefault();
  }
}

function fitYoutube() {
  if (!ytView || !win) return;
  const [w, h] = win.getContentSize();
  ytView.setBounds({ x: 0, y: 0, width: w, height: h });
}

// target — адрес внутри youtube.com/tv (например, поиск трейлера); чужие адреса не открываем
function openYoutube(target) {
  if (ytView) return;
  const url = typeof target === 'string' && /^https:\/\/www\.youtube\.com\/tv([#?/]|$)/.test(target) ? target : 'https://www.youtube.com/tv';
  ytView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-view.js'),
      partition: 'persist:youtube', // вход в аккаунт сохраняется между запусками
      contextIsolation: true,
      sandbox: true,
    },
  });
  ytView.webContents.setUserAgent(TV_UA);
  ytView.webContents.on('before-input-event', (e, input) => hotkeys(e, input));
  improveThumbnails(ytView.webContents);
  win.contentView.addChildView(ytView);
  fitYoutube();
  ytView.webContents.loadURL(url);
  ytView.webContents.focus();
}

// Заставки: YouTube/TV просит маленькие hqdefault.jpg (480×360 с чёрными полосами), которые на 2K растягиваются
// и выглядят мутно. Подменяем запрос на hq720.jpg (1280×720), если такая версия у видео есть.
const thumbCache = new Map(); // id → Promise<boolean>: есть ли у видео hq720
const hasHq720 = (id) => {
  if (!thumbCache.has(id)) {
    thumbCache.set(
      id,
      net
        .fetch(`https://i.ytimg.com/vi/${id}/hq720.jpg`, { method: 'HEAD' })
        .then((r) => r.ok)
        .catch(() => false),
    );
  }
  return thumbCache.get(id);
};

function improveThumbnails(contents) {
  const stat = { улучшено: 0, 'нет hq720': 0 };
  contents.session.webRequest.onBeforeRequest(
    { urls: ['*://i.ytimg.com/vi/*', '*://i.ytimg.com/vi_webp/*'] },
    async (d, cb) => {
      const m = /\/vi(?:_webp)?\/([\w-]{11})\/(?:mq|hq|sd)default\.(?:jpg|webp)/.exec(d.url);
      if (!m) return cb({});
      if (await hasHq720(m[1])) {
        stat.улучшено++;
        return cb({ redirectURL: `https://i.ytimg.com/vi/${m[1]}/hq720.jpg` });
      }
      stat['нет hq720']++;
      cb({});
    },
  );
  let last = '';
  const timer = setInterval(() => {
    const line = JSON.stringify(stat);
    if (line !== last && stat.улучшено + stat['нет hq720'] > 0) console.log('[youtube thumbs]', line);
    last = line;
  }, 5000);
  contents.once('destroyed', () => clearInterval(timer));
}

function closeYoutube() {
  if (!ytView) return;
  win.contentView.removeChildView(ytView);
  ytView.webContents.close();
  ytView = null;
  win.webContents.focus();
  win.webContents.send('tv:home');
}

ipcMain.on('tv:open-youtube', (_e, target) => openYoutube(target));
ipcMain.on('tv:home', closeYoutube);
ipcMain.on('tv:quit', () => app.quit());

// Геймпад внутри YouTube: preload страницы шлёт сюда нажатия,
// а мы отправляем их как настоящие клавиши.
ipcMain.on('view:key', (_e, keyCode) => {
  if (!ytView) return;
  ytView.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  ytView.webContents.sendInputEvent({ type: 'keyUp', keyCode });
});

app.whenReady().then(() => {
  registerApi();
  registerPlayer(() => win);
  diagnostics.register();
  browser.register({ getWin: () => win });
  createWindow();
  browser.attachWindow(win);
  diagnostics.watchWindow(win);
});
app.on('window-all-closed', () => app.quit());
