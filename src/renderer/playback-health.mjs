export const PEER_DISCOVERY_GRACE_MS = 12_000
export const DATA_STALL_GRACE_MS = 15_000

export function requestMediaPlayback (mediaElement) {
  try {
    Promise.resolve(mediaElement.play()).catch(() => {})
  } catch {
    // The media element's error event provides the user-facing explanation.
  }
}

function nonNegativeNumber (value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function playbackHealth ({
  task,
  elapsedMs = 0,
  stalledMs = 0,
  mediaState = 'loading',
  source = 'torrent'
}) {
  if (source === 'local') {
    if (mediaState === 'error' || task?.error) {
      return { kind: 'error', label: 'PLAYBACK ERROR', status: '播放失败', detail: task?.error ?? '', canRetry: false }
    }
    if (mediaState === 'playing') {
      return { kind: 'local', label: 'LOCAL PLAYBACK', status: '本地文件播放', detail: '', canRetry: false }
    }
    if (mediaState === 'ready') {
      return { kind: 'local', label: 'LOCAL PLAYBACK', status: '本地视频已就绪', detail: '', canRetry: false }
    }
    return { kind: 'local', label: 'LOCAL PLAYBACK', status: '正在打开本地视频…', detail: '', canRetry: false }
  }

  if (mediaState === 'playing') {
    return { kind: 'playing', label: 'NOW PLAYING', status: '边下边播', detail: '', canRetry: false }
  }
  if (mediaState === 'ready') {
    return { kind: 'ready', label: 'READY TO PLAY', status: '可以播放', detail: '', canRetry: false }
  }
  if (mediaState === 'error' || task?.error) {
    return { kind: 'error', label: 'PLAYBACK ERROR', status: '播放失败', detail: task?.error ?? '', canRetry: true }
  }

  const peers = nonNegativeNumber(task?.numPeers)
  const speed = nonNegativeNumber(task?.downloadSpeed)
  const discoveryExpired = nonNegativeNumber(elapsedMs) >= PEER_DISCOVERY_GRACE_MS
  const transferStalled = nonNegativeNumber(stalledMs) >= DATA_STALL_GRACE_MS

  if (peers === 0) {
    if (task?.noPeers || discoveryExpired) {
      return {
        kind: 'no-peers',
        label: 'NO PEERS FOUND',
        status: '没有可用节点',
        detail: '当前种子没有可用节点，暂时无法取得视频数据。可以稍后重试，或换一个有做种者的合法来源。',
        canRetry: true
      }
    }
    return {
      kind: 'connecting',
      label: 'PEER DISCOVERY',
      status: '正在寻找可用节点…',
      detail: '',
      canRetry: false
    }
  }

  if (speed === 0 && transferStalled) {
    return {
      kind: 'stalled',
      label: 'TRANSFER STALLED',
      status: '节点暂时没有数据',
      detail: `已连接 ${peers} 个节点，但连续一段时间没有收到新数据。可以重新连接或稍后再试。`,
      canRetry: true
    }
  }

  return {
    kind: 'buffering',
    label: 'NOW BUFFERING',
    status: `已连接 ${peers} 个节点，正在缓冲…`,
    detail: '',
    canRetry: false
  }
}

export function mediaCompatibilityNotice (name) {
  if (typeof name !== 'string' || name.length === 0) return ''

  const normalized = name.toLowerCase()
  const risks = []
  if (/\.mkv(?:$|[?#])/i.test(normalized)) risks.push('MKV 容器')
  if (/(?:^|[\s._\-[\]()])(?:e-?ac-?3|ac-?3)(?:$|[\s._\-[\]()])/i.test(normalized)) risks.push('AC3 音频')
  if (/(?:^|[\s._\-[\]()])(?:dts|truehd)(?:$|[\s._\-[\]()])/i.test(normalized)) risks.push('DTS/TrueHD 音频')
  if (/(?:^|[\s._\-[\]()])(?:h\.?265|x265|hevc)(?:$|[\s._\-[\]()])/i.test(normalized)) risks.push('H.265/HEVC 视频')

  if (risks.length === 0) return ''
  return `兼容性提醒：文件名显示${risks.join('、')}，内置播放器可能无法解码声音或画面。若取得数据后仍不能播放，请完整下载后使用 VLC 或 IINA。`
}
