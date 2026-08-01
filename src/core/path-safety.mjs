const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

export function isSafeTorrentPath (value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.startsWith('/') || value.startsWith('\\') || WINDOWS_DRIVE.test(value)) return false
  if (CONTROL_CHARACTER.test(value) || value.includes(':')) return false

  const segments = value.split(/[\\/]/)
  if (segments.some(segment => segment.length === 0)) return false

  return segments.every(segment => {
    if (segment === '.' || segment === '..') return false
    if (segment.endsWith('.') || segment.endsWith(' ')) return false
    if (WINDOWS_RESERVED_NAME.test(segment)) return false
    return true
  })
}

export function assertSafeTorrentFiles (files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError('Torrent metadata must contain at least one file')
  }

  for (const file of files) {
    if (!file || !isSafeTorrentPath(file.path)) {
      const shownPath = typeof file?.path === 'string' ? file.path : '<missing>'
      throw new Error(`Unsafe torrent path: ${shownPath}`)
    }
  }
}
