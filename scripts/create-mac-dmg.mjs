import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { copyFile, cp, lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'

if (process.platform !== 'darwin') {
  throw new Error('The DMG target must be built on macOS')
}

const projectRoot = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const distDirectory = path.join(projectRoot, 'dist')
const helpDirectory = path.join(projectRoot, 'help')
const appCandidates = [
  path.join(distDirectory, `mac-${process.arch}`, 'SeedStream.app'),
  path.join(distDirectory, 'mac', 'SeedStream.app')
]

let appPath = null
for (const candidate of appCandidates) {
  try {
    if ((await lstat(candidate)).isDirectory()) {
      appPath = candidate
      break
    }
  } catch {}
}
if (!appPath) throw new Error('Packaged SeedStream.app was not found in dist')

const stagingDirectory = await mkdtemp(path.join(os.tmpdir(), 'seedstream-dmg-stage-'))
const outputPath = path.join(
  distDirectory,
  `SeedStream-${packageJson.version}-mac-${process.arch}.dmg`
)

try {
  await cp(appPath, path.join(stagingDirectory, 'SeedStream.app'), {
    recursive: true,
    force: true,
    verbatimSymlinks: true
  })
  await symlink('/Applications', path.join(stagingDirectory, 'Applications'))
  await copyFile(
    path.join(helpDirectory, 'SeedStream-使用指南.html'),
    path.join(stagingDirectory, 'SeedStream-使用指南.html')
  )
  await copyFile(
    path.join(helpDirectory, '首次打开说明.txt'),
    path.join(stagingDirectory, '首次打开说明.txt')
  )

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/hdiutil', [
      'create',
      '-volname', 'SeedStream',
      '-srcfolder', stagingDirectory,
      '-ov',
      '-format', 'UDZO',
      outputPath
    ], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => resolve(code))
  })
  if (exitCode !== 0) throw new Error(`hdiutil failed with exit code ${exitCode}`)
  console.log(`Created ${outputPath}`)
} finally {
  await rm(stagingDirectory, { recursive: true, force: true })
}
