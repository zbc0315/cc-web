/**
 * Run state sidecar: `<projectFolder>/.ccweb/tracks/<basename>.run-state.json`
 *
 * v-j 起作为 LLM 节点完成判定的唯一信号源，并兼任运行进度的对外可视表达：
 *   - runtime 在节点 active/completed/failed 时同步写入文件
 *   - LLM 节点的 prompt 系统指令要求 LLM 完成时把 nodes[<id>].done=true，
 *     或不能完成时 nodes[<id>].failed=true + reason='...'；
 *   - llm-dispatcher polling 本文件 mtime，读 nodes[currentNodeId] 决定 success/failed
 *
 * 文件保留覆盖写（不在 run 结束时删，方便用户回看上一次结果）。
 */
import * as fs from 'fs'
import * as path from 'path'

export type RunStateStatus =
  | 'pending' | 'running' | 'waiting_user_input'
  | 'completed' | 'failed' | 'cancelled'

export type NodeStatus =
  | 'idle' | 'active' | 'completed' | 'failed' | 'skipped' | 'waiting_user_input'

export interface NodeRunState {
  label?: string                       // 用户填的显示名
  type: 'user_input' | 'llm' | 'if'
  status: NodeStatus
  iter: number                         // 进入该节点的次数（if 循环回来会 +1）
  lastActiveAt?: number
  lastCompletedAt?: number
  // 仅 LLM 节点用：LLM 自报完成 / 失败信号
  done?: boolean
  failed?: boolean
  reason?: string | null
}

export interface RunStateFile {
  version: 1
  runId: string
  basename: string
  startedAt: number
  finishedAt?: number | null
  status: RunStateStatus
  currentNodeId: string | null
  nodes: Record<string, NodeRunState>
  error?: { nodeId?: string; message: string } | null
}

function runStatePath(projectFolder: string, basename: string): string {
  return path.join(projectFolder, '.ccweb', 'tracks', `${basename}.run-state.json`)
}

function atomicWriteJson(target: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    return false
  }
}

export function writeRunState(
  projectFolder: string,
  basename: string,
  state: RunStateFile,
): boolean {
  return atomicWriteJson(runStatePath(projectFolder, basename), state)
}

/** 读取 run-state.json。文件不存在 / parse 失败返 null。 */
export function readRunState(
  projectFolder: string,
  basename: string,
): RunStateFile | null {
  const p = runStatePath(projectFolder, basename)
  try {
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as RunStateFile
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

/** statSync mtime — dispatcher polling 用。 */
export function getRunStateMtime(projectFolder: string, basename: string): number {
  try {
    return fs.statSync(runStatePath(projectFolder, basename)).mtimeMs
  } catch {
    return 0
  }
}

/** 返回 sidecar 文件**相对项目根**的路径，用于 prompt 系统指令告知 LLM。 */
export function runStateRelativePath(basename: string): string {
  return `.ccweb/tracks/${basename}.run-state.json`
}

export function initialRunState(
  runId: string,
  basename: string,
  nodes: { id: string; type: NodeRunState['type']; label?: string }[],
): RunStateFile {
  const nodeMap: Record<string, NodeRunState> = {}
  for (const n of nodes) {
    nodeMap[n.id] = {
      label: n.label,
      type: n.type,
      status: 'idle',
      iter: 0,
    }
  }
  return {
    version: 1,
    runId,
    basename,
    startedAt: Date.now(),
    finishedAt: null,
    status: 'pending',
    currentNodeId: null,
    nodes: nodeMap,
    error: null,
  }
}

/** Mutate-and-write helper：runtime 在每个状态切换点调一次，承担 read-modify-write 与
 *  原子写。文件可能并发被 LLM 改写（done flag），所以必须 read 最新值再 merge。 */
export function patchRunState(
  projectFolder: string,
  basename: string,
  patcher: (cur: RunStateFile) => RunStateFile,
): RunStateFile | null {
  const cur = readRunState(projectFolder, basename)
  if (!cur) return null
  const next = patcher(cur)
  writeRunState(projectFolder, basename, next)
  return next
}
