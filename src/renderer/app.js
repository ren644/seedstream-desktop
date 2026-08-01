import {
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed,
  statusLabel
} from './formatters.mjs'
import {
  completeOnboarding,
  guideForPlatform,
  shouldShowOnboarding
} from './onboarding.mjs'
import {
  mediaCompatibilityNotice,
  playbackHealth,
  requestMediaPlayback
} from './playback-health.mjs'

const api = window.seedstream
const elements = {
  appStatus: document.querySelector('#appStatus'),
  helpButton: document.querySelector('#helpButton'),
  dropZone: document.querySelector('#dropZone'),
  openTorrentButton: document.querySelector('#openTorrentButton'),
  chooseDownloadPathButton: document.querySelector('#chooseDownloadPathButton'),
  downloadPath: document.querySelector('#downloadPath'),
  taskCount: document.querySelector('#taskCount'),
  taskList: document.querySelector('#taskList'),
  emptyState: document.querySelector('#emptyState'),
  taskDetail: document.querySelector('#taskDetail'),
  detailStatus: document.querySelector('#detailStatus'),
  detailName: document.querySelector('#detailName'),
  detailMeta: document.querySelector('#detailMeta'),
  taskActions: document.querySelector('#taskActions'),
  detailProgress: document.querySelector('#detailProgress'),
  detailPercent: document.querySelector('#detailPercent'),
  metricDown: document.querySelector('#metricDown'),
  metricUp: document.querySelector('#metricUp'),
  metricPeers: document.querySelector('#metricPeers'),
  metricEta: document.querySelector('#metricEta'),
  playerPanel: document.querySelector('#playerPanel'),
  playerEyebrow: document.querySelector('#playerEyebrow'),
  playerTitle: document.querySelector('#playerTitle'),
  playerStatus: document.querySelector('#playerStatus'),
  retryPlayerButton: document.querySelector('#retryPlayerButton'),
  closePlayerButton: document.querySelector('#closePlayerButton'),
  videoPlayer: document.querySelector('#videoPlayer'),
  playerNotice: document.querySelector('#playerNotice'),
  playerError: document.querySelector('#playerError'),
  fileCount: document.querySelector('#fileCount'),
  fileList: document.querySelector('#fileList'),
  onboardingBackdrop: document.querySelector('#onboardingBackdrop'),
  onboardingDialog: document.querySelector('#onboardingDialog'),
  guidePlatform: document.querySelector('#guidePlatform'),
  platformLaunch: document.querySelector('#platformLaunch'),
  platformWarning: document.querySelector('#platformWarning'),
  openFullGuideButton: document.querySelector('#openFullGuideButton'),
  dismissOnboardingButton: document.querySelector('#dismissOnboardingButton'),
  completeOnboardingButton: document.querySelector('#completeOnboardingButton'),
  toast: document.querySelector('#toast')
}

const viewState = {
  tasks: [],
  selectedTaskId: null,
  platform: '',
  downloadPath: '',
  playback: null,
  busy: false,
  pollTimer: null,
  toastTimer: null,
  removeNativeListener: null,
  onboardingFocus: null
}

function makeElement (tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function selectedTask () {
  return viewState.tasks.find(task => task.id === viewState.selectedTaskId) ?? null
}

function setBusy (busy) {
  viewState.busy = busy
  document.body.setAttribute('aria-busy', String(busy))
  document.querySelectorAll('button').forEach(button => {
    button.disabled = busy
  })
}

function showToast (message, isError = false) {
  clearTimeout(viewState.toastTimer)
  elements.toast.textContent = message
  elements.toast.classList.toggle('is-error', isError)
  elements.toast.hidden = false
  viewState.toastTimer = setTimeout(() => {
    elements.toast.hidden = true
  }, 4200)
}

function updatePlatformGuide () {
  const guide = guideForPlatform(viewState.platform)
  elements.guidePlatform.textContent = guide.label
  elements.platformLaunch.textContent = guide.launch
  elements.platformWarning.textContent = guide.warning
}

function showOnboarding () {
  updatePlatformGuide()
  viewState.onboardingFocus = document.activeElement
  elements.onboardingBackdrop.hidden = false
  requestAnimationFrame(() => elements.onboardingDialog.focus())
}

function hideOnboarding () {
  elements.onboardingBackdrop.hidden = true
  if (viewState.onboardingFocus instanceof HTMLElement) viewState.onboardingFocus.focus()
  viewState.onboardingFocus = null
}

function errorMessage (error) {
  const byCode = {
    DUPLICATE_TORRENT: '这个种子已经在任务列表中。',
    INVALID_TORRENT_FILE: '无法解析该文件，请确认它是有效的 .torrent 种子。',
    UNSUPPORTED_MEDIA: '内置播放器不支持这个文件格式或编码。',
    NO_DOWNLOAD_PATH: '这个任务还没有永久下载目录。',
    TASK_NOT_FOUND: '任务已不存在，请刷新后重试。'
  }
  return byCode[error?.code] ?? error?.message ?? '操作失败，请稍后重试。'
}

async function withBusy (operation) {
  if (viewState.busy) return null
  setBusy(true)
  try {
    return await operation()
  } catch (error) {
    showToast(errorMessage(error), true)
    return null
  } finally {
    setBusy(false)
  }
}

function renderTaskList () {
  elements.taskList.replaceChildren()
  elements.taskCount.textContent = String(viewState.tasks.length)
  if (viewState.tasks.length === 0) {
    elements.taskList.append(makeElement('div', 'task-list-empty', '还没有任务'))
    return
  }

  for (const task of viewState.tasks) {
    const card = makeElement('button', 'task-card')
    card.type = 'button'
    card.dataset.taskId = task.id
    card.classList.toggle('is-selected', task.id === viewState.selectedTaskId)
    card.setAttribute('aria-label', `查看任务：${task.name}`)

    const top = makeElement('div', 'task-card-top')
    top.append(makeElement('strong', '', task.name))
    top.append(makeElement('span', 'status', statusLabel(task)))

    const progress = document.createElement('progress')
    progress.max = 1
    progress.value = Number.isFinite(task.progress) ? task.progress : 0

    const meta = makeElement('div', 'task-card-meta')
    meta.append(makeElement('span', '', formatBytes(task.length)))
    meta.append(makeElement('span', '', formatPercent(task.progress)))
    card.append(top, progress, meta)
    elements.taskList.append(card)
  }
}

function actionButton (label, action, className = 'button button-secondary') {
  const button = makeElement('button', className, label)
  button.type = 'button'
  button.dataset.action = action
  return button
}

function renderTaskActions (task) {
  elements.taskActions.replaceChildren()
  const phase = task.policy.phase
  if (phase === 'ready') {
    elements.taskActions.append(actionButton('下载全部', 'download', 'button button-primary'))
  } else if (phase === 'streaming') {
    elements.taskActions.append(actionButton('转为永久下载', 'download', 'button button-primary'))
  } else if (phase === 'downloading') {
    elements.taskActions.append(actionButton('暂停', 'pause'))
    elements.taskActions.append(actionButton('打开目录', 'reveal', 'button button-quiet'))
  } else if (phase === 'paused') {
    elements.taskActions.append(actionButton('继续下载', 'resume', 'button button-primary'))
    elements.taskActions.append(actionButton('打开目录', 'reveal', 'button button-quiet'))
  } else if (phase === 'complete') {
    elements.taskActions.append(actionButton('打开目录', 'reveal', 'button button-primary'))
  }
  elements.taskActions.append(actionButton('移除记录', 'remove', 'button button-danger'))
}

function renderFiles (task) {
  elements.fileList.replaceChildren()
  elements.fileCount.textContent = `${task.files.length} 个文件`

  for (const file of task.files) {
    const row = makeElement('div', 'file-row')
    const copy = makeElement('div', 'file-copy')
    copy.append(makeElement('strong', '', file.name))
    copy.append(makeElement('span', '', file.path))
    row.append(copy)
    row.append(makeElement('span', 'file-size', formatBytes(file.length)))

    if (file.playable) {
      const playButton = actionButton(
        viewState.playback?.taskId === task.id && viewState.playback?.fileIndex === file.index ? '播放中' : '播放',
        'play',
        'button button-quiet file-play'
      )
      playButton.dataset.fileIndex = String(file.index)
      row.append(playButton)
    } else {
      row.append(makeElement('span', 'unplayable', '下载文件'))
    }
    elements.fileList.append(row)
  }
}

function renderDetail () {
  const task = selectedTask()
  elements.emptyState.hidden = Boolean(task)
  elements.taskDetail.hidden = !task
  if (!task) return

  elements.detailStatus.textContent = statusLabel(task)
  elements.detailStatus.dataset.phase = task.policy.phase
  elements.detailName.textContent = task.name
  elements.detailMeta.textContent = `${formatBytes(task.length)} · ${task.files.length} 个文件${task.error ? ` · ${task.error}` : ''}`
  elements.detailProgress.value = Number.isFinite(task.progress) ? task.progress : 0
  elements.detailProgress.textContent = formatPercent(task.progress)
  elements.detailPercent.textContent = formatPercent(task.progress)
  elements.metricDown.textContent = formatSpeed(task.downloadSpeed)
  elements.metricUp.textContent = formatSpeed(task.uploadSpeed)
  elements.metricPeers.textContent = String(task.numPeers ?? 0)
  elements.metricEta.textContent = formatEta(task.timeRemaining)
  renderTaskActions(task)
  renderFiles(task)
}

function render () {
  elements.downloadPath.textContent = viewState.downloadPath || '未设置'
  elements.downloadPath.title = viewState.downloadPath || ''
  renderTaskList()
  renderDetail()
}

function updatePlaybackDiagnostics () {
  const playback = viewState.playback
  if (!playback || playback.mediaState === 'error') return
  const task = viewState.tasks.find(candidate => candidate.id === playback.taskId)
  if (!task) return

  const now = Date.now()
  if (Number.isFinite(task.downloaded) && task.downloaded > playback.lastDownloaded) {
    playback.lastDownloaded = task.downloaded
    playback.lastProgressAt = now
  }
  const health = playbackHealth({
    task,
    elapsedMs: now - playback.startedAt,
    stalledMs: now - playback.lastProgressAt,
    mediaState: playback.mediaState
  })
  elements.playerPanel.dataset.health = health.kind
  elements.playerEyebrow.textContent = health.label
  elements.playerStatus.textContent = health.status
  elements.retryPlayerButton.hidden = !health.canRetry
  elements.playerError.textContent = health.detail
  elements.playerError.hidden = health.detail.length === 0
}

async function refreshState (silent = false) {
  try {
    const state = await api.getState()
    viewState.tasks = state.tasks
    viewState.platform = state.platform
    viewState.downloadPath = state.downloadPath
    if (!viewState.selectedTaskId || !viewState.tasks.some(task => task.id === viewState.selectedTaskId)) {
      viewState.selectedTaskId = viewState.tasks.at(-1)?.id ?? null
    }
    if (viewState.playback && !viewState.tasks.some(task => task.id === viewState.playback.taskId)) {
      closePlayerLocally()
    }
    elements.appStatus.textContent = `本地引擎就绪 · v${state.version}`
    updatePlatformGuide()
    render()
    updatePlaybackDiagnostics()
  } catch (error) {
    elements.appStatus.textContent = '本地引擎连接异常'
    if (!silent) showToast(errorMessage(error), true)
  }
}

async function importDroppedFile (file) {
  if (!file?.name?.toLowerCase().endsWith('.torrent')) {
    throw Object.assign(new Error('请拖入扩展名为 .torrent 的种子文件。'), { code: 'INVALID_TORRENT_FILE' })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const task = await api.importTorrentBytes(bytes, file.name)
  viewState.selectedTaskId = task.id
  await refreshState(true)
  showToast(`已解析：${task.name}`)
}

async function chooseTorrent () {
  const task = await api.chooseTorrent()
  if (!task) return
  viewState.selectedTaskId = task.id
  await refreshState(true)
  showToast(`已解析：${task.name}`)
}

async function startPlayback (task, fileIndex) {
  if (viewState.playback) await closePlayback()
  const playback = await api.playFile(task.id, fileIndex)
  const now = Date.now()
  viewState.playback = {
    ...playback,
    startedAt: now,
    lastProgressAt: now,
    lastDownloaded: 0,
    mediaState: 'loading'
  }
  elements.playerPanel.hidden = false
  elements.playerPanel.dataset.health = 'connecting'
  elements.playerEyebrow.textContent = 'PEER DISCOVERY'
  elements.playerTitle.textContent = playback.name
  elements.playerStatus.textContent = '正在寻找可用节点…'
  elements.retryPlayerButton.hidden = true
  elements.playerError.hidden = true
  elements.playerError.textContent = ''
  const compatibilityNotice = mediaCompatibilityNotice(playback.name)
  elements.playerNotice.textContent = compatibilityNotice
  elements.playerNotice.hidden = compatibilityNotice.length === 0
  elements.videoPlayer.src = playback.url
  elements.videoPlayer.load()
  elements.playerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  requestMediaPlayback(elements.videoPlayer)
  await refreshState(true)
}

function closePlayerLocally () {
  elements.videoPlayer.pause()
  elements.videoPlayer.removeAttribute('src')
  elements.videoPlayer.load()
  elements.playerPanel.hidden = true
  delete elements.playerPanel.dataset.health
  elements.playerEyebrow.textContent = 'NOW BUFFERING'
  elements.playerTitle.textContent = '—'
  elements.playerStatus.textContent = '准备播放'
  elements.retryPlayerButton.hidden = true
  elements.playerNotice.hidden = true
  elements.playerNotice.textContent = ''
  elements.playerError.hidden = true
  elements.playerError.textContent = ''
  viewState.playback = null
}

async function closePlayback () {
  const playback = viewState.playback
  closePlayerLocally()
  if (playback) await api.closePlayer(playback.taskId)
  await refreshState(true)
}

async function retryPlayback () {
  const playback = viewState.playback
  if (!playback) return
  const task = viewState.tasks.find(candidate => candidate.id === playback.taskId)
  if (!task) return closePlayback()
  const fileIndex = playback.fileIndex
  await closePlayback()
  await startPlayback(task, fileIndex)
}

async function handleTaskAction (action, fileIndex) {
  const task = selectedTask()
  if (!task) return
  if (action === 'play') return startPlayback(task, fileIndex)
  if (action === 'download') {
    if (viewState.playback?.taskId === task.id) closePlayerLocally()
    await api.startDownload(task.id)
    showToast('已切换到永久下载。')
  } else if (action === 'pause') {
    if (viewState.playback?.taskId === task.id) closePlayerLocally()
    await api.pause(task.id)
  } else if (action === 'resume') {
    await api.resume(task.id)
  } else if (action === 'reveal') {
    await api.reveal(task.id)
  } else if (action === 'remove') {
    const confirmed = window.confirm('移除任务记录？已经下载到永久目录的文件不会被删除。')
    if (!confirmed) return
    if (viewState.playback?.taskId === task.id) closePlayerLocally()
    await api.remove(task.id)
    viewState.selectedTaskId = null
  }
  await refreshState(true)
}

elements.openTorrentButton.addEventListener('click', () => withBusy(chooseTorrent))
elements.helpButton.addEventListener('click', showOnboarding)
elements.dismissOnboardingButton.addEventListener('click', hideOnboarding)
elements.completeOnboardingButton.addEventListener('click', () => {
  completeOnboarding(window.localStorage)
  hideOnboarding()
})
elements.openFullGuideButton.addEventListener('click', () => withBusy(async () => {
  await api.openGuide()
  showToast('已在默认浏览器中打开完整使用指南。')
}))
elements.onboardingBackdrop.addEventListener('click', event => {
  if (event.target === elements.onboardingBackdrop) hideOnboarding()
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !elements.onboardingBackdrop.hidden) hideOnboarding()
})
elements.dropZone.addEventListener('keydown', event => {
  if (event.target === elements.openTorrentButton) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    withBusy(chooseTorrent)
  }
})

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, event => {
    event.preventDefault()
    elements.dropZone.classList.add('is-dragging')
  })
}

for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, event => {
    event.preventDefault()
    elements.dropZone.classList.remove('is-dragging')
  })
}

elements.dropZone.addEventListener('drop', event => {
  const file = [...event.dataTransfer.files].find(candidate => candidate.name.toLowerCase().endsWith('.torrent'))
  withBusy(() => importDroppedFile(file))
})

elements.chooseDownloadPathButton.addEventListener('click', () => withBusy(async () => {
  viewState.downloadPath = await api.chooseDownloadPath()
  render()
}))

elements.taskList.addEventListener('click', event => {
  const card = event.target.closest('[data-task-id]')
  if (!card) return
  viewState.selectedTaskId = card.dataset.taskId
  render()
})

elements.taskActions.addEventListener('click', event => {
  const button = event.target.closest('[data-action]')
  if (!button) return
  withBusy(() => handleTaskAction(button.dataset.action))
})

elements.fileList.addEventListener('click', event => {
  const button = event.target.closest('[data-action="play"]')
  if (!button) return
  withBusy(() => handleTaskAction('play', Number(button.dataset.fileIndex)))
})

elements.closePlayerButton.addEventListener('click', () => withBusy(closePlayback))
elements.retryPlayerButton.addEventListener('click', () => withBusy(retryPlayback))

elements.videoPlayer.addEventListener('waiting', () => {
  if (!viewState.playback) return
  viewState.playback.mediaState = 'waiting'
  updatePlaybackDiagnostics()
})
elements.videoPlayer.addEventListener('playing', () => {
  if (!viewState.playback) return
  viewState.playback.mediaState = 'playing'
  updatePlaybackDiagnostics()
})
elements.videoPlayer.addEventListener('canplay', () => {
  if (!viewState.playback) return
  viewState.playback.mediaState = 'ready'
  updatePlaybackDiagnostics()
})
elements.videoPlayer.addEventListener('error', () => {
  if (viewState.playback) viewState.playback.mediaState = 'error'
  const code = elements.videoPlayer.error?.code
  const message = code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
    ? '当前视频编码无法由内置播放器解码。你仍然可以完整下载后使用其他播放器打开。'
    : '视频流暂时不可用，请检查节点连接后重试。'
  elements.playerStatus.textContent = '播放失败'
  elements.playerEyebrow.textContent = 'PLAYBACK ERROR'
  elements.retryPlayerButton.hidden = code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
  elements.playerError.textContent = message
  elements.playerError.hidden = false
})

viewState.removeNativeListener = api.onNativeOpened(payload => {
  if (payload?.ok) {
    viewState.selectedTaskId = payload.task.id
    refreshState(true)
    showToast(`已从系统打开：${payload.task.name}`)
  } else {
    showToast(errorMessage(payload?.error), true)
  }
})

window.addEventListener('beforeunload', () => {
  clearInterval(viewState.pollTimer)
  viewState.removeNativeListener?.()
  if (viewState.playback) api.closePlayer(viewState.playback.taskId).catch(() => {})
})

await refreshState()
if (shouldShowOnboarding(window.localStorage)) showOnboarding()
viewState.pollTimer = setInterval(() => {
  if (!document.hidden && !viewState.busy) refreshState(true)
}, 1000)
