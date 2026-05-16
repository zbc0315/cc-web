// frontend/src/components/tracks/visual/default-nodes.ts
import type {
  AskUserNode,
  FaiNode,
  LetNode,
  ReturnNode,
  Node,
} from './graph-types'

export function newNodeId(): string {
  return 'n_' + Math.random().toString(36).slice(2, 10)
}

export function newItemId(): string {
  return 'i_' + Math.random().toString(36).slice(2, 10)
}

export function makeAskUser(): AskUserNode {
  return {
    id: newNodeId(),
    type: 'ask_user',
    outputVar: 'input',
    fields: [
      { id: newItemId(), key: 'value', label: '请输入', type: 'text', required: true },
    ],
  }
}

export function makeFai(): FaiNode {
  return {
    id: newNodeId(),
    type: 'fai',
    faiName: 'analyze',
    outputVar: 'r',
    inputs: [],
    outputs: [
      { id: newItemId(), name: 'result', type: 'string' },
    ],
    promptTemplate: [{ kind: 'text', raw: '请分析' }],
  }
}

export function makeLet(): LetNode {
  return {
    id: newNodeId(),
    type: 'let',
    varName: 'x',
    value: { kind: 'lit', raw: '0' },
  }
}

export function makeReturn(): ReturnNode {
  return {
    id: newNodeId(),
    type: 'return',
    value: { kind: 'lit', raw: 'null' },
  }
}

export const NODE_FACTORY: Record<Node['type'], () => Node> = {
  ask_user: makeAskUser,
  fai: makeFai,
  let: makeLet,
  return: makeReturn,
}

import type { TrackGraph } from './graph-types'

/**
 * Starter graph for the visual editor — mirrors STARTER_ASK_USER's
 * intent (ask user for a file path → AI analyzes it → return result).
 * Used when user creates a new track in node-graph mode.
 */
export function makeStarterGraph(trackName: string): TrackGraph {
  const askUser = makeAskUser()
  askUser.outputVar = 'input'
  askUser.fields = [
    { id: newItemId(), key: 'file_path', label: '要分析的文件路径', type: 'text', required: true },
  ]

  const fai = makeFai()
  fai.faiName = 'analyze'
  fai.outputVar = 'r'
  fai.inputs = [
    {
      id: newItemId(),
      argName: 'file_path',
      argType: 'string',
      source: { kind: 'var', path: ['input', 'file_path'] },
    },
  ]
  fai.outputs = [
    { id: newItemId(), name: 'rating', type: 'int', constraints: { min: 0, max: 10 } },
    { id: newItemId(), name: 'comment', type: 'string', constraints: { maxLen: 500 } },
  ]
  fai.promptTemplate = [
    { kind: 'text', raw: '请对 ' },
    { kind: 'ref', path: ['input', 'file_path'] },
    { kind: 'text', raw: ' 评分 0-10 并给出 500 字内评语' },
  ]

  const ret = makeReturn()
  ret.value = { kind: 'var', path: ['r'] }

  return {
    version: 1,
    trackName,
    body: [askUser, fai, ret],
  }
}
