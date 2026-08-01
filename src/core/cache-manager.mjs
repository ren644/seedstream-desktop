import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

const TASK_ID = /^[a-z0-9][a-z0-9-]{5,127}$/i

export function isPathInside (root, candidate, pathImplementation = path) {
  const resolvedRoot = pathImplementation.resolve(root)
  const resolvedCandidate = pathImplementation.resolve(candidate)
  const relative = pathImplementation.relative(resolvedRoot, resolvedCandidate)
  return relative.length > 0 && !relative.startsWith('..') && !pathImplementation.isAbsolute(relative)
}

export class CacheManager {
  constructor (root) {
    if (typeof root !== 'string' || root.length === 0) {
      throw new TypeError('CacheManager requires an owned cache root')
    }

    this.root = path.resolve(root)
    if (this.root === path.parse(this.root).root) {
      throw new Error('Refusing to use a filesystem root as the cache root')
    }
  }

  taskPath (taskId) {
    if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) {
      throw new TypeError('A safe task id is required')
    }
    return path.join(this.root, taskId.toLowerCase())
  }

  async reset () {
    await rm(this.root, { recursive: true, force: true })
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  async createTaskPath (taskId) {
    const taskPath = this.taskPath(taskId)
    await mkdir(taskPath, { recursive: true, mode: 0o700 })
    return taskPath
  }

  async removeOwnedPath (candidate) {
    if (!isPathInside(this.root, candidate)) {
      throw new Error('Refusing to remove a path outside cache root')
    }
    await rm(path.resolve(candidate), { recursive: true, force: true })
  }

  async removeTask (taskId) {
    await this.removeOwnedPath(this.taskPath(taskId))
  }
}
