import { terminalManager } from '../terminal-manager-singleton'
import { broadcastFlowEvent } from '../track-flow-ws'
import type { Injector } from '../track-flow/llm-dispatcher'

export function deriveInjector(projectId: string): Injector {
  return (text: string) => {
    terminalManager.writeRaw(projectId, text)
  }
}

export function deriveBroadcast(
  projectId: string,
): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    broadcastFlowEvent(projectId, event, payload)
  }
}
