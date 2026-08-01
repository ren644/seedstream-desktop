import path from 'node:path'

const MIME_BY_EXTENSION = new Map([
  ['.3g2', 'video/3gpp2'],
  ['.3gp', 'video/3gpp'],
  ['.m4v', 'video/x-m4v'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp4', 'video/mp4'],
  ['.ogm', 'video/ogg'],
  ['.ogv', 'video/ogg'],
  ['.webm', 'video/webm']
])

export function isPlayableVideo (name) {
  if (typeof name !== 'string') return false
  return MIME_BY_EXTENSION.has(path.extname(name).toLowerCase())
}

export function mediaTypeForName (name) {
  if (typeof name !== 'string') return 'application/octet-stream'
  return MIME_BY_EXTENSION.get(path.extname(name).toLowerCase()) ?? 'application/octet-stream'
}

export function makeFileId (infoHash, index) {
  if (typeof infoHash !== 'string' || !/^[a-z0-9]+$/i.test(infoHash)) {
    throw new TypeError('A valid alphanumeric info hash is required')
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError('A non-negative file index is required')
  }
  return `${infoHash.toLowerCase()}:${index}`
}

export function publicFileSnapshot (infoHash, file, index) {
  return {
    id: makeFileId(infoHash, index),
    index,
    name: file.name,
    path: file.path,
    length: file.length,
    playable: isPlayableVideo(file.name),
    mediaType: mediaTypeForName(file.name),
    progress: Number.isFinite(file.progress) ? file.progress : 0,
    downloaded: Number.isFinite(file.downloaded) ? file.downloaded : 0
  }
}
