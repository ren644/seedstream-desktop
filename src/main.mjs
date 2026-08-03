import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  session,
  shell
} from 'electron'
import WebTorrent from 'webtorrent'

import { CacheManager } from './core/cache-manager.mjs'
import { TaskStore } from './core/task-store.mjs'
import { TorrentEngine } from './core/torrent-engine.mjs'
import {
  CHANNELS,
  assertFileIndex,
  assertFullscreenValue,
  assertSourceName,
  assertTaskId,
  assertTorrentBytes,
  extractTorrentPath,
  isAllowedRendererUrl,
  serializableError
} from './ipc-contract.mjs'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const rendererPath = path.join(moduleDirectory, 'renderer', 'index.html')
const preloadPath = path.join(moduleDirectory, 'preload.cjs')
const guideFileName = 'SeedStream-使用指南.html'
const pendingTorrentPaths = []

let mainWindow = null
let engine = null
let taskStore = null
let downloadPath = null
let persistenceChain = Promise.resolve()
let shutdownStarted = false
let shutdownFinished = false
let videoFullscreenActive = false

app.setName('SeedStream')
app.setPath(
  'userData',
  process.env.SEEDSTREAM_USER_DATA_PATH
    ? path.resolve(process.env.SEEDSTREAM_USER_DATA_PATH)
    : path.join(app.getPath('appData'), 'SeedStream')
)

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (/\.torrent$/i.test(filePath)) queueTorrentPath(filePath)
  })

  app.on('second-instance', (_event, argv) => {
    const filePath = extractTorrentPath(argv, process.platform)
    if (filePath) queueTorrentPath(filePath)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function rendererTask (task) {
  const { torrentFilePath: _privateMetadataPath, ...safeTask } = task
  return safeTask
}

function rendererState () {
  return {
    platform: process.platform,
    version: app.getVersion(),
    windowMaximized: mainWindow?.isMaximized() ?? false,
    videoFullscreen: videoFullscreenActive,
    downloadPath,
    tasks: engine?.listTasks().map(rendererTask) ?? []
  }
}

function applyVideoFullscreen (fullscreen) {
  videoFullscreenActive = fullscreen
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setFullScreen(fullscreen)
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.VIDEO_FULLSCREEN_CHANGED, { fullscreen })
  }
}

function assertTrustedSender (event) {
  if (!isAllowedRendererUrl(event.senderFrame?.url, rendererPath)) {
    const error = new Error('Blocked IPC request from an untrusted renderer')
    error.code = 'UNTRUSTED_RENDERER'
    throw error
  }
}

function registerHandler (channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedSender(event)
      return { ok: true, value: await handler(...args) }
    } catch (error) {
      return { ok: false, error: serializableError(error) }
    }
  })
}

function saveState () {
  if (!taskStore || !engine) return Promise.resolve()
  persistenceChain = persistenceChain
    .catch(() => {})
    .then(() => taskStore.save({ downloadPath, tasks: engine.listTasks() }))
  return persistenceChain
}

async function chooseAndImportTorrent () {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开 Torrent 种子',
    properties: ['openFile'],
    filters: [
      { name: 'Torrent 种子', extensions: ['torrent'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return importTorrentPath(result.filePaths[0])
}

async function importTorrentPath (filePath) {
  const task = await engine.importTorrentPath(filePath)
  app.addRecentDocument(filePath)
  return rendererTask(task)
}

async function queueTorrentPath (filePath) {
  if (!engine) {
    pendingTorrentPaths.push(filePath)
    return
  }
  try {
    const task = await importTorrentPath(filePath)
    sendNativeOpen({ ok: true, task })
  } catch (error) {
    sendNativeOpen({ ok: false, error: serializableError(error) })
  }
}

function sendNativeOpen (payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.NATIVE_OPENED, payload)
  }
}

function registerIpcHandlers () {
  registerHandler(CHANNELS.GET_STATE, async () => rendererState())
  registerHandler(CHANNELS.TOGGLE_WINDOW_MAXIMIZE, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      const error = new Error('The SeedStream window is unavailable')
      error.code = 'WINDOW_UNAVAILABLE'
      throw error
    }
    const maximized = !mainWindow.isMaximized()
    if (maximized) mainWindow.maximize()
    else mainWindow.unmaximize()
    return { maximized }
  })
  registerHandler(CHANNELS.SET_VIDEO_FULLSCREEN, async fullscreenValue => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      const error = new Error('The SeedStream window is unavailable')
      error.code = 'WINDOW_UNAVAILABLE'
      throw error
    }
    const fullscreen = assertFullscreenValue(fullscreenValue)
    applyVideoFullscreen(fullscreen)
    return { fullscreen }
  })
  registerHandler(CHANNELS.OPEN_GUIDE, async () => {
    const guidePath = app.isPackaged
      ? path.join(process.resourcesPath, 'help', guideFileName)
      : path.join(moduleDirectory, '..', 'help', guideFileName)
    const message = await shell.openPath(guidePath)
    if (message) throw new Error(message)
    return null
  })
  registerHandler(CHANNELS.CHOOSE_TORRENT, chooseAndImportTorrent)
  registerHandler(CHANNELS.IMPORT_TORRENT_BYTES, async (input, sourceName) => {
    const task = await engine.importTorrentBuffer(
      assertTorrentBytes(input),
      assertSourceName(sourceName)
    )
    return rendererTask(task)
  })
  registerHandler(CHANNELS.IMPORT_MAGNET, async input => rendererTask(await engine.importMagnet(input)))
  registerHandler(CHANNELS.START_DOWNLOAD, async taskId => {
    const task = await engine.startDownload(assertTaskId(taskId))
    await saveState()
    return rendererTask(task)
  })
  registerHandler(CHANNELS.PLAY_FILE, async (taskId, fileIndex) => (
    engine.play(assertTaskId(taskId), assertFileIndex(fileIndex))
  ))
  registerHandler(CHANNELS.OPEN_DOWNLOADED_FILE, async (taskId, fileIndex) => {
    const filePath = await engine.completedFilePath(assertTaskId(taskId), assertFileIndex(fileIndex))
    const message = await shell.openPath(filePath)
    if (message) {
      const error = new Error(message)
      error.code = 'SYSTEM_OPEN_FAILED'
      throw error
    }
    return null
  })
  registerHandler(CHANNELS.CLOSE_PLAYER, async taskId => (
    rendererTask(await engine.closePlayer(assertTaskId(taskId)))
  ))
  registerHandler(CHANNELS.PAUSE, async taskId => {
    const task = await engine.pause(assertTaskId(taskId))
    await saveState()
    return rendererTask(task)
  })
  registerHandler(CHANNELS.RESUME, async taskId => {
    const task = await engine.resume(assertTaskId(taskId))
    await saveState()
    return rendererTask(task)
  })
  registerHandler(CHANNELS.REMOVE, async taskId => {
    await engine.remove(assertTaskId(taskId))
    await saveState()
    return null
  })
  registerHandler(CHANNELS.REVEAL, async taskId => {
    const task = engine.getTask(assertTaskId(taskId))
    if (!task.downloadPath) {
      const error = new Error('This task has no permanent download folder yet')
      error.code = 'NO_DOWNLOAD_PATH'
      throw error
    }
    const message = await shell.openPath(task.downloadPath)
    if (message) throw new Error(message)
    return null
  })
  registerHandler(CHANNELS.CHOOSE_DOWNLOAD_PATH, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择下载目录',
      defaultPath: downloadPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return downloadPath
    downloadPath = path.resolve(result.filePaths[0])
    engine.setDownloadPath(downloadPath)
    await saveState()
    return downloadPath
  })
}

function createWindow () {
  const smokeMode = process.env.SEEDSTREAM_SMOKE_UI === '1'
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'SeedStream',
    backgroundColor: '#101419',
    show: !smokeMode,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (videoFullscreenActive && input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape')) {
      event.preventDefault()
      applyVideoFullscreen(false)
    }
  })
  mainWindow.on('leave-full-screen', () => {
    if (!videoFullscreenActive) return
    videoFullscreenActive = false
    if (!mainWindow?.webContents.isDestroyed()) {
      mainWindow.webContents.send(CHANNELS.VIDEO_FULLSCREEN_CHANGED, { fullscreen: false })
    }
  })
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())
  if (!smokeMode) mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (smokeMode) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const state = await window.seedstream.getState()
          return {
            bridge: typeof window.seedstream.playFile === 'function' && typeof window.seedstream.openDownloadedFile === 'function' && typeof window.seedstream.toggleWindowMaximize === 'function' && typeof window.seedstream.setVideoFullscreen === 'function' && typeof window.seedstream.importMagnet === 'function' && typeof window.seedstream.searchTorrents === 'undefined' && typeof window.seedstream.openSearchBrowser === 'undefined',
            brand: document.querySelector('h1')?.textContent?.replace(/\\s/g, ''),
            help: Boolean(document.querySelector('#helpButton')),
            windowMaximize: Boolean(document.querySelector('#windowMaximizeButton')),
            playerFullscreen: Boolean(document.querySelector('#fullscreenPlayerButton')),
            magnetImport: Boolean(document.querySelector('#openMagnetButton')) && Boolean(document.querySelector('#magnetDialog')),
            appearance: Boolean(document.querySelector('#appearanceButton')) && Boolean(document.querySelector('#appearanceMenu')),
            appearanceThemes: document.querySelectorAll('[data-theme-option]').length,
            defaultTheme: document.body.dataset.theme,
            searchRemoved: !document.querySelector('#searchCenterButton') && !document.querySelector('#searchDialog') && !document.querySelector('#catalogCodeMode'),
            onboarding: !document.querySelector('#onboardingBackdrop')?.hidden,
            guidePlatform: document.querySelector('#guidePlatform')?.textContent,
            taskCount: state.tasks.length,
            downloadPath: state.downloadPath
          }
        })()`)
        if (!result.bridge || result.brand !== 'SEED/STREAM' || !result.help || !result.windowMaximize || !result.playerFullscreen || !result.magnetImport || !result.appearance || result.appearanceThemes !== 3 || result.defaultTheme !== 'mist' || !result.searchRemoved || !result.onboarding || !result.guidePlatform || !result.downloadPath) {
          throw new Error(`Unexpected renderer smoke result: ${JSON.stringify(result)}`)
        }
        console.log(`SEEDSTREAM_UI_SMOKE_OK ${JSON.stringify(result)}`)
        await shutdownForSmoke(0)
      } catch (error) {
        console.error('SEEDSTREAM_UI_SMOKE_FAILED', error)
        await shutdownForSmoke(1)
      }
    })
  }
  mainWindow.on('closed', () => {
    videoFullscreenActive = false
    mainWindow = null
    cleanupOpenPlayers().catch(() => {})
  })
  mainWindow.loadFile(rendererPath)
}

async function cleanupOpenPlayers () {
  if (!engine) return
  const playingTasks = engine.listTasks().filter(task => task.policy.playing)
  await Promise.allSettled(playingTasks.map(task => engine.closePlayer(task.id)))
}

async function restoreSavedTasks (savedState) {
  for (const record of savedState.tasks) {
    try {
      await engine.restorePersistentTask(record)
    } catch (error) {
      console.error(`Failed to restore ${record?.id ?? 'saved torrent'}:`, error)
    }
  }
}

async function bootstrap () {
  const userDataPath = app.getPath('userData')
  taskStore = new TaskStore(path.join(userDataPath, 'state.json'))
  const savedState = await taskStore.load().catch(error => {
    console.error('Failed to read saved task state:', error)
    return { version: 1, downloadPath: null, tasks: [] }
  })
  downloadPath = savedState.downloadPath || path.join(app.getPath('downloads'), 'SeedStream')

  const client = new WebTorrent()
  client.on('error', error => console.error('WebTorrent client error:', error))
  engine = new TorrentEngine({
    client,
    cacheManager: new CacheManager(path.join(app.getPath('temp'), 'seedstream-player-cache')),
    metadataDirectory: path.join(userDataPath, 'torrents'),
    downloadPath
  })
  await engine.initialize()

  const previousPhases = new Map()
  engine.on('change', event => {
    if (event.type !== 'updated') return
    const task = event.task
    const previous = previousPhases.get(task.id)
    previousPhases.set(task.id, task.policy.phase)
    if (task.policy.phase === 'complete' && previous && previous !== 'complete' && Notification.isSupported()) {
      new Notification({ title: '下载完成', body: task.name }).show()
    }
    if (task.policy.storage === 'persistent') saveState().catch(error => console.error('State save failed:', error))
  })

  await restoreSavedTasks(savedState)
  registerIpcHandlers()
  createWindow()

  const launchPath = extractTorrentPath(process.argv, process.platform)
  if (launchPath) pendingTorrentPaths.push(launchPath)
  const queued = pendingTorrentPaths.splice(0)
  for (const filePath of queued) await queueTorrentPath(filePath)
}

async function gracefulShutdown () {
  if (shutdownStarted) return
  shutdownStarted = true
  await cleanupOpenPlayers().catch(() => {})
  await saveState().catch(() => {})
  await engine?.shutdown().catch(error => console.error('Shutdown failed:', error))
  shutdownFinished = true
  app.quit()
}

async function shutdownForSmoke (exitCode) {
  shutdownStarted = true
  await cleanupOpenPlayers().catch(() => {})
  await saveState().catch(() => {})
  await engine?.shutdown().catch(() => {})
  shutdownFinished = true
  app.exit(exitCode)
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    await bootstrap()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch(error => {
    console.error('SeedStream failed to start:', error)
    dialog.showErrorBox('SeedStream 无法启动', error.message)
    app.quit()
  })

  app.on('before-quit', event => {
    if (shutdownFinished || !engine) return
    event.preventDefault()
    gracefulShutdown().catch(error => {
      console.error(error)
      shutdownFinished = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
