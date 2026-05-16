// frontend/src/components/tracks/visual/codegen.ts
import type {
  AskUserNode,
  Expression,
  FaiNode,
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
import { isVarVisible } from './scope'

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
    .replace(/\t/g, '\\t')
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

// ── fai declaration shape & dedupe ────────────────────────────────────

interface FaiShape {
  faiName: string
  inputsKey: string
  outputsKey: string
  promptKey: string
}

function shapeOf(n: FaiNode): FaiShape {
  const inputsKey = n.inputs.map((i) => `${i.argName}:${i.argType}`).join('|')
  const outputsKey = n.outputs.map((o) => {
    const c = o.constraints ?? {}
    const cBits: string[] = []
    // Only emit range when both min and max set — matches what
    // renderFaiDeclaration actually outputs. Solo min/max is silently
    // ignored by both shape and codegen to avoid generating .tr that
    // train-lang's grammar rejects.
    if (c.min !== undefined && c.max !== undefined) {
      cBits.push(`range=${c.min}-${c.max}`)
    }
    if (c.maxLen !== undefined) cBits.push(`maxLen=${c.maxLen}`)
    const constraintTail = cBits.length ? `;${cBits.join(',')}` : ''
    if (o.type === 'array') return `${o.name}:array<${o.innerType ?? 'string'}>${constraintTail}`
    return `${o.name}:${o.type}${constraintTail}`
  }).join('|')
  const promptKey = JSON.stringify(n.promptTemplate)
  return { faiName: n.faiName, inputsKey, outputsKey, promptKey }
}

function shapeEq(a: FaiShape, b: FaiShape): boolean {
  return a.faiName === b.faiName && a.inputsKey === b.inputsKey
    && a.outputsKey === b.outputsKey && a.promptKey === b.promptKey
}

interface DedupedFai {
  declName: string
  declSource: string
  shape: FaiShape
}

interface DedupeResult {
  decls: DedupedFai[]
  nodeIdToDeclName: Map<string, string>
}

function dedupeFais(faiNodes: FaiNode[]): DedupeResult {
  const decls: DedupedFai[] = []
  const nodeIdToDeclName = new Map<string, string>()

  for (const n of faiNodes) {
    const sh = shapeOf(n)
    let match = decls.find((d) => shapeEq(d.shape, sh))
    if (!match) {
      let declName = sh.faiName
      let suffix = 2
      while (decls.some((d) => d.declName === declName)) {
        declName = `${sh.faiName}_${suffix++}`
      }
      match = {
        declName,
        declSource: renderFaiDeclaration(declName, n),
        shape: sh,
      }
      decls.push(match)
    }
    nodeIdToDeclName.set(n.id, match.declName)
  }

  return { decls, nodeIdToDeclName }
}

function renderFaiDeclaration(declName: string, n: FaiNode): string {
  const inputs = n.inputs.map((i) => `${i.argName}: ${i.argType}`).join(', ')
  const outputs = n.outputs.map((o) => {
    let typeStr: string = o.type
    if (o.type === 'array') typeStr = `array<${o.innerType ?? 'string'}>`
    const c = o.constraints ?? {}
    const cParts: string[] = []
    if (typeof c.min === 'number' && typeof c.max === 'number') cParts.push(`${c.min}-${c.max}`)
    if (typeof c.maxLen === 'number') cParts.push(`maxLen=${c.maxLen}`)
    const cSuffix = cParts.length ? ` ${cParts.join(' ')}` : ''
    return `${o.name}: ${typeStr}${cSuffix}`
  }).join(', ')
  return `fai ${declName}(${inputs}) -> ${outputs} { }`
}

function renderFaiCall(n: FaiNode, declName: string): string {
  const argValues = n.inputs.map((i) => {
    if (i.source.kind === 'var') return renderVarRef(i.source)
    return renderLiteral(i.source)
  })
  const promptStr = renderPrompt(n.promptTemplate)
  const allArgs = [...argValues, promptStr].join(', ')
  return [
    nidComment(n.id),
    `  let ${n.outputVar} = ${declName}(${allArgs})`,
  ].join('\n')
}

// ── Validation ────────────────────────────────────────────────────────

function validate(graph: TrackGraph, errors: CodegenError[]): void {
  const declaredNames = new Map<string, { index: number; id: string }>()

  for (let i = 0; i < graph.body.length; i++) {
    const n = graph.body[i]!
    for (const ref of collectVarRefs(n)) {
      if (!isVarVisible(graph, i, ref.path)) {
        errors.push({
          nodeIndex: i, nodeId: n.id,
          message: `variable "${ref.path.join('.')}" not visible at this position`,
        })
      }
    }
    const declared = nodeDeclaredName(n)
    if (declared) {
      const prev = declaredNames.get(declared)
      if (prev) {
        errors.push({
          nodeIndex: i, nodeId: n.id,
          message: `name "${declared}" already declared at node #${prev.index}`,
        })
      } else {
        declaredNames.set(declared, { index: i, id: n.id })
      }
    }
  }
}

function nodeDeclaredName(n: Node): string | null {
  if (n.type === 'ask_user') return n.outputVar
  if (n.type === 'fai') return n.outputVar
  if (n.type === 'let') return n.varName
  return null
}

function collectVarRefs(n: Node): VarRef[] {
  const out: VarRef[] = []
  if (n.type === 'fai') {
    for (const i of n.inputs) {
      if (i.source.kind === 'var') out.push(i.source)
    }
    for (const seg of n.promptTemplate) {
      if (seg.kind === 'ref') out.push({ kind: 'var', path: seg.path })
    }
  } else if (n.type === 'let') {
    pushExprRefs(n.value, out)
  } else if (n.type === 'return') {
    pushExprRefs(n.value, out)
  }
  return out
}

function pushExprRefs(e: Expression, out: VarRef[]): void {
  if (e.kind === 'var') { out.push(e); return }
  if (e.kind === 'triple') {
    if (e.left.kind === 'var') out.push(e.left)
    if (e.right.kind === 'var') out.push(e.right)
  }
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
  const errors: CodegenError[] = []

  validate(graph, errors)
  if (errors.length > 0) return { ok: false, errors }

  // 1. Collect fai nodes and dedupe shapes
  const faiNodes: FaiNode[] = []
  for (const n of graph.body) {
    if (n.type === 'fai') faiNodes.push(n)
  }
  const dedupe = dedupeFais(faiNodes)

  // 2. Render body
  const bodyLines: string[] = []
  for (let i = 0; i < graph.body.length; i++) {
    const n = graph.body[i]!
    bodyLines.push(renderNodeFlat(n, i, errors, dedupe))
  }

  if (errors.length > 0) return { ok: false, errors }

  const declSection = dedupe.decls.length === 0
    ? ''
    : dedupe.decls.map((d) => d.declSource).join('\n\n') + '\n\n'

  const source = [
    MARKER_LINE,
    NOTICE_LINE,
    '',
    declSection,
    `func main() -> any {`,
    bodyLines.join('\n'),
    `}`,
    `export main`,
    '',
  ].join('\n')
  return { ok: true, source }
}

function renderNodeFlat(
  n: Node,
  index: number,
  errors: CodegenError[],
  dedupe: DedupeResult,
): string {
  if (n.type === 'ask_user') return renderAskUser(n)
  if (n.type === 'let') return renderLet(n)
  if (n.type === 'return') return renderReturn(n)
  if (n.type === 'fai') {
    const declName = dedupe.nodeIdToDeclName.get(n.id)
    if (!declName) {
      errors.push({ nodeIndex: index, nodeId: n.id, message: 'fai dedupe lost node' })
      return ''
    }
    return renderFaiCall(n, declName)
  }
  errors.push({ nodeIndex: index, nodeId: (n as Node).id, message: `unknown node type` })
  return `  // <unknown ${(n as Node).id}>`
}
