import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  statusLabel
} from '../src/renderer/formatters.mjs'

test('formats byte sizes and transfer speeds for compact task cards', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 ** 3), '1.0 GB')
  assert.equal(formatBytes(-1), '—')
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
  assert.equal(statusLabel({ policy: { phase: 'streaming' } }), '边下边播')
  assert.equal(statusLabel({ policy: { phase: 'downloading' }, noPeers: true }), '等待可用节点')
  assert.equal(statusLabel({ policy: { phase: 'downloading' }, noPeers: false }), '正在下载')
  assert.equal(statusLabel({ policy: { phase: 'paused' } }), '已暂停')
  assert.equal(statusLabel({ policy: { phase: 'complete' } }), '下载完成')
  assert.equal(statusLabel({ policy: { phase: 'error' }, error: 'disk full' }), '发生错误')
})
