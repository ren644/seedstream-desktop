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
import {
  fullscreenButtonLabel,
  maximizeButtonLabel
} from './fullscreen-controls.mjs'
import {
  availabilityLabel,
  canImportSearchResult,
  searchSourceSummary,
  sortSearchResults
} from './search-ui.mjs'

const api = window.seedstream
const elements = {
  appStatus: document.querySelector('#appStatus'),
  searchCenterButton: document.querySelector('#searchCenterButton'),
  windowMaximizeButton: document.querySelector('#windowMaximizeButton'),
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
  fullscreenPlayerButton: document.querySelector('#fullscreenPlayerButton'),
  closePlayerButton: document.querySelector('#closePlayerButton'),
  videoPlayer: document.querySelector('#videoPlayer'),
  playerNotice: document.querySelector('#playerNotice'),
  playerError: document.querySelector('#playerError'),
  fileCount: document.querySelector('#fileCount'),
  fileList: document.querySelector('#fileList'),
  searchBackdrop: document.querySelector('#searchBackdrop'),
  searchDialog: document.querySelector('#searchDialog'),
  closeSearchButton: document.querySelector('#closeSearchButton'),
  searchTabs: document.querySelector('#searchTabs'),
  aggregateSearchForm: document.querySelector('#aggregateSearchForm'),
  aggregateSearchInput: document.querySelector('#aggregateSearchInput'),
  searchSortSelect: document.querySelector('#searchSortSelect'),
  searchSourceSummary: document.querySelector('#searchSourceSummary'),
  searchSourceHealth: document.querySelector('#searchSourceHealth'),
  searchResults: document.querySelector('#searchResults'),
  browserSearchForm: document.querySelector('#browserSearchForm'),
  browserSearchInput: document.querySelector('#browserSearchInput'),
  clearBrowserDataButton: document.querySelector('#clearBrowserDataButton'),
  magnetImportForm: document.querySelector('#magnetImportForm'),
  magnetInput: document.querySelector('#magnetInput'),
  secretStorageStatus: document.querySelector('#secretStorageStatus'),
  providerList: document.querySelector('#providerList'),
  providerForm: document.querySelector('#providerForm'),
  providerNameInput: document.querySelector('#providerNameInput'),
  providerEndpointInput: document.querySelector('#providerEndpointInput'),
  providerApiKeyInput: document.querySelector('#providerApiKeyInput'),
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
  windowMaximized: false,
  videoFullscreen: false,
  playback: null,
  busy: false,
  pollTimer: null,
  toastTimer: null,
  removeNativeListener: null,
  removeFullscreenListener: null,
  removeSearchListener: null,
  onboardingFocus: null,
  searchFocus: null,
  search: {
    activeTab: 'aggregate',
    results: [],
    sources: [],
    sort: 'recommended',
    config: null
  }
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

function updateWindowMaximizeControl () {
  elements.windowMaximizeButton.textContent = maximizeButtonLabel(viewState.windowMaximized)
  elements.windowMaximizeButton.setAttribute('aria-pressed', String(viewState.windowMaximized))
}

function isVideoFullscreen () {
  return viewState.videoFullscreen
}

function updateFullscreenControl () {
  const fullscreen = isVideoFullscreen()
  document.body.classList.toggle('is-video-fullscreen', fullscreen)
  elements.fullscreenPlayerButton.textContent = fullscreenButtonLabel(fullscreen)
  elements.fullscreenPlayerButton.setAttribute('aria-pressed', String(fullscreen))
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

function searchableControls () {
  return [...elements.searchDialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.closest('[hidden]'))
}

function setSearchTab (tab) {
  const allowed = new Set(['aggregate', 'browser', 'magnet', 'sources'])
  viewState.search.activeTab = allowed.has(tab) ? tab : 'aggregate'
  elements.searchTabs.querySelectorAll('[data-search-tab]').forEach(button => {
    const active = button.dataset.searchTab === viewState.search.activeTab
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-selected', String(active))
  })
  elements.searchDialog.querySelectorAll('[data-search-panel]').forEach(panel => {
    panel.hidden = panel.dataset.searchPanel !== viewState.search.activeTab
  })
  const focusTarget = {
    aggregate: elements.aggregateSearchInput,
    browser: elements.browserSearchInput,
    magnet: elements.magnetInput,
    sources: elements.providerNameInput
  }[viewState.search.activeTab]
  requestAnimationFrame(() => focusTarget?.focus())
}

function renderSourceHealth () {
  elements.searchSourceSummary.textContent = searchSourceSummary(viewState.search.sources)
  elements.searchSourceHealth.replaceChildren()
  for (const source of viewState.search.sources) {
    const status = makeElement('span', `source-health-chip is-${source.status}`)
    status.textContent = source.status === 'ok'
      ? `${source.name} · ${source.count}`
      : `${source.name} · 异常`
    if (source.message) status.title = source.message
    elements.searchSourceHealth.append(status)
  }
}

function resultDate (value) {
  const date = new Date(value ?? '')
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '时间未知'
}

function renderSearchResults () {
  renderSourceHealth()
  elements.searchResults.replaceChildren()
  const results = sortSearchResults(viewState.search.results, viewState.search.sort)
  if (results.length === 0) {
    const empty = makeElement('div', 'search-empty')
    empty.append(makeElement('span', '', '⌕'))
    empty.append(makeElement('strong', '', viewState.search.sources.length > 0 ? '没有找到可导入的结果' : '等待搜索信号'))
    empty.append(makeElement('p', '', viewState.search.sources.length > 0
      ? '可以换一个关键词，或在“网页捕获”中扩大搜索范围。'
      : '无需配置也可搜索内置来源；添加私有搜索源后会自动合并结果。'))
    elements.searchResults.append(empty)
    return
  }

  for (const result of results) {
    const card = makeElement('article', 'search-result-card')
    const header = makeElement('div', 'search-result-header')
    const title = makeElement('strong', '', result.title)
    title.title = result.title
    header.append(title, makeElement('span', 'availability-chip', availabilityLabel(result)))

    const meta = makeElement('div', 'search-result-meta')
    meta.append(
      makeElement('span', '', result.sources?.join(' + ') || '未知来源'),
      makeElement('span', '', formatBytes(result.size)),
      makeElement('span', '', Number.isSafeInteger(result.seeders) ? `${result.seeders} 做种` : '节点未知'),
      makeElement('span', '', resultDate(result.publishedAt))
    )

    const actions = makeElement('div', 'search-result-actions')
    const importButton = actionButton('加入 SeedStream', 'import-search-result', 'button button-primary')
    importButton.dataset.resultToken = result.token
    importButton.disabled = !canImportSearchResult(result)
    actions.append(importButton)
    if (result.detailsUrl) {
      const detailsButton = actionButton('查看来源', 'open-search-result', 'button button-quiet')
      detailsButton.dataset.resultUrl = result.detailsUrl
      actions.append(detailsButton)
    }
    card.append(header, meta, actions)
    elements.searchResults.append(card)
  }
}

function providerPayload (provider) {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    endpoint: provider.endpoint,
    enabled: provider.enabled
  }
}

function renderProviderList () {
  const config = viewState.search.config
  elements.secretStorageStatus.textContent = config?.secretsPersisted ? '系统加密可用' : '密钥不持久化'
  elements.secretStorageStatus.classList.toggle('is-warning', !config?.secretsPersisted)
  elements.providerList.replaceChildren()
  const providers = config?.providers ?? []
  if (providers.length === 0) {
    elements.providerList.append(makeElement('div', 'provider-empty', '还没有自定义搜索源，内置来源仍然可以使用。'))
    return
  }
  for (const provider of providers) {
    const row = makeElement('article', 'provider-row')
    const copy = makeElement('div', 'provider-copy')
    copy.append(makeElement('strong', '', provider.name))
    copy.append(makeElement('span', '', provider.endpoint))
    copy.append(makeElement('small', '', `${provider.enabled ? '已启用' : '已停用'} · ${provider.apiKeyConfigured ? '密钥已保存' : '未设置密钥'}`))
    const actions = makeElement('div', 'provider-actions')
    const toggle = actionButton(provider.enabled ? '停用' : '启用', 'toggle-provider', 'button button-quiet')
    toggle.dataset.providerId = provider.id
    const remove = actionButton('移除', 'remove-provider', 'button button-danger')
    remove.dataset.providerId = provider.id
    actions.append(toggle, remove)
    row.append(copy, actions)
    elements.providerList.append(row)
  }
}

async function loadSearchConfig () {
  viewState.search.config = await api.getSearchConfig()
  renderProviderList()
}

async function showSearchCenter () {
  viewState.searchFocus = document.activeElement
  elements.searchBackdrop.hidden = false
  setSearchTab(viewState.search.activeTab)
  if (!viewState.search.config) await loadSearchConfig()
  renderSearchResults()
  requestAnimationFrame(() => elements.searchDialog.focus())
}

function hideSearchCenter () {
  elements.searchBackdrop.hidden = true
  if (viewState.searchFocus instanceof HTMLElement) viewState.searchFocus.focus()
  viewState.searchFocus = null
}

async function runAggregatedSearch () {
  const response = await api.searchTorrents(elements.aggregateSearchInput.value)
  viewState.search.results = response.results
  viewState.search.sources = response.sources
  renderSearchResults()
  showToast(`已合并 ${response.results.length} 条结果。`)
}

async function importSearchResult (token) {
  const task = await api.importSearchResult(token)
  viewState.selectedTaskId = task.id
  await refreshState(true)
  hideSearchCenter()
  showToast(`已加入任务：${task.name}`)
}

async function importMagnet () {
  const task = await api.importMagnet(elements.magnetInput.value.trim())
  elements.magnetImportForm.reset()
  viewState.selectedTaskId = task.id
  await refreshState(true)
  hideSearchCenter()
  showToast(`磁力链接已解析：${task.name}`)
}

async function saveProviders (providers) {
  viewState.search.config = await api.saveSearchConfig(providers)
  renderProviderList()
}

function errorMessage (error) {
  const byCode = {
    DUPLICATE_TORRENT: '这个种子已经在任务列表中。',
    INVALID_TORRENT_FILE: '无法解析该文件，请确认它是有效的 .torrent 种子。',
    INVALID_MAGNET: '磁力链接格式无效，请检查后重新粘贴。',
    MAGNET_METADATA_TIMEOUT: '暂时没有找到能提供文件清单的节点，请稍后重试或换一个结果。',
    MAGNET_METADATA_UNAVAILABLE: '已经连接到磁力任务，但没有获得有效的种子元数据。',
    RESULT_TOKEN_EXPIRED: '这个搜索结果已过期，请重新搜索后再加入。',
    RESULT_NOT_IMPORTABLE: '这个结果没有可用的种子文件或磁力链接。',
    INVALID_CONTENT_TYPE: '来源返回的不是有效种子文件，请换一个结果。',
    SOURCE_TOO_LARGE: '来源返回的数据异常大，已为安全起见停止处理。',
    UNSUPPORTED_MEDIA: '内置播放器不支持这个文件格式或编码。',
    NO_DOWNLOAD_PATH: '这个任务还没有永久下载目录。',
    LOCAL_FILE_MISSING: '下载完成的视频已被移动或删除，请打开下载目录检查。',
    LOCAL_FILE_INCOMPLETE: '本地视频文件不完整或已被修改，请重新下载。',
    LOCAL_FILE_UNAVAILABLE: '这个任务还没有可供本地播放的完整视频。',
    SYSTEM_OPEN_FAILED: '系统没有找到能打开这个视频的应用，请安装 VLC 或 IINA 后重试。',
    FULLSCREEN_UNAVAILABLE: '当前系统无法进入视频全屏，请尝试双击视频或使用窗口最大化。',
    WINDOW_UNAVAILABLE: '当前软件窗口暂时无法最大化，请稍后重试。',
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
    if (task.files.some(file => file.playable)) {
      elements.taskActions.append(actionButton('播放视频', 'play-first', 'button button-primary'))
      elements.taskActions.append(actionButton('系统打开', 'open-first', 'button button-secondary'))
      elements.taskActions.append(actionButton('打开目录', 'reveal', 'button button-quiet'))
    } else {
      elements.taskActions.append(actionButton('打开目录', 'reveal', 'button button-primary'))
    }
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
        viewState.playback?.taskId === task.id && viewState.playback?.fileIndex === file.index
          ? '播放中'
          : task.policy.phase === 'complete' ? '本地播放' : '播放',
        'play',
        'button button-quiet file-play'
      )
      playButton.dataset.fileIndex = String(file.index)
      const fileActions = makeElement('div', 'file-actions')
      fileActions.append(playButton)
      if (task.policy.phase === 'complete') {
        const openButton = actionButton('系统打开', 'open-file', 'button button-quiet file-open')
        openButton.dataset.fileIndex = String(file.index)
        fileActions.append(openButton)
      }
      row.append(fileActions)
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
    mediaState: playback.mediaState,
    source: playback.source
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
    viewState.windowMaximized = Boolean(state.windowMaximized)
    viewState.videoFullscreen = Boolean(state.videoFullscreen)
    if (!viewState.selectedTaskId || !viewState.tasks.some(task => task.id === viewState.selectedTaskId)) {
      viewState.selectedTaskId = viewState.tasks.at(-1)?.id ?? null
    }
    if (viewState.playback && !viewState.tasks.some(task => task.id === viewState.playback.taskId)) {
      closePlayerLocally()
    }
    elements.appStatus.textContent = `本地引擎就绪 · v${state.version}`
    updateWindowMaximizeControl()
    updateFullscreenControl()
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
  const initialHealth = playbackHealth({ task, source: playback.source })
  elements.playerPanel.dataset.health = initialHealth.kind
  elements.playerEyebrow.textContent = initialHealth.label
  elements.playerTitle.textContent = playback.name
  elements.playerStatus.textContent = initialHealth.status
  elements.retryPlayerButton.hidden = !initialHealth.canRetry
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
  if (viewState.videoFullscreen) {
    viewState.videoFullscreen = false
    updateFullscreenControl()
    api.setVideoFullscreen(false).catch(() => {})
  }
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

async function togglePlayerFullscreen () {
  const result = await api.setVideoFullscreen(!viewState.videoFullscreen)
  viewState.videoFullscreen = Boolean(result?.fullscreen)
  updateFullscreenControl()
}

async function handleTaskAction (action, fileIndex) {
  const task = selectedTask()
  if (!task) return
  if (action === 'play') return startPlayback(task, fileIndex)
  if (action === 'play-first') {
    const firstPlayable = task.files.find(file => file.playable)
    if (firstPlayable) return startPlayback(task, firstPlayable.index)
    return
  }
  if (action === 'open-first') {
    const firstPlayable = task.files.find(file => file.playable)
    if (firstPlayable) return handleTaskAction('open-file', firstPlayable.index)
    return
  }
  if (action === 'open-file') {
    await api.openDownloadedFile(task.id, fileIndex)
    showToast('已交给系统播放器打开。')
    return
  }
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

elements.searchCenterButton.addEventListener('click', () => withBusy(showSearchCenter))
elements.closeSearchButton.addEventListener('click', hideSearchCenter)
elements.searchBackdrop.addEventListener('click', event => {
  if (event.target === elements.searchBackdrop && !viewState.busy) hideSearchCenter()
})
elements.searchTabs.addEventListener('click', event => {
  const tab = event.target.closest('[data-search-tab]')
  if (tab) setSearchTab(tab.dataset.searchTab)
})
elements.aggregateSearchForm.addEventListener('submit', event => {
  event.preventDefault()
  withBusy(runAggregatedSearch)
})
elements.searchSortSelect.addEventListener('change', () => {
  viewState.search.sort = elements.searchSortSelect.value
  renderSearchResults()
})
elements.searchResults.addEventListener('click', event => {
  const button = event.target.closest('[data-action]')
  if (!button) return
  if (button.dataset.action === 'import-search-result') {
    withBusy(() => importSearchResult(button.dataset.resultToken))
  } else if (button.dataset.action === 'open-search-result') {
    withBusy(async () => {
      await api.openSearchBrowser(button.dataset.resultUrl)
      showToast('已在隔离搜索窗口中打开来源。')
    })
  }
})
elements.browserSearchForm.addEventListener('submit', event => {
  event.preventDefault()
  withBusy(async () => {
    await api.openSearchBrowser(elements.browserSearchInput.value)
    showToast('隔离搜索窗口已打开；点击磁力或种子下载即可接管。')
  })
})
elements.clearBrowserDataButton.addEventListener('click', () => withBusy(async () => {
  const confirmed = window.confirm('清理隔离网页窗口的缓存、Cookie 和登录状态？')
  if (!confirmed) return
  await api.clearSearchBrowserData()
  showToast('隔离网页数据已清理。')
}))
elements.magnetImportForm.addEventListener('submit', event => {
  event.preventDefault()
  withBusy(importMagnet)
})
elements.providerForm.addEventListener('submit', event => {
  event.preventDefault()
  withBusy(async () => {
    const config = viewState.search.config ?? { providers: [] }
    const id = `source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    await saveProviders([
      ...config.providers.map(providerPayload),
      {
        id,
        name: elements.providerNameInput.value,
        kind: 'torznab',
        endpoint: elements.providerEndpointInput.value,
        apiKey: elements.providerApiKeyInput.value,
        enabled: true
      }
    ])
    elements.providerForm.reset()
    showToast('搜索源已保存在本机。')
  })
})
elements.providerList.addEventListener('click', event => {
  const button = event.target.closest('[data-provider-id]')
  if (!button) return
  withBusy(async () => {
    const providers = viewState.search.config?.providers ?? []
    if (button.dataset.action === 'remove-provider') {
      const confirmed = window.confirm('移除这个搜索源？已保存的 API 密钥也会从 SeedStream 配置中删除。')
      if (!confirmed) return
      await saveProviders(providers.filter(provider => provider.id !== button.dataset.providerId).map(providerPayload))
      showToast('搜索源已移除。')
    } else if (button.dataset.action === 'toggle-provider') {
      await saveProviders(providers.map(provider => ({
        ...providerPayload(provider),
        enabled: provider.id === button.dataset.providerId ? !provider.enabled : provider.enabled
      })))
    }
  })
})

elements.openTorrentButton.addEventListener('click', () => withBusy(chooseTorrent))
elements.windowMaximizeButton.addEventListener('click', () => withBusy(async () => {
  const state = await api.toggleWindowMaximize()
  viewState.windowMaximized = Boolean(state?.maximized)
  updateWindowMaximizeControl()
}))
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
  if (event.key === 'Tab' && !elements.searchBackdrop.hidden) {
    const controls = searchableControls()
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  } else if (event.key === 'Escape' && !elements.onboardingBackdrop.hidden) hideOnboarding()
  else if (event.key === 'Escape' && !elements.searchBackdrop.hidden && !viewState.busy) hideSearchCenter()
  else if (event.key === 'Escape' && viewState.videoFullscreen) {
    event.preventDefault()
    togglePlayerFullscreen().catch(error => showToast(errorMessage(error), true))
  }
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
  const button = event.target.closest('[data-action="play"], [data-action="open-file"]')
  if (!button) return
  withBusy(() => handleTaskAction(button.dataset.action, Number(button.dataset.fileIndex)))
})

elements.closePlayerButton.addEventListener('click', () => withBusy(closePlayback))
elements.retryPlayerButton.addEventListener('click', () => withBusy(retryPlayback))
elements.fullscreenPlayerButton.addEventListener('click', () => {
  togglePlayerFullscreen().catch(error => showToast(errorMessage(error), true))
})
elements.videoPlayer.addEventListener('dblclick', event => {
  event.preventDefault()
  togglePlayerFullscreen().catch(error => showToast(errorMessage(error), true))
})

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
    ? viewState.playback?.source === 'local'
        ? '当前视频编码无法由内置播放器解码，请点击“系统打开”并使用 VLC、IINA 等播放器观看。'
        : '当前视频编码无法由内置播放器解码。完整下载后可点击“系统打开”。'
    : viewState.playback?.source === 'local'
        ? '本地视频文件暂时无法读取，请打开下载目录检查文件。'
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

viewState.removeFullscreenListener = api.onVideoFullscreenChanged(payload => {
  viewState.videoFullscreen = Boolean(payload?.fullscreen)
  updateFullscreenControl()
})

viewState.removeSearchListener = api.onSearchCaptured(payload => {
  if (payload?.ok) {
    viewState.selectedTaskId = payload.task.id
    refreshState(true)
    if (!elements.searchBackdrop.hidden) hideSearchCenter()
    showToast(`网页结果已加入：${payload.task.name}`)
  } else {
    showToast(errorMessage(payload?.error), true)
  }
})

window.addEventListener('beforeunload', () => {
  clearInterval(viewState.pollTimer)
  viewState.removeNativeListener?.()
  viewState.removeFullscreenListener?.()
  viewState.removeSearchListener?.()
  if (viewState.playback) api.closePlayer(viewState.playback.taskId).catch(() => {})
})

await refreshState()
if (shouldShowOnboarding(window.localStorage)) showOnboarding()
viewState.pollTimer = setInterval(() => {
  if (!document.hidden && !viewState.busy) refreshState(true)
}, 1000)
