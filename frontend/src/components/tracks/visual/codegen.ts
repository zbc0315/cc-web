// frontend/src/components/tracks/visual/codegen.ts
import type {
  AskUserNode,
  Expression,
  LetNode,
  Literal,
  Node,
  PromptSegment,
  ReturnNode,
  TrackGraph,
  TripleSlot,
  VarRef,
} from './graph-types'
import { MARKER_LINE, NOTICE_LINE } from './marker'

// ── Expression / VarRef / Literal rendering ───────────────────────────

export function renderVarRef(v: VarRef): string {
  return v.path.join('.')
}

export function renderLiteral(l: Literal): string {
  return l.raw
}

export function renderTriple(t: TripleSlot): string {
  return `${renderAtom(t.left)} ${t.op} ${renderAtom(t.right)}`
}

function renderAtom(a: VarRef | Literal): string {
  return a.kind === 'var' ? renderVarRef(a) : renderLiteral(a)
}

export function renderExpression(e: Expression): string {
  if (e.kind === 'var') return renderVarRef(e)
  if (e.kind === 'lit') return renderLiteral(e)
  return renderTriple(e)
}

// ── Prompt template ───────────────────────────────────────────────────

/**
 * Render prompt segments as a train-lang interpolated string literal.
 * Refs become ${path.parts}. Text is escaped so user-typed $ doesn't
 * accidentally trigger interpolation.
 */
export function renderPrompt(segments: PromptSegment[]): string {
  let inner = ''
  for (const s of segments) {
    if (s.kind === 'text') {
      inner += escapeForTrainStringInterp(s.raw)
    } else {
      inner += '${' + s.path.join('.') + '}'
    }
  }
  return `"${inner}"`
}

function escapeForTrainStringInterp(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

// ── Per-node renderers ────────────────────────────────────────────────

function nidComment(id: string): string {
  return `  // @@nid: ${id}`
}

function renderAskUser(n: AskUserNode): string {
  const fieldsLines = n.fields.map((f) => {
    const parts = [`key: "${f.key}"`, `label: "${f.label}"`, `type: "${f.type}"`]
    if (f.variants) parts.push(`variants: [${f.variants.map((v) => `"${v}"`).join(', ')}]`)
    if (f.required === false) parts.push(`required: false`)
    return `      { ${parts.join(', ')} }`
  })
  return [
    nidComment(n.id),
    `  let ${n.outputVar} = __ccweb_ask_user({`,
    `    fields: [`,
    fieldsLines.join(',\n'),
    `    ]`,
    `  })`,
  ].join('\n')
}

function renderLet(n: LetNode): string {
  return [
    nidComment(n.id),
    `  let ${n.varName} = ${renderExpression(n.value)}`,
  ].join('\n')
}

function renderReturn(n: ReturnNode): string {
  return [
    nidComment(n.id),
    `  return ${renderExpression(n.value)}`,
  ].join('\n')
}

// ── Codegen entrypoint ────────────────────────────────────────────────

export interface CodegenResult {
  ok: boolean
  source?: string
  errors?: CodegenError[]
}

export interface CodegenError {
  nodeIndex: number
  nodeId: string
  message: string
}

export function codegen(graph: TrackGraph): CodegenResult {
  // T6 stub: no fai dedupe (T7), no validation (T8) yet.
  const errors: CodegenError[] = []

  const bodyLines: string[] = []
  for (let i = 0; i < graph.body.length; i++) {
    const n = graph.body[i]!
    bodyLines.push(renderNodeFlat(n, i, errors))
  }

  if (errors.length > 0) return { ok: false, errors }

  const source = [
    MARKER_LINE,
    NOTICE_LINE,
    '',
    `func main() -> any {`,
    bodyLines.join('\n'),
    `}`,
    `export main`,
    '',
  ].join('\n')
  return { ok: true, source }
}

function renderNodeFlat(n: Node, index: number, errors: CodegenError[]): string {
  if (n.type === 'ask_user') return renderAskUser(n)
  if (n.type === 'let') return renderLet(n)
  if (n.type === 'return') return renderReturn(n)
  if (n.type === 'fai') {
    // T7 will fill this in. M1-T6 stub:
    errors.push({ nodeIndex: index, nodeId: n.id, message: 'fai not yet codegenable (Task 7)' })
    return `  // <fai placeholder ${n.id}>`
  }
  errors.push({ nodeIndex: index, nodeId: (n as Node).id, message: `unknown node type` })
  return `  // <unknown ${(n as Node).id}>`
}
