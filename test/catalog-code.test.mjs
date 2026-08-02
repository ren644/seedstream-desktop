import test from 'node:test'
import assert from 'node:assert/strict'

import {
  catalogCodeMatchLevel,
  catalogCodePreview,
  parseCatalogCode
} from '../src/shared/catalog-code.mjs'

test('normalizes common catalog-code spellings into bounded query variants', () => {
  assert.deepEqual(parseCatalogCode('  ssis１２３  '), {
    canonical: 'SSIS-123',
    compact: 'SSIS123',
    variants: ['SSIS-123', 'SSIS123', 'SSIS 123']
  })
  assert.deepEqual(parseCatalogCode('SSIS123'), {
    canonical: 'SSIS-123',
    compact: 'SSIS123',
    variants: ['SSIS-123', 'SSIS123', 'SSIS 123']
  })
  assert.deepEqual(parseCatalogCode('fc2 ppv 1234567'), {
    canonical: 'FC2-PPV-1234567',
    compact: 'FC2PPV1234567',
    variants: ['FC2-PPV-1234567', 'FC2PPV1234567', 'FC2 PPV 1234567']
  })
  assert.deepEqual(parseCatalogCode('259luxu1234'), {
    canonical: '259LUXU-1234',
    compact: '259LUXU1234',
    variants: ['259LUXU-1234', '259LUXU1234', '259LUXU 1234']
  })
  assert.ok(parseCatalogCode('HEYZO-1234').variants.length <= 3)
})

test('rejects inputs that are not a single catalog code', () => {
  for (const value of [
    '',
    '123456',
    'Open Movie 2026',
    'https://example.com/SSIS-123',
    `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
    'SSIS-123 extra',
    'A1',
    'A'.repeat(65)
  ]) {
    assert.throws(
      () => parseCatalogCode(value),
      error => error?.code === 'INVALID_CATALOG_CODE'
    )
  }
})

test('matches a complete normalized code without accepting longer adjacent digits', () => {
  assert.equal(catalogCodeMatchLevel('[Group] SSIS-123 1080p', 'SSIS-123'), 2)
  assert.equal(catalogCodeMatchLevel('release.ssis123.mkv', 'SSIS-123'), 2)
  assert.equal(catalogCodeMatchLevel('SSIS-1234', 'SSIS-123'), 0)
  assert.equal(catalogCodeMatchLevel('Unrelated title', 'SSIS-123'), 0)
})

test('builds neutral live-preview states without throwing while typing', () => {
  assert.deepEqual(catalogCodePreview('SSIS123', true), {
    state: 'valid',
    canonical: 'SSIS-123',
    message: '识别为 SSIS-123 · 将匹配常见写法'
  })
  assert.equal(catalogCodePreview('Open Movie', true).state, 'invalid')
  assert.equal(catalogCodePreview('', true).state, 'idle')
  assert.equal(catalogCodePreview('SSIS123', false).state, 'disabled')
})

