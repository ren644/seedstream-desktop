export const ACTION = Object.freeze({
  PLAY: 'play',
  CLOSE_PLAYER: 'close-player',
  START_DOWNLOAD: 'start-download',
  PAUSE: 'pause',
  RESUME: 'resume',
  MARK_COMPLETE: 'mark-complete',
  FAIL: 'fail',
  REMOVE: 'remove'
})

export function initialTaskPolicy () {
  return {
    phase: 'ready',
    storage: 'none',
    playing: false
  }
}

function result (state, effects = []) {
  return { state: Object.freeze(state), effects: Object.freeze(effects) }
}

function invalid (action, state) {
  throw new Error(`Cannot ${action.replaceAll('-', ' ')} while task is ${state.phase}`)
}

export function transitionTask (state, action) {
  if (!state || typeof state.phase !== 'string') {
    throw new TypeError('A task policy state is required')
  }

  switch (action) {
    case ACTION.PLAY:
      if (state.phase === 'ready') {
        return result(
          { phase: 'streaming', storage: 'ephemeral', playing: true },
          ['start-ephemeral-transfer', 'open-player']
        )
      }
      if (state.phase === 'downloading' || state.phase === 'complete') {
        return result({ ...state, playing: true }, ['open-player'])
      }
      if (state.phase === 'paused') {
        return result(
          { phase: 'downloading', storage: 'persistent', playing: true },
          ['start-persistent-transfer', 'open-player']
        )
      }
      return invalid(action, state)

    case ACTION.CLOSE_PLAYER:
      if (!state.playing) return invalid(action, state)
      if (state.storage === 'ephemeral') {
        return result(initialTaskPolicy(), ['stop-transfer', 'purge-cache'])
      }
      return result({ ...state, playing: false }, ['close-player'])

    case ACTION.START_DOWNLOAD:
      if (state.phase === 'ready') {
        return result(
          { phase: 'downloading', storage: 'persistent', playing: false },
          ['start-persistent-transfer']
        )
      }
      if (state.phase === 'streaming') {
        return result(
          { phase: 'downloading', storage: 'persistent', playing: false },
          ['stop-transfer', 'purge-cache', 'start-persistent-transfer']
        )
      }
      if (state.phase === 'paused') {
        return result(
          { phase: 'downloading', storage: 'persistent', playing: false },
          ['start-persistent-transfer']
        )
      }
      return invalid(action, state)

    case ACTION.PAUSE:
      if (state.phase !== 'downloading') return invalid(action, state)
      return result(
        { phase: 'paused', storage: 'persistent', playing: false },
        state.playing
          ? ['close-player', 'stop-transfer-keep-files']
          : ['stop-transfer-keep-files']
      )

    case ACTION.RESUME:
      if (state.phase !== 'paused') return invalid(action, state)
      return result(
        { phase: 'downloading', storage: 'persistent', playing: false },
        ['start-persistent-transfer']
      )

    case ACTION.MARK_COMPLETE:
      if (state.phase !== 'downloading') return invalid(action, state)
      return result({ phase: 'complete', storage: 'persistent', playing: state.playing })

    case ACTION.FAIL:
      return result({ ...state, phase: 'error', playing: false }, ['close-player'])

    case ACTION.REMOVE:
      return result(
        { phase: 'removed', storage: 'none', playing: false },
        state.storage === 'ephemeral'
          ? ['stop-transfer', 'purge-cache', 'remove-record']
          : ['stop-transfer-keep-files', 'remove-record']
      )

    default:
      throw new Error(`Unknown task action: ${String(action)}`)
  }
}
