import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import electronPath from 'electron'

const projectRoot = path.resolve(import.meta.dirname, '..')

function runProcess (command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out running ${command} ${args.join(' ')}`))
    }, options.timeout ?? 25_000)

    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/)
assert.equal(packageJson.build.appId, 'com.seedstream.desktop')
assert.ok(packageJson.build.mac.target.includes('dmg'))
assert.ok(packageJson.build.win.target.includes('nsis'))
assert.equal(packageJson.build.fileAssociations[0].ext, 'torrent')
assert.equal(packageJson.build.nsis.perMachine, true)
assert.equal(packageJson.build.nsis.oneClick, true)
assert.equal(packageJson.build.nsis.runAfterFinish, true)
assert.ok(packageJson.build.extraResources.some(resource => resource.from === 'help'))
await readFile(path.join(projectRoot, 'help', 'SeedStream-使用指南.html'), 'utf8')
await readFile(path.join(projectRoot, 'help', '首次打开说明.txt'), 'utf8')

const integration = await runProcess(process.execPath, [
  '--test',
  'test/streaming-integration.test.mjs'
])
assert.equal(integration.code, 0, integration.stderr || integration.stdout)

const smokeUserData = await mkdtemp(path.join(os.tmpdir(), 'seedstream-ui-smoke-'))
try {
  const ui = await runProcess(electronPath, ['.'], {
    env: {
      SEEDSTREAM_SMOKE_UI: '1',
      SEEDSTREAM_USER_DATA_PATH: smokeUserData
    }
  })
  assert.equal(ui.code, 0, ui.stderr || ui.stdout)
  assert.match(ui.stdout, /SEEDSTREAM_UI_SMOKE_OK/)
  assert.match(ui.stdout, /"brand":"SEED\/STREAM"/)
  assert.match(ui.stdout, /"help":true/)
  assert.match(ui.stdout, /"windowMaximize":true/)
  assert.match(ui.stdout, /"playerFullscreen":true/)
  assert.match(ui.stdout, /"onboarding":true/)
  assert.match(ui.stdout, /"guidePlatform":"macOS"/)
} finally {
  await rm(smokeUserData, { recursive: true, force: true })
}

console.log('SeedStream smoke checks passed: local byte-range stream, secure renderer bridge, video fullscreen, window maximize, first-run guide, clean UI boot, and cross-platform packaging manifest.')
