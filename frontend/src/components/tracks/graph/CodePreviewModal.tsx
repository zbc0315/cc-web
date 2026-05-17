// frontend/src/components/tracks/graph/CodePreviewModal.tsx
import { Suspense, lazy } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

// Self-host Monaco（同 TrackEditor.tsx:22-34 模式，避免 CDN fetch 破坏 LAN/CSP）
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
  onOpenChange: (open: boolean) => void
  source: string
  errors?: string[]
}

export function CodePreviewModal({ open, onOpenChange, source, errors }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vh] bg-white dark:bg-zinc-900 rounded-lg z-50 flex flex-col shadow-xl"
          onKeyDown={(e) => {
            // Prevent Escape from bubbling to outer Dialog (spec §TODO CodePreviewModal Escape P1)
            if (e.key === 'Escape') e.stopPropagation()
          }}
        >
          <div className="border-b px-4 py-2 flex items-center justify-between shrink-0">
            <Dialog.Title className="text-sm font-medium">.tr 代码预览（只读）</Dialog.Title>
            <Dialog.Close className="text-gray-500 hover:text-black dark:hover:text-white px-2 py-1 text-lg leading-none">
              ×
            </Dialog.Close>
          </div>
          {errors && errors.length > 0 && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 text-sm text-red-700 shrink-0">
              <div className="font-medium mb-1">codegen 错误：</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <Suspense
              fallback={
                <div className="p-4 text-sm text-gray-400">加载编辑器…</div>
              }
            >
              <Editor
                height="100%"
                language="javascript"
                value={source}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  wordWrap: 'off',
                }}
              />
            </Suspense>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
