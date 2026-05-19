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

  // v-h：attach existing run（409 attach、WS 重连）后从 backend 拉真实状态填充
  // useFlowRun，否则前端 nodeStates/vars/currentNodeId 全空，用户看不到运行进度。
  const hydrateFromBackend = useCallback((data: {
    runId: string
    status: FlowRunState['status']
    snapshot: Record<string, unknown>
    currentNodeId: string | null
    nodeStates: Record<string, 'active' | 'completed' | 'failed' | 'skipped'>
    pendingUserInput?: { nodeId: string; fields: { varKey: string; uiHint?: string; variants?: string[] }[] }
    error?: { nodeId?: string; message: string }
    quota?: FlowRunState['quota']
  }) => {
    runIdRef.current = data.runId
    setState({
      runId: data.runId,
      status: data.status,
      nodeStates: new Map(Object.entries(data.nodeStates)) as Map<string, NodeRuntimeState>,
      vars: data.snapshot,
      error: data.error?.message ?? null,
      currentNodeId: data.currentNodeId,
      pendingUserInput: data.pendingUserInput ?? null,
      quota: data.quota ?? null,
    })
  }, [])

  useEffect(() => {
    const onMessage = (ev: Event) => {
      const msg = (ev as CustomEvent<unknown>).detail as { type?: string; runId?: string; [k: string]: unknown } | undefined
      if (!msg?.type) return
      if (!msg.type.startsWith('flow_')) return
      // 未 attach 任何 run（mount 初次 / resetRun 之后）时忽略所有 flow_* 事件，
      // 避免把别人的 run 或旧 run 的事件（包括 reset 后晚到的 flow_cancelled）
      // 误并入 state。attach 后才放行；attach 前 backend 已 emit 的 flow_started
      // 等首帧事件被丢，但 attachRunId 自己已经把 status 设为 'running'，无信息丢失。
      if (!runIdRef.current) return
      if (msg.runId && msg.runId !== runIdRef.current) return  // 别的 run 事件忽略

      setState((s) => applyEvent(s, msg))
    }
    window.addEventListener('ccweb:flow-msg', onMessage)
    return () => window.removeEventListener('ccweb:flow-msg', onMessage)
  }, [])

  return { state, attachRunId, reset, hydrateFromBackend }
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
    // 用户输入节点 completed 表示用户已提交、runtime 已 resolve promise 进入下一节点。
    // backend 不专门 emit "input received"，靠这里 nodeId 比对清掉前端 dialog 状态。
    const pendingCleared = s.pendingUserInput?.nodeId === msg.nodeId
    return {
      ...s,
      nodeStates: newStates,
      pendingUserInput: pendingCleared ? null : s.pendingUserInput,
      status: pendingCleared && s.status === 'waiting_user_input' ? 'running' : s.status,
    }
  }
  if (type === 'flow_node_failed') {
    const newStates = new Map(s.nodeStates)
    if (msg.nodeId) newStates.set(msg.nodeId as string, 'failed')
    // codex P2：终态强制清 pendingUserInput，避免 cancel/fail 在 waiting_user_input
    // 时残留 dialog 让用户点提交打到后端
    return { ...s, status: 'failed', nodeStates: newStates, error: (msg.reason as string) ?? null, pendingUserInput: null }
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
    return { ...s, status: 'completed', currentNodeId: null, pendingUserInput: null }
  }
  if (type === 'flow_cancelled') {
    return { ...s, status: 'cancelled', pendingUserInput: null }
  }
  if (type === 'flow_error') {
    return { ...s, status: 'failed', error: (msg.message as string) ?? 'unknown', pendingUserInput: null }
  }
  return s
}
