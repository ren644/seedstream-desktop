import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'

function parseByteRange (header, length) {
  if (!header) return { start: 0, end: length - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || length <= 0) return null

  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, length - suffixLength)
    end = length - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : length - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
    end = Math.min(end, length - 1)
  }

  if (start < 0 || start >= length || end < start) return null
  return { start, end, partial: true }
}

function sendText (response, statusCode, message, extraHeaders = {}) {
  const body = Buffer.from(message)
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  })
  response.end(body)
}

export class LocalMediaServer {
  constructor ({ token, resolveFile }) {
    if (!/^[a-z0-9-]{8,128}$/i.test(token)) throw new TypeError('Invalid local media token')
    if (typeof resolveFile !== 'function') throw new TypeError('LocalMediaServer requires a file resolver')
    this.token = token
    this.resolveFile = resolveFile
    this.server = null
    this.port = null
  }

  async start () {
    if (this.server) return
    this.server = createServer((request, response) => {
      this.#handle(request, response).catch(() => {
        if (!response.headersSent) sendText(response, 500, 'Local media server error')
        else response.destroy()
      })
    })
    await new Promise((resolve, reject) => {
      const onError = error => {
        this.server?.off('error', onError)
        reject(error)
      }
      this.server.once('error', onError)
      this.server.listen(0, '127.0.0.1', () => {
        this.server?.off('error', onError)
        resolve()
      })
    })
    this.port = this.server.address().port
  }

  urlFor (taskId, fileIndex) {
    if (!this.port) throw new Error('Local media server is not running')
    return `http://127.0.0.1:${this.port}/local-${this.token}/${encodeURIComponent(taskId)}/${fileIndex}`
  }

  async close () {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.port = null
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections?.()
    })
  }

  async #handle (request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendText(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' })
    }

    const url = new URL(request.url, 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 3 || parts[0] !== `local-${this.token}`) {
      return sendText(response, 404, 'Not found')
    }
    const taskId = decodeURIComponent(parts[1])
    const fileIndex = Number(parts[2])
    if (!Number.isSafeInteger(fileIndex) || fileIndex < 0) {
      return sendText(response, 404, 'Not found')
    }

    let file
    try {
      file = await this.resolveFile(taskId, fileIndex)
    } catch {
      return sendText(response, 404, 'Downloaded file not found')
    }

    const range = parseByteRange(request.headers.range, file.length)
    if (!range) {
      return sendText(response, 416, 'Requested range not satisfiable', {
        'Content-Range': `bytes */${file.length}`
      })
    }

    const contentLength = range.end - range.start + 1
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': file.mediaType,
      'Content-Length': contentLength,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.length}`
    response.writeHead(range.partial ? 206 : 200, headers)
    if (request.method === 'HEAD') return response.end()

    const stream = createReadStream(file.path, { start: range.start, end: range.end })
    stream.once('error', () => response.destroy())
    stream.pipe(response)
  }
}

export { parseByteRange }
