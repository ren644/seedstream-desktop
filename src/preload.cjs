const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = Object.freeze({
  GET_STATE: 'seedstream:app:get-state',
  OPEN_GUIDE: 'seedstream:app:open-guide',
  TOGGLE_WINDOW_MAXIMIZE: 'seedstream:window:toggle-maximize',
  SET_VIDEO_FULLSCREEN: 'seedstream:window:set-video-fullscreen',
  VIDEO_FULLSCREEN_CHANGED: 'seedstream:event:video-fullscreen-changed',
  SEARCH_GET_CONFIG: 'seedstream:search:get-config',
  SEARCH_SAVE_CONFIG: 'seedstream:search:save-config',
  SEARCH_QUERY: 'seedstream:search:query',
  SEARCH_IMPORT_RESULT: 'seedstream:search:import-result',
  SEARCH_OPEN_BROWSER: 'seedstream:search:open-browser',
  SEARCH_CLEAR_BROWSER_DATA: 'seedstream:search:clear-browser-data',
  SEARCH_CAPTURED: 'seedstream:event:search-captured',
  CHOOSE_TORRENT: 'seedstream:torrent:choose',
  IMPORT_TORRENT_BYTES: 'seedstream:torrent:import-bytes',
  IMPORT_MAGNET: 'seedstream:torrent:import-magnet',
  START_DOWNLOAD: 'seedstream:torrent:start-download',
  PLAY_FILE: 'seedstream:torrent:play-file',
  OPEN_DOWNLOADED_FILE: 'seedstream:torrent:open-downloaded-file',
  CLOSE_PLAYER: 'seedstream:torrent:close-player',
  PAUSE: 'seedstream:torrent:pause',
  RESUME: 'seedstream:torrent:resume',
  REMOVE: 'seedstream:torrent:remove',
  REVEAL: 'seedstream:torrent:reveal',
  CHOOSE_DOWNLOAD_PATH: 'seedstream:settings:choose-download-path',
  NATIVE_OPENED: 'seedstream:event:native-opened'
})

async function invoke (channel, ...args) {
  const response = await ipcRenderer.invoke(channel, ...args)
  if (!response?.ok) {
    const error = new Error(response?.error?.message ?? 'SeedStream request failed')
    error.code = response?.error?.code ?? 'UNEXPECTED_ERROR'
    throw error
  }
  return response.value
}

contextBridge.exposeInMainWorld('seedstream', Object.freeze({
  getState: () => invoke(CHANNELS.GET_STATE),
  openGuide: () => invoke(CHANNELS.OPEN_GUIDE),
  toggleWindowMaximize: () => invoke(CHANNELS.TOGGLE_WINDOW_MAXIMIZE),
  setVideoFullscreen: fullscreen => invoke(CHANNELS.SET_VIDEO_FULLSCREEN, fullscreen),
  getSearchConfig: () => invoke(CHANNELS.SEARCH_GET_CONFIG),
  saveSearchConfig: providers => invoke(CHANNELS.SEARCH_SAVE_CONFIG, providers),
  searchTorrents: query => invoke(CHANNELS.SEARCH_QUERY, query),
  importSearchResult: token => invoke(CHANNELS.SEARCH_IMPORT_RESULT, token),
  openSearchBrowser: input => invoke(CHANNELS.SEARCH_OPEN_BROWSER, input),
  clearSearchBrowserData: () => invoke(CHANNELS.SEARCH_CLEAR_BROWSER_DATA),
  chooseTorrent: () => invoke(CHANNELS.CHOOSE_TORRENT),
  importTorrentBytes: (bytes, sourceName) => invoke(CHANNELS.IMPORT_TORRENT_BYTES, bytes, sourceName),
  importMagnet: magnetUri => invoke(CHANNELS.IMPORT_MAGNET, magnetUri),
  startDownload: taskId => invoke(CHANNELS.START_DOWNLOAD, taskId),
  playFile: (taskId, fileIndex) => invoke(CHANNELS.PLAY_FILE, taskId, fileIndex),
  openDownloadedFile: (taskId, fileIndex) => invoke(CHANNELS.OPEN_DOWNLOADED_FILE, taskId, fileIndex),
  closePlayer: taskId => invoke(CHANNELS.CLOSE_PLAYER, taskId),
  pause: taskId => invoke(CHANNELS.PAUSE, taskId),
  resume: taskId => invoke(CHANNELS.RESUME, taskId),
  remove: taskId => invoke(CHANNELS.REMOVE, taskId),
  reveal: taskId => invoke(CHANNELS.REVEAL, taskId),
  chooseDownloadPath: () => invoke(CHANNELS.CHOOSE_DOWNLOAD_PATH),
  onVideoFullscreenChanged: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on(CHANNELS.VIDEO_FULLSCREEN_CHANGED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.VIDEO_FULLSCREEN_CHANGED, listener)
  },
  onNativeOpened: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on(CHANNELS.NATIVE_OPENED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.NATIVE_OPENED, listener)
  },
  onSearchCaptured: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on(CHANNELS.SEARCH_CAPTURED, listener)
    return () => ipcRenderer.removeListener(CHANNELS.SEARCH_CAPTURED, listener)
  }
}))
