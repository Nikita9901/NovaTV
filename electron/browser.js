// Браузер: обычная веб-страница в отдельном окне-«слое» под панелью управления (она рисуется в основном окне).
// Геймпадом управляет preload-browser.js: левый стик — курсор, Ⓐ — клик, стики и крестовина — прокрутка.
// Пока страница в фокусе, геймпад опрашивает она сама; когда нужна панель или клавиатура, фокус возвращается в основное окно.
const path = require('path');
const { app, ipcMain, WebContentsView } = require('electron');

const SEARCH = 'https://duckduckgo.com/?q=';
const START_ZOOM = 1.25; // на телевизоре и мониторе в 2K обычные сайты мелкие

let getWin = () => null;
let view = null;
let mode = 'page'; // page — геймпад управляет страницей; ui — панелью в основном окне
let zoom = START_ZOOM;
let fullscreen = false; // страница показывает видео на весь экран
let layout = { top: 0, bottom: 0 }; // сколько места занимают панель сверху и клавиатура снизу

const send = (channel, payload) => getWin()?.webContents.send(channel, payload);

// Что человек вписал в адресную строку: адрес сайта или запрос для поиска
function normalize(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(text)) return `https://${text}`;
  return SEARCH + encodeURIComponent(text);
}
const allowed = (url) => /^https?:\/\//i.test(url) || url === 'about:blank';

function state() {
  const h = view?.webContents.navigationHistory;
  return {
    open: !!view,
    url: view?.webContents.getURL() || '',
    title: view?.webContents.getTitle() || '',
    loading: !!view?.webContents.isLoading(),
    canBack: !!h?.canGoBack(),
    canForward: !!h?.canGoForward(),
    zoom,
  };
}
const push = () => send('browser:state', state());

function fit() {
  const win = getWin();
  if (!view || !win) return;
  const [w, h] = win.getContentSize();
  view.setBounds(fullscreen ? { x: 0, y: 0, width: w, height: h } : { x: 0, y: layout.top, width: w, height: Math.max(100, h - layout.top - layout.bottom) });
}

function setMode(next) {
  mode = next;
  if (!view) return;
  view.webContents.send('browser:mode', mode);
  // в какую сторону смотрит геймпад, зависит от того, какое окно в фокусе
  if (mode === 'page') view.webContents.focus();
  else getWin()?.webContents.focus();
}

function create(url) {
  const win = getWin();
  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-browser.js'),
      partition: 'persist:browser',
      contextIsolation: true,
      sandbox: true,
    },
  });
  const wc = view.webContents;
  const ses = wc.session;
  // Обычный Chrome-адрес: «Electron» в user-agent ломает часть сайтов
  ses.setUserAgent(wc.getUserAgent().replace(/\s(Electron|nova-tv|google-tv-win)\/\S+/gi, ''));
  // Страницы ничего не просят у компьютера (камера, геолокация, уведомления), кроме полноэкранного режима
  ses.setPermissionRequestHandler((_c, permission, cb) => cb(permission === 'fullscreen'));
  ses.removeAllListeners('will-download');
  ses.on('will-download', (e) => e.preventDefault()); // скачивание файлов в браузере не поддерживается

  // Ссылки «в новом окне» открываем в этом же; страницы не с http(s) не пускаем
  wc.setWindowOpenHandler(({ url: target }) => {
    if (allowed(target)) wc.loadURL(target);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, target) => !allowed(target) && e.preventDefault());

  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, push);
  wc.on('did-fail-load', (_e, code, desc, _u, isMain) => {
    if (isMain && code !== -3) send('browser:event', { name: 'error', text: desc });
  });
  wc.on('enter-html-full-screen', () => {
    fullscreen = true;
    fit();
  });
  wc.on('leave-html-full-screen', () => {
    fullscreen = false;
    fit();
  });
  // Физическая клавиатура: Esc — панель, Ctrl+L — адрес, Alt+стрелки — история, F5 — обновить
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const nav = wc.navigationHistory;
    if (input.key === 'Escape' && !fullscreen) {
      send('browser:event', { name: 'toolbar' });
      e.preventDefault();
    } else if (input.control && input.key.toLowerCase() === 'l') {
      send('browser:event', { name: 'address' });
      e.preventDefault();
    } else if (input.alt && input.key === 'ArrowLeft') nav.canGoBack() && nav.goBack();
    else if (input.alt && input.key === 'ArrowRight') nav.canGoForward() && nav.goForward();
    else if (input.key === 'F5') wc.reload();
  });
  // Chromium сбрасывает масштаб при каждом переходе на другой сайт — возвращаем наш
  wc.on('dom-ready', () => wc.setZoomFactor(zoom));
  wc.on('did-navigate', () => wc.setZoomFactor(zoom));
  win.contentView.addChildView(view);
  fit();
  wc.loadURL(url);
  setMode('page');
  push();
}

function changeZoom(delta) {
  zoom = Math.min(3, Math.max(0.5, Math.round((zoom + delta) * 100) / 100));
  view?.webContents.setZoomFactor(zoom);
  push();
}

function close() {
  const win = getWin();
  if (!view) return;
  win?.contentView.removeChildView(view);
  view.webContents.close();
  view = null;
  fullscreen = false;
  win?.webContents.focus();
  push();
}

// Ввод текста в поле на странице. execCommand работает и пока окно страницы не в фокусе (мы отдали фокус клавиатуре).
const typeJs = (text) => `document.execCommand('insertText', false, ${JSON.stringify(text)})`;
const KEY_JS = {
  Backspace: `document.execCommand('delete')`,
  Enter: `(() => { const el = document.activeElement; if (!el) return;
    const ev = (t) => el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    if (ev('keydown') && el.form && el.tagName !== 'TEXTAREA') { ev('keypress'); el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); }
    else if (el.tagName === 'TEXTAREA') document.execCommand('insertText', false, '\\n');
    ev('keyup'); })()`,
  Blur: `document.activeElement && document.activeElement.blur()`,
};

function register(opts) {
  getWin = opts.getWin;
  // Команды от нашего интерфейса (основное окно)
  const fromUi = (name, fn) => ipcMain.on(name, (e, arg) => e.sender === getWin()?.webContents && fn(arg));
  fromUi('browser:open', (url) => {
    const target = normalize(url) || 'about:blank';
    if (!view) create(target);
    else view.webContents.loadURL(target);
  });
  fromUi('browser:go', (text) => {
    const target = normalize(text);
    if (target && view) view.webContents.loadURL(target);
  });
  fromUi('browser:back', () => view?.webContents.navigationHistory.canGoBack() && view.webContents.navigationHistory.goBack());
  fromUi('browser:forward', () => view?.webContents.navigationHistory.canGoForward() && view.webContents.navigationHistory.goForward());
  fromUi('browser:reload', () => (view?.webContents.isLoading() ? view.webContents.stop() : view?.webContents.reload()));
  fromUi('browser:close', close);
  fromUi('browser:mode', setMode);
  fromUi('browser:layout', (l) => {
    layout = { top: Math.max(0, Math.round(l.top) || 0), bottom: Math.max(0, Math.round(l.bottom) || 0) };
    fit();
  });
  fromUi('browser:zoom', changeZoom);
  fromUi('browser:type', (text) => view?.webContents.executeJavaScript(typeJs(String(text).slice(0, 200))).catch(() => {}));
  fromUi('browser:key', (name) => KEY_JS[name] && view?.webContents.executeJavaScript(KEY_JS[name]).catch(() => {}));
  ipcMain.handle('browser:state', (e) => (e.sender === getWin()?.webContents ? state() : null));

  // События от самой страницы (preload-browser.js)
  const fromPage = (name, fn) => ipcMain.on(name, (e, arg) => view && e.sender === view.webContents && fn(arg));
  fromPage('browser:mouse', (m) => {
    const wc = view.webContents;
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    if (m.type === 'move') wc.sendInputEvent({ type: 'mouseMove', x, y });
    else if (m.type === 'down') wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    else if (m.type === 'up') wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    else if (m.type === 'wheel') wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -Math.round(m.dx || 0), deltaY: -Math.round(m.dy || 0), canScroll: true });
  });
  fromPage('browser:cmd', (cmd) => {
    const wc = view.webContents;
    const nav = wc.navigationHistory;
    if (cmd === 'back') {
      if (fullscreen) wc.executeJavaScript('document.exitFullscreen()').catch(() => {});
      else if (nav.canGoBack()) nav.goBack();
      else send('browser:event', { name: 'empty-back' });
    } else if (cmd === 'forward') nav.canGoForward() && nav.goForward();
    else if (cmd === 'zoomIn') changeZoom(0.1);
    else if (cmd === 'zoomOut') changeZoom(-0.1);
    else if (cmd === 'reload') wc.reload();
    else send('browser:event', { name: cmd }); // toolbar, address, exit
  });
  // Геймпадом нажали на поле ввода: просим основное окно показать экранную клавиатуру
  fromPage('browser:field-value', (v) => send('browser:field-value', v));
  fromPage('browser:field', (f) => {
    send('browser:field', f);
    if (f) setMode('ui');
  });

  app.on('before-quit', close);
}

module.exports = { register, attachWindow: (win) => win.on('resize', fit) };
