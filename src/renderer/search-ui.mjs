function integer (value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function availabilityLabel (result) {
  const seeders = integer(result?.seeders)
  if (seeders === null) return '节点未知'
  if (seeders >= 20) return '节点较多'
  if (seeders >= 5) return '节点一般'
  if (seeders > 0) return '节点较少'
  return '暂无线索'
}

export function canImportSearchResult (result) {
  return typeof result?.token === 'string' && result.token.length > 0 && Boolean(result.hasTorrent || result.hasMagnet)
}

export function searchSourceSummary (sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '尚未搜索'
  const available = sources.filter(source => source?.status === 'ok').length
  const failed = sources.filter(source => source?.status === 'error').length
  const count = sources.reduce((total, source) => total + (integer(source?.count) ?? 0), 0)
  return `${available} 个来源可用 · ${failed} 个来源异常 · ${count} 条原始结果`
}

function timestamp (value) {
  const time = new Date(value ?? '').getTime()
  return Number.isFinite(time) ? time : 0
}

export function sortSearchResults (results, mode = 'recommended') {
  const output = Array.isArray(results) ? [...results] : []
  const title = (left, right) => String(left.title).localeCompare(String(right.title), 'zh-CN')
  if (mode === 'newest') {
    return output.sort((left, right) => timestamp(right.publishedAt) - timestamp(left.publishedAt) || title(left, right))
  }
  if (mode === 'smallest') {
    return output.sort((left, right) => (integer(left.size) ?? Number.MAX_SAFE_INTEGER) - (integer(right.size) ?? Number.MAX_SAFE_INTEGER) || title(left, right))
  }
  if (mode === 'seeders') {
    return output.sort((left, right) => (integer(right.seeders) ?? -1) - (integer(left.seeders) ?? -1) || title(left, right))
  }
  return output.sort((left, right) => (Number(right.availabilityScore) || 0) - (Number(left.availabilityScore) || 0) || title(left, right))
}
