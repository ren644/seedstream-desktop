import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeTheme,
  readTheme,
  THEME_STORAGE_KEY,
  THEMES,
  themeLabel,
  writeTheme
} from '../src/renderer/theme-preference.mjs'

test('defines three distinct appearance themes', () => {
  assert.deepEqual(THEMES.map(theme => theme.id), ['mist', 'night', 'sand'])
  assert.equal(new Set(THEMES.map(theme => theme.label)).size, 3)
})

test('falls back to the approved mist theme for invalid values', () => {
  assert.equal(normalizeTheme('night'), 'night')
  assert.equal(normalizeTheme('unknown'), 'mist')
  assert.equal(normalizeTheme(null), 'mist')
})

test('reads, writes and labels a valid persisted theme', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }

  assert.equal(readTheme(storage), 'mist')
  assert.equal(writeTheme(storage, 'sand'), 'sand')
  assert.equal(values.get(THEME_STORAGE_KEY), 'sand')
  assert.equal(readTheme(storage), 'sand')
  assert.equal(themeLabel('sand'), '暖砂')
})

test('fails open when renderer storage is unavailable', () => {
  const storage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') }
  }

  assert.equal(readTheme(storage), 'mist')
  assert.equal(writeTheme(storage, 'night'), 'night')
})
