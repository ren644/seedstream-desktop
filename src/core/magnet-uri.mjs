const MAGNET_MAX_LENGTH = 8192
const BTIH = /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i
const BTMH = /^urn:btmh:1220[a-f0-9]{64}$/i

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
