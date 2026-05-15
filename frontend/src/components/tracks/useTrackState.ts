import { useCallback, useEffect, useRef, useState } from 'react'
import { getTrackState } from './api'
import type { TrackRunState, AskUserRequest } from './types'

const POLL_MS_ACTIVE = 2000
const POLL_MS_IDLE = 10_000

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
