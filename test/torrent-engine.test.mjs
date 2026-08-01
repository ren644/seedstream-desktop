import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  constructor (parsed) {
    super()
    this.parsed = parsed
    this.torrents = []
    this.addCalls = []
    this.removeCalls = []
    this.serverClosed = false
    this.destroyed = false
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

  add (_torrentBuffer, options, callback) {
    const torrent = new FakeTorrent(this, this.parsed, options)
    this.torrents.push(torrent)
    this.addCalls.push({ options, torrent })
    queueMicrotask(() => callback(torrent))
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
    queueMicrotask(() => callback?.())
  }

  destroy (callback) {
    this.destroyed = true
    this.torrents = []
    queueMicrotask(() => callback?.())
  }
}

async function withEngine (callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'seedstream-engine-'))
  try {
    const torrentBuffer = await createFixture(directory)
    const parsed = await parseTorrent(torrentBuffer)
    const client = new FakeClient(parsed)
    const cacheManager = new CacheManager(path.join(directory, 'cache'))
    const engine = new TorrentEngine({
      client,
      cacheManager,
      metadataDirectory: path.join(directory, 'metadata'),
      downloadPath: path.join(directory, 'downloads'),
      streamToken: 'fixed-token'
    })
    await engine.initialize()
    await callback({ directory, torrentBuffer, parsed, client, cacheManager, engine })
    await engine.shutdown()
  } finally {
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
