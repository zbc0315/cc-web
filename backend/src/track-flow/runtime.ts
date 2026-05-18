import { translatePrompt, type VarDecl } from './prompt-translator'
import { parseIfExpr } from './if-expr-parser'
import { evaluateIfExpr } from './if-expr-evaluator'
import { dispatchLlmCall, type Injector } from './llm-dispatcher'
import { appendAudit } from './audit-log'
import { flowRunRegistry, type RunInfo } from './run-registry'

// ── 简化版 FlowV3 类型（避免引入 frontend types）────────────────────────

export interface FlowV3 {
  version: 3
  trackName: string
  adapter: 'claude-code' | 'codex' | 'qwen' | 'gemini'
  variables: VarDecl[]
  nodes: NodeV3[]
  edges: EdgeV3[]
}

export type NodeV3 = UserInputNode | LLMNode | IfNode

export interface NodeBase {
  id: string
  position: { x: number; y: number }
}

export interface UserInputNode extends NodeBase {
  type: 'user_input'
  fields: { varKey: string; uiHint?: string; variants?: string[] }[]
}

export interface LLMNode extends NodeBase {
  type: 'llm'
  promptTemplate: string
  inputs: string[]
  outputs: string[]
}

export interface IfNode extends NodeBase {
  type: 'if'
  conditionExpr: string
}

export interface EdgeV3 {
  id: string
  source: string
  sourceHandle?: 'default' | 'true' | 'false'
  target: string | null
}

// ── Runtime 接口 ───────────────────────────────────────────────────────

export interface RuntimeDeps {
  projectFolder: string         // CLI cwd
  basename: string              // flow 文件 basename
  runId: string
  injector: Injector            // terminal-manager 注入器
  broadcast: (event: string, payload: Record<string, unknown>) => void
  // v-h: PTY ref getter，给 llm-dispatcher 做 PTY crash 检测。optional 以便
  // 测试用 mock injector 不强制提供。
  getTerminalRef?: () => object | null
}

export interface UserInputPromise {
  resolve: (values: Record<string, unknown>) => void
  reject: (err: Error) => void
}

const pendingUserInput = new Map<string, UserInputPromise>()  // runId → promise

/**
 * Submit user input from frontend. Resolves the runtime's await.
 */
export function submitUserInputForRun(runId: string, values: Record<string, unknown>): boolean {
  const p = pendingUserInput.get(runId)
  if (!p) return false
  pendingUserInput.delete(runId)
  p.resolve(values)
  return true
}

/**
 * Find entry node：no incoming edge.
 */
function findEntryNode(flow: FlowV3): NodeV3 | null {
  const incoming = new Set<string>()
  for (const e of flow.edges) {
    if (e.target !== null) incoming.add(e.target)
  }
  for (const n of flow.nodes) {
    if (!incoming.has(n.id)) return n
  }
  return null
}

/**
 * Pick next node id (or null for end) given current node + which sourceHandle was taken.
 */
function pickNext(flow: FlowV3, nodeId: string, sourceHandle: 'default' | 'true' | 'false'): string | null {
  for (const e of flow.edges) {
    if (e.source === nodeId && (e.sourceHandle ?? 'default') === sourceHandle) {
      return e.target  // 可能 null
    }
  }
  return null
}

// ── 主驱动函数 ──────────────────────────────────────────────────────────

export async function runFlow(
  flow: FlowV3,
  initialSnapshot: Record<string, unknown>,
  deps: RuntimeDeps,
): Promise<void> {
  const info = flowRunRegistry.get(deps.runId)
  if (!info) throw new Error('runId not in registry')

  let snapshot: Record<string, unknown> = { ...initialSnapshot }
  let currentNodeId: string | null = findEntryNode(flow)?.id ?? null
  flowRunRegistry.updateStatus(deps.runId, 'running')
  flowRunRegistry.setSnapshot(deps.runId, snapshot)
  flowRunRegistry.setCurrentNode(deps.runId, currentNodeId)
  emit('flow_started', deps, { initialVars: snapshot })

  while (currentNodeId !== null && info.status !== 'cancelled') {
    const node = flow.nodes.find((n) => n.id === currentNodeId)
    if (!node) {
      finish('failed', deps, info, `节点 ${currentNodeId} 在 flow 中找不到`)
      return
    }

    // 三道防线
    const quotaErr = flowRunRegistry.checkQuotaForNode(deps.runId, node.id)
    if (quotaErr) {
      finish('failed', deps, info, quotaErr, node.id)
      return
    }

    const iter = (info.iterCounts.get(node.id) ?? 1)
    flowRunRegistry.setCurrentNode(deps.runId, node.id)
    flowRunRegistry.setNodeState(deps.runId, node.id, 'active')
    emit('flow_node_active', deps, { nodeId: node.id, iter, quota: flowRunRegistry.remainingQuota(deps.runId, node.id) })
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'node_active', nodeId: node.id, iter,
    })

    let nextSourceHandle: 'default' | 'true' | 'false' = 'default'
    let stepError: string | null = null

    if (node.type === 'user_input') {
      const r = await executeUserInputNode(node, snapshot, deps)
      if (r.kind === 'cancelled') {
        finish('cancelled', deps, info, undefined, node.id)
        return
      }
      snapshot = { ...snapshot, ...r.values }
      flowRunRegistry.setSnapshot(deps.runId, snapshot)
      for (const k of Object.keys(r.values)) {
        emit('flow_var_changed', deps, { key: k, value: r.values[k] })
      }
    } else if (node.type === 'llm') {
      const llmQuotaErr = flowRunRegistry.checkQuotaBeforeLlmCall(deps.runId)
      if (llmQuotaErr) {
        finish('failed', deps, info, llmQuotaErr, node.id)
        return
      }
      const translated = translatePrompt(node.promptTemplate, flow.variables, snapshot, node.outputs)
      const r = await dispatchLlmCall({
        projectFolder: deps.projectFolder,
        injector: deps.injector,
        prompt: translated,
        beforeSnapshot: snapshot,
        outputs: node.outputs,
        whitelist: flow.variables.map((v) => v.key),
        signal: info.cancelAbortController.signal,
        getTerminalRef: deps.getTerminalRef,
      })
      if (r.kind === 'cancelled') {
        finish('cancelled', deps, info, undefined, node.id)
        return
      }
      if (r.kind === 'failed') {
        stepError = r.reason
      } else {
        snapshot = r.newSnapshot
        flowRunRegistry.setSnapshot(deps.runId, snapshot)
        for (const d of r.varsDiff) {
          emit('flow_var_changed', deps, { key: d.key, value: d.new })
        }
      }
    } else if (node.type === 'if') {
      try {
        const ast = parseIfExpr(node.conditionExpr)
        const result = evaluateIfExpr(ast, snapshot)
        nextSourceHandle = result ? 'true' : 'false'
      } catch (e) {
        stepError = `if expr parse 失败：${(e as Error).message}`
      }
    }

    if (stepError) {
      finish('failed', deps, info, stepError, node.id)
      return
    }

    flowRunRegistry.setNodeState(deps.runId, node.id, 'completed')
    emit('flow_node_completed', deps, { nodeId: node.id, iter })
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'node_completed', nodeId: node.id, iter,
    })

    currentNodeId = pickNext(flow, node.id, nextSourceHandle)
  }

  if (info.status === 'cancelled') {
    return  // already emitted in cancel handler
  }
  finish('completed', deps, info)
}

// ── 节点执行子函数 ─────────────────────────────────────────────────────

async function executeUserInputNode(
  node: UserInputNode,
  _snapshot: Record<string, unknown>,
  deps: RuntimeDeps,
): Promise<{ kind: 'ok'; values: Record<string, unknown> } | { kind: 'cancelled' }> {
  const fields = node.fields.map((f) => ({
    varKey: f.varKey,
    description: '',     // backend 不知道 description（在 flow.variables 里）—— 让前端用 varKey 自己查
    uiHint: f.uiHint,
    variants: f.variants,
  }))
  flowRunRegistry.setPendingUserInput(deps.runId, { nodeId: node.id, fields })
  flowRunRegistry.updateStatus(deps.runId, 'waiting_user_input')
  emit('flow_user_input_required', deps, { nodeId: node.id, fields })

  const info = flowRunRegistry.get(deps.runId)!
  return new Promise((resolve) => {
    pendingUserInput.set(deps.runId, {
      resolve: (values) => {
        flowRunRegistry.clearPendingUserInput(deps.runId)
        flowRunRegistry.updateStatus(deps.runId, 'running')
        resolve({ kind: 'ok', values })
      },
      reject: () => resolve({ kind: 'cancelled' }),
    })
    info.cancelAbortController.signal.addEventListener('abort', () => {
      const p = pendingUserInput.get(deps.runId)
      if (p) {
        pendingUserInput.delete(deps.runId)
        resolve({ kind: 'cancelled' })
      }
    })
  })
}

// ── helpers ────────────────────────────────────────────────────────────

function emit(event: string, deps: RuntimeDeps, payload: Record<string, unknown>): void {
  // v-i：每条事件附 basename，前端 minimap 监听 flow_started 时可以一次性
  // 拿 (runId, basename) 拉 .flow + state，不用额外往返查表。
  deps.broadcast(event, { runId: deps.runId, basename: deps.basename, ...payload })
}

function finish(
  status: 'completed' | 'failed' | 'cancelled',
  deps: RuntimeDeps,
  info: RunInfo,
  errorMessage?: string,
  nodeId?: string,
): void {
  flowRunRegistry.setCurrentNode(deps.runId, null)
  // v-h Q2 fix：所有 finish 路径都清 pendingUserInput，否则 cancel 在 user_input
  // 节点等待中时 registry 仍残留 pending，hydrateFromBackend 会让前端弹一个
  // status=cancelled 但仍要求用户输入的对话框。
  flowRunRegistry.clearPendingUserInput(deps.runId)
  if (status === 'failed') {
    flowRunRegistry.updateStatus(deps.runId, 'failed', {
      nodeId,
      message: errorMessage ?? 'unknown',
    })
    if (nodeId) flowRunRegistry.setNodeState(deps.runId, nodeId, 'failed')
    emit('flow_node_failed', deps, { nodeId, reason: errorMessage })
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'node_failed', nodeId, message: errorMessage,
    })
    emit('flow_error', deps, { message: errorMessage })
  } else if (status === 'cancelled') {
    flowRunRegistry.updateStatus(deps.runId, 'cancelled')
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'cancelled', nodeId,
    })
    emit('flow_cancelled', deps, {})
  } else {
    flowRunRegistry.updateStatus(deps.runId, 'completed')
    appendAudit(deps.projectFolder, deps.basename, deps.runId, {
      ts: Date.now(), type: 'done',
    })
    emit('flow_done', deps, { finalVars: info ? {} : {} })  // M2 简化
  }
}
