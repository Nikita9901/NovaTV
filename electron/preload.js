const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tv', {
  openYoutube: (target) => ipcRenderer.send('tv:open-youtube', target),
  quit: () => ipcRenderer.send('tv:quit'),
  searchMovies: (query) => ipcRenderer.invoke('movies:search', query),
  getMovie: (id) => ipcRenderer.invoke('movies:get', id),
  getDetails: (id) => ipcRenderer.invoke('movies:details', id),
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
