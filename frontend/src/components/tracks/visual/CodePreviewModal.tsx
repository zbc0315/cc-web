import { lazy, Suspense } from 'react'

const Editor = lazy(async () => {
  const [monacoNs, reactWrapper] = await Promise.all([
    import('monaco-editor'),
    import('@monaco-editor/react'),
  ])
  const m = monacoNs as unknown as { default?: typeof monacoNs }
  const monacoLib = m.default ?? monacoNs
  reactWrapper.loader.config({ monaco: monacoLib as never })
  return { default: reactWrapper.default }
})

interface Props {
  open: boolean
  source: string
  errors?: { nodeId: string; nodeIndex: number; message: string }[]
  onClose: () => void
}

export function CodePreviewModal({ open, source, errors, onClose }: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg w-3/4 h-3/4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-3 border-b border-gray-200">
          <span className="font-medium">预览 .tr（只读）</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-lg leading-none">×</button>
        </header>
        {errors && errors.length > 0 && (
          <div className="bg-red-50 border-b border-red-200 p-2 text-sm text-red-700">
            <div className="font-medium mb-1">codegen 报错（{errors.length}）:</div>
            {errors.slice(0, 5).map((e, i) => (
              <div key={i} className="font-mono text-xs">节点 #{e.nodeIndex}: {e.message}</div>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-4 text-sm text-gray-500">加载预览中...</div>}>
            <Editor
              height="100%"
              value={source}
              language="javascript"
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
