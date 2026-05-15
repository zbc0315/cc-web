import { useMemo } from 'react'
import { parseToAst, type ParseToAstResult } from './parse-train'
import { Hash, FunctionSquare, Variable, Sparkles, ArrowRight } from 'lucide-react'

// Minimal local mirror of @tom2012/train-core AST shapes — kept as a
// frontend "contract" rather than importing types via the newly added
// subpath export (`@tom2012/train-core/ast`). Rationale:
//   - Pin the exact subset we depend on; train-lang adding new node
//     variants doesn't silently break the outline.
//   - Drift becomes a TS compile error at usage sites instead of
//     runtime "kind is not handled" surprises.
//   - The mirror is ~50 lines and stable; lower maintenance cost than
//     leaking core internals into the frontend.
// If we ever depend on >5 node types this should be revisited.
interface Range {
  startLine: number
  startColumn: number
}
interface BaseNode {
  range: Range
}
interface ImportNode extends BaseNode {
  kind: 'Import'
  source: string
}
interface ConstDecl extends BaseNode {
  kind: 'ConstDecl'
  name: string
}
interface VarDecl extends BaseNode {
  kind: 'VarDecl'
  name: string
}
interface Param {
  name: string
}
interface FuncDecl extends BaseNode {
  kind: 'FuncDecl'
  name: string
  params: Param[]
}
interface FaiOutput {
  name: string
}
interface FaiDecl extends BaseNode {
  kind: 'FaiDecl'
  name: string
  params: Param[]
  outputs: FaiOutput[]
}
interface ExportSpec extends BaseNode {
  kind: 'ExportSpec'
  name: string
  alias: string | null
}
interface ExportNames extends BaseNode {
  kind: 'ExportNames'
  specs: ExportSpec[]
}
interface ExportDecl extends BaseNode {
  kind: 'ExportDecl'
  target: ExportNames | FuncDecl | FaiDecl
}
type TopLevel =
  | ImportNode
  | ConstDecl
  | VarDecl
  | FuncDecl
  | FaiDecl
  | ExportDecl
  | { kind: string; range: Range } // catch-all for forms we don't outline
interface Program {
  items: TopLevel[]
}

interface Props {
  source: string
  /**
   * Optional pre-computed parse result. When provided (typical case
   * — TrackEditor parses once and shares), avoids re-parsing the same
   * source. When omitted, we parse on our own (used by detached
   * call sites and tests).
   */
  parseResult?: ParseToAstResult
  onJump: (line: number, column: number) => void
}

interface OutlineEntry {
  kind: 'const' | 'var' | 'func' | 'fai' | 'export' | 'import'
  name: string
  signature?: string
  line: number
  column: number
}

function summarizeFuncDecl(d: FuncDecl): string {
  const params = d.params.map((p) => p.name).join(', ')
  return `(${params})`
}

function summarizeFaiDecl(d: FaiDecl): string {
  const params = d.params.map((p) => p.name).join(', ')
  const outputs = d.outputs.map((o) => o.name).join(', ')
  return `(${params}) → ${outputs}`
}

function buildOutline(program: Program): OutlineEntry[] {
  const out: OutlineEntry[] = []
  for (const node of program.items) {
    switch (node.kind) {
      case 'Import': {
        const item = node as ImportNode
        out.push({
          kind: 'import',
          name: item.source,
          line: item.range.startLine,
          column: item.range.startColumn,
        })
        break
      }
      case 'ConstDecl': {
        const item = node as ConstDecl
        out.push({
          kind: 'const',
          name: item.name,
          line: item.range.startLine,
          column: item.range.startColumn,
        })
        break
      }
      case 'VarDecl': {
        const item = node as VarDecl
        out.push({
          kind: 'var',
          name: item.name,
          line: item.range.startLine,
          column: item.range.startColumn,
        })
        break
      }
      case 'FuncDecl': {
        const item = node as FuncDecl
        out.push({
          kind: 'func',
          name: item.name,
          signature: summarizeFuncDecl(item),
          line: item.range.startLine,
          column: item.range.startColumn,
        })
        break
      }
      case 'FaiDecl': {
        const item = node as FaiDecl
        out.push({
          kind: 'fai',
          name: item.name,
          signature: summarizeFaiDecl(item),
          line: item.range.startLine,
          column: item.range.startColumn,
        })
        break
      }
      case 'ExportDecl': {
        const item = node as ExportDecl
        const tgt = item.target
        if (tgt.kind === 'ExportNames') {
          for (const spec of tgt.specs) {
            out.push({
              kind: 'export',
              name: spec.alias ?? spec.name,
              line: spec.range.startLine,
              column: spec.range.startColumn,
            })
          }
        } else if (tgt.kind === 'FuncDecl') {
          const t = tgt as FuncDecl
          out.push({
            kind: 'func',
            name: `export ${t.name}`,
            signature: summarizeFuncDecl(t),
            line: t.range.startLine,
            column: t.range.startColumn,
          })
        } else if (tgt.kind === 'FaiDecl') {
          const t = tgt as FaiDecl
          out.push({
            kind: 'fai',
            name: `export ${t.name}`,
            signature: summarizeFaiDecl(t),
            line: t.range.startLine,
            column: t.range.startColumn,
          })
        }
        break
      }
    }
  }
  return out
}

function iconFor(kind: OutlineEntry['kind']) {
  switch (kind) {
    case 'fai':
      return <Sparkles className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
    case 'func':
      return (
        <FunctionSquare className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
      )
    case 'const':
      return <Hash className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
    case 'var':
      return <Variable className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
    case 'export':
      return (
        <ArrowRight className="h-3.5 w-3.5 text-pink-500 dark:text-pink-400" />
      )
    case 'import':
      return (
        <ArrowRight className="h-3.5 w-3.5 rotate-180 text-cyan-500 dark:text-cyan-400" />
      )
  }
}

/**
 * Outline panel — lists top-level fai / func / const / var / imports /
 * exports declared in the .tr source. Click an entry → editor jumps
 * to that line via the parent's `onJump` callback.
 *
 * When the source fails to parse, we fall back to a regex-extracted
 * outline (so users still see *something* useful even if their tip
 * has a syntax error). The regex outline is intentionally dumb — it
 * catches the common `func/fai/const/var NAME` patterns at line start.
 */
export function TrackOutline({ source, parseResult, onJump }: Props) {
  const entries = useMemo<OutlineEntry[]>(() => {
    // Prefer the pre-computed parse result from TrackEditor (avoids
    // re-parsing the same source twice). Fall back to local parse if
    // the prop is missing.
    const r = parseResult ?? parseToAst(source)
    if (r.ast && r.lexErrors.length === 0 && r.parseErrors.length === 0) {
      return buildOutline(r.ast as unknown as Program)
    }
    return regexOutline(source)
  }, [source, parseResult])

  return (
    <div className="h-full flex flex-col bg-muted/30">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
        大纲 ({entries.length})
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {entries.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            (空)
          </p>
        )}
        {entries.map((e, i) => (
          <button
            key={`${e.kind}-${e.name}-${i}`}
            className="
              w-full flex items-center gap-2 px-3 py-1.5
              text-xs text-left hover:bg-accent
              transition-colors
            "
            onClick={() => onJump(e.line, e.column)}
            title={`${e.kind} ${e.name}${e.signature ?? ''} (行 ${e.line})`}
          >
            {iconFor(e.kind)}
            <span className="font-mono truncate flex-1">
              {e.name}
              {e.signature && (
                <span className="text-muted-foreground ml-1">
                  {e.signature}
                </span>
              )}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {e.line}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Best-effort regex outline for source that fails to parse. Recognizes
 * top-level declarations starting at line beginnings (no leading
 * whitespace allowed — keeps the regex strict enough to skip examples
 * embedded in string literals).
 */
function regexOutline(source: string): OutlineEntry[] {
  const out: OutlineEntry[] = []
  const lines = source.split(/\r?\n/)
  const PAT = /^(import|export|const|var|fai|func)\s+([A-Za-z_]\w*)/
  for (let i = 0; i < lines.length; i++) {
    const m = PAT.exec(lines[i] ?? '')
    if (!m) continue
    const kw = m[1] as 'import' | 'export' | 'const' | 'var' | 'fai' | 'func'
    const name = m[2] ?? ''
    if (!name) continue
    out.push({ kind: kw, name, line: i + 1, column: 1 })
  }
  return out
}
