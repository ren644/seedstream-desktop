import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isPlayableVideo,
  mediaTypeForName,
  makeFileId
} from '../src/core/media.mjs'
import {
  assertSafeTorrentFiles,
  isSafeTorrentPath
} from '../src/core/path-safety.mjs'
import {
  ACTION,
  initialTaskPolicy,
  transitionTask
} from '../src/core/task-policy.mjs'

test('recognizes video file names case-insensitively', () => {
  assert.equal(isPlayableVideo('Movie.MP4'), true)
  assert.equal(isPlayableVideo('folder/clip.webm'), true)
  assert.equal(isPlayableVideo('archive.zip'), false)
  assert.equal(mediaTypeForName('film.mkv'), 'video/x-matroska')
})

test('creates stable file ids without trusting a torrent path as an id', () => {
  assert.equal(makeFileId('abc123', 4), 'abc123:4')
  assert.throws(() => makeFileId('../bad', 4), /info hash/i)
  assert.throws(() => makeFileId('abc123', -1), /index/i)
})

test('accepts portable relative paths and rejects traversal or platform traps', () => {
  assert.equal(isSafeTorrentPath('Show/Season 1/Episode 01.mp4'), true)
  assert.equal(isSafeTorrentPath('Show\\Season 1\\Episode 01.mp4'), true)

  for (const unsafe of [
    '../secret.txt',
    'safe/../../secret.txt',
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    '\\\\server\\share\\file.mp4',
    'movie:alternate.mp4',
    'folder/CON.txt',
    'folder/trailing. ',
    'folder//file.mp4',
    'folder\0file.mp4'
  ]) {
    assert.equal(isSafeTorrentPath(unsafe), false, unsafe)
  }
})

test('reports the first unsafe file path in torrent metadata', () => {
  assert.doesNotThrow(() => assertSafeTorrentFiles([
    { path: 'safe/a.mp4' },
    { path: 'safe/subtitles/a.srt' }
  ]))
  assert.throws(
    () => assertSafeTorrentFiles([{ path: 'safe/a.mp4' }, { path: '../escape' }]),
    /unsafe torrent path/i
  )
})

test('stream-only playback is ephemeral and closing it requests a purge', () => {
  const ready = initialTaskPolicy()
  const streaming = transitionTask(ready, ACTION.PLAY)
  assert.deepEqual(streaming.state, {
    phase: 'streaming',
    storage: 'ephemeral',
    playing: true
  })

  const closed = transitionTask(streaming.state, ACTION.CLOSE_PLAYER)
  assert.deepEqual(closed.state, initialTaskPolicy())
  assert.deepEqual(closed.effects, ['stop-transfer', 'purge-cache'])
})

test('promoting a stream to download purges cache before persistent restart', () => {
  const streaming = transitionTask(initialTaskPolicy(), ACTION.PLAY).state
  const downloading = transitionTask(streaming, ACTION.START_DOWNLOAD)
  assert.deepEqual(downloading.state, {
    phase: 'downloading',
    storage: 'persistent',
    playing: false
  })
  assert.deepEqual(downloading.effects, [
    'stop-transfer',
    'purge-cache',
    'start-persistent-transfer'
  ])
})

test('playing a permanent download reuses it and pause closes playback', () => {
  const downloading = transitionTask(initialTaskPolicy(), ACTION.START_DOWNLOAD).state
  const playing = transitionTask(downloading, ACTION.PLAY)
  assert.equal(playing.state.phase, 'downloading')
  assert.equal(playing.state.storage, 'persistent')
  assert.equal(playing.state.playing, true)
  assert.deepEqual(playing.effects, ['open-player'])

  const paused = transitionTask(playing.state, ACTION.PAUSE)
  assert.deepEqual(paused.state, {
    phase: 'paused',
    storage: 'persistent',
    playing: false
  })
  assert.deepEqual(paused.effects, ['close-player', 'stop-transfer-keep-files'])

  const resumed = transitionTask(paused.state, ACTION.RESUME)
  assert.equal(resumed.state.phase, 'downloading')
  assert.deepEqual(resumed.effects, ['start-persistent-transfer'])
})

test('rejects invalid state transitions', () => {
  assert.throws(
    () => transitionTask(initialTaskPolicy(), ACTION.PAUSE),
    /cannot pause/i
  )
})
