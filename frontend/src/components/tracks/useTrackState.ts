import { useCallback, useEffect, useRef, useState } from 'react'
import { getTrackState } from './api'
import type {
  TrackRunState,
  AskUserRequest,
  WsTrackMessage,
  WsTrackAskUser,
  WsTrackStatusChange,
  WsTrackRunComplete,
} from './types'

// Polling is now a fallback — WS push events (track_status_change /
// track_ask_user / track_run_complete) arrive via the
// `ccweb:track-msg` window CustomEvent dispatched by websocket.ts.
// Polling intervals are far-back to catch WS gaps without flooding.
const POLL_MS_ACTIVE = 5_000
const POLL_MS_IDLE = 30_000

interface UseTrackState {
  state: TrackRunState | null
  running: boolean
  pendingAskUser: AskUserRequest | null
  refresh: () => void
}

/**
 * Polls /api/projects/:id/tracks/state on a 2s interval. Stops on unmount.
 * Pauses while the document is hidden. Race-safe across projectId changes.
 *
 * T2 uses polling for simplicity. T3 (or when WS UX requires sub-second
 * latency) will subscribe to track_status_change / track_ask_user
 * messages through the existing useProjectWebSocket hook and merge those
 * into local state, removing the poll.
 */
export function useTrackState(projectId: string | null): UseTrackState {
  const [state, setState] = useState<TrackRunState | null>(null)
  const [running, setRunning] = useState(false)
  const [pendingAskUser, setPendingAskUser] = useState<AskUserRequest | null>(
    null,
  )
  const pidRef = useRef(projectId)
  pidRef.current = projectId

  const fetchOnce = useCallback(async () => {
    const pid = pidRef.current
    if (!pid) return
    try {
      const r = await getTrackState(pid)
      if (pid !== pidRef.current) return
      setState(r.state)
      setRunning(r.running)
      setPendingAskUser(r.pendingAskUser)
    } catch {
      /* keep last known state */
    }
  }, [])

  // Track current poll interval so we can adapt on activity transitions.
  const currentIntervalRef = useRef<number>(POLL_MS_ACTIVE)
  const hasActivity = !!state || running || !!pendingAskUser

  // ── WS push subscription (T3) ──────────────────────────────────────────
  //
  // Listen for `ccweb:track-msg` CustomEvents dispatched by
  // websocket.ts when the server pushes track_status_change /
  // track_ask_user / track_run_complete. Merging these into local
  // state turns the 2s-polling experience into sub-second.
  useEffect(() => {
    if (!projectId) return
    const onMessage = (ev: Event) => {
      const detail = (ev as CustomEvent<unknown>).detail as WsTrackMessage | undefined
      if (!detail || !detail.type) return
      switch (detail.type) {
        case 'track_status_change': {
          const m = detail as WsTrackStatusChange
          setState(m.state)
          setRunning(
            m.state.status === 'running' || m.state.status === 'paused',
          )
          break
        }
        case 'track_ask_user': {
          const m = detail as WsTrackAskUser
          setPendingAskUser({
            runId: m.runId,
            requestId: m.requestId,
            fields: m.fields,
          })
          break
        }
        case 'track_run_complete': {
          // Defer the actual state shape to the next poll — server
          // also emits track_status_change for the terminal state.
          // Clear any pending ask_user as a safety net.
          const m = detail as WsTrackRunComplete
          if (!m.ok) setPendingAskUser(null)
          break
        }
      }
    }
    window.addEventListener('ccweb:track-msg', onMessage)
    return () => window.removeEventListener('ccweb:track-msg', onMessage)
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setState(null)
      setRunning(false)
      setPendingAskUser(null)
      return
    }
    let timer: ReturnType<typeof setInterval> | null = null

    // Adaptive backoff: when there's no active track, poll at 10s instead
    // of 2s. A track first arrives via either (a) the user opening the
    // TracksListDialog and clicking Run (which calls refresh() immediately)
    // or (b) a slow-poll tick catching it. (b) at most adds 10s latency,
    // acceptable for the idle case. As soon as state becomes non-null we
    // switch to 2s in the same render via the dep-array.
    const intervalMs = hasActivity ? POLL_MS_ACTIVE : POLL_MS_IDLE
    currentIntervalRef.current = intervalMs

    const start = () => {
      void fetchOnce()
      timer = setInterval(() => {
        void fetchOnce()
      }, intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else if (!timer) start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [projectId, fetchOnce, hasActivity])

  return { state, running, pendingAskUser, refresh: fetchOnce }
}
