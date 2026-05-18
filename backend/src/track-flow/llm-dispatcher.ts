import * as fs from 'fs'
import * as path from 'path'
import { copyToProjectCwd, reloadFromProjectCwd, cleanupProjectCwd, filterByWhitelist } from './train-json-sync'
import { getRunStateMtime, readRunState } from './run-state-file'

export type Injector = (text: string) => void | Promise<void>

export interface DispatchOptions {
  projectFolder: string                    // CLI cwd
  basename: string                         // flow basename — 决定 run-state.json 路径
  nodeId: string                           // 当前 LLM 节点 id
  expectedIter: number                     // 当前 iter（v-j codex P0）：dispatcher 只接受
                                           //   nodes[nodeId].iter === expectedIter 的 done/failed，
                                           //   防止 LLM 在上一轮 iter 写过的 stale done 提前结束新一轮
  injector: Injector                       // 把 prompt 写到项目 PTY
  prompt: string                           // 转译后的完整 prompt
  beforeSnapshot: Record<string, unknown>  // 调用前的 train.json snapshot
  outputs: string[]                        // 业务声明的 outputs（v-j 仅记 warning 不强制）
  whitelist: string[]                      // variables[*].key（用于过滤 train.json）
  signal: AbortSignal                      // 用户取消
  timeoutMs?: number                       // 默认 600_000 (10 min)
  // v-h: PTY 实例 ref getter；ref 变了视为 PTY crash，立即 fail 不等 600s
  getTerminalRef?: () => object | null
}

export type DispatchResult =
  | { kind: 'success'; newSnapshot: Record<string, unknown>; varsDiff: { key: string; old: unknown; new: unknown }[]; missingOutputs?: string[] }
  | { kind: 'failed'; reason: string }
  | { kind: 'cancelled' }

/**
 * v-j 起的完成判定：
 *   1. 写 cwd train.json snapshot（业务变量）
 *   2. inject prompt — 系统指令告诉 LLM 完成后改 `.ccweb/tracks/<basename>.run-state.json`
 *      中 nodes[nodeId].done=true，或失败时 nodes[nodeId].failed=true + reason='...'
 *   3. polling run-state.json mtime；每次变化读 nodes[nodeId]：
 *        - failed=true → 立即 kind:'failed' + LLM 给的 reason
 *        - done=true → kind:'success'，仍读 train.json 拿 varsDiff；outputs 检查降级
 *          为 missingOutputs warning（不阻进下一节点，由 runtime 选择处理）
 *   4. timeout / signal aborted / PTY ref 变化 走原有 fail-fast 路径
 *
 * **不再**依赖 train.json mtime 作为完成信号 —— LLM 多步调用过程中会反复改 train.json，
 * mtime 触发完成会让 LLM 第一次 Edit 就被强制结束节点。
 */
export async function dispatchLlmCall(opts: DispatchOptions): Promise<DispatchResult> {
  const cwd = opts.projectFolder
  const timeoutMs = opts.timeoutMs ?? 600_000

  // 1. 写 snapshot（业务变量初值）
  copyToProjectCwd(cwd, filterByWhitelist(opts.beforeSnapshot, opts.whitelist))

  // 记录 run-state 初始 mtime（runtime 刚写完 active 状态）
  const initialMtimeMs = getRunStateMtime(opts.projectFolder, opts.basename)

  try {
    // 2. inject prompt
    const ptyRefAtInject = opts.getTerminalRef?.() ?? null
    if (opts.getTerminalRef && ptyRefAtInject === null) {
      cleanupProjectCwd(cwd)
      return { kind: 'failed', reason: 'PTY 未启动或已退出，无法注入 prompt。请确保 CLI 已运行后重新运行工作轨' }
    }
    await opts.injector(opts.prompt)

    // 3. polling run-state.json，读 nodes[nodeId].done / .failed
    const startedAt = Date.now()
    const pollInterval = 500
    while (true) {
      if (opts.signal.aborted) {
        cleanupProjectCwd(cwd)
        return { kind: 'cancelled' }
      }
      if (Date.now() - startedAt > timeoutMs) {
        cleanupProjectCwd(cwd)
        return { kind: 'failed', reason: `LLM 调用超时（${timeoutMs}ms 内未标 done/failed）` }
      }
      if (ptyRefAtInject && opts.getTerminalRef) {
        const cur = opts.getTerminalRef()
        if (cur !== ptyRefAtInject) {
          cleanupProjectCwd(cwd)
          return { kind: 'failed', reason: 'PTY 在 LLM 调用中重启，prompt 落空。请重新运行' }
        }
      }
      const mtimeMs = getRunStateMtime(opts.projectFolder, opts.basename)
      if (mtimeMs > initialMtimeMs + 1) {
        // run-state.json 被 LLM 改了。读出来看 nodes[nodeId]
        const cur = readRunState(opts.projectFolder, opts.basename)
        if (cur === null) {
          // codex P3：文件存在但 readRunState 返 null = schema 不识别（版本不匹配
          // / 文件损坏）。fail-fast 不傻等超时。
          const filePath = path.join(opts.projectFolder, '.ccweb', 'tracks', `${opts.basename}.run-state.json`)
          if (fs.existsSync(filePath)) {
            cleanupProjectCwd(cwd)
            return { kind: 'failed', reason: 'run-state.json 解析失败或版本不支持（请检查文件）' }
          }
          // 文件不存在：runtime 还没写 active 状态？等一轮
          await sleep(pollInterval)
          continue
        }
        const nodeState = cur.nodes?.[opts.nodeId]
        // codex P0：iter 校验。LLM 上一轮可能写过 done=true，runtime 进新一轮时
        // 清了 done=false，但 LLM 进程仍活着可能再写。只 accept 当前 iter 的标记。
        if (nodeState && nodeState.iter === opts.expectedIter) {
          if (nodeState.failed === true) {
            cleanupProjectCwd(cwd)
            // codex P2 #5：reason 必须是字符串才采纳
            const reason = typeof nodeState.reason === 'string' && nodeState.reason.length > 0
              ? `LLM 自报失败：${nodeState.reason}`
              : 'LLM 标记 failed=true 但未给有效 reason'
            return { kind: 'failed', reason }
          }
          if (nodeState.done === true) {
            break  // 完成
          }
        }
        // 否则只是 LLM 改了别的字段 / iter 不匹配的 stale 标记，继续等
      }
      await sleep(pollInterval)
    }

    // 4. reload train.json 拿变量更新 diff
    const reload = await reloadFromProjectCwd(cwd)
    if (!reload.ok || !reload.data) {
      cleanupProjectCwd(cwd)
      return { kind: 'failed', reason: `.ccweb-flow-train.json reload 失败：${reload.error ?? 'unknown'}` }
    }

    const newSnapshotFiltered = filterByWhitelist(reload.data, opts.whitelist)
    const varsDiff: { key: string; old: unknown; new: unknown }[] = []
    for (const k of Object.keys(newSnapshotFiltered)) {
      const oldV = opts.beforeSnapshot[k] ?? null
      const newV = newSnapshotFiltered[k]
      if (!sameValue(oldV, newV)) {
        varsDiff.push({ key: k, old: oldV, new: newV })
      }
    }

    // outputs 校验降级为 warning：done=true 但某些 outputs 未改 → 仍 success，
    // 但返回 missingOutputs 让 runtime 记 warning（spec §6.2 调整：相信 LLM 自报）
    const changedKeys = new Set(varsDiff.map((d) => d.key))
    const missingOutputs = opts.outputs.filter((k) => !changedKeys.has(k))

    cleanupProjectCwd(cwd)
    return { kind: 'success', newSnapshot: newSnapshotFiltered, varsDiff, missingOutputs: missingOutputs.length > 0 ? missingOutputs : undefined }
  } catch (e) {
    cleanupProjectCwd(cwd)
    if (opts.signal.aborted) return { kind: 'cancelled' }
    return { kind: 'failed', reason: `dispatch 异常：${(e as Error).message}` }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
