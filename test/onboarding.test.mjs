import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ONBOARDING_KEY,
  completeOnboarding,
  guideForPlatform,
  shouldShowOnboarding
} from '../src/renderer/onboarding.mjs'

function memoryStorage (initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  }
}

test('shows onboarding until the user explicitly completes it', () => {
  const storage = memoryStorage()
  assert.equal(shouldShowOnboarding(storage), true)
  completeOnboarding(storage)
  assert.equal(storage.getItem(ONBOARDING_KEY), '1')
  assert.equal(shouldShowOnboarding(storage), false)
})

test('fails open when renderer storage is unavailable', () => {
  const brokenStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') }
  }
  assert.equal(shouldShowOnboarding(brokenStorage), true)
  assert.doesNotThrow(() => completeOnboarding(brokenStorage))
})

test('provides honest platform-specific first-run guidance', () => {
  const mac = guideForPlatform('darwin')
  assert.equal(mac.label, 'macOS')
  assert.match(mac.warning, /隐私与安全/)
  assert.match(mac.launch, /右键/)

  const windows = guideForPlatform('win32')
  assert.equal(windows.label, 'Windows')
  assert.match(windows.warning, /SmartScreen/)
  assert.match(windows.launch, /便携版/)

  const fallback = guideForPlatform('linux')
  assert.equal(fallback.label, '当前系统')
  assert.match(fallback.warning, /来源/)
})
