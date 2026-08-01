import { EventEmitter } from 'node:events'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import parseTorrent from 'parse-torrent'

import { assertSafeTorrentFiles } from './path-safety.mjs'
import { isPlayableVideo, mediaTypeForName, publicFileSnapshot } from './media.mjs'
import { ACTION, initialTaskPolicy, transitionTask } from './task-policy.mjs'

const MAX_TORRENT_BYTES = 10 * 1024 * 1024
const MAX_TORRENT_FILES = 10_000
const INFO_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

export class TorrentEngineError extends Error {
  constructor (code, message, options) {
    super(message, options)
    this.name = 'TorrentEngineError'
    this.code = code
  }
}

export function normalizeParsedTorrent (parsed) {
  if (!parsed || typeof parsed !== 'object' || !INFO_HASH.test(parsed.infoHash ?? '')) {
    throw new TorrentEngineError('INVALID_TORRENT', 'Torrent metadata has no valid info hash')
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new TorrentEngineError('INVALID_TORRENT', 'Torrent metadata contains no files')
  }
  if (parsed.files.length > MAX_TORRENT_FILES) {
    throw new TorrentEngineError('TOO_MANY_FILES', `Torrent contains more than ${MAX_TORRENT_FILES} files`)
  }

  assertSafeTorrentFiles(parsed.files)

  const files = parsed.files.map((file, index) => {
    if (!Number.isSafeInteger(file.length) || file.length < 0) {
      throw new TorrentEngineError('INVALID_TORRENT', `Torrent file ${index + 1} has an invalid size`)
    }
    return {
      index,
      name: file.name,
      path: file.path,
      length: file.length,
      playable: isPlayableVideo(file.name),
      mediaType: mediaTypeForName(file.name)
    }
  })

  return {
    id: parsed.infoHash.toLowerCase(),
    name: typeof parsed.name === 'string' && parsed.name.length > 0
      ? parsed.name
      : parsed.infoHash.toLowerCase(),
    length: Number.isSafeInteger(parsed.length)
      ? parsed.length
      : files.reduce((total, file) => total + file.length, 0),
    files
  }
}

function safeErrorMessage (error) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function closeWithCallback (operation) {
  return new Promise((resolve, reject) => {
    let finished = false
    const done = error => {
      if (finished) return
      finished = true
      if (error) reject(error)
      else resolve()
    }
    try {
      const result = operation(done)
      Promise.resolve(result).catch(done)
    } catch (error) {
      done(error)
    }
  })
}

export class TorrentEngine extends EventEmitter {
  constructor ({
    client,
    cacheManager,
    metadataDirectory,
    downloadPath,
    parseTorrentImpl = parseTorrent,
    streamToken = randomBytes(16).toString('hex'),
    now = () => new Date()
  }) {
    super()
    if (!client) throw new TypeError('TorrentEngine requires a WebTorrent client')
    if (!cacheManager) throw new TypeError('TorrentEngine requires a CacheManager')
    if (typeof metadataDirectory !== 'string') throw new TypeError('TorrentEngine requires a metadata directory')
    if (typeof downloadPath !== 'string') throw new TypeError('TorrentEngine requires a download path')
    if (!/^[a-z0-9-]{8,128}$/i.test(streamToken)) throw new TypeError('Invalid stream server token')

    this.client = client
    this.cacheManager = cacheManager
    this.metadataDirectory = path.resolve(metadataDirectory)
    this.downloadPath = path.resolve(downloadPath)
    this.parseTorrent = parseTorrentImpl
    this.streamToken = streamToken
    this.now = now
    this.tasks = new Map()
    this.streamServer = null
    this.streamPort = null
    this.initialized = false
    this.closed = false
  }

  async initialize () {
    if (this.initialized) return
    await mkdir(this.metadataDirectory, { recursive: true, mode: 0o700 })
    await mkdir(this.downloadPath, { recursive: true })
    await this.cacheManager.reset()
    await this.#startStreamServer()
    this.initialized = true
  }

  setDownloadPath (directory) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new TypeError('A download directory is required')
    }
    this.downloadPath = path.resolve(directory)
  }

  async importTorrentPath (filePath) {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.torrent') {
      throw new TorrentEngineError('INVALID_TORRENT_FILE', 'Please choose a .torrent file')
    }
    const buffer = new Uint8Array(await readFile(filePath))
    return this.importTorrentBuffer(buffer, path.basename(filePath))
  }

  async importTorrentBuffer (input, sourceName = 'dropped.torrent') {
    this.#assertReady()
    if (!ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)) {
      throw new TorrentEngineError('INVALID_TORRENT_FILE', 'Torrent data must be binary')
    }
    const buffer = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_TORRENT_BYTES) {
      throw new TorrentEngineError('INVALID_TORRENT_FILE', 'Torrent file is empty or unreasonably large')
    }

    let parsed
    try {
      parsed = await this.parseTorrent(buffer)
    } catch (error) {
      throw new TorrentEngineError('INVALID_TORRENT_FILE', 'The selected file is not valid torrent metadata', { cause: error })
    }

    const normalized = normalizeParsedTorrent(parsed)
    if (this.tasks.has(normalized.id)) {
      throw new TorrentEngineError('DUPLICATE_TORRENT', 'This torrent is already in the task list')
    }

    const torrentFilePath = path.join(this.metadataDirectory, `${normalized.id}.torrent`)
    await this.#writeMetadata(torrentFilePath, buffer)
    const task = {
      ...normalized,
      sourceName: typeof sourceName === 'string' ? sourceName : 'torrent',
      torrentBuffer: new Uint8Array(buffer),
      torrentFilePath,
      downloadPath: null,
      addedAt: this.now().toISOString(),
      policy: initialTaskPolicy(),
      activeTorrent: null,
      noPeers: false,
      error: null
    }
    this.tasks.set(task.id, task)
    this.#emitChange(task)
    return this.#snapshot(task)
  }

  async restorePersistentTask (record) {
    this.#assertReady()
    if (!record || record?.policy?.storage !== 'persistent' || typeof record.torrentFilePath !== 'string') {
      throw new TorrentEngineError('INVALID_SAVED_TASK', 'Saved torrent task is malformed')
    }

    const torrentBuffer = new Uint8Array(await readFile(record.torrentFilePath))
    const parsed = await this.parseTorrent(torrentBuffer)
    const normalized = normalizeParsedTorrent(parsed)
    if (normalized.id !== record.id || this.tasks.has(normalized.id)) {
      throw new TorrentEngineError('INVALID_SAVED_TASK', 'Saved torrent identity does not match its metadata')
    }

    const allowedPhases = new Set(['downloading', 'paused', 'complete', 'error'])
    const phase = allowedPhases.has(record.policy.phase) ? record.policy.phase : 'paused'
    const task = {
      ...normalized,
      sourceName: path.basename(record.torrentFilePath),
      torrentBuffer,
      torrentFilePath: path.resolve(record.torrentFilePath),
      downloadPath: typeof record.downloadPath === 'string'
        ? path.resolve(record.downloadPath)
        : this.downloadPath,
      addedAt: typeof record.addedAt === 'string' ? record.addedAt : this.now().toISOString(),
      policy: { phase, storage: 'persistent', playing: false },
      activeTorrent: null,
      noPeers: false,
      error: typeof record.error === 'string' ? record.error : null
    }
    this.tasks.set(task.id, task)

    if (phase === 'downloading') {
      try {
        task.activeTorrent = await this.#startPersistentTransfer(task)
      } catch (error) {
        task.policy = { phase: 'error', storage: 'persistent', playing: false }
        task.error = safeErrorMessage(error)
      }
    }

    this.#emitChange(task)
    return this.#snapshot(task)
  }

  getTask (taskId) {
    return this.#snapshot(this.#requireTask(taskId))
  }

  listTasks () {
    return [...this.tasks.values()].map(task => this.#snapshot(task))
  }

  async play (taskId, fileIndex) {
    const task = this.#requireTask(taskId)
    const fileRecord = task.files[fileIndex]
    if (!fileRecord || fileRecord.index !== fileIndex) {
      throw new TorrentEngineError('FILE_NOT_FOUND', 'The selected torrent file no longer exists')
    }
    if (!fileRecord.playable) {
      throw new TorrentEngineError('UNSUPPORTED_MEDIA', 'This file type cannot be played in the built-in player')
    }

    const transition = transitionTask(task.policy, ACTION.PLAY)
    try {
      if (task.policy.phase === 'ready') {
        const cachePath = await this.cacheManager.createTaskPath(task.id)
        task.activeTorrent = await this.#addTransfer(task, {
          path: cachePath,
          deselect: true,
          destroyStoreOnDestroy: true
        })
      } else if (task.policy.phase === 'paused') {
        task.activeTorrent = await this.#startPersistentTransfer(task)
      } else if (!task.activeTorrent && task.policy.storage === 'persistent') {
        task.activeTorrent = await this.#startPersistentTransfer(task, task.policy.phase === 'complete')
      }

      const activeFile = task.activeTorrent?.files?.[fileIndex]
      if (!activeFile) throw new TorrentEngineError('FILE_NOT_FOUND', 'The selected file is unavailable')
      task.policy = transition.state
      task.error = null
      this.#emitChange(task)
      return {
        taskId: task.id,
        fileIndex,
        name: activeFile.name,
        mediaType: fileRecord.mediaType,
        url: `http://127.0.0.1:${this.streamPort}${activeFile.streamURL}`
      }
    } catch (error) {
      if (task.policy.phase === 'ready') {
        await this.cacheManager.removeTask(task.id).catch(() => {})
      }
      task.error = safeErrorMessage(error)
      this.#emitChange(task)
      throw error
    }
  }

  async closePlayer (taskId) {
    const task = this.#requireTask(taskId)
    const transition = transitionTask(task.policy, ACTION.CLOSE_PLAYER)
    if (task.policy.storage === 'ephemeral') {
      await this.#stopTransfer(task, true)
      await this.cacheManager.removeTask(task.id)
    }
    task.policy = transition.state
    this.#emitChange(task)
    return this.#snapshot(task)
  }

  async startDownload (taskId) {
    const task = this.#requireTask(taskId)
    const transition = transitionTask(task.policy, ACTION.START_DOWNLOAD)
    if (task.policy.storage === 'ephemeral') {
      await this.#stopTransfer(task, true)
      await this.cacheManager.removeTask(task.id)
    }

    task.policy = transition.state
    task.downloadPath = this.downloadPath
    try {
      task.activeTorrent = await this.#startPersistentTransfer(task)
      task.error = null
    } catch (error) {
      task.policy = { phase: 'error', storage: 'persistent', playing: false }
      task.error = safeErrorMessage(error)
      throw error
    } finally {
      this.#emitChange(task)
    }
    return this.#snapshot(task)
  }

  async pause (taskId) {
    const task = this.#requireTask(taskId)
    const transition = transitionTask(task.policy, ACTION.PAUSE)
    await this.#stopTransfer(task, false)
    task.policy = transition.state
    this.#emitChange(task)
    return this.#snapshot(task)
  }

  async resume (taskId) {
    const task = this.#requireTask(taskId)
    const transition = transitionTask(task.policy, ACTION.RESUME)
    task.policy = transition.state
    try {
      task.activeTorrent = await this.#startPersistentTransfer(task)
      task.error = null
    } catch (error) {
      task.policy = { phase: 'error', storage: 'persistent', playing: false }
      task.error = safeErrorMessage(error)
      throw error
    } finally {
      this.#emitChange(task)
    }
    return this.#snapshot(task)
  }

  async remove (taskId) {
    const task = this.#requireTask(taskId)
    if (task.activeTorrent) {
      await this.#stopTransfer(task, task.policy.storage === 'ephemeral')
    }
    if (task.policy.storage === 'ephemeral') {
      await this.cacheManager.removeTask(task.id)
    }
    this.tasks.delete(task.id)
    await rm(task.torrentFilePath, { force: true })
    this.emit('change', { type: 'removed', taskId })
  }

  async shutdown () {
    if (this.closed) return
    this.closed = true

    for (const task of this.tasks.values()) {
      if (task.activeTorrent) {
        await this.#stopTransfer(task, task.policy.storage === 'ephemeral').catch(() => {})
      }
    }
    await this.cacheManager.reset()

    if (this.streamServer) {
      await closeWithCallback(callback => this.streamServer.destroy(callback)).catch(() => {})
      this.streamServer = null
    }
    await closeWithCallback(callback => this.client.destroy(callback)).catch(() => {})
  }

  async #startStreamServer () {
    this.streamServer = this.client.createServer({
      origin: false,
      hostname: '127.0.0.1',
      pathname: `/stream-${this.streamToken}`
    }, 'node')

    const server = this.streamServer.server
    await new Promise((resolve, reject) => {
      const onError = error => {
        server.off?.('error', onError)
        reject(error)
      }
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off?.('error', onError)
        resolve()
      })
    })
    this.streamPort = server.address().port
  }

  async #startPersistentTransfer (task, deselect = false) {
    if (task.activeTorrent) return task.activeTorrent
    const destination = task.downloadPath ?? this.downloadPath
    await mkdir(destination, { recursive: true })
    task.downloadPath = destination
    return this.#addTransfer(task, {
      path: destination,
      deselect,
      destroyStoreOnDestroy: false
    })
  }

  #addTransfer (task, options) {
    return new Promise((resolve, reject) => {
      let torrent
      let settled = false
      const finish = (error, readyTorrent) => {
        if (settled) return
        settled = true
        torrent?.off?.('error', onError)
        if (error) reject(error)
        else {
          this.#attachTorrentEvents(task, readyTorrent)
          resolve(readyTorrent)
        }
      }
      const onError = error => finish(error)

      try {
        torrent = this.client.add(task.torrentBuffer, options, readyTorrent => finish(null, readyTorrent))
        torrent.once?.('error', onError)
      } catch (error) {
        finish(error)
      }
    })
  }

  #attachTorrentEvents (task, torrent) {
    torrent.once?.('done', () => {
      if (task.policy.phase !== 'downloading') return
      task.policy = transitionTask(task.policy, ACTION.MARK_COMPLETE).state
      task.noPeers = false
      this.#emitChange(task)
    })
    torrent.on?.('noPeers', () => {
      task.noPeers = true
      this.#emitChange(task)
    })
    torrent.on?.('wire', () => {
      if (!task.noPeers) return
      task.noPeers = false
      this.#emitChange(task)
    })
    torrent.on?.('error', error => {
      task.error = safeErrorMessage(error)
      this.#emitChange(task)
    })
  }

  async #stopTransfer (task, destroyStore) {
    if (!task.activeTorrent) return
    const infoHash = task.activeTorrent.infoHash ?? task.id
    await closeWithCallback(callback => this.client.remove(
      infoHash,
      { destroyStore },
      callback
    ))
    task.activeTorrent = null
  }

  async #writeMetadata (targetPath, buffer) {
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${randomUUID()}.tmp`
    )
    try {
      await writeFile(temporaryPath, buffer, { mode: 0o600 })
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
  }

  #snapshot (task) {
    const active = task.activeTorrent
    const activeFiles = active?.files ?? []
    return {
      id: task.id,
      name: task.name,
      length: task.length,
      sourceName: task.sourceName,
      torrentFilePath: task.torrentFilePath,
      downloadPath: task.downloadPath,
      addedAt: task.addedAt,
      policy: { ...task.policy },
      progress: Number.isFinite(active?.progress) ? active.progress : task.policy.phase === 'complete' ? 1 : 0,
      downloaded: Number.isFinite(active?.downloaded) ? active.downloaded : 0,
      uploaded: Number.isFinite(active?.uploaded) ? active.uploaded : 0,
      downloadSpeed: Number.isFinite(active?.downloadSpeed) ? active.downloadSpeed : 0,
      uploadSpeed: Number.isFinite(active?.uploadSpeed) ? active.uploadSpeed : 0,
      numPeers: Number.isFinite(active?.numPeers) ? active.numPeers : 0,
      timeRemaining: Number.isFinite(active?.timeRemaining) ? active.timeRemaining : null,
      noPeers: task.noPeers,
      error: task.error,
      files: task.files.map((file, index) => {
        const activeFile = activeFiles[index]
        return publicFileSnapshot(task.id, activeFile ?? file, index)
      })
    }
  }

  #requireTask (taskId) {
    const task = this.tasks.get(taskId)
    if (!task) throw new TorrentEngineError('TASK_NOT_FOUND', 'Torrent task was not found')
    return task
  }

  #assertReady () {
    if (!this.initialized || this.closed) {
      throw new TorrentEngineError('ENGINE_NOT_READY', 'Torrent engine is not ready')
    }
  }

  #emitChange (task) {
    this.emit('change', { type: 'updated', task: this.#snapshot(task) })
  }
}
