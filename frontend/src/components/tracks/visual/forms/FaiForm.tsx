import type { FaiInput, FaiNode, FaiOutput, PromptSegment } from '../graph-types'
import { VarRefInput } from '../VarRefInput'

interface Props {
  node: FaiNode
  candidates: string[]
  onChange: (patch: Partial<FaiNode>) => void
}

export function FaiForm({ node, candidates, onChange }: Props) {
  function updateInput(idx: number, patch: Partial<FaiInput>): void {
    onChange({ inputs: node.inputs.map((i, k) => (k === idx ? { ...i, ...patch } : i)) })
  }
  function addInput(): void {
    const existingNames = new Set(node.inputs.map((i) => i.argName))
    let n = node.inputs.length + 1
    while (existingNames.has('arg' + n)) n++
    onChange({
      inputs: [...node.inputs, { argName: 'arg' + n, argType: 'string', source: { kind: 'lit', raw: '""' } }],
    })
  }
  function removeInput(idx: number): void {
    onChange({ inputs: node.inputs.filter((_, k) => k !== idx) })
  }

  function updateOutput(idx: number, patch: Partial<FaiOutput>): void {
    onChange({ outputs: node.outputs.map((o, k) => (k === idx ? { ...o, ...patch } : o)) })
  }
  function addOutput(): void {
    const existingNames = new Set(node.outputs.map((o) => o.name))
    let n = node.outputs.length + 1
    while (existingNames.has('out' + n)) n++
    onChange({ outputs: [...node.outputs, { name: 'out' + n, type: 'string' }] })
  }
  function removeOutput(idx: number): void {
    onChange({ outputs: node.outputs.filter((_, k) => k !== idx) })
  }

  // Serialize prompt template as plain text with `@{path}` placeholders.
  // Re-parse on every keystroke into PromptSegment[].
  const promptAsText = node.promptTemplate.map((s) => s.kind === 'text' ? s.raw : `@{${s.path.join('.')}}`).join('')
  function setPromptText(raw: string): void {
    const segments: PromptSegment[] = []
    let i = 0
    while (i < raw.length) {
      const at = raw.indexOf('@{', i)
      if (at === -1) {
        segments.push({ kind: 'text', raw: raw.slice(i) })
        break
      }
      if (at > i) segments.push({ kind: 'text', raw: raw.slice(i, at) })
      const close = raw.indexOf('}', at + 2)
      if (close === -1) {
        segments.push({ kind: 'text', raw: raw.slice(at) })
        break
      }
      const path = raw.slice(at + 2, close).split('.').filter((s) => s.length > 0)
      if (path.length > 0) segments.push({ kind: 'ref', path })
      else segments.push({ kind: 'text', raw: raw.slice(at, close + 1) })
      i = close + 1
    }
    onChange({ promptTemplate: segments })
  }

  return (
    <div className="p-4 flex flex-col gap-4 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-20">fai 名:</span>
        <input value={node.faiName} onChange={(e) => onChange({ faiName: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-gray-600 w-20">输出变量名:</span>
        <input value={node.outputVar} onChange={(e) => onChange({ outputVar: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
      </label>

      <div>
        <div className="text-gray-600 mb-1">输入:</div>
        {node.inputs.map((i, k) => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <input value={i.argName} onChange={(e) => updateInput(k, { argName: e.target.value })}
              className="px-2 py-0.5 rounded border border-gray-300 font-mono w-28" />
            <select value={i.argType} onChange={(e) => updateInput(k, { argType: e.target.value as FaiInput['argType'] })}
              className="px-2 py-0.5 rounded border border-gray-300">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="bool">bool</option>
              <option value="prompt">prompt</option>
            </select>
            <span>=</span>
            <VarRefInput value={i.source} candidates={candidates}
              onChange={(v) => updateInput(k, { source: v })} />
            <button type="button" onClick={() => removeInput(k)} className="text-red-600 text-xs ml-auto">×</button>
          </div>
        ))}
        <button type="button" onClick={addInput} className="text-blue-600 text-xs">+ 添加输入</button>
      </div>

      <div>
        <div className="text-gray-600 mb-1">输出 (schema):</div>
        {node.outputs.map((o, k) => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <input value={o.name} onChange={(e) => updateOutput(k, { name: e.target.value })}
              className="px-2 py-0.5 rounded border border-gray-300 font-mono w-28" />
            <select value={o.type} onChange={(e) => updateOutput(k, { type: e.target.value as FaiOutput['type'] })}
              className="px-2 py-0.5 rounded border border-gray-300">
              <option value="string">string</option>
              <option value="int">int</option>
              <option value="number">number</option>
              <option value="bool">bool</option>
              <option value="array">array</option>
            </select>
            {o.type === 'array' && (
              <select value={o.innerType ?? 'string'} onChange={(e) => updateOutput(k, { innerType: e.target.value as FaiOutput['innerType'] })}
                className="px-2 py-0.5 rounded border border-gray-300">
                <option value="string">array&lt;string&gt;</option>
                <option value="int">array&lt;int&gt;</option>
                <option value="number">array&lt;number&gt;</option>
                <option value="bool">array&lt;bool&gt;</option>
              </select>
            )}
            <button type="button" onClick={() => removeOutput(k)} className="text-red-600 text-xs ml-auto">×</button>
          </div>
        ))}
        <button type="button" onClick={addOutput} className="text-blue-600 text-xs">+ 添加输出</button>
      </div>

      <div>
        <div className="text-gray-600 mb-1">Prompt（用 @{'{var.path}'} 引用上文变量）:</div>
        <textarea
          value={promptAsText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={5}
          className="w-full px-2 py-1 rounded border border-gray-300 font-mono text-sm"
        />
        <div className="text-xs text-gray-500 mt-1">
          可用变量: {candidates.slice(0, 8).map((c) => `@{${c}}`).join(' · ')}
          {candidates.length > 8 ? ` 等 ${candidates.length} 个` : ''}
        </div>
      </div>
    </div>
  )
}
