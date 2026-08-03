export const THEME_STORAGE_KEY = 'seedstream-theme-v1'

export const THEMES = Object.freeze([
  Object.freeze({ id: 'mist', label: '晨雾', description: '淡蓝灰浅色' }),
  Object.freeze({ id: 'night', label: '深海', description: '深蓝黑暗夜' }),
  Object.freeze({ id: 'sand', label: '暖砂', description: '米白暖棕' })
])

const THEME_IDS = new Set(THEMES.map(theme => theme.id))

export function normalizeTheme (value) {
  return typeof value === 'string' && THEME_IDS.has(value) ? value : 'mist'
}

export function readTheme (storage) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'mist'
  }
}

export function writeTheme (storage, value) {
  const theme = normalizeTheme(value)
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {}
  return theme
}

export function themeLabel (value) {
  const theme = THEMES.find(candidate => candidate.id === normalizeTheme(value))
  return theme?.label ?? '晨雾'
}
