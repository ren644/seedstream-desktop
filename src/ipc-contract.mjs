import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_TORRENT_BYTES = 10 * 1024 * 1024
const TASK_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

export const CHANNELS = Object.freeze({
  GET_STATE: 'seedstream:app:get-state',
  OPEN_GUIDE: 'seedstream:app:open-guide',
  TOGGLE_WINDOW_MAXIMIZE: 'seedstream:window:toggle-maximize',
  SET_VIDEO_FULLSCREEN: 'seedstream:window:set-video-fullscreen',
  VIDEO_FULLSCREEN_CHANGED: 'seedstream:event:video-fullscreen-changed',
  CHOOSE_TORRENT: 'seedstream:torrent:choose',
  IMPORT_TORRENT_BYTES: 'seedstream:torrent:import-bytes',
  IMPORT_MAGNET: 'seedstream:torrent:import-magnet',
  START_DOWNLOAD: 'seedstream:torrent:start-download',
  PLAY_FILE: 'seedstream:torrent:play-file',
  OPEN_DOWNLOADED_FILE: 'seedstream:torrent:open-downloaded-file',
  CLOSE_PLAYER: 'seedstream:torrent:close-player',
  PAUSE: 'seedstream:torrent:pause',
  RESUME: 'seedstream:torrent:resume',
  REMOVE: 'seedstream:torrent:remove',
  REVEAL: 'seedstream:torrent:reveal',
  CHOOSE_DOWNLOAD_PATH: 'seedstream:settings:choose-download-path',
  NATIVE_OPENED: 'seedstream:event:native-opened'
})

export function assertFullscreenValue (value) {
  if (typeof value !== 'boolean') {
    throw new TypeError('A boolean fullscreen value is required')
  }
  return value
}

export function assertTaskId (value) {
  if (typeof value !== 'string' || !TASK_ID.test(value)) {
    throw new TypeError('A valid torrent task id is required')
  }
  return value.toLowerCase()
}

export function assertFileIndex (value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10_000) {
    throw new TypeError('A valid torrent file index is required')
  }
  return value
}

export function assertTorrentBytes (value) {
  let bytes
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value)
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  } else {
    throw new TypeError('Torrent data must be binary')
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TORRENT_BYTES) {
    throw new TypeError('Torrent data is empty or too large')
  }
  return new Uint8Array(bytes)
}

export function assertSourceName (value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new TypeError('A valid torrent source name is required')
  }
  return path.basename(value)
}

export function extractTorrentPath (argv, _platform = process.platform) {
  if (!Array.isArray(argv)) return null
  for (const argument of argv) {
    if (typeof argument !== 'string' || argument.startsWith('--')) continue
    if (/\.torrent$/i.test(argument)) return argument
  }
  return null
}

export function isAllowedRendererUrl (senderUrl, rendererPath) {
  if (typeof senderUrl !== 'string' || typeof rendererPath !== 'string') return false
  try {
    return senderUrl === pathToFileURL(path.resolve(rendererPath)).href
  } catch {
    return false
  }
}

export function serializableError (error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : String(error)
  }
}
