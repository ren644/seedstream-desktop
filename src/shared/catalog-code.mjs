const MAX_INPUT_LENGTH = 64
const ALLOWED_INPUT = /^[A-Z0-9 _-]+$/
const DASHES = /[‐‑‒–—―]/g

function invalidCatalogCode () {
  const error = new TypeError('A valid catalog code is required')
  error.code = 'INVALID_CATALOG_CODE'
  return error
}

function normalizeInput (value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_INPUT_LENGTH) {
    throw invalidCatalogCode()
  }
  const normalized = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(DASHES, '-')
    .trim()
    .replace(/\s+/g, ' ')
  if (!normalized || !ALLOWED_INPUT.test(normalized)) throw invalidCatalogCode()
  return normalized
}

function uniqueVariants (canonical, compact, spaced) {
  return [...new Set([canonical, compact, spaced])].slice(0, 3)
}

function resultFor (parts) {
  const canonical = parts.join('-')
  const compact = parts.join('')
  return {
    canonical,
    compact,
    variants: uniqueVariants(canonical, compact, parts.join(' '))
  }
}

export function parseCatalogCode (value) {
  const normalized = normalizeInput(value)

  const fc2 = normalized.match(/^FC2(?:[-_ ]*PPV)?[-_ ]*(\d{5,10})$/)
  if (fc2) return resultFor(['FC2', 'PPV', fc2[1]])

  const separated = normalized.match(/^([A-Z0-9]{2,16})[-_ ]+((?:\d[-_ ]*){2,12})$/)
  if (separated && /[A-Z]/.test(separated[1])) {
    const digits = separated[2].replace(/[-_ ]/g, '')
    if (digits.length >= 2 && digits.length <= 12) return resultFor([separated[1], digits])
  }

  if (!/[-_ ]/.test(normalized)) {
    const lettersFirst = normalized.match(/^([A-Z]{2,12})(\d{2,12})$/)
    if (lettersFirst) return resultFor([lettersFirst[1], lettersFirst[2]])

    const numericPrefix = normalized.match(/^(\d{1,4}[A-Z0-9]*[A-Z])(\d{2,12})$/)
    if (numericPrefix && numericPrefix[1].length <= 16) {
      return resultFor([numericPrefix[1], numericPrefix[2]])
    }
  }

  throw invalidCatalogCode()
}

function escapedPattern (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function catalogCodeMatchLevel (title, code) {
  if (typeof title !== 'string' || !title) return 0
  let parsed
  try {
    parsed = typeof code === 'object' && code?.canonical ? code : parseCatalogCode(code)
  } catch {
    return 0
  }
  const normalizedTitle = title.normalize('NFKC').toUpperCase()
  const pattern = parsed.canonical.split('-').map(escapedPattern).join('[^A-Z0-9]*')
  return new RegExp(`(?:^|[^A-Z0-9])${pattern}(?=$|[^A-Z0-9])`).test(normalizedTitle) ? 2 : 0
}

export function catalogCodePreview (value, enabled) {
  if (!enabled) return { state: 'disabled', canonical: null, message: '' }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { state: 'idle', canonical: null, message: '输入番号后将在本机识别格式' }
  }
  try {
    const parsed = parseCatalogCode(value)
    return {
      state: 'valid',
      canonical: parsed.canonical,
      message: `识别为 ${parsed.canonical} · 将匹配常见写法`
    }
  } catch {
    return { state: 'invalid', canonical: null, message: '未识别到规范番号，请检查字母和数字' }
  }
}

