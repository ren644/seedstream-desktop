import { randomBytes } from 'node:crypto'

import {
  assertResultToken,
  assertSearchEndpoint,
  normalizeProviderConfigs,
  normalizeSearchQuery
} from './search-contract.mjs'
import { mapArchiveResults, parseTorznabFeed } from './search-providers.mjs'
import { mergeSearchResults, rankSearchResults } from './search-results.mjs'

const DEFAULT_ARCHIVE_ENDPOINT = 'https://archive.org/advancedsearch.php'
const RESULT_LIMIT = 200
const TOKEN_TTL_MS = 10 * 60 * 1000

class SearchServiceError extends Error {
  constructor (code, message, options) {
    super(message, options)
    this.name = 'SearchServiceError'
    this.code = code
  }
}

function safeSourceMessage (error) {
  const byCode = {
    SEARCH_TIMEOUT: 'Source request timed out',
    SOURCE_TOO_LARGE: 'Source response is too large',
    INVALID_CONTENT_TYPE: 'Source returned an unexpected content type'
  }
  if (byCode[error?.code]) return byCode[error.code]
  if (typeof error?.status === 'number') return `Source returned HTTP ${error.status}`
  return 'Source request failed'
}

function expectedContentType (response, type) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const valid = type === 'json'
    ? contentType.includes('json')
    : /(?:xml|rss)|text\/plain/.test(contentType)
  if (!valid) {
    throw new SearchServiceError('INVALID_CONTENT_TYPE', 'Unexpected source content type')
  }
}

async function boundedBody (response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SearchServiceError('SOURCE_TOO_LARGE', 'Source response is too large')
  }

  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new SearchServiceError('SOURCE_TOO_LARGE', 'Source response is too large')
    return bytes
  }

  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new SearchServiceError('SOURCE_TOO_LARGE', 'Source response is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function publicResult (result, token) {
  return {
    token,
    title: result.title,
    size: result.size ?? null,
    seeders: result.seeders ?? null,
    peers: result.peers ?? null,
    downloads: result.downloads ?? null,
    publishedAt: result.publishedAt ?? null,
    detailsUrl: result.detailsUrl ?? null,
    sources: Array.isArray(result.sources) ? result.sources : [result.sourceName].filter(Boolean),
    availabilityScore: result.availabilityScore ?? 0,
    hasMagnet: Boolean(result.magnetUri),
    hasTorrent: Boolean(result.torrentUrl)
  }
}

export class SearchService {
  constructor ({
    configStore,
    fetchImpl = globalThis.fetch,
    archiveEndpoint = DEFAULT_ARCHIVE_ENDPOINT,
    archiveEnabled = true,
    timeoutMs = 15_000,
    maxSearchBytes = 8 * 1024 * 1024,
    maxTorrentBytes = 10 * 1024 * 1024,
    now = () => Date.now(),
    tokenFactory = () => randomBytes(24).toString('base64url')
  } = {}) {
    if (!configStore || typeof configStore.load !== 'function') throw new TypeError('SearchService requires a config store')
    if (typeof fetchImpl !== 'function') throw new TypeError('SearchService requires fetch')
    this.configStore = configStore
    this.fetch = fetchImpl
    this.archiveEndpoint = archiveEndpoint
    this.archiveEnabled = archiveEnabled
    this.timeoutMs = timeoutMs
    this.maxSearchBytes = maxSearchBytes
    this.maxTorrentBytes = maxTorrentBytes
    this.now = now
    this.tokenFactory = tokenFactory
    this.resultTokens = new Map()
  }

  async getConfig () {
    const providers = await this.configStore.load()
    return {
      secretsPersisted: this.configStore.secretsPersisted !== false,
      providers: providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        apiKeyConfigured: Boolean(apiKey)
      }))
    }
  }

  async saveConfig (input) {
    if (typeof this.configStore.save !== 'function') throw new TypeError('Search configuration is read-only')
    const providers = await this.configStore.save(normalizeProviderConfigs(input))
    return {
      secretsPersisted: this.configStore.secretsPersisted !== false,
      providers: providers.map(({ apiKey, ...provider }) => ({ ...provider, apiKeyConfigured: Boolean(apiKey) }))
    }
  }

  async #fetch (url, type) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response
      try {
        response = await this.fetch(url, {
          signal: controller.signal,
          headers: { Accept: type === 'json' ? 'application/json' : 'application/rss+xml, application/xml, text/xml' }
        })
      } catch (error) {
        if (controller.signal.aborted) throw new SearchServiceError('SEARCH_TIMEOUT', 'Source request timed out', { cause: error })
        throw error
      }
      if (!response.ok) {
        const error = new SearchServiceError('SOURCE_HTTP_ERROR', `Source returned HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      expectedContentType(response, type)
      const bytes = await boundedBody(response, this.maxSearchBytes)
      return new TextDecoder().decode(bytes)
    } finally {
      clearTimeout(timeout)
    }
  }

  async #fetchTorrent (url, fetchImpl = this.fetch) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response
      try {
        response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: 'application/x-bittorrent, application/octet-stream' }
        })
      } catch (error) {
        if (controller.signal.aborted) throw new SearchServiceError('SEARCH_TIMEOUT', 'Torrent download timed out', { cause: error })
        throw error
      }
      if (!response.ok) {
        const error = new SearchServiceError('SOURCE_HTTP_ERROR', `Torrent source returned HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (contentType && !/(?:x-bittorrent|octet-stream|force-download|application\/download)/.test(contentType)) {
        throw new SearchServiceError('INVALID_CONTENT_TYPE', 'Torrent source returned an unexpected content type')
      }
      return boundedBody(response, this.maxTorrentBytes)
    } finally {
      clearTimeout(timeout)
    }
  }

  async #searchArchive (query) {
    const url = new URL(this.archiveEndpoint)
    url.searchParams.set('q', query)
    url.searchParams.set('rows', '50')
    url.searchParams.set('page', '1')
    url.searchParams.set('output', 'json')
    for (const field of ['identifier', 'title', 'downloads', 'item_size', 'date']) {
      url.searchParams.append('fl[]', field)
    }
    const raw = await this.#fetch(url, 'json')
    return mapArchiveResults(JSON.parse(raw))
  }

  async #searchTorznab (provider, query) {
    const url = new URL(provider.endpoint)
    url.searchParams.set('t', 'search')
    url.searchParams.set('q', query)
    if (provider.apiKey) url.searchParams.set('apikey', provider.apiKey)
    const raw = await this.#fetch(url, 'xml')
    return parseTorznabFeed(raw, provider)
  }

  #clearExpiredTokens () {
    const now = this.now()
    for (const [token, entry] of this.resultTokens) {
      if (entry.expiresAt <= now) this.resultTokens.delete(token)
    }
  }

  #issueToken (result) {
    let token
    do token = this.tokenFactory()
    while (this.resultTokens.has(token))
    this.resultTokens.set(token, { result, expiresAt: this.now() + TOKEN_TTL_MS })
    return token
  }

  async search (input) {
    const query = normalizeSearchQuery(input)
    this.#clearExpiredTokens()
    const providers = normalizeProviderConfigs(await this.configStore.load())
    const operations = []
    if (this.archiveEnabled) {
      operations.push({
        id: 'internet-archive',
        name: 'Internet Archive',
        execute: () => this.#searchArchive(query)
      })
    }
    for (const provider of providers.filter(provider => provider.enabled)) {
      operations.push({ id: provider.id, name: provider.name, execute: () => this.#searchTorznab(provider, query) })
    }

    const settled = await Promise.all(operations.map(async operation => {
      try {
        const results = await operation.execute()
        return {
          source: { id: operation.id, name: operation.name, status: 'ok', count: results.length },
          results
        }
      } catch (error) {
        return {
          source: { id: operation.id, name: operation.name, status: 'error', count: 0, message: safeSourceMessage(error) },
          results: []
        }
      }
    }))

    const ranked = rankSearchResults(mergeSearchResults(settled.flatMap(item => item.results))).slice(0, RESULT_LIMIT)
    return {
      query,
      results: ranked.map(result => publicResult(result, this.#issueToken(result))),
      sources: settled.map(item => item.source)
    }
  }

  takeResult (input) {
    const token = assertResultToken(input)
    this.#clearExpiredTokens()
    const entry = this.resultTokens.get(token)
    if (!entry) throw new SearchServiceError('RESULT_TOKEN_EXPIRED', 'Search result expired or already used')
    this.resultTokens.delete(token)
    return entry.result
  }

  async takeImportPayload (input) {
    const result = this.takeResult(input)
    if (result.torrentUrl) {
      try {
        const bytes = await this.#fetchTorrent(result.torrentUrl)
        const baseName = String(result.title || 'search-result')
          .trim()
          .replace(/[\\/:*?"<>|]/g, '-')
          .slice(0, 180) || 'search-result'
        return { kind: 'torrent', bytes, sourceName: `${baseName}.torrent` }
      } catch (error) {
        if (!result.magnetUri) throw error
      }
    }
    if (result.magnetUri) return { kind: 'magnet', magnetUri: result.magnetUri }
    throw new SearchServiceError('RESULT_NOT_IMPORTABLE', 'Search result has no torrent or magnet link')
  }

  async downloadTorrentUrl (input, { fetchImpl = this.fetch } = {}) {
    const url = assertSearchEndpoint(input)
    const bytes = await this.#fetchTorrent(url, fetchImpl)
    let sourceName = 'web-capture.torrent'
    try {
      const candidate = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, 180)
      if (candidate) sourceName = /\.torrent$/i.test(candidate) ? candidate : `${candidate}.torrent`
    } catch {}
    return { bytes, sourceName }
  }
}
