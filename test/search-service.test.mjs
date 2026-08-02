import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'

import { SearchConfigStore } from '../src/core/search-config-store.mjs'
import { SearchService } from '../src/core/search-service.mjs'

const hash = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
const magnet = `magnet:?xt=urn:btih:${hash}&dn=Open%20Movie`

async function listen (handler) {
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

function memoryEncryption () {
  return {
    isAvailable: () => true,
    encrypt: value => Buffer.from(`encrypted:${value}`),
    decrypt: value => Buffer.from(value).toString().replace(/^encrypted:/, '')
  }
}

async function withDirectory (callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'seedstream-search-'))
  try {
    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('stores provider API keys encrypted and restores normalized configs', async () => {
  await withDirectory(async directory => {
    const filePath = path.join(directory, 'search.json')
    const store = new SearchConfigStore({ filePath, encryption: memoryEncryption() })
    const providers = await store.save([{
      id: 'home',
      name: 'Home Search',
      kind: 'torznab',
      endpoint: 'https://search.example/api',
      apiKey: 'top-secret',
      enabled: true
    }])

    assert.equal(providers[0].apiKey, 'top-secret')
    const raw = await readFile(filePath, 'utf8')
    assert.doesNotMatch(raw, /top-secret/)
    assert.match(raw, /encryptedApiKey/)
    assert.deepEqual(await store.load(), providers)
  })
})

test('does not persist plaintext keys when system encryption is unavailable', async () => {
  await withDirectory(async directory => {
    const store = new SearchConfigStore({
      filePath: path.join(directory, 'search.json'),
      encryption: { isAvailable: () => false }
    })
    await store.save([{
      id: 'home', name: 'Home', kind: 'torznab',
      endpoint: 'http://127.0.0.1:9117/api', apiKey: 'secret', enabled: true
    }])
    const [loaded] = await store.load()
    assert.equal(loaded.apiKey, '')
    assert.equal(store.secretsPersisted, false)
  })
})

test('aggregates Archive and Torznab while isolating failed sources', async () => {
  const server = await listen((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/archive') {
      assert.equal(url.searchParams.get('q'), 'Open Movie')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ response: { docs: [{ identifier: 'archive-open', title: 'Archive Open', downloads: 45, item_size: 100 }] } }))
      return
    }
    if (url.pathname === '/torznab') {
      assert.equal(url.searchParams.get('t'), 'search')
      assert.equal(url.searchParams.get('q'), 'Open Movie')
      assert.equal(url.searchParams.get('apikey'), 'private-key')
      response.writeHead(200, { 'content-type': 'application/rss+xml' })
      response.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item><title>Open Movie</title><torznab:attr name="seeders" value="22"/><torznab:attr name="infohash" value="${hash}"/><torznab:attr name="magneturl" value="${magnet.replaceAll('&', '&amp;')}"/></item></channel></rss>`)
      return
    }
    response.writeHead(503, { 'content-type': 'text/plain' })
    response.end('provider offline')
  })

  try {
    const configStore = {
      load: async () => [
        { id: 'home', name: 'Home', kind: 'torznab', endpoint: `${server.origin}/torznab`, apiKey: 'private-key', enabled: true },
        { id: 'offline', name: 'Offline', kind: 'torznab', endpoint: `${server.origin}/offline`, apiKey: 'must-not-leak', enabled: true }
      ]
    }
    const service = new SearchService({
      configStore,
      archiveEndpoint: `${server.origin}/archive`,
      timeoutMs: 1_000
    })
    const response = await service.search(' Open   Movie ')

    assert.equal(response.query, 'Open Movie')
    assert.equal(response.results.length, 2)
    assert.equal(response.sources.find(source => source.id === 'home').status, 'ok')
    assert.equal(response.sources.find(source => source.id === 'offline').status, 'error')
    assert.doesNotMatch(JSON.stringify(response), /private-key|must-not-leak|magnet:\?/)
    assert.ok(response.results.every(result => typeof result.token === 'string'))

    const torznab = response.results.find(result => result.title === 'Open Movie')
    const privateResult = service.takeResult(torznab.token)
    assert.equal(privateResult.magnetUri, magnet)
    assert.throws(() => service.takeResult(torznab.token), /expired or already used/i)
  } finally {
    await server.close()
  }
})

test('enforces response byte limits and request timeouts per source', async () => {
  const server = await listen((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/rss+xml' })
        response.end('<rss><channel></channel></rss>')
      }, 150)
      return
    }
    response.writeHead(200, { 'content-type': 'application/rss+xml' })
    response.end('x'.repeat(2_048))
  })

  try {
    const service = new SearchService({
      configStore: {
        load: async () => [
          { id: 'slow', name: 'Slow', kind: 'torznab', endpoint: `${server.origin}/slow`, apiKey: '', enabled: true },
          { id: 'large', name: 'Large', kind: 'torznab', endpoint: `${server.origin}/large`, apiKey: '', enabled: true }
        ]
      },
      archiveEnabled: false,
      timeoutMs: 30,
      maxSearchBytes: 512
    })
    const response = await service.search('test')
    assert.equal(response.results.length, 0)
    assert.deepEqual(response.sources.map(source => source.status), ['error', 'error'])
    assert.match(response.sources.find(source => source.id === 'slow').message, /timed out/i)
    assert.match(response.sources.find(source => source.id === 'large').message, /too large/i)
  } finally {
    await server.close()
  }
})

test('rejects a successful response with an unexpected content type', async () => {
  const server = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html>not a feed</html>')
  })
  try {
    const service = new SearchService({
      configStore: { load: async () => [{ id: 'html', name: 'HTML', kind: 'torznab', endpoint: `${server.origin}/feed`, apiKey: '', enabled: true }] },
      archiveEnabled: false,
      timeoutMs: 1_000
    })
    const response = await service.search('test')
    assert.match(response.sources[0].message, /content type/i)
  } finally {
    await server.close()
  }
})

test('downloads a bounded remote torrent from a one-time result token', async () => {
  const torrentBytes = Buffer.from('d4:infod4:name4:test6:lengthi1eee')
  const server = await listen((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/feed') {
      response.writeHead(200, { 'content-type': 'application/rss+xml' })
      response.end(`<rss><channel><item><title>Remote Torrent</title><enclosure url="${server.origin}/download" type="application/x-bittorrent"/></item></channel></rss>`)
      return
    }
    response.writeHead(200, { 'content-type': 'application/x-bittorrent' })
    response.end(torrentBytes)
  })
  try {
    const service = new SearchService({
      configStore: { load: async () => [{ id: 'remote', name: 'Remote', kind: 'torznab', endpoint: `${server.origin}/feed`, apiKey: '', enabled: true }] },
      archiveEnabled: false,
      timeoutMs: 1_000
    })
    const search = await service.search('remote')
    const payload = await service.takeImportPayload(search.results[0].token)
    assert.equal(payload.kind, 'torrent')
    assert.equal(payload.sourceName, 'Remote Torrent.torrent')
    assert.deepEqual(Buffer.from(payload.bytes), torrentBytes)
    await assert.rejects(() => service.takeImportPayload(search.results[0].token), /expired or already used/i)
  } finally {
    await server.close()
  }
})
