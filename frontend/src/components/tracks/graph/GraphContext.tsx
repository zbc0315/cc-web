// frontend/src/components/tracks/graph/GraphContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Action } from './reducer-v2'

interface GraphCtx {
  dispatch: (a: Action) => void
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
