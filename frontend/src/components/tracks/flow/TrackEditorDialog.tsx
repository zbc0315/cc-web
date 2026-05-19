// frontend/src/components/tracks/flow/TrackEditorDialog.tsx
//
// 全屏 Dialog 包装 TrackFlowEditor。v-k 起工作轨入口（列表 + 运行可视化）
// 移到左侧边栏，编辑器仍走 Dialog（保留全屏沉浸式编辑体验）。
// v-l：删 autoRun 路径——列表 ▶ 运行不再弹 Dialog，统一由 ProjectPage 顶层 driver。
// v-m：换 shadcn Dialog 封装；自管 dirty 拦截（Radix onOpenChange 不等 Promise，
// 所以 confirm 必须在父层用 e.preventDefault() 同步拦截 Esc/PointerOutside + 异步
// useConfirm；onOpenChange(false) 在 dirty 时也走异步分支）。隐藏 shadcn 内置 X，
// 由 TrackFlowEditor 内 ChevronLeft 按钮统一走 askClose。
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConfirm } from '@/components/ConfirmProvider'
import { TrackFlowEditor } from './TrackFlowEditor'
import type { FlowRunState } from './useFlowRun'

interface Props {
  projectId: string
  filename: string
  open: boolean
  /** 顶层 useFlowRun state（仅当 filename === runningFlow.filename 时传真实值） */
  runState?: FlowRunState | null
  onClose: () => void
}

export function TrackEditorDialog({ projectId, filename, open, runState, onClose }: Props) {
  const confirm = useConfirm()
  const [dirty, setDirty] = useState(false)

  const askClose = async () => {
    if (dirty) {
      const ok = await confirm({
        description: '未保存的修改将丢失。确认关闭吗？',
        confirmLabel: '关闭',
        destructive: true,
      })
      if (!ok) return
    }
    window.dispatchEvent(new CustomEvent('ccweb:track-editor-closed'))
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Radix 在 X 按钮 click / programmatic Open=false 时会调这里；Esc 和
        // outside click 走下方 onEscapeKeyDown / onPointerDownOutside（更早，可 preventDefault）。
        // open 受 Props 控制，只有调 onClose() 才会真正关闭；这里不直接 onClose()，
        // 而是走 askClose 异步流程。
        if (!o) void askClose()
      }}
    >
      <DialogContent
        className="max-w-[90vw] w-[90vw] h-[85vh] p-0 gap-0 flex flex-col overflow-hidden sm:rounded-lg [&>button.absolute]:hidden"
        onEscapeKeyDown={(e) => {
          e.preventDefault()
          void askClose()
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault()
          void askClose()
        }}
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>工作轨编辑器：{filename}</DialogTitle>
        </DialogHeader>
        <TrackFlowEditor
          projectId={projectId}
          filename={filename}
          isNew={false}
          runState={runState}
          onClose={() => void askClose()}
          onDirtyChange={setDirty}
        />
      </DialogContent>
    </Dialog>
  )
}
