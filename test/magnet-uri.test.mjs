import test from 'node:test'
import assert from 'node:assert/strict'

import { assertMagnetUri } from '../src/core/magnet-uri.mjs'

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
