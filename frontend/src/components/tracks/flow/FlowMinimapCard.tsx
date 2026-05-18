// frontend/src/components/tracks/flow/FlowMinimapCard.tsx
//
// 工作轨运行中的悬浮半透明缩略 card。出现在右下角，按节点 position 等比缩放
// 渲染整张图，节点画矩形 + 显示名（用户填的 label，fallback type）+ 状态颜色
// （active 黄 pulse / completed 绿 / failed 红 / skipped 灰划线 / idle 默认）。
// edges 用直线连接节点中心；if 节点的 true/false 分别绿 / 红。
//
// 数据流：ProjectPage 监听 ccweb:flow-msg 的 flow_started 拉 .flow 和 run state，
// 传给本组件；后续 flow_node_active / completed / failed 事件由父组件维护
// nodeStates Map 更新 props。flow_done / cancelled / error 后父组件延迟清空。

import type { FlowV3, NodeV3 } from './flow-types-v3'
import type { NodeRuntimeState } from './useFlowRun'

interface Props {
  flow: FlowV3
  nodeStates: Map<string, NodeRuntimeState>
  currentNodeId: string | null
  status: 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  onClose?: () => void
}

const CARD_W = 320          // minimap card 宽
const CARD_H = 240          // minimap card 高（节点区域，不含 header）
const NODE_W = 80           // 缩略节点宽
const NODE_H = 28           // 缩略节点高
const PAD = 12              // 内边距

export function FlowMinimapCard({ flow, nodeStates, currentNodeId, status, onClose }: Props) {
  if (flow.nodes.length === 0) return null

  // 用节点 position 算 bounding box，等比缩放进 viewport
  const xs = flow.nodes.map((n) => n.position.x)
  const ys = flow.nodes.map((n) => n.position.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const srcW = Math.max(1, maxX - minX) + 240   // 节点本身宽度补偿
  const srcH = Math.max(1, maxY - minY) + 100
  const scale = Math.min((CARD_W - PAD * 2 - NODE_W) / srcW, (CARD_H - PAD * 2 - NODE_H) / srcH)

  function projX(x: number): number {
    return PAD + (x - minX) * scale
  }
  function projY(y: number): number {
    return PAD + (y - minY) * scale
  }
  function nodeCenter(n: NodeV3): { x: number; y: number } {
    return { x: projX(n.position.x) + NODE_W / 2, y: projY(n.position.y) + NODE_H / 2 }
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 rounded-lg shadow-lg border border-gray-300 backdrop-blur-md bg-white/70"
      style={{ width: CARD_W }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200">
        <div className="flex items-center gap-2 text-xs">
          <span className={statusDotClass(status)} />
          <span className="font-medium text-gray-700">{flow.trackName}</span>
          <span className="text-gray-400">{statusLabel(status)}</span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-sm leading-none px-1"
            title="关闭"
          >×</button>
        )}
      </div>
      <svg width={CARD_W} height={CARD_H} className="block">
        {/* 边 */}
        {flow.edges.map((e) => {
          const src = flow.nodes.find((n) => n.id === e.source)
          const dst = e.target ? flow.nodes.find((n) => n.id === e.target) : null
          if (!src) return null
          const s = nodeCenter(src)
          const d = dst ? nodeCenter(dst) : { x: s.x, y: s.y + 30 }
          const stroke = e.sourceHandle === 'true' ? '#10b981'
                        : e.sourceHandle === 'false' ? '#ef4444'
                        : '#9ca3af'
          return (
            <line
              key={e.id}
              x1={s.x} y1={s.y + NODE_H / 2}
              x2={d.x} y2={dst ? d.y - NODE_H / 2 : d.y}
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray={dst ? undefined : '3 3'}
              markerEnd="url(#mm-arrow)"
            />
          )
        })}
        <defs>
          <marker id="mm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
        </defs>
        {/* 节点 */}
        {flow.nodes.map((n) => {
          const x = projX(n.position.x)
          const y = projY(n.position.y)
          const state = nodeStates.get(n.id) ?? null
          const isCurrent = currentNodeId === n.id
          const { fill, stroke, textClass } = nodeStyle(n.type, state, isCurrent)
          const displayName = (n.label?.trim() || defaultLabel(n.type))
          return (
            <g key={n.id}>
              <rect
                x={x} y={y}
                width={NODE_W} height={NODE_H}
                rx={6} ry={6}
                fill={fill} stroke={stroke}
                strokeWidth={isCurrent ? 2 : 1}
                className={isCurrent ? 'animate-pulse' : undefined}
              />
              <text
                x={x + NODE_W / 2} y={y + NODE_H / 2 + 1}
                textAnchor="middle" dominantBaseline="middle"
                className={`text-[10px] font-mono select-none ${textClass}`}
              >
                {truncate(displayName, 10)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function defaultLabel(type: NodeV3['type']): string {
  return type === 'user_input' ? '用户输入' : type === 'llm' ? 'LLM' : '判断'
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function nodeStyle(
  type: NodeV3['type'],
  state: NodeRuntimeState | null,
  isCurrent: boolean,
): { fill: string; stroke: string; textClass: string } {
  if (state === 'active' || isCurrent) {
    return { fill: '#fef3c7', stroke: '#f59e0b', textClass: 'fill-amber-900' }
  }
  if (state === 'completed') {
    return { fill: '#d1fae5', stroke: '#10b981', textClass: 'fill-green-900' }
  }
  if (state === 'failed') {
    return { fill: '#fee2e2', stroke: '#ef4444', textClass: 'fill-red-900' }
  }
  if (state === 'skipped') {
    return { fill: '#f3f4f6', stroke: '#9ca3af', textClass: 'fill-gray-400' }
  }
  // idle，按 type 染色
  if (type === 'user_input') return { fill: '#fce7f3', stroke: '#f9a8d4', textClass: 'fill-gray-700' }
  if (type === 'llm') return { fill: '#fed7aa', stroke: '#fb923c', textClass: 'fill-gray-700' }
  return { fill: '#e0f2fe', stroke: '#7dd3fc', textClass: 'fill-gray-700' }
}

function statusLabel(s: Props['status']): string {
  return s === 'running' ? '运行中'
       : s === 'waiting_user_input' ? '等待输入'
       : s === 'completed' ? '已完成'
       : s === 'failed' ? '失败'
       : '已取消'
}

function statusDotClass(s: Props['status']): string {
  const base = 'inline-block w-2 h-2 rounded-full'
  if (s === 'running') return `${base} bg-amber-500 animate-pulse`
  if (s === 'waiting_user_input') return `${base} bg-blue-500`
  if (s === 'completed') return `${base} bg-green-500`
  if (s === 'failed') return `${base} bg-red-500`
  return `${base} bg-gray-400`
}
