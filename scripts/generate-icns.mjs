import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

const projectRoot = path.resolve(import.meta.dirname, '..')
const iconsetDirectory = path.join(projectRoot, 'build', 'icon.iconset')
const outputPath = path.join(projectRoot, 'build', 'icon.icns')

const entries = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
  ['ic11', 'icon_16x16@2x.png'],
  ['ic12', 'icon_32x32@2x.png'],
  ['ic13', 'icon_128x128@2x.png'],
  ['ic14', 'icon_256x256@2x.png']
]

function createChunk (type, payload) {
  const chunk = Buffer.allocUnsafe(8 + payload.length)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32BE(chunk.length, 4)
  payload.copy(chunk, 8)
  return chunk
}

const chunks = []
for (const [type, fileName] of entries) {
  chunks.push(createChunk(type, await readFile(path.join(iconsetDirectory, fileName))))
}

const length = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
const header = Buffer.allocUnsafe(8)
header.write('icns', 0, 4, 'ascii')
header.writeUInt32BE(length, 4)

await writeFile(outputPath, Buffer.concat([header, ...chunks], length))
console.log(`Generated ${path.relative(projectRoot, outputPath)} (${length} bytes)`)
