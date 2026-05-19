// frontend/src/components/tracks/flow/TracksLeftPanelContent.tsx
//
// v-k 起工作轨入口嵌入左侧边栏 tab。包含：
//   1. 非运行态：列表 + 新建按钮，点击行 / ▶ 运行 → callback 让 ProjectPage 弹编辑 Dialog
//   2. 运行中：FlowMinimapCard embedded 模式实时显示节点状态
//
// 数据流：listFlows API 拉列表；ccweb:flow-msg lifecycle 事件 derive 运行状态
// + 拉 .flow + getRunState 渲染 minimap（逻辑沿用之前 ProjectPage 的 minimapState）。
import { useState, useEffect, useCallback } from 'react'
import { TrainTrack } from 'lucide-react'
import { listFlows, deleteFlow, saveFlow as apiSaveFlow, getFlow, getRunState,
  type FlowFileInfo } from '../api'
import { emptyFlow, type FlowV3 } from './flow-types-v3'
import { deriveTrainJsonFromVariables, decodeFlow } from './flow-sidecar-io'
import { FlowMinimapCard } from './FlowMinimapCard'
import type { NodeRuntimeState } from './useFlowRun'

interface Props {
  projectId: string
  /** 用户在列表里点击某条 flow（或 ▶）时回调，由 ProjectPage 弹编辑 Dialog */
  onOpenEditor: (filename: string, autoRun?: boolean) => void
}

type MinimapState = {
  flow: FlowV3 | null
  runId: string
  basename: string
  currentNodeId: string | null
  nodeStates: Map<string, NodeRuntimeState>
  status: 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
}

export function TracksLeftPanelContent({ projectId, onOpenEditor }: Props) {
  const [files, setFiles] = useState<FlowFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [minimap, setMinimap] = useState<MinimapState | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listFlows(projectId)
      setFiles(res.files)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void reload() }, [reload])

  // v-k 顺修：编辑 Dialog 关闭后 reload，确保 mtime/size 刷新；未来加 rename 也覆盖
  useEffect(() => {
    const onClosed = () => void reload()
    window.addEventListener('ccweb:track-editor-closed', onClosed)
    return () => window.removeEventListener('ccweb:track-editor-closed', onClosed)
  }, [reload])

  // 监听 flow lifecycle 事件维护 minimap（逻辑与 ProjectPage 之前的实现等价）
  useEffect(() => {
    let latestRunId: string | null = null
    let clearTimer: ReturnType<typeof setTimeout> | null = null
    const cancelClear = () => { if (clearTimer) { clearTimeout(clearTimer); clearTimer = null } }

    const onMsg = (ev: Event) => {
      const msg = (ev as CustomEvent<{
        type?: string; runId?: string; basename?: string; nodeId?: string;
      }>).detail
      if (!msg?.type) return
      if (msg.type.startsWith('flow_') && !msg.runId) return

      if (msg.type === 'flow_started' && msg.basename && msg.runId) {
        cancelClear()
        latestRunId = msg.runId
        const runId = msg.runId
        const basename = msg.basename
        setMinimap({
          flow: null, runId, basename,
          currentNodeId: null, nodeStates: new Map(), status: 'running',
        })
        void (async () => {
          try {
            const [flowRes, stateRes] = await Promise.all([
              getFlow(projectId, `${basename}.flow`),
              getRunState(projectId, runId),
            ])
            if (latestRunId !== runId) return  // 新 run 已替换
            const decoded = decodeFlow(flowRes.flow)
            if (!decoded.ok || !decoded.flow) return
            setMinimap((prev) => {
              if (!prev || prev.runId !== runId) return prev
              const merged = new Map<string, NodeRuntimeState>(
                Object.entries(stateRes.nodeStates) as [string, NodeRuntimeState][],
              )
              for (const [k, v] of prev.nodeStates) merged.set(k, v)
              return {
                ...prev,
                flow: decoded.flow!,
                currentNodeId: prev.currentNodeId ?? stateRes.currentNodeId,
                nodeStates: merged,
              }
            })
          } catch {/* swallow */}
        })()
        return
      }

      setMinimap((prev) => {
        if (!prev) return prev
        if (msg.runId !== prev.runId) return prev
        if (msg.type === 'flow_node_active' && msg.nodeId) {
          const ns = new Map(prev.nodeStates); ns.set(msg.nodeId, 'active')
          return { ...prev, nodeStates: ns, currentNodeId: msg.nodeId, status: 'running' }
        }
        if (msg.type === 'flow_node_completed' && msg.nodeId) {
          const ns = new Map(prev.nodeStates); ns.set(msg.nodeId, 'completed')
          return { ...prev, nodeStates: ns }
        }
        if (msg.type === 'flow_node_failed' && msg.nodeId) {
          const ns = new Map(prev.nodeStates); ns.set(msg.nodeId, 'failed')
          return { ...prev, nodeStates: ns, status: 'failed', currentNodeId: null }
        }
        if (msg.type === 'flow_user_input_required') return { ...prev, status: 'waiting_user_input' }
        if (msg.type === 'flow_done') return { ...prev, status: 'completed', currentNodeId: null }
        if (msg.type === 'flow_cancelled') return { ...prev, status: 'cancelled', currentNodeId: null }
        return prev
      })

      if (msg.type === 'flow_done' || msg.type === 'flow_cancelled' ||
          msg.type === 'flow_error' || msg.type === 'flow_node_failed') {
        const terminalRunId = msg.runId
        cancelClear()
        clearTimer = setTimeout(() => {
          setMinimap((prev) => prev && prev.runId === terminalRunId ? null : prev)
          clearTimer = null
        }, 3000)
      }
    }
    window.addEventListener('ccweb:flow-msg', onMsg)
    return () => {
      window.removeEventListener('ccweb:flow-msg', onMsg)
      cancelClear()
    }
  }, [projectId])

  const handleCreate = async () => {
    const name = window.prompt('工作轨名（filename，不含 .flow 后缀）:')
    if (!name) return
    const trimmed = name.trim()
    if (!/^[a-zA-Z0-9_一-鿿぀-ヿㇰ-ㇿ-]+$/.test(trimmed)) {
      alert('名字只允许字母/数字/下划线/中文/连字符')
      return
    }
    if (files.some((f) => f.filename === `${trimmed}.flow`)) {
      alert(`工作轨 "${trimmed}" 已存在，请用不同名字`)
      return
    }
    setCreating(true)
    try {
      const flow = emptyFlow(trimmed)
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, `${trimmed}.flow`, flow, trainJson, { createOnly: true })
      await reload()
      onOpenEditor(`${trimmed}.flow`)
    } catch (e) {
      const err = e as Error & { detail?: { code?: string } }
      if (err.detail?.code === 'FLOW_FILE_EXISTS') {
        alert(`工作轨 "${trimmed}" 已存在（backend 二道闸拦截）`)
      } else {
        alert(err.message)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(`删除 ${filename}？`)) return
    try {
      await deleteFlow(projectId, filename)
      await reload()
    } catch (e2) {
      const err = e2 as Error & { detail?: { code?: string } }
      if (err.detail?.code === 'FLOW_RUN_ACTIVE') {
        alert(`${filename} 正在运行，请先取消运行再删除`)
      } else {
        alert(err.message)
      }
    }
  }

  // 运行中：显示 minimap 替换列表
  if (minimap && minimap.flow) {
    return (
      <div className="h-full flex flex-col p-2 gap-2 overflow-y-auto">
        <div className="text-xs text-muted-foreground px-1">
          <TrainTrack className="inline-block h-3 w-3 mr-1" />
          运行中
        </div>
        <FlowMinimapCard
          flow={minimap.flow}
          nodeStates={minimap.nodeStates}
          currentNodeId={minimap.currentNodeId}
          status={minimap.status}
          embedded
        />
        <button
          type="button"
          onClick={() => onOpenEditor(`${minimap.basename}.flow`)}
          className="text-xs text-blue-600 hover:underline px-1"
        >
          打开编辑页查看详情 →
        </button>
      </div>
    )
  }

  // 非运行：列表 UI
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border">
        <TrainTrack className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="text-xs font-medium flex-1">工作轨</div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? '…' : '+ 新建'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {loading && <div className="text-xs text-muted-foreground p-2">加载中…</div>}
        {error && <div className="text-xs text-red-600 p-2">错误：{error}</div>}
        {!loading && !error && files.length === 0 && (
          <div className="text-xs text-muted-foreground p-2 text-center">
            暂无工作轨。
          </div>
        )}
        {files.map((f) => (
          <div
            key={f.filename}
            className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-accent cursor-pointer text-xs"
            onClick={() => onOpenEditor(f.filename)}
            title={`${(f.size / 1024).toFixed(1)} KB · ${new Date(f.mtimeMs).toLocaleString()}`}
          >
            <span>🕸️</span>
            <span className="flex-1 font-mono truncate">{f.filename.replace(/\.flow$/, '')}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenEditor(f.filename, true)
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700"
              title="直接运行"
            >▶</button>
            <button
              type="button"
              onClick={(e) => void handleDelete(f.filename, e)}
              className="text-[10px] text-red-500 hover:text-red-700 px-1"
              title="删除"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  )
}
