// frontend/src/components/tracks/flow/TrackFlowEditor.tsx
import { useEffect, useReducer, useRef, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Button } from '@/components/ui/button'
import { reducer, initialFlow } from './flow-reducer'
import { GraphProvider } from './GraphContext'
import { FlowCanvas } from './FlowCanvas'
import { FlowToolbar } from './FlowToolbar'
import { NodePalette } from './NodePalette'
import { VariablesPanel } from './VariablesPanel'
import { NodeInspector } from './NodeInspector'
import { FlowRunPanel } from './FlowRunPanel'
import type { FlowRunState, NodeRuntimeState } from './useFlowRun'
import { decodeFlow, crossCheckTrainJson } from './flow-sidecar-io'
import { getFlow } from '../api'

interface Props {
  projectId: string
  filename: string                      // 'foo.flow'
  isNew: boolean
  /** v-l：顶层 ProjectPage 的 useFlowRun state（仅当 filename === 顶层 runningFlow.filename
   *  时传真实值；编辑别的 flow 时传 null = 编辑器内显示 idle，不串台显示别的 run 状态）。 */
  runState?: FlowRunState | null
  onClose: () => void
  /** v-m：dirty 状态实时上报给父（TrackEditorDialog），父在外侧 onOpenChange / onEscape /
   *  onPointerDownOutside 同步检查 + 异步弹 confirm 拦截关闭。原本 handleClose 内部 await confirm
   *  无法拦截 Radix 的同步关闭路径（codex P0）。 */
  onDirtyChange?: (dirty: boolean) => void
}

const IDLE_RUN_STATE: FlowRunState = {
  runId: null, status: 'idle',
  nodeStates: new Map<string, NodeRuntimeState>(),
  vars: {}, error: null, currentNodeId: null, pendingUserInput: null, quota: null,
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'desync'; message: string }

export function TrackFlowEditor({ projectId, filename, isNew, runState: runStateProp, onClose, onDirtyChange }: Props) {
  const [flow, dispatch] = useReducer(reducer, initialFlow(filename.replace(/\.flow$/, '')))
  const [loadState, setLoadState] = useState<LoadState>(
    isNew ? { kind: 'ready' } : { kind: 'loading' },
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // v-l：编辑器不再 new useFlowRun。runState 来自顶层 ProjectPage 透传，确保编辑器
  // 内 FlowToolbar 状态 / 节点边框 / FlowRunPanel 与顶层 minimap 一致。filename 不匹配
  // 顶层 runningFlow 时传 null（= idle，不串台显示别的 run）。
  const runState = runStateProp ?? IDLE_RUN_STATE

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

  // v-h dirty 假阳性 fix：原版 useEffect [flow] 看到加载完 dispatch(replace) 触发
  // 的 flow 变化也 setDirty(true)，导致刚加载完按钮就显示"未保存"。用 ref 跟踪
  // "首次 [flow] effect"（即从 initialFlow → replace 后的 loaded flow），跳过这一帧；
  // 第二次起才记 dirty（=真正的用户编辑）。
  const dirtyArmedRef = useRef(false)
  useEffect(() => {
    if (!dirtyArmedRef.current) {
      dirtyArmedRef.current = true
      return
    }
    if (loadState.kind === 'ready' || loadState.kind === 'desync') setDirty(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  // v-l：autoRun 路径删除。运行入口统一为 dispatch ccweb:flow-run-request CustomEvent
  // 让 ProjectPage 顶层处理。编辑器关闭不触碰运行（顶层管 run 生命周期）。
  // v-m：dirty 上报给 TrackEditorDialog；那里同步拦截 onOpenChange/Esc/Outside/X，
  // 异步弹 useConfirm（Radix 无法等待 async return false 的 onOpenChange，所以确认
  // 流程必须在父层用 e.preventDefault() + await confirm + 主动 onClose 实现）。
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const handleClose = () => onClose()

  if (loadState.kind === 'loading') {
    return (
      <div className="flex items-center justify-center h-full bg-background text-muted-foreground">
        加载中…
      </div>
    )
  }
  const isRunningView = runState.status === 'running' || runState.status === 'waiting_user_input'

  if (loadState.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-destructive gap-2 max-w-md mx-auto p-6">
        <div className="font-medium">加载失败</div>
        <div className="text-sm">{loadState.message}</div>
        <Button onClick={onClose} variant="outline" size="sm" className="mt-2">关闭</Button>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <GraphProvider value={{ dispatch, nodeStates: runState.nodeStates }}>
        <div className="flex flex-col h-full bg-background text-foreground">
          <FlowToolbar
            flow={flow}
            projectId={projectId}
            filename={filename}
            dirty={dirty}
            runStatus={runState.status}
            onSaved={() => setDirty(false)}
            onClose={handleClose}
          />
          {loadState.kind === 'desync' && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 px-3 py-1 text-xs text-amber-800 dark:text-amber-200">
              ⚠ {loadState.message}（保存时将以当前 variables 重新派生 train.json）
            </div>
          )}
          <div className="flex-1 flex overflow-hidden">
            {/* 运行 / 等待用户输入时收起 3 个编辑面板，给 Canvas 满屏看节点状态变化。
                变量值实时在 FlowRunPanel 里展示，不会丢信息。idle/completed/failed/
                cancelled 时仍显示编辑面板，方便用户复盘并修改。 */}
            {!isRunningView && <NodePalette />}
            {!isRunningView && <VariablesPanel flow={flow} />}
            <FlowCanvas
              flow={flow}
              dispatch={dispatch}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
            {!isRunningView && <NodeInspector flow={flow} selectedNodeId={selectedNodeId} />}
          </div>
          <FlowRunPanel flow={flow} run={runState} />
        </div>
      </GraphProvider>

      {/* v-l：FlowUserInputDialog 已提到 ProjectPage 顶层渲染（不依赖编辑器 mount） */}
    </ReactFlowProvider>
  )
}
