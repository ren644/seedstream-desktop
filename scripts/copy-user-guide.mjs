import path from 'node:path'
import { copyFile, mkdir } from 'node:fs/promises'

const projectRoot = path.resolve(import.meta.dirname, '..')
const helpDirectory = path.join(projectRoot, 'help')
const distDirectory = path.join(projectRoot, 'dist')

await mkdir(distDirectory, { recursive: true })
for (const fileName of ['SeedStream-使用指南.html', '首次打开说明.txt']) {
  await copyFile(
    path.join(helpDirectory, fileName),
    path.join(distDirectory, fileName)
  )
}

console.log('Copied offline user guides to dist')
