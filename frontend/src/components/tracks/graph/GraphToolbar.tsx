// frontend/src/components/tracks/graph/GraphToolbar.tsx
import { useState } from 'react'
import type { GraphV2 } from './graph-types-v2'
import { codegen } from './codegen-v2'
import { encodeSidecar } from './sidecar-io'
import { saveTrack } from '../api'
import { CodePreviewModal } from './CodePreviewModal'

interface Props {
  graph: GraphV2
  projectId: string
  filename: string
  dirty: boolean
  onSaved: () => void
  onClose: () => void
}

export function GraphToolbar({
  graph,
  projectId,
  filename,
  dirty,
  onSaved,
  onClose,
}: Props) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handlePreview = () => {
    const r = codegen(graph)
    setPreviewSrc(r.source ?? '')
    setPreviewErrors(r.errors?.map((e) => e.message) ?? [])
    setPreviewOpen(true)
  }

  const handleSave = async () => {
    setSaveError(null)
    const r = codegen(graph)
    if (!r.ok || !r.source) {
      setSaveError(
        `无法保存：${r.errors?.map((e) => e.message).join('; ') ?? 'unknown'}`,
      )
      return
    }
    setSaving(true)
    try {
      const sidecar = encodeSidecar(graph)
      await saveTrack(projectId, filename, r.source, sidecar)
      onSaved()
    } catch (e) {
      setSaveError(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="border-b bg-white dark:bg-zinc-900 px-3 py-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onClose}
          className="text-sm text-gray-600 hover:text-black dark:text-zinc-400 dark:hover:text-white px-1"
          title="返回列表"
        >
          ←
        </button>
        <span className="font-mono text-sm truncate max-w-[240px]">{filename}</span>
        {dirty && (
          <span className="text-xs text-orange-500" title="未保存更改">
            ●
          </span>
        )}
        <div className="flex-1" />
        {saveError && (
          <span className="text-xs text-red-600 max-w-[280px] truncate">{saveError}</span>
        )}
        <button
          onClick={handlePreview}
          className="text-sm px-3 py-1 rounded border hover:bg-gray-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          预览 .tr 代码
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </header>
      <CodePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        source={previewSrc}
        errors={previewErrors}
      />
    </>
  )
}
