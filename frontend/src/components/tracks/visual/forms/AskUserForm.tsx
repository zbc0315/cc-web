import type { AskUserField, AskUserNode } from '../graph-types'
import { newItemId } from '../default-nodes'

interface Props {
  node: AskUserNode
  onChange: (patch: Partial<AskUserNode>) => void
}

export function AskUserForm({ node, onChange }: Props) {
  function updateField(idx: number, patch: Partial<AskUserField>): void {
    const fields = node.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f))
    onChange({ fields })
  }
  function addField(): void {
    const existingKeys = new Set(node.fields.map((f) => f.key))
    let n = node.fields.length + 1
    while (existingKeys.has('field_' + n)) n++
    onChange({
      fields: [...node.fields, { id: newItemId(), key: 'field_' + n, label: '', type: 'text', required: true }],
    })
  }
  function removeField(idx: number): void {
    onChange({ fields: node.fields.filter((_, i) => i !== idx) })
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600">变量名:</span>
        <input
          type="text"
          value={node.outputVar}
          onChange={(e) => onChange({ outputVar: e.target.value })}
          className="px-2 py-0.5 rounded border border-gray-300 text-sm font-mono"
        />
      </label>

      <div>
        <div className="text-sm text-gray-600 mb-1">字段:</div>
        {node.fields.map((f, i) => (
          <div key={f.id} className="border border-gray-200 rounded p-2 mb-2 flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">key</span>
              <input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })}
                className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1" />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">label</span>
              <input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })}
                className="px-2 py-0.5 rounded border border-gray-300 flex-1" />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">type</span>
              <select value={f.type} onChange={(e) => {
                const newType = e.target.value as AskUserField['type']
                updateField(i, newType === 'enum' ? { type: newType } : { type: newType, variants: undefined })
              }}
                className="px-2 py-0.5 rounded border border-gray-300">
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="bool">bool</option>
                <option value="enum">enum</option>
              </select>
            </label>
            {f.type === 'enum' && (
              <label className="flex items-center gap-2">
                <span className="w-12 text-gray-500">variants</span>
                <input
                  value={(f.variants ?? []).join(',')}
                  onChange={(e) => updateField(i, { variants: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="a,b,c"
                  className="px-2 py-0.5 rounded border border-gray-300 font-mono flex-1"
                />
              </label>
            )}
            <label className="flex items-center gap-2">
              <span className="w-12 text-gray-500">required</span>
              <input type="checkbox" checked={f.required !== false} onChange={(e) => updateField(i, { required: e.target.checked })} />
            </label>
            <button type="button" onClick={() => removeField(i)} className="text-red-600 text-xs self-end">删除该字段</button>
          </div>
        ))}
        <button type="button" onClick={addField} className="text-blue-600 text-sm">+ 添加字段</button>
      </div>
    </div>
  )
}
