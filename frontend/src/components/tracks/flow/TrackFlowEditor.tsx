// frontend/src/components/tracks/flow/TrackFlowEditor.tsx
import { useEffect, useReducer, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { reducer, initialFlow } from './flow-reducer'
import { GraphProvider } from './GraphContext'
import { FlowCanvas } from './FlowCanvas'
import { FlowToolbar } from './FlowToolbar'
import { NodePalette } from './NodePalette'
import { VariablesPanel } from './VariablesPanel'
import { NodeInspector } from './NodeInspector'
import { FlowRunPanel } from './FlowRunPanel'
import { FlowUserInputDialog } from './FlowUserInputDialog'
import { useFlowRun } from './useFlowRun'
import { decodeFlow, crossCheckTrainJson } from './flow-sidecar-io'
import { getFlow, cancelFlow, submitUserInput } from '../api'

interface Props {
  projectId: string
  filename: string                      // 'foo.flow'
  isNew: boolean
  onClose: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'desync'; message: string }

export function TrackFlowEditor({ projectId, filename, isNew, onClose }: Props) {
  const [flow, dispatch] = useReducer(reducer, initialFlow(filename.replace(/\.flow$/, '')))
  const [loadState, setLoadState] = useState<LoadState>(
    isNew ? { kind: 'ready' } : { kind: 'loading' },
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const { state: runState, attachRunId, reset: resetRun } = useFlowRun()

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getFlow(projectId, filename)
        if (cancelled) return
        const decoded = decodeFlow(res.flow)
        if (!decoded.ok || !decoded.flow) {
          setLoadState({ kind: 'error', message: `flow 解析失败：${decoded.reason}` })
          return
        }
        const cc = res.trainJson
          ? crossCheckTrainJson(decoded.flow, res.trainJson)
          : { ok: true, missingKeys: [], extraKeys: [] }
        if (!cc.ok) {
          setLoadState({
            kind: 'desync',
            message: `train.json 与 variables 失同步（缺 ${cc.missingKeys.length} / 多 ${cc.extraKeys.length}）`,
          })
          // M1 不阻止，仅警告
        }
        dispatch({ type: 'replace', flow: decoded.flow })
        if (cc.ok) setLoadState({ kind: 'ready' })
      } catch (e) {
        if (!cancelled) setLoadState({ kind: 'error', message: (e as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [projectId, filename, isNew])

  useEffect(() => {
    if (loadState.kind === 'ready' || loadState.kind === 'desync') setDirty(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm('未保存的修改将丢失。确认关闭吗？')
      if (!ok) return
    }
    onClose()
  }

  const handleSubmitUserInput = async (values: Record<string, unknown>) => {
    if (!runState.runId) return
    try {
      await submitUserInput(projectId, filename, runState.runId, values)
    } catch (e) {
      alert(`提交失败：${(e as Error).message}`)
    }
  }

  const handleCancelUserInput = async () => {
    if (!runState.runId) return
    try {
      await cancelFlow(projectId, filename, runState.runId)
    } catch {
      /* WS will emit flow_cancelled */
    }
    resetRun()
  }

  if (loadState.kind === 'loading') {
    return <div className="flex items-center justify-center h-full text-gray-400">加载中…</div>
  }
  if (loadState.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-600 gap-2 max-w-md mx-auto p-6">
        <div className="font-medium">加载失败</div>
        <div className="text-sm">{loadState.message}</div>
        <button onClick={onClose} className="text-sm px-3 py-1 rounded border mt-2">关闭</button>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <GraphProvider value={{ dispatch, nodeStates: runState.nodeStates }}>
        <div className="flex flex-col h-full">
          <FlowToolbar
            flow={flow}
            projectId={projectId}
            filename={filename}
            dirty={dirty}
            runStatus={runState.status}
            onSaved={() => setDirty(false)}
            onClose={handleClose}
            onRunStarted={attachRunId}
            onCancelled={resetRun}
          />
          {loadState.kind === 'desync' && (
            <div className="bg-amber-50 border-b border-amber-200 px-3 py-1 text-xs text-amber-800">
              ⚠ {loadState.message}（保存时将以当前 variables 重新派生 train.json）
            </div>
          )}
          <div className="flex-1 flex overflow-hidden">
            <NodePalette />
            <VariablesPanel flow={flow} />
            <FlowCanvas
              flow={flow}
              dispatch={dispatch}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
            <NodeInspector flow={flow} selectedNodeId={selectedNodeId} />
          </div>
          <FlowRunPanel flow={flow} run={runState} />
        </div>
      </GraphProvider>

      {runState.pendingUserInput && (
        <FlowUserInputDialog
          open
          flow={flow}
          pending={runState.pendingUserInput}
          onSubmit={(values) => void handleSubmitUserInput(values)}
          onCancel={() => void handleCancelUserInput()}
        />
      )}
    </ReactFlowProvider>
  )
}
