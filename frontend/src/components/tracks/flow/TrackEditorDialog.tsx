// frontend/src/components/tracks/flow/TrackEditorDialog.tsx
//
// 全屏 Dialog 包装 TrackFlowEditor。v-k 起工作轨入口（列表 + 运行可视化）
// 移到左侧边栏，编辑器仍走 Dialog（保留全屏沉浸式编辑体验）。
import * as Dialog from '@radix-ui/react-dialog'
import { TrackFlowEditor } from './TrackFlowEditor'

interface Props {
  projectId: string
  filename: string
  autoRun?: boolean
  open: boolean
  onClose: () => void
}

export function TrackEditorDialog({ projectId, filename, autoRun, open, onClose }: Props) {
  // 关闭时通知左侧栏列表刷新（mtime / size，未来 rename 也覆盖）
  const handleClose = () => {
    window.dispatchEvent(new CustomEvent('ccweb:track-editor-closed'))
    onClose()
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[85vh] bg-white rounded-lg z-50 flex flex-col">
          <Dialog.Title className="sr-only">工作轨编辑器：{filename}</Dialog.Title>
          <TrackFlowEditor
            projectId={projectId}
            filename={filename}
            isNew={false}
            autoRun={autoRun}
            onClose={handleClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
