const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tv', {
  openYoutube: (target) => ipcRenderer.send('tv:open-youtube', target),
  quit: () => ipcRenderer.send('tv:quit'),
  searchMovies: (query) => ipcRenderer.invoke('movies:search', query),
  getMovie: (id) => ipcRenderer.invoke('movies:get', id),
  getDetails: (id) => ipcRenderer.invoke('movies:details', id),
  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    enable: (on) => ipcRenderer.invoke('remote:enable', on),
    forget: (id) => ipcRenderer.invoke('remote:forget', id),
    newPin: () => ipcRenderer.invoke('remote:newpin'),
    // сообщения от телефона (курсор, клики, кнопки, текст) и изменения списка устройств
    onMessage: (cb) => {
      const h = (_e, m) => cb(m);
      ipcRenderer.on('remote:msg', h);
      return () => ipcRenderer.removeListener('remote:msg', h);
    },
    onChanged: (cb) => {
      const h = () => cb();
      ipcRenderer.on('remote:changed', h);
      return () => ipcRenderer.removeListener('remote:changed', h);
    },
  },
  browser: {
    open: (url) => ipcRenderer.send('browser:open', url),
    go: (text) => ipcRenderer.send('browser:go', text),
    back: () => ipcRenderer.send('browser:back'),
    forward: () => ipcRenderer.send('browser:forward'),
    reload: () => ipcRenderer.send('browser:reload'),
    close: () => ipcRenderer.send('browser:close'),
    mode: (m) => ipcRenderer.send('browser:mode', m),
    layout: (l) => ipcRenderer.send('browser:layout', l),
    zoom: (d) => ipcRenderer.send('browser:zoom', d),
    type: (text) => ipcRenderer.send('browser:type', text),
    key: (name) => ipcRenderer.send('browser:key', name),
    state: () => ipcRenderer.invoke('browser:state'),
    // подписка на события страницы: { state, field, fieldValue, event }
    on: (cb) => {
      const subs = [
        ['browser:state', (v) => cb({ state: v })],
        ['browser:field', (v) => cb({ field: v })],
        ['browser:field-value', (v) => cb({ fieldValue: v })],
        ['browser:event', (v) => cb({ event: v })],
      ].map(([ch, fn]) => {
        const h = (_e, v) => fn(v);
        ipcRenderer.on(ch, h);
        return () => ipcRenderer.removeListener(ch, h);
      });
      return () => subs.forEach((off) => off());
    },
  },
  about: {
    info: () => ipcRenderer.invoke('app:info'),
    checkUpdate: () => ipcRenderer.invoke('app:update'),
    downloadUpdate: () => ipcRenderer.invoke('app:update-download'),
    applyUpdate: () => ipcRenderer.invoke('app:update-apply'),
    onUpdateProgress: (cb) => {
      const h = (_e, v) => cb(v);
      ipcRenderer.on('app:update-progress', h);
      return () => ipcRenderer.removeListener('app:update-progress', h);
    },
    report: () => ipcRenderer.invoke('app:report'),
    openLogs: () => ipcRenderer.invoke('app:openLogs'),
    openRelease: (url) => ipcRenderer.invoke('app:openRelease', url),
  },
  prowlarr: {
    status: () => ipcRenderer.invoke('prowlarr:status'),
    install: () => ipcRenderer.invoke('prowlarr:install'),
    autosetup: () => ipcRenderer.invoke('prowlarr:autosetup'),
    start: () => ipcRenderer.invoke('prowlarr:start'),
    stop: () => ipcRenderer.invoke('prowlarr:stop'),
    indexers: () => ipcRenderer.invoke('prowlarr:indexers'),
    catalog: () => ipcRenderer.invoke('prowlarr:catalog'),
    add: (a) => ipcRenderer.invoke('prowlarr:add', a),
    remove: (id) => ipcRenderer.invoke('prowlarr:remove', id),
    toggle: (a) => ipcRenderer.invoke('prowlarr:toggle', a),
    test: (id) => ipcRenderer.invoke('prowlarr:test', id),
    onProgress: (cb) => {
      const h = (_e, v) => cb(v);
      ipcRenderer.on('prowlarr:progress', h);
      return () => ipcRenderer.removeListener('prowlarr:progress', h);
    },
  },
  getPerson: (id) => ipcRenderer.invoke('movies:person', id),
  discover: (row, genre) => ipcRenderer.invoke('movies:discover', { row, genre }),
  getSeasons: (movie) => ipcRenderer.invoke('series:seasons', { id: movie.id, seasonsInfo: movie.seasonsInfo || [] }),
  searchTorrents: (movie) => ipcRenderer.invoke('torrents:search', movie),
  getProgress: (movieId) => ipcRenderer.invoke('progress:get', movieId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getDisplay: () => ipcRenderer.invoke('system:display'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickDir: () => ipcRenderer.invoke('settings:pick-dir'),
  diskInfo: (dir) => ipcRenderer.invoke('settings:disk', dir),
  signOutYoutube: () => ipcRenderer.invoke('youtube:signout'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  clearProgress: (movieId) => ipcRenderer.invoke('progress:clear', movieId),
  getAllProgress: () => ipcRenderer.invoke('progress:all'),
  setProgress: (movieId, entry) => ipcRenderer.invoke('progress:set', { movieId, entry }),
  openSettings: () => ipcRenderer.send('settings:open'),
  play: (torrent) => ipcRenderer.invoke('player:play', torrent),
  stopPlayer: () => ipcRenderer.send('player:stop'),
  getBuffer: (pos) => ipcRenderer.invoke('player:buffer', pos),
  perf: (stats) => ipcRenderer.send('player:perf', stats),
  onPlayerStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('player:status', handler);
    return () => ipcRenderer.removeListener('player:status', handler);
  },
  onHome: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('tv:home', handler);
    return () => ipcRenderer.removeListener('tv:home', handler);
  },
});
