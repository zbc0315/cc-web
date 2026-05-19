// frontend/src/components/tracks/flow/TracksLeftPanelContent.tsx
//
// v-k 起工作轨入口嵌入左侧边栏 tab。包含：
//   1. 非运行态：列表 + 新建按钮，点击行 / ▶ 运行 → callback 让 ProjectPage 弹编辑 Dialog
//   2. 运行中：FlowMinimapCard embedded 模式实时显示节点状态
//
// 数据流：listFlows API 拉列表；ccweb:flow-msg lifecycle 事件 derive 运行状态
// + 拉 .flow + getRunState 渲染 minimap（逻辑沿用之前 ProjectPage 的 minimapState）。
//
// v-m：原生 button + window.prompt/confirm/alert 全换 shadcn Button / Dialog / useConfirm /
// toast；emoji 🕸️ 换 lucide Workflow；色彩用语义 token。
import { useState, useEffect, useCallback } from 'react'
import { TrainTrack, Workflow, Plus, Play, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useConfirm } from '@/components/ConfirmProvider'
import { listFlows, deleteFlow, saveFlow as apiSaveFlow, getFlow, getRunState,
  type FlowFileInfo } from '../api'
import { emptyFlow, type FlowV3 } from './flow-types-v3'
import { deriveTrainJsonFromVariables, decodeFlow } from './flow-sidecar-io'
import { FlowMinimapCard } from './FlowMinimapCard'
import type { NodeRuntimeState } from './useFlowRun'

interface Props {
  projectId: string
  /** 点击列表行 / 编辑按钮 → ProjectPage 弹编辑 Dialog（仅编辑，不运行） */
  onOpenEditor: (filename: string) => void
}

type MinimapState = {
  flow: FlowV3 | null
  runId: string
  basename: string
  currentNodeId: string | null
  nodeStates: Map<string, NodeRuntimeState>
  status: 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
}

const NAME_RE = /^[a-zA-Z0-9_一-鿿぀-ヿㇰ-ㇿ-]+$/

export function TracksLeftPanelContent({ projectId, onOpenEditor }: Props) {
  const confirm = useConfirm()
  const [files, setFiles] = useState<FlowFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [minimap, setMinimap] = useState<MinimapState | null>(null)

  // 新建工作轨 Dialog
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState<string | null>(null)

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

  const submitCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) { setNewError('工作轨名不能为空'); return }
    if (!NAME_RE.test(trimmed)) {
      setNewError('名字只允许字母/数字/下划线/中文/连字符')
      return
    }
    if (files.some((f) => f.filename === `${trimmed}.flow`)) {
      setNewError(`工作轨 "${trimmed}" 已存在，请用不同名字`)
      return
    }
    setCreating(true)
    setNewError(null)
    try {
      const flow = emptyFlow(trimmed)
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, `${trimmed}.flow`, flow, trainJson, { createOnly: true })
      await reload()
      setNewOpen(false)
      setNewName('')
      onOpenEditor(`${trimmed}.flow`)
    } catch (e) {
      const err = e as Error & { detail?: { code?: string } }
      if (err.detail?.code === 'FLOW_FILE_EXISTS') {
        setNewError(`工作轨 "${trimmed}" 已存在（backend 二道闸拦截）`)
      } else {
        setNewError(err.message)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ok = await confirm({
      description: `删除 ${filename}？`,
      confirmLabel: '删除',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteFlow(projectId, filename)
      await reload()
    } catch (e2) {
      const err = e2 as Error & { detail?: { code?: string } }
      if (err.detail?.code === 'FLOW_RUN_ACTIVE') {
        toast.error(`${filename} 正在运行，请先取消运行再删除`)
      } else {
        toast.error(err.message)
      }
    }
  }

  // 运行中：显示 minimap 替换列表
  if (minimap && minimap.flow) {
    return (
      <div className="h-full flex flex-col p-2 gap-2 overflow-y-auto bg-background">
        <div className="text-xs text-muted-foreground px-1 flex items-center gap-1">
          <TrainTrack className="h-3 w-3" />
          运行中
        </div>
        <FlowMinimapCard
          flow={minimap.flow}
          nodeStates={minimap.nodeStates}
          currentNodeId={minimap.currentNodeId}
          status={minimap.status}
          embedded
        />
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => onOpenEditor(`${minimap.basename}.flow`)}
          className="h-7 justify-start px-1 text-xs"
        >
          打开编辑页查看详情 →
        </Button>
      </div>
    )
  }

  // 非运行：列表 UI
  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border">
        <TrainTrack className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="text-xs font-medium flex-1 text-foreground">工作轨</div>
        <Button
          type="button"
          size="sm"
          onClick={() => { setNewName(''); setNewError(null); setNewOpen(true) }}
          disabled={creating}
          className="h-6 px-2 text-xs"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : (
            <>
              <Plus className="h-3 w-3 mr-0.5" />
              新建
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {loading && <div className="text-xs text-muted-foreground p-2">加载中…</div>}
        {error && <div className="text-xs text-destructive p-2">错误：{error}</div>}
        {!loading && !error && files.length === 0 && (
          <div className="text-xs text-muted-foreground p-2 text-center">
            暂无工作轨。
          </div>
        )}
        {files.map((f) => (
          <div
            key={f.filename}
            className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-accent cursor-pointer text-xs group"
            onClick={() => onOpenEditor(f.filename)}
            title={`${(f.size / 1024).toFixed(1)} KB · ${new Date(f.mtimeMs).toLocaleString()}`}
          >
            <Workflow className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="flex-1 font-mono truncate text-foreground">
              {f.filename.replace(/\.flow$/, '')}
            </span>
            <Button
              type="button"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                // v-l：dispatch CustomEvent 让 ProjectPage 顶层启动 run（不弹编辑器 Dialog）
                window.dispatchEvent(new CustomEvent('ccweb:flow-run-request', {
                  detail: { filename: f.filename },
                }))
              }}
              title="直接运行（不打开编辑器）"
              className="h-5 w-5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Play className="h-2.5 w-2.5 fill-current" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e) => void handleDelete(f.filename, e)}
              title="删除"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={newOpen} onOpenChange={(o) => { if (!o) setNewOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建工作轨</DialogTitle>
            <DialogDescription>
              工作轨文件名（不含 .flow 后缀），只允许字母/数字/下划线/中文/连字符。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-flow-name" className="text-xs text-muted-foreground">
              文件名
            </Label>
            <Input
              id="new-flow-name"
              autoFocus
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setNewError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitCreate() } }}
              placeholder="例：search-and-summarize"
              className="font-mono"
            />
            {newError && (
              <div className="text-xs text-destructive">{newError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button size="sm" onClick={() => void submitCreate()} disabled={creating}>
              {creating ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
