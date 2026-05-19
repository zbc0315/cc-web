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
//
// v-m：节点 fill/stroke 全改 Tailwind className 派生（fill-amber-100 / dark:fill-amber-900/40
// 等），边色 stroke 也用 className；取消按钮换 shadcn Button + lucide Square；
// 标题栏 close 按钮用 lucide X。SVG marker 箭头无法 per-edge 染色（用全局 fill
// currentColor + 外层 text-muted-foreground 让箭头跟 muted-foreground 一致）。

import { Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FlowV3, NodeV3 } from './flow-types-v3'
import type { NodeRuntimeState } from './useFlowRun'

interface Props {
  flow: FlowV3
  nodeStates: Map<string, NodeRuntimeState>
  currentNodeId: string | null
  status: 'running' | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled'
  onClose?: () => void
  /** v-k：嵌入模式（左侧栏内）— 不 fixed 定位、撑满父容器宽度，无关闭按钮（容器控生命周期） */
  embedded?: boolean
}

const FLOAT_CARD_W = 320    // 悬浮模式固定宽
const NODE_W = 80           // 缩略节点宽
const NODE_H = 28           // 缩略节点高
const PAD = 12              // 内边距

export function FlowMinimapCard({ flow, nodeStates, currentNodeId, status, onClose, embedded }: Props) {
  if (flow.nodes.length === 0) return null

  const cardW = embedded ? 240 : FLOAT_CARD_W
  const cardH = embedded ? 320 : 240

  const xs = flow.nodes.map((n) => n.position.x)
  const ys = flow.nodes.map((n) => n.position.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const srcW = Math.max(1, maxX - minX) + 240
  const srcH = Math.max(1, maxY - minY) + 100
  const scale = Math.min((cardW - PAD * 2 - NODE_W) / srcW, (cardH - PAD * 2 - NODE_H) / srcH)

  function projX(x: number): number {
    return PAD + (x - minX) * scale
  }
  function projY(y: number): number {
    return PAD + (y - minY) * scale
  }
  function nodeCenter(n: NodeV3): { x: number; y: number } {
    return { x: projX(n.position.x) + NODE_W / 2, y: projY(n.position.y) + NODE_H / 2 }
  }

  const containerClass = embedded
    ? 'w-full overflow-hidden rounded-md border border-border bg-card text-muted-foreground'
    : 'fixed bottom-4 right-4 z-40 rounded-lg shadow-lg border border-border backdrop-blur-md bg-card/70 text-muted-foreground'

  return (
    <div
      className={containerClass}
      style={embedded ? undefined : { width: cardW }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className={statusDotClass(status)} />
          <span className="font-medium text-foreground truncate">{flow.trackName}</span>
          <span className="text-muted-foreground shrink-0">{statusLabel(status)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* v-l：运行中显示 cancel 按钮（dispatch 让 ProjectPage 顶层调 API） */}
          {(status === 'running' || status === 'waiting_user_input') && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={() => window.dispatchEvent(new CustomEvent('ccweb:flow-cancel-request'))}
              title="取消运行"
              className="h-5 w-5"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
            </Button>
          )}
          {onClose && !embedded && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="关闭"
              className="h-5 w-5"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${cardW} ${cardH}`}
        width={embedded ? '100%' : cardW}
        height={embedded ? undefined : cardH}
        preserveAspectRatio="xMinYMin meet"
        className="block"
      >
        <defs>
          <marker
            id="mm-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            {/* fill="currentColor" 继承外层 text-muted-foreground，dark mode 自动跟变 */}
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {/* 边 */}
        {flow.edges.map((e) => {
          const src = flow.nodes.find((n) => n.id === e.source)
          const dst = e.target ? flow.nodes.find((n) => n.id === e.target) : null
          if (!src) return null
          const s = nodeCenter(src)
          const d = dst ? nodeCenter(dst) : { x: s.x, y: s.y + 30 }
          const strokeClass = e.sourceHandle === 'true'
            ? 'stroke-emerald-500 dark:stroke-emerald-400'
            : e.sourceHandle === 'false'
              ? 'stroke-red-500 dark:stroke-red-400'
              : 'stroke-muted-foreground/60'
          return (
            <line
              key={e.id}
              x1={s.x} y1={s.y + NODE_H / 2}
              x2={d.x} y2={dst ? d.y - NODE_H / 2 : d.y}
              className={strokeClass}
              strokeWidth={1.5}
              strokeDasharray={dst ? undefined : '3 3'}
              markerEnd="url(#mm-arrow)"
            />
          )
        })}
        {/* 节点 */}
        {flow.nodes.map((n) => {
          const x = projX(n.position.x)
          const y = projY(n.position.y)
          const state = nodeStates.get(n.id) ?? null
          const isCurrent = currentNodeId === n.id
          const { fillClass, strokeClass, textClass } = nodeStyle(n.type, state, isCurrent)
          const displayName = (n.label?.trim() || defaultLabel(n.type))
          return (
            <g key={n.id}>
              <rect
                x={x} y={y}
                width={NODE_W} height={NODE_H}
                rx={6} ry={6}
                className={`${fillClass} ${strokeClass}`}
                strokeWidth={isCurrent ? 2 : 1}
                style={isCurrent ? { animationDuration: '1.5s' } : undefined}
              >
                {isCurrent && (
                  <animate
                    attributeName="opacity"
                    values="1;0.55;1"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                )}
              </rect>
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
): { fillClass: string; strokeClass: string; textClass: string } {
  if (state === 'active' || isCurrent) {
    return {
      fillClass: 'fill-amber-100 dark:fill-amber-900/50',
      strokeClass: 'stroke-amber-500',
      textClass: 'fill-amber-900 dark:fill-amber-100',
    }
  }
  if (state === 'completed') {
    return {
      fillClass: 'fill-emerald-100 dark:fill-emerald-900/50',
      strokeClass: 'stroke-emerald-500',
      textClass: 'fill-emerald-900 dark:fill-emerald-100',
    }
  }
  if (state === 'failed') {
    return {
      fillClass: 'fill-red-100 dark:fill-red-900/50',
      strokeClass: 'stroke-red-500',
      textClass: 'fill-red-900 dark:fill-red-100',
    }
  }
  if (state === 'skipped') {
    return {
      fillClass: 'fill-muted dark:fill-muted',
      strokeClass: 'stroke-muted-foreground/60',
      textClass: 'fill-muted-foreground',
    }
  }
  // idle，按 type 染色
  if (type === 'user_input') return {
    fillClass: 'fill-pink-100 dark:fill-pink-900/40',
    strokeClass: 'stroke-pink-400 dark:stroke-pink-700',
    textClass: 'fill-foreground/80',
  }
  if (type === 'llm') return {
    fillClass: 'fill-orange-100 dark:fill-orange-900/40',
    strokeClass: 'stroke-orange-400 dark:stroke-orange-700',
    textClass: 'fill-foreground/80',
  }
  return {
    fillClass: 'fill-sky-100 dark:fill-sky-900/40',
    strokeClass: 'stroke-sky-400 dark:stroke-sky-700',
    textClass: 'fill-foreground/80',
  }
}

function statusLabel(s: Props['status']): string {
  return s === 'running' ? '运行中'
       : s === 'waiting_user_input' ? '等待输入'
       : s === 'completed' ? '已完成'
       : s === 'failed' ? '失败'
       : '已取消'
}

function statusDotClass(s: Props['status']): string {
  const base = 'inline-block w-2 h-2 rounded-full shrink-0'
  if (s === 'running') return `${base} bg-amber-500 animate-pulse`
  if (s === 'waiting_user_input') return `${base} bg-sky-500`
  if (s === 'completed') return `${base} bg-emerald-500`
  if (s === 'failed') return `${base} bg-destructive`
  return `${base} bg-muted-foreground`
}
