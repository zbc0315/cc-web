// frontend/src/components/tracks/graph/nodes/CodeNode.tsx
import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react'
import { Handle, Position, type NodeProps, useUpdateNodeInternals } from 'reactflow'
import type { editor as MonacoEditor } from 'monaco-editor'
import type { CodeNode as CodeNodeData } from '../graph-types-v2'
import { useGraphDispatch } from '../GraphContext'

// Same self-host loader pattern as TrackEditor.tsx:22-34.
// Monaco core is bundled via local `monaco-editor` package, NOT fetched from CDN.
const Editor = lazy(async () => {
  const [monacoNs, reactWrapper] = await Promise.all([
    import('monaco-editor'),
    import('@monaco-editor/react'),
  ])
  // Some bundlers wrap the namespace in `{ default: ns }`; unwrap if so.
  const m = monacoNs as unknown as { default?: typeof monacoNs }
  const monacoLib = m.default ?? monacoNs
  reactWrapper.loader.config({ monaco: monacoLib as never })
  return { default: reactWrapper.default }
})

type OnMountFn = (editor: MonacoEditor.IStandaloneCodeEditor) => void

const HEIGHT_MIN = 80
const HEIGHT_MAX = 400

export function CodeNodeView({ id, data, selected }: NodeProps<CodeNodeData>) {
  const dispatch = useGraphDispatch()
  const updateNodeInternals = useUpdateNodeInternals()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [height, setHeight] = useState<number>(HEIGHT_MIN)

  const updateInternals = useCallback(() => updateNodeInternals(id), [updateNodeInternals, id])

  const handleMount: OnMountFn = useCallback(
    (editor) => {
      editorRef.current = editor
      editor.onDidContentSizeChange(() => {
        const contentH = editor.getContentHeight()
        const next = Math.min(Math.max(contentH, HEIGHT_MIN), HEIGHT_MAX)
        setHeight(next)
        updateInternals()
      })
      updateInternals()
    },
    [updateInternals],
  )

  // Layer 3: force one updateInternals after mount completes — onDidContentSizeChange
  // may fire before ReactFlow finishes registering the node, ResizeObserver
  // only fires on subsequent resizes. This mount effect guarantees the
  // initial size is propagated.
  useEffect(() => {
    updateInternals()
  }, [updateInternals])

  // Layer 2: ResizeObserver on outer div for container width changes
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => {
      editorRef.current?.layout()
      updateInternals()
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [updateInternals])

  return (
    <div
      ref={containerRef}
      className={[
        'rounded-lg border-2 bg-gray-50 overflow-hidden',
        selected ? 'border-blue-500 shadow' : 'border-gray-300',
      ].join(' ')}
      style={{ width: 400, height: height + 32 }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 border-b">
        <span className="text-base">📝</span>
        <span className="text-sm font-medium">代码</span>
      </div>
      <Suspense fallback={<div className="px-3 py-2 text-xs text-gray-400">加载编辑器…</div>}>
        <Editor
          height={height}
          language="train-lang"
          value={data.code}
          onChange={(v) =>
            dispatch({ type: 'update_node', nodeId: id, patch: { code: v ?? '' } })
          }
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: 'off',
            folding: true,
            scrollbar: { vertical: 'auto', horizontal: 'hidden' },
          }}
        />
      </Suspense>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
