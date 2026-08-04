import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import WebTorrent from 'webtorrent'

import { CacheManager } from '../src/core/cache-manager.mjs'
import { TorrentEngine } from '../src/core/torrent-engine.mjs'

function createLocalClient () {
  return new WebTorrent({
    dht: false,
    lsd: false,
    natPmp: false,
    natUpnp: false,
    tracker: false,
    utp: false
  })
}

function seedFile (client, filePath) {
  return new Promise((resolve, reject) => {
    client.once('error', reject)
    client.seed(filePath, { announce: [] }, torrent => {
      client.off('error', reject)
      resolve(torrent)
    })
  })
}

function destroyClient (client) {
  if (!client || client.destroyed) return Promise.resolve()
  return new Promise(resolve => client.destroy(() => resolve()))
}

test('resolves metadata from a real local WebTorrent peer without public network access', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'seedstream-real-magnet-'))
  const sourcePath = path.join(directory, 'legal-local-fixture.mp4')
  const seeder = createLocalClient()
  const downloader = createLocalClient()
  let engine

  try {
    await writeFile(sourcePath, Buffer.alloc(96 * 1024, 11))
    const seededTorrent = await seedFile(seeder, sourcePath)
    assert.ok(seeder.torrentPort > 0)

    engine = new TorrentEngine({
      client: downloader,
      cacheManager: new CacheManager(path.join(directory, 'cache')),
      metadataDirectory: path.join(directory, 'metadata'),
      downloadPath: path.join(directory, 'downloads'),
      streamToken: 'local-integration-token',
      magnetMetadataTimeoutMs: 10_000,
      magnetCleanupTimeoutMs: 1_000,
      magnetTrackers: []
    })
    await engine.initialize()

    downloader.once('add', torrent => {
      const connect = () => torrent.addPeer(`127.0.0.1:${seeder.torrentPort}`, 'local-integration-test')
      if (torrent.infoHash) connect()
      else torrent.once('_infoHash', connect)
    })

    const task = await engine.importMagnet(`magnet:?xt=urn:btih:${seededTorrent.infoHash}&dn=legal-local-fixture.mp4`)
    assert.equal(task.id, seededTorrent.infoHash)
    assert.equal(task.name, 'legal-local-fixture.mp4')
    assert.equal(task.files.length, 1)
    assert.equal(task.files[0].playable, true)
  } finally {
    await engine?.shutdown()
    await destroyClient(seeder)
    await destroyClient(downloader)
    await rm(directory, { recursive: true, force: true })
  }
})
