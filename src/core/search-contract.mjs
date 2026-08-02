import { parseCatalogCode } from '../shared/catalog-code.mjs'

const QUERY_MAX_LENGTH = 200
const ENDPOINT_MAX_LENGTH = 2048
const MAGNET_MAX_LENGTH = 8192
const MAX_PROVIDERS = 32
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const RESULT_TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const UNSAFE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const BTIH = /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i
const BTMH = /^urn:btmh:1220[a-f0-9]{64}$/i

function boundedText (value, { name, maxLength, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || UNSAFE_CONTROLS.test(value)) {
    throw new TypeError(`A valid ${name} is required`)
  }
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!allowEmpty && normalized.length === 0) {
    throw new TypeError(`A valid ${name} is required`)
  }
  return normalized
}

export function normalizeSearchQuery (value) {
  return boundedText(value, { name: 'search query', maxLength: QUERY_MAX_LENGTH })
}

export function normalizeSearchRequest (value) {
  if (typeof value === 'string') {
    const query = normalizeSearchQuery(value)
    return { mode: 'standard', query, queries: [query], catalogCode: null }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('A valid search request is required')
  }
  const mode = value.mode ?? 'standard'
  if (!['standard', 'catalog'].includes(mode)) throw new TypeError('A valid search mode is required')
  const query = normalizeSearchQuery(value.query)
  if (mode === 'standard') return { mode, query, queries: [query], catalogCode: null }
  const catalog = parseCatalogCode(query)
  return {
    mode,
    query: catalog.canonical,
    queries: catalog.variants,
    catalogCode: catalog.canonical
  }
}

export function assertSearchEndpoint (value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > ENDPOINT_MAX_LENGTH || UNSAFE_CONTROLS.test(value)) {
    throw new TypeError('A valid search endpoint is required')
  }
  let endpoint
  try {
    endpoint = new URL(value)
  } catch {
    throw new TypeError('A valid search endpoint is required')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new TypeError('A valid search endpoint is required')
  }
  return endpoint.href
}

export function assertMagnetUri (value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAGNET_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('A valid magnet link is required')
  }
  let magnet
  try {
    magnet = new URL(value)
  } catch {
    throw new TypeError('A valid magnet link is required')
  }
  if (magnet.protocol !== 'magnet:') {
    throw new TypeError('A valid magnet link is required')
  }
  const exactTopics = magnet.searchParams.getAll('xt')
  if (!exactTopics.some(topic => BTIH.test(topic) || BTMH.test(topic))) {
    throw new TypeError('A valid magnet link with an info hash is required')
  }
  return value
}

export function normalizeProviderConfigs (value) {
  if (!Array.isArray(value) || value.length > MAX_PROVIDERS) {
    throw new TypeError('A valid provider configuration list is required')
  }

  const providerIds = new Set()
  return value.map((provider, index) => {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      throw new TypeError(`A valid provider configuration is required at index ${index}`)
    }
    const id = boundedText(provider.id, { name: 'provider id', maxLength: 64 }).toLowerCase()
    if (!PROVIDER_ID.test(id)) throw new TypeError('A valid provider id is required')
    if (providerIds.has(id)) throw new TypeError(`Duplicate provider id: ${id}`)
    providerIds.add(id)

    if (provider.kind !== 'torznab') throw new TypeError('A supported provider kind is required')
    const name = boundedText(provider.name, { name: 'provider name', maxLength: 80 })
    const apiKey = boundedText(provider.apiKey ?? '', {
      name: 'provider API key',
      maxLength: 512,
      allowEmpty: true
    })
    return {
      id,
      name,
      kind: 'torznab',
      endpoint: assertSearchEndpoint(provider.endpoint),
      apiKey,
      enabled: provider.enabled !== false
    }
  })
}

export function assertResultToken (value) {
  if (typeof value !== 'string' || !RESULT_TOKEN.test(value)) {
    throw new TypeError('A valid search result token is required')
  }
  return value
}
