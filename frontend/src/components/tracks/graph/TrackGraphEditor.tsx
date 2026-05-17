// frontend/src/components/tracks/graph/TrackGraphEditor.tsx
import { useEffect, useReducer, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { reducer, initialGraph } from './reducer-v2'
import { GraphProvider } from './GraphContext'
import { GraphCanvas } from './GraphCanvas'
import { GraphToolbar } from './GraphToolbar'
import { NodePalette } from './NodePalette'
import { NodeInspector } from './NodeInspector'
import { decodeSidecar, crossCheck } from './sidecar-io'
import { detectTrackMode } from './marker-v2'
import { getTrack } from '../api'

interface Props {
  projectId: string
  filename: string                      // 'foo.tr'
  isNew: boolean                        // true 时跳过 GET，直接进空图编辑（避免覆盖现有 .tr）
  onClose: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'desync'; message: string; recoverable: boolean }

export function TrackGraphEditor({ projectId, filename, isNew, onClose }: Props) {
  const [graph, dispatch] = useReducer(reducer, initialGraph(filename.replace(/\.tr$/, '')))
  const [loadState, setLoadState] = useState<LoadState>(
    isNew ? { kind: 'ready' } : { kind: 'loading' },
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    // 新建路径不去 GET（避免覆盖同名旧 .tr 或加载不属于本编辑器的内容）
    if (isNew) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getTrack(projectId, filename)
        if (cancelled) return
        const mode = detectTrackMode(res.source)
        if (mode === 'node-graph-v1') {
          setLoadState({
            kind: 'error',
            message: '此节点图为旧版本（M1 嵌套块）。请切换到代码模式打开，或手动重建。',
          })
          return
        }
        if (mode === 'code') {
          // 已是纯代码 .tr，不能作为节点图打开（会丢失代码）
          setLoadState({
            kind: 'error',
            message: '此文件是纯 .tr 代码（无节点图 marker）。请切换到代码模式打开。',
          })
          return
        }
        // mode === 'graph-v2'
        if (res.sidecar) {
          const decoded = decodeSidecar(res.sidecar)
          if (!decoded.ok || !decoded.graph) {
            setLoadState({ kind: 'desync', message: `sidecar 解析失败：${decoded.reason}`, recoverable: false })
            return
          }
          const cc = crossCheck(decoded.graph, res.source)
          if (!cc.ok) {
            setLoadState({
              kind: 'desync',
              message: `sidecar 与 .tr 节点 nid 不匹配（缺失 ${cc.missingNids.length} / 多余 ${cc.extraNids.length}）`,
              recoverable: true,
            })
            return
          }
          dispatch({ type: 'replace', graph: decoded.graph })
        }
        setLoadState({ kind: 'ready' })
      } catch (e) {
        if (!cancelled) {
          setLoadState({ kind: 'error', message: (e as Error).message })
        }
      }
    })()
    return () => { cancelled = true }
  }, [projectId, filename, isNew])

  // Mark dirty on any reducer state change after initial load
  useEffect(() => {
    if (loadState.kind === 'ready') setDirty(true)
    // ESLint: depend on graph identity only after ready; ignore loadState in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const wrappedDispatch = (a: Parameters<typeof dispatch>[0]) => {
    dispatch(a)
  }

  if (loadState.kind === 'loading') {
    return <div className="flex items-center justify-center h-full text-gray-400">加载中…</div>
  }
  if (loadState.kind === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-600 gap-2">
        <div>{loadState.message}</div>
        <button onClick={onClose} className="text-sm px-3 py-1 rounded border">关闭</button>
      </div>
    )
  }
  if (loadState.kind === 'desync') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-amber-700 gap-2 max-w-md mx-auto p-6">
        <div className="font-medium">sidecar 与 .tr 失同步</div>
        <div className="text-sm">{loadState.message}</div>
        <div className="text-xs text-gray-600 mt-2">
          M1 暂仅支持"代码模式打开" 兜底；M2 起会提供"重建 sidecar / 只读图"恢复路径。
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="text-sm px-3 py-1 rounded border">关闭</button>
          <button
            onClick={() => {
              // 通知父级以代码模式重新打开此文件（父级 TracksListDialog 处理）
              window.dispatchEvent(new CustomEvent('ccweb:open-track-as-code', {
                detail: { projectId, filename },
              }))
              onClose()
            }}
            className="text-sm px-3 py-1 rounded bg-blue-600 text-white"
          >
            改为代码模式打开
          </button>
        </div>
      </div>
    )
  }

  const handleClose = () => {
    if (dirty) {
      const ok = window.confirm('未保存的修改将丢失。确认关闭吗？')
      if (!ok) return
    }
    onClose()
  }

  return (
    <ReactFlowProvider>
      <GraphProvider value={{ dispatch: wrappedDispatch }}>
        <div className="flex flex-col h-full">
          <GraphToolbar
            graph={graph}
            projectId={projectId}
            filename={filename}
            dirty={dirty}
            onSaved={() => setDirty(false)}
            onClose={handleClose}
          />
          <div className="flex-1 flex overflow-hidden">
            <NodePalette />
            <GraphCanvas
              graph={graph}
              dispatch={wrappedDispatch}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
            <NodeInspector graph={graph} selectedNodeId={selectedNodeId} />
          </div>
        </div>
      </GraphProvider>
    </ReactFlowProvider>
  )
}
