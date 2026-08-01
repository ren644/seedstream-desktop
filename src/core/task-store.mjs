import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

const STATE_VERSION = 1
const PERSISTENT_PHASES = new Set(['downloading', 'paused', 'complete', 'error'])

function emptyState () {
  return { version: STATE_VERSION, downloadPath: null, tasks: [] }
}

function persistentRecord (task) {
  if (task?.policy?.storage !== 'persistent') return null
  if (typeof task.id !== 'string' || typeof task.torrentFilePath !== 'string') return null

  const phase = PERSISTENT_PHASES.has(task.policy.phase) ? task.policy.phase : 'paused'
  return {
    id: task.id,
    name: typeof task.name === 'string' ? task.name : task.id,
    policy: { phase, storage: 'persistent', playing: false },
    torrentFilePath: task.torrentFilePath,
    downloadPath: typeof task.downloadPath === 'string' ? task.downloadPath : null,
    addedAt: typeof task.addedAt === 'string' ? task.addedAt : null,
    error: typeof task.error === 'string' ? task.error : null
  }
}

function normalizeLoadedState (value) {
  if (!value || value.version !== STATE_VERSION || !Array.isArray(value.tasks)) {
    throw new Error('Unsupported or malformed SeedStream state file')
  }

  return {
    version: STATE_VERSION,
    downloadPath: typeof value.downloadPath === 'string' ? value.downloadPath : null,
    tasks: value.tasks.map(persistentRecord).filter(Boolean)
  }
}

export class TaskStore {
  constructor (filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('TaskStore requires a state file path')
    }
    this.filePath = path.resolve(filePath)
  }

  async load () {
    let raw
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState()
      throw error
    }
    return normalizeLoadedState(JSON.parse(raw))
  }

  async save ({ downloadPath = null, tasks = [] } = {}) {
    const state = {
      version: STATE_VERSION,
      downloadPath: typeof downloadPath === 'string' ? downloadPath : null,
      tasks: Array.isArray(tasks) ? tasks.map(persistentRecord).filter(Boolean) : []
    }

    const directory = path.dirname(this.filePath)
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`)
    await mkdir(directory, { recursive: true })

    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      const { rm } = await import('node:fs/promises')
      await rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }

    return state
  }
}
