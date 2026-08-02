import { catalogCodeMatchLevel } from '../shared/catalog-code.mjs'

function nonNegativeInteger (value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function normalizedTitle (value) {
  return typeof value === 'string'
    ? value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    : ''
}

function resultKey (result) {
  if (typeof result?.infoHash === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(result.infoHash)) {
    return `hash:${result.infoHash.toLowerCase()}`
  }
  const title = normalizedTitle(result?.title)
  const size = nonNegativeInteger(result?.size)
  return title ? `title:${title}|size:${size ?? 'unknown'}` : null
}

function maxInteger (left, right) {
  const values = [nonNegativeInteger(left), nonNegativeInteger(right)].filter(value => value !== null)
  return values.length > 0 ? Math.max(...values) : null
}

function sourceLabels (result) {
  const values = Array.isArray(result?.sources) ? result.sources : [result?.sourceName]
  return values.filter(value => typeof value === 'string' && value.length > 0)
}

function mergePair (current, candidate) {
  const sources = [...new Set([...sourceLabels(current), ...sourceLabels(candidate)])]
  return {
    ...current,
    sourceId: current.sourceId ?? candidate.sourceId,
    sourceName: current.sourceName ?? candidate.sourceName,
    sourceResultId: current.sourceResultId ?? candidate.sourceResultId,
    title: current.title ?? candidate.title,
    size: nonNegativeInteger(current.size) ?? nonNegativeInteger(candidate.size),
    seeders: maxInteger(current.seeders, candidate.seeders),
    peers: maxInteger(current.peers, candidate.peers),
    downloads: maxInteger(current.downloads, candidate.downloads),
    publishedAt: current.publishedAt ?? candidate.publishedAt ?? null,
    detailsUrl: current.detailsUrl ?? candidate.detailsUrl ?? null,
    torrentUrl: current.torrentUrl ?? candidate.torrentUrl ?? null,
    magnetUri: current.magnetUri ?? candidate.magnetUri ?? null,
    infoHash: (current.infoHash ?? candidate.infoHash)?.toLowerCase?.() ?? null,
    sources
  }
}

export function mergeSearchResults (input) {
  if (!Array.isArray(input)) return []
  const merged = new Map()
  const unkeyed = []
  for (const result of input) {
    if (!result || typeof result !== 'object' || typeof result.title !== 'string' || !result.title.trim()) continue
    const normalized = {
      ...result,
      infoHash: typeof result.infoHash === 'string' ? result.infoHash.toLowerCase() : null,
      sources: sourceLabels(result)
    }
    const key = resultKey(normalized)
    if (!key) {
      unkeyed.push(normalized)
      continue
    }
    const current = merged.get(key)
    merged.set(key, current ? mergePair(current, normalized) : normalized)
  }
  return [...merged.values(), ...unkeyed]
}

function timestamp (value) {
  const time = typeof value === 'string' ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function score (result) {
  const connectable = Boolean(result?.magnetUri || result?.torrentUrl)
  const seeders = nonNegativeInteger(result?.seeders) ?? 0
  const peers = nonNegativeInteger(result?.peers) ?? 0
  const downloads = nonNegativeInteger(result?.downloads) ?? 0
  return (connectable ? 1_000_000_000_000 : 0) + (seeders * 1_000_000) + (peers * 1_000) + Math.min(downloads, 999)
}

export function rankSearchResults (input, { catalogCode = null } = {}) {
  if (!Array.isArray(input)) return []
  return input
    .map(result => {
      const matchLevel = catalogCode ? catalogCodeMatchLevel(result.title, catalogCode) : 0
      return {
        ...result,
        availabilityScore: score(result),
        catalogMatch: matchLevel > 0,
        catalogMatchLevel: matchLevel
      }
    })
    .sort((left, right) => (
      right.catalogMatchLevel - left.catalogMatchLevel ||
      right.availabilityScore - left.availabilityScore ||
      timestamp(right.publishedAt) - timestamp(left.publishedAt) ||
      String(left.title).localeCompare(String(right.title), 'zh-CN')
    ))
}
