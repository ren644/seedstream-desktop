import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertMagnetUri,
  assertResultToken,
  assertSearchEndpoint,
  normalizeProviderConfigs,
  normalizeSearchQuery
} from '../src/core/search-contract.mjs'

test('normalizes bounded search queries', () => {
  assert.equal(normalizeSearchQuery('  open   movie  '), 'open movie')
  assert.equal(normalizeSearchQuery('片名\n第二季'), '片名 第二季')
  for (const value of ['', '   ', 42, 'a'.repeat(201), 'ok\u0000bad']) {
    assert.throws(() => normalizeSearchQuery(value), /search query/i)
  }
})

test('accepts only credential-free HTTP search endpoints', () => {
  assert.equal(
    assertSearchEndpoint('https://search.example/api?t=search'),
    'https://search.example/api?t=search'
  )
  assert.equal(assertSearchEndpoint('http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/'), 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/')

  for (const value of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:secret@example.com/api',
    'not a url',
    `https://example.com/${'a'.repeat(2050)}`
  ]) {
    assert.throws(() => assertSearchEndpoint(value), /search endpoint/i)
  }
})

test('validates v1 and v2 magnet links without rewriting trackers', () => {
  const v1 = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Example&tr=https%3A%2F%2Ftracker.example%2Fannounce`
  const v2 = `magnet:?xt=urn:btmh:1220${'b'.repeat(64)}&dn=Hybrid`
  assert.equal(assertMagnetUri(v1), v1)
  assert.equal(assertMagnetUri(v2), v2)

  for (const value of [
    '',
    'https://example.com/file.torrent',
    'magnet:?dn=missing-hash',
    'magnet:?xt=urn:btih:not-a-hash',
    `magnet:?xt=urn:btih:${'a'.repeat(40)}\u0000bad`,
    `magnet:?xt=urn:btih:${'a'.repeat(40)}&x=${'b'.repeat(8200)}`
  ]) {
    assert.throws(() => assertMagnetUri(value), /magnet/i)
  }
})

test('normalizes user-managed Torznab provider configs', () => {
  assert.deepEqual(normalizeProviderConfigs([
    {
      id: ' Local-One ',
      name: '  家庭搜索  ',
      kind: 'torznab',
      endpoint: 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/',
      apiKey: ' secret-key ',
      enabled: true
    }
  ]), [{
    id: 'local-one',
    name: '家庭搜索',
    kind: 'torznab',
    endpoint: 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/',
    apiKey: 'secret-key',
    enabled: true
  }])

  assert.throws(() => normalizeProviderConfigs('bad'), /provider configuration/i)
  assert.throws(() => normalizeProviderConfigs([{ id: '../bad', name: 'x', kind: 'torznab', endpoint: 'https://example.com' }]), /provider id/i)
  assert.throws(() => normalizeProviderConfigs([{ id: 'same', name: 'x', kind: 'torznab', endpoint: 'https://example.com' }, { id: 'same', name: 'y', kind: 'torznab', endpoint: 'https://example.org' }]), /duplicate provider/i)
  assert.throws(() => normalizeProviderConfigs([{ id: 'x', name: 'x', kind: 'other', endpoint: 'https://example.com' }]), /provider kind/i)
})

test('validates opaque result tokens', () => {
  const token = 'L3v7ZpFk8Qm2sT9xW4nC6a'
  assert.equal(assertResultToken(token), token)
  for (const value of ['', 'short', '../escape', 123, 'a'.repeat(129)]) {
    assert.throws(() => assertResultToken(value), /result token/i)
  }
})
