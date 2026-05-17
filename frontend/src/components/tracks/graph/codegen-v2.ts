// frontend/src/components/tracks/graph/codegen-v2.ts
import type {
  AskUserNode, CodeNode, FaiNode, GraphV2, ReturnNode,
} from './graph-types-v2'
import {
  MARKER_LINE_V2, NOTICE_LINE_V2,
  codeNodeStartComment, codeNodeEndComment, nidComment,
} from './marker-v2'
import { topoOrderTopLevel } from './topo-codegen'

export interface CodegenError {
  nodeId?: string
  message: string
}

export interface CodegenResult {
  ok: boolean
  source?: string
  errors?: CodegenError[]
}

// ── Per-node renderers ────────────────────────────────────────────────

function renderCodeNode(n: CodeNode): string {
  const indented = n.code
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `  ${line}`))
    .join('\n')
  return [
    codeNodeStartComment(n.id),
    indented,
    codeNodeEndComment(n.id),
  ].join('\n')
}

function renderAskUser(n: AskUserNode): string {
  const fieldsLines = n.fields.map((f) => {
    const parts = [
      `key: ${JSON.stringify(f.key)}`,
      `label: ${JSON.stringify(f.label)}`,
      `type: ${JSON.stringify(f.type)}`,
    ]
    if (f.type === 'enum' && f.variants) {
      parts.push(`variants: [${f.variants.map((v) => JSON.stringify(v)).join(', ')}]`)
    }
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

function renderReturn(n: ReturnNode): string {
  return [
    nidComment(n.id),
    `  return ${n.valueExpr}`,
  ].join('\n')
}

// ── fai shape dedupe（沿用 v1 算法 + 自动追加 prompt: prompt 形参）────

interface FaiShape {
  faiName: string
  inputsKey: string
  outputsKey: string
  promptKey: string
}

function shapeOf(n: FaiNode): FaiShape {
  const inputsKey = n.inputs.map((i) => `${i.argName}:${i.argType}`).join('|')
  const outputsKey = n.outputs
    .map((o) => {
      const c = o.constraints ?? {}
      const cBits: string[] = []
      if (c.min !== undefined && c.max !== undefined) cBits.push(`range=${c.min}-${c.max}`)
      if (c.maxLen !== undefined) cBits.push(`maxLen=${c.maxLen}`)
      const ct = cBits.length ? `;${cBits.join(',')}` : ''
      if (o.type === 'array') return `${o.name}:array<${o.innerType ?? 'string'}>${ct}`
      return `${o.name}:${o.type}${ct}`
    })
    .join('|')
  return { faiName: n.faiName, inputsKey, outputsKey, promptKey: n.promptTemplate }
}

function shapeEq(a: FaiShape, b: FaiShape): boolean {
  return a.faiName === b.faiName
    && a.inputsKey === b.inputsKey
    && a.outputsKey === b.outputsKey
    && a.promptKey === b.promptKey
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
  // train-lang fai must declare `prompt: prompt` as the last formal arg
  // (v-17-b lesson #2 固化). renderFaiCall always appends the prompt string.
  const userInputs = n.inputs.map((i) => `${i.argName}: ${i.argType}`)
  const inputs = [...userInputs, 'prompt: prompt'].join(', ')
  const outputs = n.outputs
    .map((o) => {
      let typeStr: string = o.type
      if (o.type === 'array') typeStr = `array<${o.innerType ?? 'string'}>`
      const c = o.constraints ?? {}
      const cParts: string[] = []
      if (typeof c.min === 'number' && typeof c.max === 'number') cParts.push(`${c.min}-${c.max}`)
      if (typeof c.maxLen === 'number') cParts.push(`maxLen=${c.maxLen}`)
      const cSuffix = cParts.length ? ` ${cParts.join(' ')}` : ''
      return `${o.name}: ${typeStr}${cSuffix}`
    })
    .join(', ')
  return `fai ${declName}(${inputs}) -> ${outputs} { }`
}

function renderFaiCall(n: FaiNode, declName: string): string {
  const argValues = n.inputs.map((i) => i.sourceExpr)
  const promptStr = JSON.stringify(n.promptTemplate)
  const allArgs = [...argValues, promptStr].join(', ')
  return [
    nidComment(n.id),
    `  let ${n.outputVar} = ${declName}(${allArgs})`,
  ].join('\n')
}

// ── Entrypoint ────────────────────────────────────────────────────────

export function codegen(graph: GraphV2): CodegenResult {
  const topo = topoOrderTopLevel(graph.nodes, graph.edges)
  if (topo.errors.length > 0) {
    return { ok: false, errors: topo.errors.map((m) => ({ message: m })) }
  }

  // Collect fai nodes (M1: only top-level, since no frames)
  const faiNodes = topo.ordered.filter((n): n is FaiNode => n.type === 'fai')
  const dedupe = dedupeFais(faiNodes)

  const bodyLines: string[] = []
  for (const n of topo.ordered) {
    if (n.type === 'code') bodyLines.push(renderCodeNode(n))
    else if (n.type === 'ask_user') bodyLines.push(renderAskUser(n))
    else if (n.type === 'return') bodyLines.push(renderReturn(n))
    else if (n.type === 'fai') {
      const declName = dedupe.nodeIdToDeclName.get(n.id)
      if (!declName) {
        return { ok: false, errors: [{ nodeId: n.id, message: 'fai dedupe lost node' }] }
      }
      bodyLines.push(renderFaiCall(n, declName))
    }
  }

  const declSection =
    dedupe.decls.length === 0 ? '' : dedupe.decls.map((d) => d.declSource).join('\n\n') + '\n\n'

  const source = [
    MARKER_LINE_V2,
    NOTICE_LINE_V2,
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
