// frontend/src/components/tracks/flow/GraphContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Action } from './flow-reducer'
import type { NodeRuntimeState } from './useFlowRun'

interface GraphCtx {
  dispatch: (a: Action) => void
  nodeStates?: Map<string, NodeRuntimeState>  // 可选 — 编辑期是 undefined
}

const Ctx = createContext<GraphCtx | null>(null)

export function GraphProvider({ value, children }: { value: GraphCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGraphDispatch() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useGraphDispatch outside GraphProvider')
  return c.dispatch
}

export function useNodeRuntimeState(nodeId: string): NodeRuntimeState | null {
  const c = useContext(Ctx)
  if (!c?.nodeStates) return null
  return c.nodeStates.get(nodeId) ?? null
}
