import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  SearchBrowser,
  resolveBrowserTarget
} from '../src/core/search-browser.mjs'

const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Example`

class FakeWebContents extends EventEmitter {
  setWindowOpenHandler (handler) { this.windowOpenHandler = handler }
}

class FakeWindow extends EventEmitter {
  constructor (options) {
    super()
    this.options = options
    this.webContents = new FakeWebContents()
    this.urls = []
    this.destroyed = false
    this.focused = false
  }

  async loadURL (url) { this.urls.push(url) }
  isDestroyed () { return this.destroyed }
  show () {}
  focus () { this.focused = true }
  close () { this.destroyed = true; this.emit('closed') }
}

class FakeSession extends EventEmitter {
  constructor () {
    super()
    this.cacheCleared = 0
    this.storageCleared = 0
  }

  async clearCache () { this.cacheCleared += 1 }
  async clearStorageData () { this.storageCleared += 1 }
}

function preventableEvent () {
  return {
    prevented: false,
    preventDefault () { this.prevented = true }
  }
}

function flush () {
  return new Promise(resolve => setImmediate(resolve))
}

test('resolves HTTP addresses directly and keywords through a privacy search page', () => {
  assert.equal(resolveBrowserTarget('https://example.com/search?q=test'), 'https://example.com/search?q=test')
  assert.equal(
    resolveBrowserTarget('open movie 2026'),
    'https://duckduckgo.com/?q=open+movie+2026'
  )
  for (const value of ['', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.throws(() => resolveBrowserTarget(value), /browser target/i)
  }
})

test('creates a sandboxed browser and captures magnet navigation', async () => {
  const browserSession = new FakeSession()
  const magnets = []
  let window
  const browser = new SearchBrowser({
    windowFactory: options => (window = new FakeWindow(options)),
    browserSession,
    onMagnet: value => magnets.push(value),
    onTorrentUrl: () => {}
  })
  const opened = await browser.open('open movie')

  assert.equal(opened.url, 'https://duckduckgo.com/?q=open+movie')
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  assert.equal(window.options.webPreferences.contextIsolation, true)
  assert.equal(window.options.webPreferences.sandbox, true)
  assert.equal(window.options.webPreferences.session, browserSession)
  assert.equal(window.options.webPreferences.preload, undefined)

  const magnetEvent = preventableEvent()
  window.webContents.emit('will-navigate', magnetEvent, magnet)
  await flush()
  assert.equal(magnetEvent.prevented, true)
  assert.deepEqual(magnets, [magnet])

  const fileEvent = preventableEvent()
  window.webContents.emit('will-navigate', fileEvent, 'file:///tmp/private.txt')
  assert.equal(fileEvent.prevented, true)

  const webEvent = preventableEvent()
  window.webContents.emit('will-navigate', webEvent, 'https://example.com/page')
  assert.equal(webEvent.prevented, false)
})

test('keeps allowed popups inside the controlled window and denies unsafe schemes', async () => {
  let window
  const magnets = []
  const browser = new SearchBrowser({
    windowFactory: options => (window = new FakeWindow(options)),
    browserSession: new FakeSession(),
    onMagnet: value => magnets.push(value),
    onTorrentUrl: () => {}
  })
  await browser.open('test')

  assert.deepEqual(window.webContents.windowOpenHandler({ url: magnet }), { action: 'deny' })
  await flush()
  assert.deepEqual(magnets, [magnet])
  assert.deepEqual(window.webContents.windowOpenHandler({ url: 'https://example.com/result' }), { action: 'deny' })
  await flush()
  assert.equal(window.urls.at(-1), 'https://example.com/result')
  assert.deepEqual(window.webContents.windowOpenHandler({ url: 'file:///etc/passwd' }), { action: 'deny' })
})

test('captures torrent downloads without writing temporary files', async () => {
  const browserSession = new FakeSession()
  const torrents = []
  let window
  const browser = new SearchBrowser({
    windowFactory: options => (window = new FakeWindow(options)),
    browserSession,
    onMagnet: () => {},
    onTorrentUrl: url => torrents.push(url)
  })
  await browser.open('test')

  const event = preventableEvent()
  const item = {
    getFilename: () => 'video.torrent',
    getMimeType: () => 'application/x-bittorrent',
    getURL: () => 'https://private.example/download?id=1'
  }
  browserSession.emit('will-download', event, item, window.webContents)
  await flush()
  assert.equal(event.prevented, true)
  assert.deepEqual(torrents, ['https://private.example/download?id=1'])

  const unrelated = preventableEvent()
  browserSession.emit('will-download', unrelated, {
    getFilename: () => 'manual.pdf', getMimeType: () => 'application/pdf', getURL: () => 'https://example.com/manual.pdf'
  }, window.webContents)
  assert.equal(unrelated.prevented, true, 'unrelated downloads are blocked in the isolated browser')
})

test('clears isolated browser data and removes listeners when closed', async () => {
  const browserSession = new FakeSession()
  let window
  const browser = new SearchBrowser({
    windowFactory: options => (window = new FakeWindow(options)),
    browserSession,
    onMagnet: () => {},
    onTorrentUrl: () => {}
  })
  await browser.open('test')
  assert.equal(browserSession.listenerCount('will-download'), 1)
  await browser.clearBrowsingData()
  assert.equal(browserSession.cacheCleared, 1)
  assert.equal(browserSession.storageCleared, 1)
  browser.close()
  assert.equal(browserSession.listenerCount('will-download'), 0)
  assert.equal(window.destroyed, true)
})
