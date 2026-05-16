import type { PromptSegment } from '../graph-types'

interface Props {
  segments: PromptSegment[]
  candidates: string[]   // for marking broken refs
}

export function PromptPreview({ segments, candidates }: Props) {
  if (segments.length === 0) {
    return <div className="text-xs italic text-gray-400">（空 prompt）</div>
  }
  const candSet = new Set(candidates)
  return (
    <div className="text-sm font-mono leading-relaxed border border-gray-200 rounded p-2 bg-gray-50">
      {segments.map((s, i) => {
        if (s.kind === 'text') {
          return (
            <span key={i} className="whitespace-pre-wrap">
              {s.raw}
            </span>
          )
        }
        const path = s.path.join('.')
        const valid = candSet.has(path)
        const cls = valid
          ? 'bg-blue-100 text-blue-800 border border-blue-300'
          : 'bg-red-100 text-red-800 border border-red-300'
        return (
          <span
            key={i}
            className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded ${cls}`}
            title={valid ? '' : `引用未找到: ${path}`}
          >
            @{path}
          </span>
        )
      })}
    </div>
  )
}
