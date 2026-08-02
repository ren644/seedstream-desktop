import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { normalizeProviderConfigs } from './search-contract.mjs'

const CONFIG_VERSION = 1

function encryptionAvailable (encryption) {
  try {
    return Boolean(encryption?.isAvailable?.())
  } catch {
    return false
  }
}

function encryptedKey (encryption, apiKey) {
  if (!apiKey || !encryptionAvailable(encryption) || typeof encryption?.encrypt !== 'function') return null
  const encrypted = encryption.encrypt(apiKey)
  if (!Buffer.isBuffer(encrypted) && !ArrayBuffer.isView(encrypted)) {
    throw new TypeError('The encryption adapter must return binary data')
  }
  return Buffer.from(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength).toString('base64')
}

function decryptedKey (encryption, value) {
  if (typeof value !== 'string' || !value || !encryptionAvailable(encryption) || typeof encryption?.decrypt !== 'function') return ''
  try {
    return String(encryption.decrypt(Buffer.from(value, 'base64')))
  } catch {
    return ''
  }
}

export class SearchConfigStore {
  constructor ({ filePath, encryption = null } = {}) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('SearchConfigStore requires a file path')
    }
    this.filePath = path.resolve(filePath)
    this.encryption = encryption
    this.secretsPersisted = encryptionAvailable(encryption)
  }

  async load () {
    let raw
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== CONFIG_VERSION || !Array.isArray(parsed.providers)) {
      throw new Error('Unsupported or malformed SeedStream search configuration')
    }
    const providers = parsed.providers.map(provider => ({
      ...provider,
      apiKey: decryptedKey(this.encryption, provider.encryptedApiKey)
    }))
    return normalizeProviderConfigs(providers)
  }

  async save (input) {
    const providers = normalizeProviderConfigs(input)
    this.secretsPersisted = encryptionAvailable(this.encryption)
    const storedProviders = providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      endpoint: provider.endpoint,
      enabled: provider.enabled,
      encryptedApiKey: encryptedKey(this.encryption, provider.apiKey)
    }))
    const document = {
      version: CONFIG_VERSION,
      providers: storedProviders
    }
    const directory = path.dirname(this.filePath)
    const temporaryPath = path.join(directory, `.${path.basename(this.filePath)}.${randomUUID()}.tmp`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
    return providers.map(provider => ({
      ...provider,
      apiKey: this.secretsPersisted ? provider.apiKey : ''
    }))
  }
}
