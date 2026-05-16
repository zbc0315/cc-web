// frontend/src/components/tracks/visual/graph-types.ts

/** Top-level container for the whole visual track. */
export interface TrackGraph {
  version: 1
  trackName: string
  body: Node[]
}

export type Node = AskUserNode | FaiNode | LetNode | ReturnNode
// M2 will add: | IfNode | ForNode

export interface NodeBase {
  id: string  // n_xxxxxx, stable across edits, used for runtime nid mapping
  type: string
}

export interface AskUserNode extends NodeBase {
  type: 'ask_user'
  outputVar: string
  fields: AskUserField[]
}

export interface AskUserField {
  key: string
  label: string
  type: 'text' | 'number' | 'bool' | 'enum'
  variants?: string[]
  required?: boolean
}

export interface FaiNode extends NodeBase {
  type: 'fai'
  faiName: string
  outputVar: string
  inputs: FaiInput[]
  outputs: FaiOutput[]
  promptTemplate: PromptSegment[]
}

export interface FaiInput {
  argName: string
  argType: 'string' | 'number' | 'bool' | 'prompt'
  source: VarRef | Literal
}

export interface FaiOutput {
  name: string
  type: 'string' | 'number' | 'bool' | 'int' | 'array'
  innerType?: 'string' | 'number' | 'bool' | 'int'  // when type==='array'
  constraints?: { min?: number; max?: number; maxLen?: number }
}

export interface LetNode extends NodeBase {
  type: 'let'
  varName: string
  value: Expression
}

export interface ReturnNode extends NodeBase {
  type: 'return'
  value: Expression
}

/** Used inside Expression and Prompt — wrap a variable reference. */
export interface VarRef {
  kind: 'var'
  path: string[]   // ['r','rating'] = r.rating
}

/** Raw literal — copied verbatim into codegen output (so users decide quoting). */
export interface Literal {
  kind: 'lit'
  raw: string      // e.g. '"hello"', '42', 'true'
}

export type TripleOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | '+' | '-' | '*' | '/'

export interface TripleSlot {
  kind: 'triple'
  left: VarRef | Literal
  op: TripleOp
  right: VarRef | Literal
}

export type Expression = VarRef | Literal | TripleSlot

/** Segments forming a prompt: text + variable references interleaved. */
export type PromptSegment =
  | { kind: 'text'; raw: string }
  | { kind: 'ref'; path: string[] }

/** Path into a TrackGraph.body — sequence of child indices (for M2 nesting). */
export type NodePath = number[]
