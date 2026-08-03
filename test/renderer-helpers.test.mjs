import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  statusLabel
} from '../src/renderer/formatters.mjs'
import {
  DATA_STALL_GRACE_MS,
  mediaCompatibilityNotice,
  PEER_DISCOVERY_GRACE_MS,
  playbackHealth,
  requestMediaPlayback
} from '../src/renderer/playback-health.mjs'
import {
  fullscreenButtonLabel,
  maximizeButtonLabel
} from '../src/renderer/fullscreen-controls.mjs'

test('formats byte sizes and transfer speeds for compact task cards', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 ** 3), '1.0 GB')
  assert.equal(formatBytes(-1), '—')
  assert.equal(formatSpeed(0.8), '1 B/s')
  assert.equal(formatSpeed(1024 ** 2), '1.0 MB/s')
})

test('formats time remaining without leaking Infinity or NaN into the UI', () => {
  assert.equal(formatEta(null), '—')
  assert.equal(formatEta(Infinity), '—')
  assert.equal(formatEta(45_000), '45 秒')
  assert.equal(formatEta(90_000), '1 分 30 秒')
  assert.equal(formatEta(3_660_000), '1 小时 1 分')
})

test('clamps progress percentages', () => {
  assert.equal(formatPercent(-0.2), '0%')
  assert.equal(formatPercent(0.426), '43%')
  assert.equal(formatPercent(2), '100%')
  assert.equal(formatPercent(NaN), '0%')
})

test('maps engine state to honest user-facing status labels', () => {
  assert.equal(statusLabel({ policy: { phase: 'ready' } }), '等待操作')
  assert.equal(statusLabel({ policy: { phase: 'streaming' }, numPeers: 0 }), '正在寻找节点')
  assert.equal(statusLabel({ policy: { phase: 'streaming' }, numPeers: 0, noPeers: true }), '暂无可用节点')
  assert.equal(statusLabel({ policy: { phase: 'streaming' }, numPeers: 2 }), '边下边播')
  assert.equal(statusLabel({ policy: { phase: 'streaming' }, numPeers: 2, noPeers: true }), '边下边播')
  assert.equal(statusLabel({ policy: { phase: 'downloading' }, noPeers: true }), '等待可用节点')
  assert.equal(statusLabel({ policy: { phase: 'downloading' }, noPeers: true, numPeers: 1, downloadSpeed: 1024 }), '正在下载')
  assert.equal(statusLabel({ policy: { phase: 'downloading' }, noPeers: false }), '正在下载')
  assert.equal(statusLabel({ policy: { phase: 'paused' } }), '已暂停')
  assert.equal(statusLabel({ policy: { phase: 'complete' } }), '下载完成')
  assert.equal(statusLabel({ policy: { phase: 'error' }, error: 'disk full' }), '发生错误')
})

test('explains peer discovery and stalled transfers instead of buffering forever', () => {
  const emptyTask = { numPeers: 0, downloadSpeed: 0, noPeers: false }
  assert.equal(playbackHealth({ task: emptyTask, elapsedMs: PEER_DISCOVERY_GRACE_MS - 1 }).kind, 'connecting')

  const noPeers = playbackHealth({ task: emptyTask, elapsedMs: PEER_DISCOVERY_GRACE_MS })
  assert.equal(noPeers.kind, 'no-peers')
  assert.equal(noPeers.label, 'NO PEERS FOUND')
  assert.equal(noPeers.canRetry, true)
  assert.match(noPeers.detail, /没有可用节点/)

  const stalled = playbackHealth({
    task: { numPeers: 2, downloadSpeed: 0 },
    stalledMs: DATA_STALL_GRACE_MS
  })
  assert.equal(stalled.kind, 'stalled')
  assert.match(stalled.detail, /2 个节点/)

  assert.equal(playbackHealth({ task: { numPeers: 1, downloadSpeed: 64 }, stalledMs: 0 }).kind, 'buffering')
  assert.equal(playbackHealth({ task: emptyTask, mediaState: 'ready' }).kind, 'ready')
  assert.equal(playbackHealth({ task: emptyTask, mediaState: 'playing' }).kind, 'playing')
  assert.deepEqual(
    playbackHealth({ task: emptyTask, source: 'local', mediaState: 'loading' }),
    {
      kind: 'local',
      label: 'LOCAL PLAYBACK',
      status: '正在打开本地视频…',
      detail: '',
      canRetry: false
    }
  )
  assert.equal(playbackHealth({ task: emptyTask, source: 'local', mediaState: 'playing' }).status, '本地文件播放')
})

test('warns conservatively about filename-signaled media compatibility risks', () => {
  assert.equal(mediaCompatibilityNotice('movie.mp4'), '')
  assert.match(mediaCompatibilityNotice('[Group]_Movie_[H264_AC3].mkv'), /MKV 容器、AC3 音频/)
  assert.match(mediaCompatibilityNotice('sample.HEVC.DTS.mkv'), /H\.265\/HEVC 视频/)
})

test('does not lock the UI while the browser waits indefinitely for media data', () => {
  let playCalled = false
  const pendingPlayback = new Promise(() => {})
  const result = requestMediaPlayback({
    play () {
      playCalled = true
      return pendingPlayback
    }
  })

  assert.equal(playCalled, true)
  assert.equal(result, undefined)
})

test('labels video fullscreen and window maximize controls honestly', () => {
  assert.equal(fullscreenButtonLabel(false), '全屏播放')
  assert.equal(fullscreenButtonLabel(true), '退出全屏')
  assert.equal(maximizeButtonLabel(false), '窗口最大化')
  assert.equal(maximizeButtonLabel(true), '还原窗口')
})
