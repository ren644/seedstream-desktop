import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'

import { CacheManager, isPathInside } from '../src/core/cache-manager.mjs'
import { TaskStore } from '../src/core/task-store.mjs'

async function withTempDirectory (prefix, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('TaskStore only persists permanent tasks and replaces state atomically', async () => {
  await withTempDirectory('seedstream-store-', async directory => {
    const filePath = path.join(directory, 'nested', 'state.json')
    const store = new TaskStore(filePath)

    await store.save({
      downloadPath: path.join(directory, 'My Downloads'),
      tasks: [
        {
          id: 'aaa111',
          name: 'keep-me',
          policy: { phase: 'downloading', storage: 'persistent', playing: false },
          torrentFilePath: '/metadata/aaa111.torrent',
          addedAt: '2026-08-01T00:00:00.000Z'
        },
        {
          id: 'bbb222',
          name: 'discard-stream-cache',
          policy: { phase: 'streaming', storage: 'ephemeral', playing: true },
          torrentFilePath: '/metadata/bbb222.torrent'
        }
      ]
    })

    const raw = JSON.parse(await readFile(filePath, 'utf8'))
    assert.equal(raw.version, 1)
    assert.equal(raw.tasks.length, 1)
    assert.equal(raw.tasks[0].id, 'aaa111')
    assert.equal(raw.tasks[0].policy.playing, false)

    const loaded = await store.load()
    assert.deepEqual(loaded, raw)

    const siblingNames = await (await import('node:fs/promises')).readdir(path.dirname(filePath))
    assert.deepEqual(siblingNames, ['state.json'])
  })
})

test('TaskStore returns a safe empty state for a missing file', async () => {
  await withTempDirectory('seedstream-missing-store-', async directory => {
    const store = new TaskStore(path.join(directory, 'not-created', 'state.json'))
    assert.deepEqual(await store.load(), { version: 1, downloadPath: null, tasks: [] })
  })
})

test('path containment works with POSIX and Windows path semantics', () => {
  assert.equal(isPathInside('/tmp/seed cache', '/tmp/seed cache/abc'), true)
  assert.equal(isPathInside('/tmp/seed cache', '/tmp/seed cache-evil/abc'), false)
  assert.equal(isPathInside('/tmp/seed cache', '/tmp/seed cache'), false)

  assert.equal(
    isPathInside('C:\\Temp\\Seed Cache', 'C:\\Temp\\Seed Cache\\abc', path.win32),
    true
  )
  assert.equal(
    isPathInside('C:\\Temp\\Seed Cache', 'C:\\Temp\\Seed Cache Evil\\abc', path.win32),
    false
  )
})

test('CacheManager sweeps stale cache and refuses outside deletion', async () => {
  await withTempDirectory('seedstream-cache-parent-', async parent => {
    const root = path.join(parent, 'cache with spaces')
    const outside = path.join(parent, 'must-survive.txt')
    await mkdir(path.join(root, 'stale-task'), { recursive: true })
    await writeFile(path.join(root, 'stale-task', 'piece.bin'), 'stale')
    await writeFile(outside, 'important')

    const manager = new CacheManager(root)
    await manager.reset()

    await assert.rejects(() => manager.removeOwnedPath(outside), /outside cache root/i)
    assert.equal(await readFile(outside, 'utf8'), 'important')
    assert.equal((await stat(root)).isDirectory(), true)

    const taskPath = await manager.createTaskPath('abc123')
    await writeFile(path.join(taskPath, 'piece.bin'), 'temporary')
    await manager.removeTask('abc123')
    await assert.rejects(() => stat(taskPath), { code: 'ENOENT' })
  })
})

test('CacheManager rejects path-shaped task identifiers', async () => {
  await withTempDirectory('seedstream-cache-ids-', async parent => {
    const manager = new CacheManager(path.join(parent, 'cache'))
    await manager.reset()
    await assert.rejects(() => manager.createTaskPath('../outside'), /task id/i)
    await assert.rejects(() => manager.removeTask('a/b'), /task id/i)
  })
})
