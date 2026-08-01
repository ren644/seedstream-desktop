import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import createTorrent from 'create-torrent'
import WebTorrent from 'webtorrent'

import { CacheManager } from '../src/core/cache-manager.mjs'
import { TorrentEngine } from '../src/core/torrent-engine.mjs'

const LOCAL_ONLY_OPTIONS = {
  dht: false,
  tracker: false,
  lsd: false,
  natUpnp: false,
  natPmp: false,
  utp: false
}

function createTorrentBuffer (input) {
  return new Promise((resolve, reject) => {
    createTorrent(input, {
      name: 'local-video.mp4',
      announceList: [],
      pieceLength: 16 * 1024,
      creationDate: new Date('2026-08-01T00:00:00.000Z')
    }, (error, buffer) => {
      if (error) reject(error)
      else resolve(new Uint8Array(buffer))
    })
  })
}

function addSeed (client, torrentBuffer, sourceDirectory) {
  return new Promise((resolve, reject) => {
    const torrent = client.add(torrentBuffer, {
      path: sourceDirectory,
      deselect: false,
      destroyStoreOnDestroy: false
    }, readyTorrent => {
      if (readyTorrent.progress === 1) resolve(readyTorrent)
      else readyTorrent.once('done', () => resolve(readyTorrent))
    })
    torrent.once('error', reject)
  })
}

function destroyClient (client) {
  return new Promise(resolve => client.destroy(() => resolve()))
}

test('loopback HTTP server fulfills video byte ranges from a local peer', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'seedstream-local-peer-'))
  const seeder = new WebTorrent(LOCAL_ONLY_OPTIONS)
  let engine
  try {
    const sourcePath = path.join(directory, 'local-video.mp4')
    const sourceBytes = Buffer.alloc(64 * 1024, 23)
    await writeFile(sourcePath, sourceBytes)
    const torrentBuffer = await createTorrentBuffer(sourcePath)

    const seededTorrent = await addSeed(seeder, torrentBuffer, directory)
    assert.equal(seededTorrent.infoHash.length, 40)

    const leecher = new WebTorrent(LOCAL_ONLY_OPTIONS)
    engine = new TorrentEngine({
      client: leecher,
      cacheManager: new CacheManager(path.join(directory, 'cache')),
      metadataDirectory: path.join(directory, 'metadata'),
      downloadPath: path.join(directory, 'downloads'),
      streamToken: 'integration-token'
    })
    await engine.initialize()
    const imported = await engine.importTorrentBuffer(torrentBuffer, 'local.torrent')
    const playback = await engine.play(imported.id, 0)

    const leecherTorrent = await leecher.get(imported.id)
    const seederAddress = seeder.address()
    assert.ok(seederAddress?.port, 'local seeder must expose a TCP port')
    leecherTorrent.addPeer(`127.0.0.1:${seederAddress.port}`)

    const response = await fetch(playback.url, {
      headers: { Range: 'bytes=0-31' }
    })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(response.headers.get('content-range'), `bytes 0-31/${sourceBytes.length}`)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), sourceBytes.subarray(0, 32))
  } finally {
    await engine?.shutdown().catch(() => {})
    await destroyClient(seeder)
    await rm(directory, { recursive: true, force: true })
  }
})
