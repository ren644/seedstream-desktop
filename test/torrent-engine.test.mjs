import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import createTorrent from 'create-torrent'
import parseTorrent from 'parse-torrent'

import { CacheManager } from '../src/core/cache-manager.mjs'
import {
  TorrentEngine,
  normalizeParsedTorrent
} from '../src/core/torrent-engine.mjs'

function createTorrentBuffer (input, options) {
  return new Promise((resolve, reject) => {
    createTorrent(input, options, (error, buffer) => {
      if (error) reject(error)
      else resolve(new Uint8Array(buffer))
    })
  })
}

async function createFixture (directory) {
  const sourcePath = path.join(directory, 'sample-video.mp4')
  await writeFile(sourcePath, Buffer.alloc(48 * 1024, 7))
  return createTorrentBuffer(sourcePath, {
    name: 'sample-video.mp4',
    announceList: [],
    pieceLength: 16 * 1024,
    creationDate: new Date('2026-08-01T00:00:00.000Z')
  })
}

class FakeFile {
  constructor (client, torrent, file, index) {
    this.client = client
    this.torrent = torrent
    this.name = file.name
    this.path = file.path
    this.length = file.length
    this.type = file.name.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream'
    this.progress = 0
    this.downloaded = 0
    this.index = index
  }

  get streamURL () {
    const encoded = this.path.split(/[\\/]/).map(encodeURIComponent).join('/')
    return `${this.client.serverInstance.pathname}/${this.torrent.infoHash}/${encoded}`
  }
}

class FakeTorrent extends EventEmitter {
  constructor (client, parsed, options) {
    super()
    this.client = client
    this.infoHash = parsed.infoHash
    this.name = parsed.name
    this.length = parsed.length
    this.progress = 0
    this.downloaded = 0
    this.uploaded = 0
    this.downloadSpeed = 0
    this.uploadSpeed = 0
    this.numPeers = 0
    this.timeRemaining = Infinity
    this.options = options
    this.files = parsed.files.map((file, index) => new FakeFile(client, this, file, index))
  }
}

class FakeClient extends EventEmitter {
  constructor (parsed, torrentBuffer = null, options = {}) {
    super()
    this.parsed = parsed
    this.torrentBuffer = torrentBuffer
    this.torrents = []
    this.addCalls = []
    this.removeCalls = []
    this.serverClosed = false
    this.destroyed = false
    this.autoResolveMagnet = options.autoResolveMagnet !== false
    this.completeRemove = options.completeRemove !== false
  }

  createServer (options, force) {
    assert.equal(force, 'node')
    const server = new EventEmitter()
    server.listen = (_port, host, callback) => {
      assert.equal(host, '127.0.0.1')
      queueMicrotask(callback)
      return server
    }
    server.address = () => ({ address: '127.0.0.1', port: 43110 })
    server.close = callback => {
      this.serverClosed = true
      queueMicrotask(() => callback?.())
    }

    this.serverInstance = {
      pathname: options.pathname,
      server,
      destroy: callback => server.close(callback)
    }
    return this.serverInstance
  }

  add (torrentInput, options, callback) {
    const torrent = new FakeTorrent(this, this.parsed, options)
    if (typeof torrentInput === 'string' && this.torrentBuffer) {
      torrent.torrentFile = Buffer.from(this.torrentBuffer)
    }
    this.torrents.push(torrent)
    this.addCalls.push({ input: torrentInput, options, torrent })
    if (typeof torrentInput !== 'string' || this.autoResolveMagnet) {
      queueMicrotask(() => callback(torrent))
    }
    return torrent
  }

  async get (id) {
    return this.torrents.find(torrent => torrent.infoHash === id) ?? null
  }

  async remove (id, options, callback) {
    const index = this.torrents.findIndex(torrent => torrent.infoHash === id)
    if (index === -1) throw new Error(`No torrent with id ${id}`)
    this.torrents.splice(index, 1)
    this.removeCalls.push({ id, options })
    if (this.completeRemove) queueMicrotask(() => callback?.())
  }

  destroy (callback) {
    this.destroyed = true
    this.torrents = []
    queueMicrotask(() => callback?.())
  }
}

async function withEngine (callback, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'seedstream-engine-'))
  let engine
  try {
    const torrentBuffer = await createFixture(directory)
    const parsed = await parseTorrent(torrentBuffer)
    const client = new FakeClient(parsed, torrentBuffer, options.client)
    const cacheManager = new CacheManager(path.join(directory, 'cache'))
    engine = new TorrentEngine({
      client,
      cacheManager,
      metadataDirectory: path.join(directory, 'metadata'),
      downloadPath: path.join(directory, 'downloads'),
      streamToken: 'fixed-token',
      ...options.engine
    })
    await engine.initialize()
    await callback({ directory, torrentBuffer, parsed, client, cacheManager, engine })
  } finally {
    await engine?.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
}

test('imports a real locally generated torrent and copies its metadata', async () => {
  await withEngine(async ({ torrentBuffer, parsed, engine }) => {
    const task = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    assert.equal(task.id, parsed.infoHash)
    assert.equal(task.name, 'sample-video.mp4')
    assert.equal(task.files.length, 1)
    assert.equal(task.files[0].playable, true)
    assert.equal(task.policy.phase, 'ready')
    assert.deepEqual(new Uint8Array(await readFile(task.torrentFilePath)), torrentBuffer)

    await assert.rejects(
      () => engine.importTorrentBuffer(torrentBuffer, 'duplicate.torrent'),
      error => error.code === 'DUPLICATE_TORRENT'
    )
  })
})

test('resolves a magnet into validated torrent metadata before creating a task', async () => {
  await withEngine(async ({ torrentBuffer, parsed, client, engine }) => {
    const magnet = `magnet:?xt=urn:btih:${parsed.infoHash}&dn=sample-video.mp4&tr=https%3A%2F%2Ftracker.example%2Fannounce`
    const task = await engine.importMagnet(magnet)

    assert.equal(task.id, parsed.infoHash)
    assert.equal(task.name, 'sample-video.mp4')
    assert.equal(client.addCalls[0].input, magnet)
    assert.equal(client.addCalls[0].options.destroyStoreOnDestroy, true)
    assert.equal(client.addCalls[0].options.deselect, true)
    assert.deepEqual(client.addCalls[0].options.announce, [
      'udp://tracker.opentrackr.org:1337/announce',
      'wss://tracker.openwebtorrent.com'
    ])
    assert.equal(client.removeCalls[0].options.destroyStore, true)
    assert.deepEqual(new Uint8Array(await readFile(task.torrentFilePath)), torrentBuffer)

    const addCount = client.addCalls.length
    await assert.rejects(() => engine.importMagnet(magnet), error => error.code === 'DUPLICATE_TORRENT')
    assert.equal(client.addCalls.length, addCount, 'duplicate magnets are rejected before connecting')
  })
})

test('cancels a pending magnet metadata request without waiting for its timeout', async () => {
  await withEngine(async ({ parsed, engine }) => {
    const magnet = `magnet:?xt=urn:btih:${parsed.infoHash}&dn=slow.mp4`
    const pending = engine.importMagnet(magnet)
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(engine.cancelMagnetImport(), true)
    await assert.rejects(pending, error => error.code === 'MAGNET_METADATA_CANCELLED')
    assert.equal(engine.cancelMagnetImport(), false)
  }, {
    client: { autoResolveMagnet: false },
    engine: { magnetMetadataTimeoutMs: 10_000, magnetCleanupTimeoutMs: 50 }
  })
})

test('magnet cancellation cannot hang on a missing client removal callback', async () => {
  await withEngine(async ({ parsed, engine }) => {
    const magnet = `magnet:?xt=urn:btih:${parsed.infoHash}&dn=stuck-cleanup.mp4`
    const pending = engine.importMagnet(magnet)
    await new Promise(resolve => setImmediate(resolve))
    engine.cancelMagnetImport()

    await assert.rejects(Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('magnet cleanup remained stuck')), 250))
    ]), error => error.code === 'MAGNET_METADATA_CANCELLED')
  }, {
    client: { autoResolveMagnet: false, completeRemove: false },
    engine: { magnetMetadataTimeoutMs: 10_000, magnetCleanupTimeoutMs: 20 }
  })
})

test('rejects unsafe paths found in parsed torrent metadata', () => {
  assert.throws(() => normalizeParsedTorrent({
    infoHash: 'a'.repeat(40),
    name: 'bad',
    length: 1,
    files: [{ name: 'escape.mp4', path: '../escape.mp4', length: 1 }]
  }), /unsafe torrent path/i)
})

test('streams from ephemeral cache, then purges it before permanent download', async () => {
  await withEngine(async ({ torrentBuffer, client, cacheManager, engine }) => {
    const imported = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    const playback = await engine.play(imported.id, 0)

    assert.match(
      playback.url,
      new RegExp(`^http://127\\.0\\.0\\.1:43110/stream-fixed-token/${imported.id}/`)
    )
    assert.equal(engine.getTask(imported.id).policy.storage, 'ephemeral')
    const ephemeralPath = cacheManager.taskPath(imported.id)
    assert.equal((await stat(ephemeralPath)).isDirectory(), true)
    assert.equal(client.addCalls.at(-1).options.destroyStoreOnDestroy, true)
    assert.equal(client.addCalls.at(-1).options.deselect, true)
    assert.equal(client.addCalls.at(-1).options.noPeersIntervalTime, 10)

    await engine.startDownload(imported.id)
    assert.equal(client.removeCalls[0].options.destroyStore, true)
    await assert.rejects(() => stat(ephemeralPath), { code: 'ENOENT' })
    assert.equal(client.addCalls.at(-1).options.destroyStoreOnDestroy, false)
    assert.equal(client.addCalls.at(-1).options.deselect, false)
    assert.equal(engine.getTask(imported.id).policy.phase, 'downloading')

    const addCount = client.addCalls.length
    await engine.play(imported.id, 0)
    assert.equal(client.addCalls.length, addCount, 'permanent playback reuses active torrent')
    await engine.closePlayer(imported.id)
    assert.equal(engine.getTask(imported.id).policy.phase, 'downloading')
  })
})

test('plays a completed download from the local file without reconnecting the torrent', async () => {
  await withEngine(async ({ torrentBuffer, parsed, client, engine }) => {
    const imported = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    const downloading = await engine.startDownload(imported.id)
    const localPath = path.join(downloading.downloadPath, parsed.files[0].path)
    const localBytes = Buffer.alloc(parsed.files[0].length, 19)
    await mkdir(path.dirname(localPath), { recursive: true })
    await writeFile(localPath, localBytes)

    const activeTorrent = client.addCalls.at(-1).torrent
    activeTorrent.progress = 1
    activeTorrent.downloaded = activeTorrent.length
    activeTorrent.emit('done')
    assert.equal(engine.getTask(imported.id).policy.phase, 'complete')

    const addCount = client.addCalls.length
    const playback = await engine.play(imported.id, 0)
    assert.equal(playback.source, 'local')
    assert.match(playback.url, /^http:\/\/127\.0\.0\.1:\d+\/local-fixed-token\//)
    assert.equal(client.addCalls.length, addCount, 'local playback must not reconnect the torrent')
    assert.equal(await engine.completedFilePath(imported.id, 0), await realpath(localPath))

    const response = await fetch(playback.url, { headers: { Range: 'bytes=8-23' } })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(response.headers.get('content-range'), `bytes 8-23/${localBytes.length}`)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), localBytes.subarray(8, 24))

    const headResponse = await fetch(playback.url, { method: 'HEAD' })
    assert.equal(headResponse.status, 200)
    assert.equal(headResponse.headers.get('content-length'), String(localBytes.length))
    assert.equal((await headResponse.arrayBuffer()).byteLength, 0)

    const invalidRange = await fetch(playback.url, { headers: { Range: `bytes=${localBytes.length}-` } })
    assert.equal(invalidRange.status, 416)
    assert.equal(invalidRange.headers.get('content-range'), `bytes */${localBytes.length}`)

    await engine.closePlayer(imported.id)
    assert.equal(engine.getTask(imported.id).policy.phase, 'complete')
  })
})

test('restores a completed task and plays it locally while offline', async () => {
  await withEngine(async ({ directory, torrentBuffer, parsed, client, engine }) => {
    const imported = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    const downloading = await engine.startDownload(imported.id)
    const localPath = path.join(downloading.downloadPath, parsed.files[0].path)
    await mkdir(path.dirname(localPath), { recursive: true })
    await writeFile(localPath, Buffer.alloc(parsed.files[0].length, 29))
    client.addCalls.at(-1).torrent.emit('done')
    const completed = engine.getTask(imported.id)
    await engine.shutdown()

    const restoredClient = new FakeClient(parsed)
    const restoredEngine = new TorrentEngine({
      client: restoredClient,
      cacheManager: new CacheManager(path.join(directory, 'completed-cache')),
      metadataDirectory: path.join(directory, 'metadata'),
      downloadPath: path.join(directory, 'other-downloads'),
      streamToken: 'completed-token'
    })
    await restoredEngine.initialize()
    try {
      await restoredEngine.restorePersistentTask(completed)
      const playback = await restoredEngine.play(imported.id, 0)
      assert.equal(playback.source, 'local')
      assert.equal(restoredClient.addCalls.length, 0)
      assert.equal((await fetch(playback.url, { method: 'HEAD' })).status, 200)
    } finally {
      await restoredEngine.shutdown()
    }
  })
})

test('reports a clear error when a completed download was moved or deleted', async () => {
  await withEngine(async ({ torrentBuffer, client, engine }) => {
    const imported = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    await engine.startDownload(imported.id)
    client.addCalls.at(-1).torrent.emit('done')

    await assert.rejects(
      () => engine.play(imported.id, 0),
      error => error.code === 'LOCAL_FILE_MISSING'
    )
    assert.equal(engine.getTask(imported.id).policy.playing, false)
  })
})

test('refuses to serve a completed-file symlink outside the download directory', async () => {
  if (process.platform === 'win32') return
  await withEngine(async ({ directory, torrentBuffer, parsed, client, engine }) => {
    const imported = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    const downloading = await engine.startDownload(imported.id)
    const outsidePath = path.join(directory, 'outside-video.mp4')
    const localPath = path.join(downloading.downloadPath, parsed.files[0].path)
    await writeFile(outsidePath, Buffer.alloc(parsed.files[0].length, 41))
    await mkdir(path.dirname(localPath), { recursive: true })
    await symlink(outsidePath, localPath)
    client.addCalls.at(-1).torrent.emit('done')

    await assert.rejects(
      () => engine.play(imported.id, 0),
      error => error.code === 'LOCAL_FILE_MISSING'
    )
  })
})

test('pause closes the active torrent without deleting files and resume re-adds it', async () => {
  await withEngine(async ({ torrentBuffer, client, engine }) => {
    const task = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    await engine.startDownload(task.id)
    await engine.pause(task.id)

    assert.equal(client.removeCalls.at(-1).options.destroyStore, false)
    assert.equal(engine.getTask(task.id).policy.phase, 'paused')

    const beforeResume = client.addCalls.length
    await engine.resume(task.id)
    assert.equal(client.addCalls.length, beforeResume + 1)
    assert.equal(engine.getTask(task.id).policy.phase, 'downloading')
  })
})

test('closing an ephemeral player removes cached pieces and keeps imported metadata ready', async () => {
  await withEngine(async ({ torrentBuffer, cacheManager, engine }) => {
    const task = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    await engine.play(task.id, 0)
    const activeTorrent = engine.client.addCalls.at(-1).torrent
    activeTorrent.emit('noPeers', 'tracker')
    assert.equal(engine.getTask(task.id).noPeers, true)
    activeTorrent.emit('wire', {})
    assert.equal(engine.getTask(task.id).noPeers, false)
    activeTorrent.emit('noPeers', 'dht')
    const cachePath = cacheManager.taskPath(task.id)
    await writeFile(path.join(cachePath, 'piece.bin'), 'temporary')

    await engine.closePlayer(task.id)
    assert.equal(engine.getTask(task.id).policy.phase, 'ready')
    assert.equal(engine.getTask(task.id).noPeers, false)
    await assert.rejects(() => stat(cachePath), { code: 'ENOENT' })
  })
})

test('restores a paused permanent task without network activity, then resumes in place', async () => {
  await withEngine(async ({ directory, torrentBuffer, parsed, engine }) => {
    const task = await engine.importTorrentBuffer(torrentBuffer, 'sample.torrent')
    await engine.startDownload(task.id)
    const paused = await engine.pause(task.id)
    await engine.shutdown()

    const restoredClient = new FakeClient(parsed)
    const restoredEngine = new TorrentEngine({
      client: restoredClient,
      cacheManager: new CacheManager(path.join(directory, 'restored-cache')),
      metadataDirectory: path.join(directory, 'metadata'),
      downloadPath: path.join(directory, 'other-default-downloads'),
      streamToken: 'restore-token'
    })
    await restoredEngine.initialize()
    try {
      const restored = await restoredEngine.restorePersistentTask(paused)
      assert.equal(restored.policy.phase, 'paused')
      assert.equal(restoredClient.addCalls.length, 0)
      assert.equal(restored.downloadPath, paused.downloadPath)

      const resumed = await restoredEngine.resume(restored.id)
      assert.equal(resumed.policy.phase, 'downloading')
      assert.equal(restoredClient.addCalls.length, 1)
      assert.equal(restoredClient.addCalls[0].options.path, paused.downloadPath)
      assert.equal(restoredClient.addCalls[0].options.destroyStoreOnDestroy, false)
    } finally {
      await restoredEngine.shutdown()
    }
  })
})
