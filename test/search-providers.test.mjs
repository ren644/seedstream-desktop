import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mapArchiveResults,
  parseTorznabFeed
} from '../src/core/search-providers.mjs'
import {
  mergeSearchResults,
  rankSearchResults
} from '../src/core/search-results.mjs'

const hash = '0123456789abcdef0123456789abcdef01234567'
const magnet = `magnet:?xt=urn:btih:${hash}&dn=Open%20Film`

test('parses Torznab RSS attributes into renderer-safe results', () => {
  const xml = `<?xml version="1.0"?>
    <rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
      <channel>
        <item>
          <title>Open Film 1080p</title>
          <guid>source-42</guid>
          <link>https://indexer.example/details/42</link>
          <pubDate>Sat, 01 Aug 2026 04:05:06 GMT</pubDate>
          <size>734003200</size>
          <enclosure url="https://indexer.example/download/42" length="734003200" type="application/x-bittorrent" />
          <torznab:attr name="seeders" value="73" />
          <torznab:attr name="peers" value="91" />
          <torznab:attr name="infohash" value="${hash.toUpperCase()}" />
          <torznab:attr name="magneturl" value="${magnet.replaceAll('&', '&amp;')}" />
        </item>
      </channel>
    </rss>`

  const [result] = parseTorznabFeed(xml, { id: 'home', name: '家庭索引' })
  assert.deepEqual(result, {
    sourceId: 'home',
    sourceName: '家庭索引',
    sourceResultId: 'source-42',
    title: 'Open Film 1080p',
    size: 734003200,
    seeders: 73,
    peers: 91,
    publishedAt: '2026-08-01T04:05:06.000Z',
    detailsUrl: 'https://indexer.example/details/42',
    torrentUrl: 'https://indexer.example/download/42',
    magnetUri: magnet,
    infoHash: hash
  })
})

test('maps Internet Archive documents to generated torrent downloads', () => {
  const results = mapArchiveResults({
    response: {
      docs: [{
        identifier: 'open-film-2026',
        title: ['Open Film'],
        downloads: 1200,
        item_size: 4096,
        date: '2026-07-30T12:00:00Z'
      }]
    }
  })

  assert.deepEqual(results, [{
    sourceId: 'internet-archive',
    sourceName: 'Internet Archive',
    sourceResultId: 'open-film-2026',
    title: 'Open Film',
    size: 4096,
    seeders: null,
    peers: null,
    publishedAt: '2026-07-30T12:00:00.000Z',
    detailsUrl: 'https://archive.org/details/open-film-2026',
    torrentUrl: 'https://archive.org/download/open-film-2026/open-film-2026_archive.torrent',
    magnetUri: null,
    infoHash: null,
    downloads: 1200
  }])
})

test('merges duplicates by info hash and preserves all source labels', () => {
  const merged = mergeSearchResults([
    {
      sourceId: 'one', sourceName: 'One', title: 'Open Film', size: 10,
      seeders: 12, peers: 14, infoHash: hash, magnetUri: magnet, torrentUrl: null
    },
    {
      sourceId: 'two', sourceName: 'Two', title: 'Open Film Copy', size: 10,
      seeders: 30, peers: 33, infoHash: hash.toUpperCase(), magnetUri: null,
      torrentUrl: 'https://two.example/file.torrent'
    }
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].seeders, 30)
  assert.equal(merged[0].peers, 33)
  assert.equal(merged[0].magnetUri, magnet)
  assert.equal(merged[0].torrentUrl, 'https://two.example/file.torrent')
  assert.deepEqual(merged[0].sources, ['One', 'Two'])
})

test('falls back to normalized title and size deduplication', () => {
  const merged = mergeSearchResults([
    { sourceId: 'a', sourceName: 'A', title: 'Film.Name 2026', size: 25, seeders: null, peers: null },
    { sourceId: 'b', sourceName: 'B', title: 'film name 2026', size: 25, seeders: 1, peers: 2 }
  ])
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].sources, ['A', 'B'])
})

test('ranks connectable results deterministically by availability then recency', () => {
  const ranked = rankSearchResults([
    { title: 'No route', sourceId: 'a', sourceName: 'A', seeders: 999, peers: 999, publishedAt: '2026-08-02T00:00:00Z' },
    { title: 'Older fast', sourceId: 'b', sourceName: 'B', seeders: 20, peers: 30, publishedAt: '2026-07-01T00:00:00Z', torrentUrl: 'https://b.example/t' },
    { title: 'New fast', sourceId: 'c', sourceName: 'C', seeders: 20, peers: 30, publishedAt: '2026-08-01T00:00:00Z', magnetUri: magnet }
  ])
  assert.deepEqual(ranked.map(result => result.title), ['New fast', 'Older fast', 'No route'])
  assert.ok(ranked[0].availabilityScore > ranked[2].availabilityScore)
})

test('promotes an exact catalog-code title match before a busier unrelated result', () => {
  const ranked = rankSearchResults([
    { title: 'Popular unrelated release', sourceId: 'a', sourceName: 'A', seeders: 999, magnetUri: magnet },
    { title: '[Group] SSIS-123 1080p', sourceId: 'b', sourceName: 'B', seeders: 1, magnetUri: magnet }
  ], { catalogCode: 'SSIS-123' })

  assert.deepEqual(ranked.map(result => result.title), ['[Group] SSIS-123 1080p', 'Popular unrelated release'])
  assert.equal(ranked[0].catalogMatch, true)
  assert.equal(ranked[1].catalogMatch, false)
})

test('ignores malformed provider entries instead of failing the complete feed', () => {
  const xml = '<rss><channel><item><title>Good</title><link>https://example.com/file.torrent</link></item><item><title></title></item></channel></rss>'
  const results = parseTorznabFeed(xml, { id: 'mixed', name: 'Mixed' })
  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'Good')
})
