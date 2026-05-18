// frontend/src/components/tracks/TracksListDialog.tsx
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * v3 placeholder — M0 cleanup milestone removed v1 (visual/) and v2 (graph/)
 * editors. v3 .flow editor lands in M1. This component is intentionally
 * stubbed so the project page mount point keeps working.
 */
export function TracksListDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[480px] bg-white rounded-lg z-50 p-6"
        >
          <Dialog.Title className="text-lg font-semibold mb-2">工作轨</Dialog.Title>
          <div className="text-sm text-gray-600 space-y-2">
            <p>工作轨子系统正在重构为 v3（流程图工作流引擎）。</p>
            <p>v1（嵌套块）与 v2（ReactFlow + train-lang）已下线。</p>
            <p>新版本 v3 即将上线，敬请期待。</p>
            <p className="text-xs text-gray-400 mt-4">
              如果您有项目里有旧版 .tr 文件，它们保留在磁盘但暂不可编辑/运行。
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Dialog.Close className="px-3 py-1 text-sm rounded border hover:bg-gray-50">
              关闭
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
