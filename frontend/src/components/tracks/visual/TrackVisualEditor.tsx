import { useMemo, useReducer, useState } from 'react'
import type { Node, TrackGraph } from './graph-types'
import { Action, makeEmptyGraph, reduce } from './reducer'
import { codegen, type CodegenError } from './codegen'
import { scopeCandidates } from './scope'
import { TrackCanvas } from './TrackCanvas'
import { NodePalette } from './NodePalette'
import { NodeFormDrawer } from './NodeFormDrawer'
import { CodePreviewModal } from './CodePreviewModal'

interface Props {
  initialGraph?: TrackGraph
  trackName: string
  onSave: (source: string) => Promise<void> | void
}

function reducer(state: TrackGraph, action: Action): TrackGraph {
  return reduce(state, action)
}

export function TrackVisualEditor({ initialGraph, trackName, onSave }: Props) {
  const [graph, dispatch] = useReducer(reducer, initialGraph ?? makeEmptyGraph(trackName))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const selectedIndex = selectedId === null ? -1 : graph.body.findIndex((n) => n.id === selectedId)
  const selectedNode: Node | null = selectedIndex >= 0 ? graph.body[selectedIndex]! : null

  const candidates = useMemo(
    () => scopeCandidates(graph, selectedIndex >= 0 ? selectedIndex : graph.body.length),
    [graph, selectedIndex],
  )

  async function handleSave(): Promise<void> {
    setSaveError(null)
    const res = codegen(graph)
    if (!res.ok || !res.source) {
      const count = res.errors?.length ?? 0
      setSaveError(`codegen 报 ${count} 个错。点"预览代码"查看详情。`)
      setPreviewOpen(true)
      return
    }
    setSaving(true)
    try {
      await onSave(res.source)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function handleNodePatch(patch: Partial<Node>): void {
    if (selectedIndex < 0) return
    dispatch({ type: 'update', index: selectedIndex, patch: patch as Partial<Omit<Node, 'type'>> })
  }

  // Live codegen for preview modal — recomputed only when graph changes
  const liveCodegen = useMemo(() => codegen(graph), [graph])
  const previewSource = liveCodegen.ok
    ? liveCodegen.source!
    : '// codegen 错误：\n' + (liveCodegen.errors ?? []).map((e: CodegenError) => `// #${e.nodeIndex}: ${e.message}`).join('\n')

  return (
    <div className="flex flex-col h-full w-full bg-gray-50">
      {/* Header — flex-shrink-0 row, no fixed */}
      <header className="flex items-center gap-3 p-3 border-b border-gray-200 bg-white flex-shrink-0">
        <span className="text-lg font-medium">{trackName}</span>
        <span className="text-xs text-gray-400">节点图模式</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setPreviewOpen(true)}
            className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50">预览代码</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
        {saveError && <div className="ml-3 text-xs text-red-600 max-w-md truncate" title={saveError}>{saveError}</div>}
      </header>

      {/* Middle row — palette + canvas + drawer */}
      <div className="flex flex-row flex-1 overflow-hidden">
        <NodePalette />
        <TrackCanvas
          graph={graph}
          dispatch={dispatch}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <NodeFormDrawer
          node={selectedNode}
          candidates={candidates}
          onChange={handleNodePatch}
          onClose={() => setSelectedId(null)}
        />
      </div>

      {/* Modal preview — still floats above everything */}
      <CodePreviewModal
        open={previewOpen}
        source={previewSource}
        errors={liveCodegen.ok ? undefined : liveCodegen.errors}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
