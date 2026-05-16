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

export function makeAskUser(): AskUserNode {
  return {
    id: newNodeId(),
    type: 'ask_user',
    outputVar: 'input',
    fields: [
      { key: 'value', label: '请输入', type: 'text', required: true },
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
      { name: 'result', type: 'string' },
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
