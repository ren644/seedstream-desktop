import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CHANNELS,
  assertFileIndex,
  assertFullscreenValue,
  assertTaskId,
  assertTorrentBytes,
  extractTorrentPath,
  isAllowedRendererUrl
} from '../src/ipc-contract.mjs'

test('defines unique IPC channel names', () => {
  const values = Object.values(CHANNELS)
  assert.equal(new Set(values).size, values.length)
  assert.ok(values.every(value => value.startsWith('seedstream:')))
  assert.equal(CHANNELS.OPEN_GUIDE, 'seedstream:app:open-guide')
  assert.equal(CHANNELS.TOGGLE_WINDOW_MAXIMIZE, 'seedstream:window:toggle-maximize')
  assert.equal(CHANNELS.SET_VIDEO_FULLSCREEN, 'seedstream:window:set-video-fullscreen')
  assert.equal(CHANNELS.VIDEO_FULLSCREEN_CHANGED, 'seedstream:event:video-fullscreen-changed')
  assert.equal(CHANNELS.IMPORT_MAGNET, 'seedstream:torrent:import-magnet')
  assert.equal(CHANNELS.CANCEL_MAGNET_IMPORT, 'seedstream:torrent:cancel-magnet-import')
  assert.equal(values.some(value => value.includes(':search:')), false)
})

test('requires an explicit boolean for privileged video fullscreen changes', () => {
  assert.equal(assertFullscreenValue(true), true)
  assert.equal(assertFullscreenValue(false), false)
  for (const value of [null, 0, 'true', {}]) {
    assert.throws(() => assertFullscreenValue(value), /boolean fullscreen/i)
  }
})

test('validates task ids and file indexes before privileged operations', () => {
  const hash = 'a'.repeat(40)
  assert.equal(assertTaskId(hash), hash)
  assert.equal(assertFileIndex(3), 3)

  for (const value of ['', '../escape', 'g'.repeat(40), 123]) {
    assert.throws(() => assertTaskId(value), /task id/i)
  }
  for (const value of [-1, 1.2, '2', 10_001]) {
    assert.throws(() => assertFileIndex(value), /file index/i)
  }
})

test('copies bounded torrent bytes crossing IPC', () => {
  const input = new Uint8Array([1, 2, 3])
  const copied = assertTorrentBytes(input)
  assert.deepEqual(copied, input)
  assert.notEqual(copied.buffer, input.buffer)

  assert.throws(() => assertTorrentBytes('not bytes'), /torrent data/i)
  assert.throws(() => assertTorrentBytes(new Uint8Array()), /torrent data/i)
  assert.throws(() => assertTorrentBytes(new Uint8Array(10 * 1024 * 1024 + 1)), /torrent data/i)
})

test('extracts torrent paths from macOS and Windows launch arguments', () => {
  assert.equal(
    extractTorrentPath(['/Applications/SeedStream', '/Users/me/Downloads/demo.TORRENT'], 'darwin'),
    '/Users/me/Downloads/demo.TORRENT'
  )
  assert.equal(
    extractTorrentPath(['C:\\Program Files\\SeedStream.exe', '--flag', 'D:\\种子\\demo.torrent'], 'win32'),
    'D:\\种子\\demo.torrent'
  )
  assert.equal(extractTorrentPath(['SeedStream.exe', '--inspect=1234'], 'win32'), null)
})

test('only the packaged local renderer URL is accepted as an IPC sender', () => {
  const rendererPath = path.resolve('/tmp/SeedStream App/index.html')
  const allowed = pathToFileURL(rendererPath).href
  assert.equal(isAllowedRendererUrl(allowed, rendererPath), true)
  assert.equal(isAllowedRendererUrl(`${allowed}?ignored=no`, rendererPath), false)
  assert.equal(isAllowedRendererUrl('https://evil.example/index.html', rendererPath), false)
  assert.equal(isAllowedRendererUrl('file:///tmp/other.html', rendererPath), false)
  assert.equal(isAllowedRendererUrl('not a url', rendererPath), false)
})
