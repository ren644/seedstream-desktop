import path from 'node:path'
import { copyFile, mkdir } from 'node:fs/promises'

const projectRoot = path.resolve(import.meta.dirname, '..')
const helpDirectory = path.join(projectRoot, 'help')
const distDirectory = path.join(projectRoot, 'dist')

await mkdir(distDirectory, { recursive: true })
const guideCopies = [
  ['SeedStream-使用指南.html', 'SeedStream-使用指南.html'],
  ['SeedStream-使用指南.html', 'SeedStream-User-Guide.html'],
  ['首次打开说明.txt', '首次打开说明.txt'],
  ['首次打开说明.txt', 'SeedStream-First-Launch.txt']
]

for (const [sourceName, targetName] of guideCopies) {
  await copyFile(
    path.join(helpDirectory, sourceName),
    path.join(distDirectory, targetName)
  )
}

console.log('Copied offline user guides to dist')
