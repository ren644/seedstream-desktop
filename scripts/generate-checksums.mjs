import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'

const projectRoot = path.resolve(import.meta.dirname, '..')
const distDirectory = path.join(projectRoot, 'dist')
const artifactPattern = /^SeedStream-.+\.(?:dmg|zip|exe)$/

function sha256 (filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

const artifactNames = (await readdir(distDirectory))
  .filter(fileName => artifactPattern.test(fileName))
  .sort((left, right) => left.localeCompare(right, 'en'))

if (artifactNames.length === 0) throw new Error('No SeedStream artifacts found in dist')

const lines = []
for (const fileName of artifactNames) {
  lines.push(`${await sha256(path.join(distDirectory, fileName))}  ${fileName}`)
}
await writeFile(path.join(distDirectory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8')
console.log(`Updated SHA256SUMS.txt for ${artifactNames.length} artifacts`)
