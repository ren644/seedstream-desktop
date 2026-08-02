import { assertMagnetUri, assertSearchEndpoint, normalizeSearchQuery } from './search-contract.mjs'

const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/'

function httpTarget (value) {
  try {
    return assertSearchEndpoint(value)
  } catch {
    return null
  }
}

export function resolveBrowserTarget (input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new TypeError('A valid browser target is required')
  }
  const trimmed = input.trim()
  const direct = httpTarget(trimmed)
  if (direct) return direct
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new TypeError('A valid browser target is required')
  }
  const query = normalizeSearchQuery(trimmed)
  const url = new URL(DEFAULT_SEARCH_URL)
  url.searchParams.set('q', query)
  return url.href
}

function isTorrentDownload (item) {
  const filename = item?.getFilename?.() ?? ''
  const mimeType = item?.getMimeType?.() ?? ''
  return /\.torrent$/i.test(filename) || /(?:x-bittorrent|application\/torrent)/i.test(mimeType)
}

export class SearchBrowser {
  constructor ({
    windowFactory,
    browserSession,
    parentWindow = null,
    onMagnet,
    onTorrentUrl,
    onError = () => {}
  } = {}) {
    if (typeof windowFactory !== 'function') throw new TypeError('SearchBrowser requires a window factory')
    if (!browserSession?.on || !browserSession?.removeListener) throw new TypeError('SearchBrowser requires an isolated session')
    if (typeof onMagnet !== 'function' || typeof onTorrentUrl !== 'function') {
      throw new TypeError('SearchBrowser requires capture callbacks')
    }
    this.windowFactory = windowFactory
    this.browserSession = browserSession
    this.parentWindow = parentWindow
    this.onMagnet = onMagnet
    this.onTorrentUrl = onTorrentUrl
    this.onError = onError
    this.window = null
    this.downloadListener = null
  }

  #dispatch (callback, value) {
    queueMicrotask(() => {
      Promise.resolve(callback(value)).catch(error => this.onError(error))
    })
  }

  #captureNavigation (event, input) {
    if (typeof input !== 'string') {
      event?.preventDefault?.()
      return
    }
    if (input.startsWith('magnet:')) {
      event?.preventDefault?.()
      try {
        this.#dispatch(this.onMagnet, assertMagnetUri(input))
      } catch (error) {
        this.onError(error)
      }
      return
    }
    if (!httpTarget(input)) event?.preventDefault?.()
  }

  #attachWindow (window) {
    const contents = window.webContents
    const navigationListener = (event, url) => this.#captureNavigation(event, url)
    contents.on('will-navigate', navigationListener)
    contents.on('will-redirect', navigationListener)
    contents.on('will-attach-webview', event => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (typeof url === 'string' && url.startsWith('magnet:')) {
        try {
          this.#dispatch(this.onMagnet, assertMagnetUri(url))
        } catch (error) {
          this.onError(error)
        }
      } else {
        const target = httpTarget(url)
        if (target) this.#dispatch(value => window.loadURL(value), target)
      }
      return { action: 'deny' }
    })

    this.downloadListener = (event, item, webContents) => {
      if (webContents !== contents) return
      event.preventDefault()
      if (!isTorrentDownload(item)) return
      const url = httpTarget(item.getURL?.())
      if (url) this.#dispatch(this.onTorrentUrl, url)
    }
    this.browserSession.on('will-download', this.downloadListener)

    window.once('closed', () => {
      if (this.downloadListener) {
        this.browserSession.removeListener('will-download', this.downloadListener)
        this.downloadListener = null
      }
      if (this.window === window) this.window = null
    })
  }

  async open (input) {
    const url = resolveBrowserTarget(input)
    if (!this.window || this.window.isDestroyed()) {
      const options = {
        width: 1120,
        height: 760,
        minWidth: 760,
        minHeight: 520,
        title: 'SeedStream 网页搜索',
        backgroundColor: '#101419',
        show: true,
        webPreferences: {
          session: this.browserSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false
        }
      }
      if (this.parentWindow) options.parent = this.parentWindow
      this.window = this.windowFactory(options)
      this.#attachWindow(this.window)
    } else {
      this.window.show?.()
      this.window.focus?.()
    }
    await this.window.loadURL(url)
    return { url }
  }

  async clearCache () {
    await this.browserSession.clearCache()
  }

  async clearBrowsingData () {
    await Promise.all([
      this.browserSession.clearCache(),
      this.browserSession.clearStorageData()
    ])
  }

  close () {
    if (!this.window || this.window.isDestroyed()) return
    this.window.close()
  }
}
