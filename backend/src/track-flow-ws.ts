type BroadcastFn = (projectId: string, msg: Record<string, unknown>) => void

let _broadcast: BroadcastFn | null = null

export function setBroadcast(fn: BroadcastFn): void {
  _broadcast = fn
}

export function broadcastFlowEvent(
  projectId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!_broadcast) return
  _broadcast(projectId, { type: event, ...payload })
}
