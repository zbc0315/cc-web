// frontend/src/components/tracks/flow/useFlowRun.ts
import { useState, useEffect, useRef, useCallback } from 'react'

export type NodeRuntimeState = 'idle' | 'active' | 'completed' | 'failed' | 'skipped'

export interface FlowRunState {
  runId: string | null
  status: 'idle' | 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  nodeStates: Map<string, NodeRuntimeState>
  vars: Record<string, unknown>
  error: string | null
  currentNodeId: string | null
  pendingUserInput: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] } | null
  quota: { iterRemaining?: number; llmCallsRemaining: number; durationRemainingMs: number } | null
}

const initialState: FlowRunState = {
  runId: null,
  status: 'idle',
  nodeStates: new Map(),
  vars: {},
  error: null,
  currentNodeId: null,
  pendingUserInput: null,
  quota: null,
}

interface Props {
  projectId: string
  /** 项目级 WS 单例（由 ProjectPage 提供） */
  projectWs: WebSocket | null
}

export function useFlowRun({ projectWs }: Props) {
  const [state, setState] = useState<FlowRunState>(initialState)
  const runIdRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    runIdRef.current = null
    setState(initialState)
  }, [])

  const attachRunId = useCallback((runId: string) => {
    runIdRef.current = runId
    setState((s) => ({ ...s, runId, status: 'running', nodeStates: new Map(), vars: {}, error: null }))
  }, [])

  useEffect(() => {
    if (!projectWs) return
    const onMessage = (ev: MessageEvent) => {
      let msg: { type?: string; runId?: string; [k: string]: unknown }
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      } catch {
        return
      }
      if (!msg.type?.startsWith('flow_')) return
      if (runIdRef.current && msg.runId && msg.runId !== runIdRef.current) return  // 别的 run 事件忽略

      setState((s) => applyEvent(s, msg))
    }
    projectWs.addEventListener('message', onMessage)
    return () => projectWs.removeEventListener('message', onMessage)
  }, [projectWs])

  return { state, attachRunId, reset }
}

function applyEvent(s: FlowRunState, msg: { type?: string; [k: string]: unknown }): FlowRunState {
  const type = msg.type
  if (type === 'flow_started') {
    return { ...s, status: 'running', vars: (msg.initialVars as Record<string, unknown>) ?? {} }
  }
  if (type === 'flow_node_active') {
    const newStates = new Map(s.nodeStates)
    newStates.set(msg.nodeId as string, 'active')
    return {
      ...s,
      currentNodeId: msg.nodeId as string,
      nodeStates: newStates,
      quota: (msg.quota as FlowRunState['quota']) ?? s.quota,
    }
  }
  if (type === 'flow_node_completed') {
    const newStates = new Map(s.nodeStates)
    newStates.set(msg.nodeId as string, 'completed')
    return { ...s, nodeStates: newStates }
  }
  if (type === 'flow_node_failed') {
    const newStates = new Map(s.nodeStates)
    if (msg.nodeId) newStates.set(msg.nodeId as string, 'failed')
    return { ...s, status: 'failed', nodeStates: newStates, error: (msg.reason as string) ?? null }
  }
  if (type === 'flow_var_changed') {
    return { ...s, vars: { ...s.vars, [msg.key as string]: msg.value } }
  }
  if (type === 'flow_user_input_required') {
    return {
      ...s,
      status: 'waiting_user_input',
      pendingUserInput: {
        nodeId: msg.nodeId as string,
        fields: msg.fields as { varKey: string; uiHint?: string; variants?: string[] }[],
      },
    }
  }
  if (type === 'flow_done') {
    return { ...s, status: 'completed', currentNodeId: null }
  }
  if (type === 'flow_cancelled') {
    return { ...s, status: 'cancelled' }
  }
  if (type === 'flow_error') {
    return { ...s, status: 'failed', error: (msg.message as string) ?? 'unknown' }
  }
  return s
}
