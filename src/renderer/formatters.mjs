const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes (value) {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value === 0) return '0 B'
  const unitIndex = Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), SIZE_UNITS.length - 1))
  if (unitIndex === 0) return `${Math.round(value)} B`
  return `${(value / (1024 ** unitIndex)).toFixed(1)} ${SIZE_UNITS[unitIndex]}`
}

export function formatSpeed (value) {
  const bytes = formatBytes(value)
  return bytes === '—' ? bytes : `${bytes}/s`
}

export function formatEta (milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0
    ? `${minutes} 分 ${remainingSeconds} 秒`
    : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`
}

export function formatPercent (progress) {
  const safeProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  return `${Math.round(safeProgress * 100)}%`
}

export function statusLabel (task) {
  if (task?.policy?.phase === 'ready') return '等待操作'
  if (task?.policy?.phase === 'streaming') {
    if (Number.isFinite(task.numPeers) && task.numPeers > 0) return '边下边播'
    return task.noPeers ? '暂无可用节点' : '正在寻找节点'
  }
  if (task?.policy?.phase === 'downloading') {
    if ((Number.isFinite(task.numPeers) && task.numPeers > 0) || (Number.isFinite(task.downloadSpeed) && task.downloadSpeed > 0)) {
      return '正在下载'
    }
    return task.noPeers ? '等待可用节点' : '正在下载'
  }
  if (task?.policy?.phase === 'paused') return '已暂停'
  if (task?.policy?.phase === 'complete') return '下载完成'
  if (task?.policy?.phase === 'error') return '发生错误'
  return '状态未知'
}
