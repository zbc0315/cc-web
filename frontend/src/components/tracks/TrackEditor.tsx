import { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react'
import { Button } from '@/components/ui/button'
import { TrackOutline } from './TrackOutline'
import { registerTrainLanguage } from './train-monaco-lang'
import { parseToAst, type ParseToAstResult } from './parse-train'
import { useTheme } from '@/components/theme-provider'
import type * as monaco from 'monaco-editor'

// Lazy-load both Monaco React wrapper AND the Monaco core itself.
// - @monaco-editor/react by default fetches Monaco core from a CDN
//   (jsdelivr), which breaks LAN/offline deployments.
// - We instead bundle Monaco locally via `monaco-editor` and route
//   `loader.config({ monaco })` so all assets come from our origin.
// - Both still go through dynamic import so the initial bundle is
//   unaffected — Monaco (~5MB) is only fetched when the editor opens.
const Editor = lazy(async () => {
  const [{ default: monacoLib }, reactWrapper] = await Promise.all([
    import('monaco-editor'),
    import('@monaco-editor/react'),
  ])
  reactWrapper.loader.config({ monaco: monacoLib as never })
  return { default: reactWrapper.default }
})

interface Props {
  filename: string
  initialSource: string
  onCancel: () => void
  onSave: (source: string) => void | Promise<void>
}

interface ParseDiagnostic {
  line: number
  column: number
  endLine: number
  endColumn: number
  message: string
}

interface ChevrotainLexError {
  offset?: number
  line?: number
  column?: number
  length?: number
  message?: string
}

interface ChevrotainParseError {
  message?: string
  name?: string
  token?: {
    startOffset?: number
    startLine?: number
    startColumn?: number
    endLine?: number
    endColumn?: number
    image?: string
  }
}

function extractDiagnostics(
  lex: ReadonlyArray<unknown>,
  parse: ReadonlyArray<unknown>,
): ParseDiagnostic[] {
  const out: ParseDiagnostic[] = []
  for (const raw of lex) {
    const e = raw as ChevrotainLexError
    const line = e.line ?? 1
    const column = e.column ?? 1
    const length = e.length ?? 1
    out.push({
      line,
      column,
      endLine: line,
      endColumn: column + length,
      message: e.message ?? 'lex error',
    })
  }
  for (const raw of parse) {
    const e = raw as ChevrotainParseError
    const line = e.token?.startLine ?? 1
    const column = e.token?.startColumn ?? 1
    const len = e.token?.image?.length ?? 1
    out.push({
      line,
      column,
      endLine: line,
      endColumn: column + len,
      message: `${e.name ?? 'ParseError'}: ${e.message ?? ''}`,
    })
  }
  return out
}

/**
 * Track editor — Monaco + parse-on-type.
 *
 * - Monaco editor with `train` language registered (syntax highlighting
 *   via `train-monaco-lang.ts`).
 * - Source changes are debounced (~250ms) → parsed via
 *   `@train-lang/core`'s `parseToAst` → lex/parse errors pushed as
 *   Monaco model markers so they render as red underlines + appear in
 *   Monaco's "Problems" panel.
 * - Side outline (TrackOutline) lists fai/func/const/var declarations
 *   with click-to-jump.
 * - Cmd/Ctrl+S → save.
 */
export function TrackEditor({ filename, initialSource, onCancel, onSave }: Props) {
  const { resolved } = useTheme()
  const [source, setSource] = useState(initialSource)
  const [saving, setSaving] = useState(false)
  // Single parse result shared with TrackOutline so we don't re-parse
  // the same source twice on every keystroke.
  const [parseResult, setParseResult] = useState<ParseToAstResult>(() =>
    parseToAst(initialSource),
  )
  const diagnostics = useMemo<ParseDiagnostic[]>(
    () => extractDiagnostics(parseResult.lexErrors, parseResult.parseErrors),
    [parseResult],
  )
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parse the current source and update parseResult + Monaco markers.
  const reparse = useCallback((src: string) => {
    try {
      const r = parseToAst(src)
      setParseResult(r)
      const diags = extractDiagnostics(r.lexErrors, r.parseErrors)

      const m = monacoRef.current
      const ed = editorRef.current
      if (m && ed) {
        const model = ed.getModel()
        if (model) {
          m.editor.setModelMarkers(
            model,
            'train-parser',
            diags.map((d) => ({
              startLineNumber: d.line,
              startColumn: d.column,
              endLineNumber: d.endLine,
              endColumn: d.endColumn,
              message: d.message,
              severity: m.MarkerSeverity.Error,
            })),
          )
        }
      }
    } catch (e) {
      // Parser crash — emit a synthetic parseError so TrackOutline can
      // still display the regex-fallback outline.
      setParseResult({
        ast: null,
        lexErrors: [],
        parseErrors: [
          {
            message: `parser crashed: ${(e as Error).message}`,
            name: 'ParserCrash',
            token: { startLine: 1, startColumn: 1, image: '' },
          },
        ],
      })
    }
  }, [])

  // Reparse on source change with debounce
  useEffect(() => {
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current)
    parseTimerRef.current = setTimeout(() => reparse(source), 250)
    return () => {
      if (parseTimerRef.current) clearTimeout(parseTimerRef.current)
    }
  }, [source, reparse])

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(source)
    } finally {
      setSaving(false)
    }
  }, [saving, source, onSave])

  // Cmd/Ctrl+S — bind via Monaco's keybinding API after mount.
  const handleMount = (
    editor: monaco.editor.IStandaloneCodeEditor,
    m: typeof monaco,
  ) => {
    editorRef.current = editor
    monacoRef.current = m
    registerTrainLanguage(m)
    m.editor.setModelLanguage(editor.getModel()!, 'train')

    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      void handleSave()
    })

    // Push current diagnostics as Monaco markers (the markers ref was
    // null when the synchronous initial parse ran in component init).
    reparse(source)
  }

  // Click-to-jump from outline
  const handleJump = (line: number, column: number) => {
    const ed = editorRef.current
    if (!ed) return
    ed.revealLineInCenter(line)
    ed.setPosition({ lineNumber: line, column })
    ed.focus()
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-mono text-muted-foreground truncate flex-1">
          {filename}
        </span>
        {diagnostics.length > 0 ? (
          <span className="text-xs text-red-600 dark:text-red-400">
            {diagnostics.length} 个问题
          </span>
        ) : (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            语法正确
          </span>
        )}
        <Button onClick={onCancel} variant="ghost" size="sm">
          取消
        </Button>
        <Button onClick={handleSave} size="sm" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>

      <div className="flex gap-2 flex-1 min-h-0">
        <div className="flex-1 min-w-0 rounded-md border border-border overflow-hidden">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                加载编辑器…
              </div>
            }
          >
            <Editor
              height="100%"
              defaultLanguage="train"
              language="train"
              value={source}
              onChange={(v) => setSource(v ?? '')}
              onMount={handleMount}
              theme={resolved === 'dark' ? 'vs-dark' : 'vs'}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                tabSize: 2,
                insertSpaces: true,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </Suspense>
        </div>

        <div className="w-56 flex-shrink-0 rounded-md border border-border overflow-hidden">
          <TrackOutline parseResult={parseResult} source={source} onJump={handleJump} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground flex-shrink-0">
        .tr 源码 · train-lang DSL · Cmd/Ctrl+S 保存 · 实时语法检查 +
        AST 大纲
      </p>
    </div>
  )
}
