import { XMLParser } from 'fast-xml-parser'

const INFO_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

const torznabParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (_name, jPath) => jPath.endsWith('.channel.item') || jPath.endsWith('.item.attr')
})

function asArray (value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function scalarText (value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (value && typeof value === 'object' && typeof value['#text'] === 'string') return value['#text'].trim()
  return ''
}

function finiteInteger (value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function isoDate (value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function httpUrl (value) {
  const raw = scalarText(value)
  if (!raw || raw.length > 4096) return null
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

function magnetHash (value) {
  if (typeof value !== 'string' || !value.startsWith('magnet:')) return null
  try {
    const url = new URL(value)
    for (const topic of url.searchParams.getAll('xt')) {
      const match = /^urn:btih:([a-f0-9]{40})$/i.exec(topic)
      if (match) return match[1].toLowerCase()
    }
  } catch {}
  return null
}

function normalizedHash (value) {
  const hash = scalarText(value)
  return INFO_HASH.test(hash) ? hash.toLowerCase() : null
}

function attributesFor (item) {
  const attributes = new Map()
  for (const attribute of asArray(item?.attr)) {
    const name = scalarText(attribute?.['@_name']).toLowerCase()
    if (!name) continue
    attributes.set(name, scalarText(attribute?.['@_value']))
  }
  return attributes
}

function torznabItem (item, source) {
  const title = scalarText(item?.title)
  if (!title) return null

  const attributes = attributesFor(item)
  const enclosure = Array.isArray(item?.enclosure) ? item.enclosure[0] : item?.enclosure
  const rawMagnet = attributes.get('magneturl') ?? ''
  const magnetUri = rawMagnet.startsWith('magnet:') ? rawMagnet : null
  const link = httpUrl(item?.link)
  const enclosureUrl = httpUrl(enclosure?.['@_url'])
  const downloadUrl = httpUrl(attributes.get('downloadurl'))
  const torrentUrl = downloadUrl ?? enclosureUrl ?? (link && /\.torrent(?:$|[?#])/i.test(link) ? link : null)
  const infoHash = normalizedHash(attributes.get('infohash')) ?? magnetHash(magnetUri)

  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceResultId: scalarText(item?.guid) || infoHash || torrentUrl || link || title,
    title,
    size: finiteInteger(item?.size) ?? finiteInteger(enclosure?.['@_length']) ?? finiteInteger(attributes.get('size')),
    seeders: finiteInteger(attributes.get('seeders')),
    peers: finiteInteger(attributes.get('peers')) ?? finiteInteger(attributes.get('leechers')),
    publishedAt: isoDate(item?.pubDate),
    detailsUrl: link,
    torrentUrl,
    magnetUri,
    infoHash
  }
}

export function parseTorznabFeed (xml, source) {
  if (typeof xml !== 'string' || xml.length === 0) return []
  if (!source || typeof source.id !== 'string' || typeof source.name !== 'string') {
    throw new TypeError('A Torznab source identity is required')
  }
  let parsed
  try {
    parsed = torznabParser.parse(xml)
  } catch {
    return []
  }
  return asArray(parsed?.rss?.channel?.item)
    .map(item => torznabItem(item, source))
    .filter(Boolean)
}

function archiveTitle (value, identifier) {
  const candidate = Array.isArray(value) ? value[0] : value
  const title = scalarText(candidate)
  return title || identifier
}

export function mapArchiveResults (payload) {
  const documents = Array.isArray(payload?.response?.docs) ? payload.response.docs : []
  return documents.flatMap(document => {
    const identifier = scalarText(document?.identifier)
    if (!identifier || identifier.length > 512) return []
    const encoded = encodeURIComponent(identifier)
    return [{
      sourceId: 'internet-archive',
      sourceName: 'Internet Archive',
      sourceResultId: identifier,
      title: archiveTitle(document.title, identifier),
      size: finiteInteger(document.item_size),
      seeders: null,
      peers: null,
      publishedAt: isoDate(document.date ?? document.publicdate ?? document.addeddate),
      detailsUrl: `https://archive.org/details/${encoded}`,
      torrentUrl: `https://archive.org/download/${encoded}/${encoded}_archive.torrent`,
      magnetUri: null,
      infoHash: null,
      downloads: finiteInteger(document.downloads)
    }]
  })
}
