import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  filename: string
  initialSource: string
  onCancel: () => void
  onSave: (source: string) => void | Promise<void>
}

/**
 * Track editor — .tr source code editor.
 *
 * T2 implementation uses a plain `<textarea>` with monospace font.
 * **No syntax highlighting** in T2 — Monaco-based highlighting +
 * parse-on-type diagnostics arrive in T2.5. Errors surface at save
 * time (toast) and at run time (TrackStatusBar.error).
 *
 * Display:
 *   [filename header]   [save / cancel buttons]
 *   ──────────────────────────────────────────
 *   [textarea (fills remaining space)]
 *   ──────────────────────────────────────────
 *   [.tr quick reference / placeholder hint]
 */
export function TrackEditor({ filename, initialSource, onCancel, onSave }: Props) {
  const [source, setSource] = useState(initialSource)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(source)
    } finally {
      setSaving(false)
    }
  }

  // Cmd/Ctrl+S → save
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-mono text-muted-foreground truncate flex-1">
          {filename}
        </span>
        <Button onClick={onCancel} variant="ghost" size="sm">
          取消
        </Button>
        <Button onClick={handleSave} size="sm" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>

      <textarea
        className="
          flex-1 min-h-0 font-mono text-sm leading-relaxed
          rounded-md border border-border bg-background
          px-3 py-2 resize-none
          focus:outline-none focus:ring-1 focus:ring-ring
          whitespace-pre overflow-auto
        "
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
      />

      <p className="text-xs text-muted-foreground flex-shrink-0">
        .tr 源码 · train-lang DSL · Cmd/Ctrl+S 保存 · 语法高亮 + AST
        可视化将在 T2.5 加入
      </p>
    </div>
  )
}
