import { useEffect, useState, Suspense, lazy } from 'react'
import { Plus, Play, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { useConfirm } from '@/components/ConfirmProvider'
import {
  listTracks,
  getTrack,
  saveTrack,
  deleteTrack,
  runTrack,
  listGlobalTracks,
  getGlobalTrack,
  saveGlobalTrack,
  deleteGlobalTrack,
  type TrackSource,
} from './api'
import type { TrackFileInfo } from './types'
import { detectTrackMode } from './graph/marker-v2'

// Lazy-load TrackGraphEditor (v2 ReactFlow). Keep out of ProjectPage eager chunk.
const TrackGraphEditor = lazy(() =>
  import('./graph/TrackGraphEditor').then((m) => ({ default: m.TrackGraphEditor })),
)

// Lazy-load TrackEditor: pulls in Monaco React wrapper + train-lang
// parser (chevrotain). Initial bundle stays light; cost only when the
// user actually opens an editor.
const TrackEditor = lazy(() =>
  import('./TrackEditor').then((m) => ({ default: m.TrackEditor })),
)

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// IMPORTANT: starter templates must be 0-arg — ccweb's run button posts
// args=[] and there's no UI to provide arguments. If main needs input,
// use __ccweb_ask_user inside the body to collect it interactively.
// Tested end-to-end by verify-starter-templates.ts (parse + run + main
// signature check).

const STARTER_BASIC = `// Starter track — edit and save, then run.
//
// Reference: ~/Obsidian/Base/cc-web/工作流DSL.md (train-lang spec)

fai greet(prompt: prompt) -> message: string maxLen=200 { }

func main() -> any {
  let r = greet("用一句话介绍工作轨这个功能（不超过 50 字）")
  return r.message
}

export main
`

const STARTER_ASK_USER = `// Starter track with __ccweb_ask_user — pauses for user input.
//
// __ccweb_ask_user(spec) blocks until the user submits the dialog.
// Field types: text / number / bool / enum (with variants).

fai analyze(file_path: string, prompt: prompt)
    -> rating: int 0-10, comment: string maxLen=500 {
}

func main() -> any {
  // Collect the file path interactively — ccweb's run button does not
  // pass any CLI args, so any input must come from ask_user.
  let input = __ccweb_ask_user({
    fields: [
      { key: "file_path", label: "要分析的文件路径", type: "text" }
    ]
  })

  let r = analyze(input.file_path, "请对此文件评分 0-10")

  // Pause and ask user to confirm or override the AI rating.
  let review = __ccweb_ask_user({
    fields: [
      { key: "decision", label: "AI 评分: " + r.rating + "，是否接受？", type: "enum", variants: ["accept", "override"] }
    ]
  })

  return { aiRating: r.rating, decision: review.decision, comment: r.comment }
}

export main
`

type CreateMode = 'graph-v2' | 'code-basic' | 'code-ask'

export function TracksListDialog({ projectId, open, onOpenChange }: Props) {
  const confirm = useConfirm()
  const [source, setSource] = useState<TrackSource>('project')
  const [files, setFiles] = useState<TrackFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{
    filename: string
    src: string
    source: TrackSource
    mode: 'code' | 'graph-v2-new' | 'graph-v2-edit' | 'v1-readonly'
    banner?: string
  } | null>(null)
  const [newName, setNewName] = useState('')
  const [createMode, setCreateMode] = useState<CreateMode>('graph-v2')

  const refresh = async (s: TrackSource = source) => {
    setLoading(true)
    try {
      const r =
        s === 'global' ? await listGlobalTracks() : await listTracks(projectId)
      setFiles(r.files)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void refresh(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, source])

  const [modeByFile, setModeByFile] = useState<Record<string, 'graph-v2' | 'node-graph-v1' | 'code'>>({})

  useEffect(() => {
    setNewName('')
    setModeByFile({})
  }, [source])

  useEffect(() => {
    if (!open || files.length === 0) return
    let cancelled = false
    async function detectModes() {
      const queue = files.filter((f) => modeByFile[f.filename] === undefined)
      if (queue.length === 0) return
      const updates: Record<string, 'graph-v2' | 'node-graph-v1' | 'code'> = {}
      const concurrency = 6
      for (let i = 0; i < queue.length; i += concurrency) {
        const batch = queue.slice(i, i + concurrency)
        await Promise.all(
          batch.map(async (f) => {
            try {
              const r =
                source === 'global'
                  ? await getGlobalTrack(f.filename)
                  : await getTrack(projectId, f.filename)
              updates[f.filename] = detectTrackMode(r.source)
            } catch {
              // Silent — leave undefined, no icon shown
            }
          }),
        )
        if (cancelled) return
      }
      if (!cancelled) {
        setModeByFile((prev) => ({ ...prev, ...updates }))
      }
    }
    void detectModes()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, source, projectId, open])

  // Listen for sidecar desync fallback events from TrackGraphEditor
  useEffect(() => {
    const onFallback = (ev: Event) => {
      const detail = (ev as CustomEvent<{ projectId: string; filename: string }>).detail
      if (detail.projectId === projectId) {
        setEditing((prev) =>
          prev?.filename === detail.filename
            ? { ...prev, mode: 'code', banner: 'sidecar 失同步，已切换到代码模式查看' }
            : prev,
        )
      }
    }
    window.addEventListener('ccweb:open-track-as-code', onFallback)
    return () => window.removeEventListener('ccweb:open-track-as-code', onFallback)
  }, [projectId])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) {
      toast.error('请输入工作轨名称')
      return
    }
    const filename = name.endsWith('.tr') ? name : `${name}.tr`
    if (createMode === 'graph-v2') {
      setEditing({ filename, src: '', source, mode: 'graph-v2-new' })
    } else {
      const starter = createMode === 'code-ask' ? STARTER_ASK_USER : STARTER_BASIC
      setEditing({ filename, src: starter, source, mode: 'code' })
    }
    setNewName('')
  }

  const handleEdit = async (filename: string) => {
    try {
      const r =
        source === 'global'
          ? await getGlobalTrack(filename)
          : await getTrack(projectId, filename)
      const trackMode = detectTrackMode(r.source)
      if (trackMode === 'graph-v2') {
        setEditing({ filename, src: r.source, source, mode: 'graph-v2-edit' })
      } else if (trackMode === 'node-graph-v1') {
        setEditing({ filename, src: r.source, source, mode: 'v1-readonly' })
      } else {
        setEditing({ filename, src: r.source, source, mode: 'code' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取失败')
    }
  }

  const handleSave = async (
    filename: string,
    src: string,
    editSource: TrackSource,
  ) => {
    try {
      if (editSource === 'global') {
        await saveGlobalTrack(filename, src)
      } else {
        await saveTrack(projectId, filename, src)
      }
      toast.success('已保存')
      setEditing(null)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (filename: string) => {
    const label = source === 'global' ? '全局工作轨' : '工作轨'
    const ok = await confirm({
      description: `删除${label} ${filename}？此操作不可恢复。`,
      confirmLabel: '删除',
      destructive: true,
    })
    if (!ok) return
    try {
      if (source === 'global') await deleteGlobalTrack(filename)
      else await deleteTrack(projectId, filename)
      toast.success('已删除')
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleRun = async (filename: string) => {
    try {
      await runTrack(projectId, filename, source)
      toast.success('工作轨已启动')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动失败')
    }
  }

  if (editing) {
    const titleSuffix = editing.source === 'global' ? '（全局）' : ''

    // Mode: graph-v2-new / graph-v2-edit — TrackGraphEditor (v2 ReactFlow)
    if (editing.mode === 'graph-v2-new' || editing.mode === 'graph-v2-edit') {
      return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) setEditing(null) }}>
          <DialogContent className="max-w-6xl h-[90vh] p-0 overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>节点图编辑器 — {editing.filename}</DialogTitle>
            </DialogHeader>
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  加载节点图编辑器…
                </div>
              }
            >
              <TrackGraphEditor
                projectId={projectId}
                filename={editing.filename}
                isNew={editing.mode === 'graph-v2-new'}
                onClose={() => setEditing(null)}
              />
            </Suspense>
          </DialogContent>
        </Dialog>
      )
    }

    // Mode: v1-readonly — old v1 node-graph .tr, no reverse parse
    if (editing.mode === 'v1-readonly') {
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>
                查看工作轨{titleSuffix} · {editing.filename}
              </DialogTitle>
            </DialogHeader>
            <div className="bg-orange-50 border border-orange-200 rounded p-2 text-sm text-orange-700">
              ⚠️ 此工作轨由旧版节点图编辑器（v1）创建，不支持在 v2 编辑器中再次编辑。下方为只读代码视图，如需修改请删除重建。
            </div>
            <pre className="flex-1 overflow-auto p-3 bg-gray-50 text-xs font-mono whitespace-pre-wrap rounded">{editing.src}</pre>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setEditing(null)}>关闭</Button>
            </div>
          </DialogContent>
        </Dialog>
      )
    }

    // Mode: code — code editor, Suspense + TrackEditor
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              编辑工作轨{titleSuffix} · {editing.filename}
            </DialogTitle>
          </DialogHeader>
          {editing.banner && (
            <div className="bg-orange-50 border border-orange-200 rounded p-2 text-sm text-orange-700">
              ⚠️ {editing.banner}
            </div>
          )}
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                加载编辑器…
              </div>
            }
          >
            <TrackEditor
              filename={editing.filename}
              initialSource={editing.src}
              onCancel={() => setEditing(null)}
              onSave={(s) => handleSave(editing.filename, s, editing.source)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">工作轨</DialogTitle>
        </DialogHeader>

        <Tabs value={source} onValueChange={(v) => setSource(v as TrackSource)}>
          <TabsList>
            <TabsTrigger value="project">项目轨</TabsTrigger>
            <TabsTrigger value="global">我的全局轨</TabsTrigger>
          </TabsList>
        </Tabs>

        {source === 'global' && (
          <p className="text-xs text-muted-foreground">
            全局轨是可复用的模板，运行时仍绑定到当前项目（PTY 与文件路径来自该项目）。
          </p>
        )}

        <div className="flex gap-2 items-center">
          <Input
            placeholder={
              source === 'global' ? '新全局轨名称' : '新工作轨名称（例：review）'
            }
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            className="flex-1"
          />
          <select
            value={createMode}
            onChange={(e) => setCreateMode(e.target.value as CreateMode)}
            className="text-xs h-9 px-2 rounded-md border border-border bg-background"
            title="新建模式"
          >
            <option value="graph-v2">节点图（v2 ReactFlow）</option>
            <option value="code-basic">代码（基础）</option>
            <option value="code-ask">代码（含 ask_user）</option>
          </select>
          <Button onClick={handleCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> 新建
          </Button>
          <Button
            onClick={() => refresh()}
            size="sm"
            variant="ghost"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="space-y-1 max-h-[55vh] overflow-y-auto">
          {files.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {source === 'global'
                ? '暂无全局工作轨。新建一个开始。'
                : '暂无工作轨。新建一个开始。'}
            </p>
          )}
          {files.map((f) => (
            <div
              key={f.filename}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors"
            >
              {modeByFile[f.filename] === 'graph-v2' && (
                <span className="text-base flex-shrink-0" title="节点图 v2">🕸️</span>
              )}
              {modeByFile[f.filename] === 'node-graph-v1' && (
                <span className="text-base flex-shrink-0" title="节点图 v1（旧版）">🧩</span>
              )}
              <span
                className="flex-1 text-sm font-mono truncate"
                title={f.filename}
              >
                {f.filename}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(f.size / 100) / 10}KB
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRun(f.filename)}
                title="运行"
              >
                <Play className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleEdit(f.filename)}
                title="编辑"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(f.filename)}
                title="删除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
