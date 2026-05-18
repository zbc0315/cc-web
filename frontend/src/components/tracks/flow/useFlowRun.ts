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

export function useFlowRun() {
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
    const onMessage = (ev: Event) => {
      const msg = (ev as CustomEvent<unknown>).detail as { type?: string; runId?: string; [k: string]: unknown } | undefined
      if (!msg?.type) return
      if (!msg.type.startsWith('flow_')) return
      if (runIdRef.current && msg.runId && msg.runId !== runIdRef.current) return  // 别的 run 事件忽略

      setState((s) => applyEvent(s, msg))
    }
    window.addEventListener('ccweb:flow-msg', onMessage)
    return () => window.removeEventListener('ccweb:flow-msg', onMessage)
  }, [])

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
