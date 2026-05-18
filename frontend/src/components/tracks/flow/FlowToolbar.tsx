import { useState } from 'react'
import type { FlowV3 } from './flow-types-v3'
import { validateFlow } from './flow-validator'
import { deriveTrainJsonFromVariables } from './flow-sidecar-io'
import { saveFlow as apiSaveFlow } from '../api'

interface Props {
  flow: FlowV3
  projectId: string
  filename: string
  dirty: boolean
  onSaved: () => void
  onClose: () => void
}

export function FlowToolbar({ flow, projectId, filename, dirty, onSaved, onClose }: Props) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaveError(null)
    const v = validateFlow(flow)
    if (!v.ok) {
      setSaveError(`无法保存：${v.errors.map((e) => e.message).join('; ')}`)
      return
    }
    setSaving(true)
    try {
      const trainJson = deriveTrainJsonFromVariables(flow.variables)
      await apiSaveFlow(projectId, filename, flow, trainJson)
      onSaved()
    } catch (e) {
      setSaveError(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className="border-b bg-white px-3 py-2 flex items-center gap-2">
      <button onClick={onClose} className="text-sm text-gray-600 hover:text-black">←</button>
      <div className="font-mono text-sm">{filename}</div>
      {dirty && <span className="text-xs text-orange-500">●</span>}
      <div className="flex-1" />
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存'}
      </button>
      {saveError && (
        <div className="text-xs text-red-600 ml-2 max-w-md truncate" title={saveError}>{saveError}</div>
      )}
    </header>
  )
}
