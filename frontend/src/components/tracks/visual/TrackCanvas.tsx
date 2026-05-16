import { DndContext, DragEndEvent, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { useState } from 'react'
import type { Node, TrackGraph } from './graph-types'
import { Action } from './reducer'
import { NODE_FACTORY } from './default-nodes'
import { NodeBlock } from './NodeBlock'

interface Props {
  graph: TrackGraph
  dispatch: (a: Action) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const TYPE_LABEL: Record<Node['type'], string> = {
  ask_user: '💬 问用户',
  fai: '🤖 AI 调用',
  let: '📦 命名变量',
  return: '⬅️ 返回',
}

export function TrackCanvas({ graph, dispatch, selectedId, onSelect }: Props) {
  const [activeDrag, setActiveDrag] = useState<{ kind: 'create' | 'reorder'; label: string } | null>(null)

  // 8px activation distance: prevents accidental drag-hijack of click-to-select.
  // Without this, a 1px pointer move while clicking a node would trigger drag
  // mode and suppress the click event entirely (per Group 4 code review M-3).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDrag(null)
    const { active, over } = event
    if (!over) return
    const data = active.data.current as { kind?: string; nodeType?: Node['type']; sourceIndex?: number } | undefined
    const overData = over.data.current as { kind?: string; index?: number } | undefined
    if (!data || !overData) return

    if (data.kind === 'create' && overData.kind === 'drop-before') {
      const factory = data.nodeType ? NODE_FACTORY[data.nodeType] : undefined
      if (factory) dispatch({ type: 'add', node: factory(), index: overData.index ?? 0 })
    }
    if (data.kind === 'create' && overData.kind === 'drop-end') {
      const factory = data.nodeType ? NODE_FACTORY[data.nodeType] : undefined
      if (factory) dispatch({ type: 'add', node: factory(), index: graph.body.length })
    }
    if (data.kind === 'reorder' && overData.kind === 'drop-before') {
      const from = data.sourceIndex
      if (typeof from !== 'number') return
      let to = overData.index ?? 0
      if (from < to) to -= 1  // adjust for self-removal before insert
      if (from !== to) dispatch({ type: 'move', from, to })
    }
    if (data.kind === 'reorder' && overData.kind === 'drop-end') {
      const from = data.sourceIndex
      if (typeof from !== 'number') return
      const to = graph.body.length - 1
      if (from !== to) dispatch({ type: 'move', from, to })
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        const d = e.active.data.current as { kind?: string; nodeType?: Node['type']; nodeId?: string } | undefined
        if (d?.kind === 'create' && d.nodeType) {
          setActiveDrag({ kind: 'create', label: TYPE_LABEL[d.nodeType] })
        } else if (d?.kind === 'reorder') {
          setActiveDrag({ kind: 'reorder', label: '移动节点' })
        }
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <main className="flex-1 overflow-y-auto p-6" onClick={() => onSelect(null)}>
        <h1 className="text-xl font-semibold mb-4">{graph.trackName}</h1>
        <div className="flex flex-col gap-2">
          {graph.body.length === 0 && <EmptyDrop />}
          {graph.body.map((n, i) => (
            <NodeBlock
              key={n.id}
              node={n}
              index={i}
              selected={selectedId === n.id}
              onSelect={() => onSelect(n.id)}
              onDuplicate={() => dispatch({ type: 'duplicate', index: i })}
              onRemove={() => dispatch({ type: 'remove', index: i })}
            />
          ))}
          {graph.body.length > 0 && <EndDrop />}
        </div>
      </main>
      <DragOverlay>
        {activeDrag && (
          <div className="px-3 py-2 bg-white border-2 border-blue-400 rounded shadow text-sm">
            {activeDrag.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function EmptyDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-end-empty', data: { kind: 'drop-end' } })
  return (
    <div
      ref={setNodeRef}
      className={[
        'border-2 border-dashed rounded-lg p-12 text-center text-gray-400',
        isOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300',
      ].join(' ')}
    >
      从左侧拖一个节点过来开始搭建
    </div>
  )
}

function EndDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-end', data: { kind: 'drop-end' } })
  return (
    <div
      ref={setNodeRef}
      className={[
        'border-2 border-dashed rounded-lg p-4 text-center text-gray-400 text-sm',
        isOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200',
      ].join(' ')}
    >
      拖节点到这里追加
    </div>
  )
}
