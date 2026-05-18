// frontend/src/components/tracks/flow/TrackFlowsListDialog.tsx
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { listFlows, deleteFlow, saveFlow as apiSaveFlow, type FlowFileInfo } from '../api'
import { emptyFlow } from './flow-types-v3'
import { deriveTrainJsonFromVariables } from './flow-sidecar-io'
import { TrackFlowEditor } from './TrackFlowEditor'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ActiveEditor = { filename: string; isNew: boolean; autoRun?: boolean } | null

export function TrackFlowsListDialog({ projectId, open, onOpenChange }: Props) {
  const [files, setFiles] = useState<FlowFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<ActiveEditor>(null)
  const [creating, setCreating] = useState(false)

  const reload = async () => {
    if (!open) return
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
  }

  useEffect(() => {
    void reload()
  }, [open, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    const name = window.prompt('工作轨名（filename，不含 .flow 后缀）:')
    if (!name) return
    const trimmed = name.trim()
    if (!/^[a-zA-Z0-9_一-鿿぀-ヿㇰ-ㇿ-]+$/.test(trimmed)) {
      alert('名字只允许字母/数字/下划线/中文/连字符')
      return
    }
    setCreating(true)
    try {
      const flow = emptyFlow(trimmed)
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, `${trimmed}.flow`, flow, trainJson)
      await reload()
      setActive({ filename: `${trimmed}.flow`, isNew: false })
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`删除 ${filename}？`)) return
    try {
      await deleteFlow(projectId, filename)
      await reload()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[85vh] bg-white rounded-lg z-50 flex flex-col">
          {active ? (
            <TrackFlowEditor
              projectId={projectId}
              filename={active.filename}
              isNew={active.isNew}
              autoRun={active.autoRun}
              onClose={() => {
                setActive(null)
                void reload()
              }}
            />
          ) : (
            <>
              <div className="border-b p-3 flex items-center gap-2">
                <Dialog.Title className="font-medium">工作轨（v3）</Dialog.Title>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? '创建中…' : '+ 新建工作轨'}
                </button>
                <Dialog.Close className="text-sm text-gray-500 hover:text-gray-800 px-2">关闭</Dialog.Close>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {loading && <div className="text-sm text-gray-400">加载中…</div>}
                {error && <div className="text-sm text-red-600">错误：{error}</div>}
                {!loading && !error && files.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-12">
                    暂无工作轨。点击右上角"新建工作轨"开始。
                  </div>
                )}
                {files.map((f) => (
                  <div
                    key={f.filename}
                    className="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() => setActive({ filename: f.filename, isNew: false })}
                  >
                    <span className="text-base">🕸️</span>
                    <div className="flex-1">
                      <div className="text-sm font-mono">{f.filename}</div>
                      <div className="text-xs text-gray-400">
                        {(f.size / 1024).toFixed(1)} KB · {new Date(f.mtimeMs).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActive({ filename: f.filename, isNew: false, autoRun: true })
                      }}
                      className="text-xs px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700"
                      title="直接运行（无需进入编辑页）"
                    >
                      ▶ 运行
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDelete(f.filename) }}
                      className="text-xs text-red-500 hover:text-red-700 px-2"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
