import { terminalManager } from '../terminal-manager'
import { buildPaste, writeTerminalInputSplit } from '../terminal-paste'
import { broadcastFlowEvent } from '../track-flow-ws'
import type { Injector } from '../track-flow/llm-dispatcher'

// v3 工作轨 LLM 节点把 prompt 注入 CLI PTY。复用 chat 输入的 paste 路径
// （bracketed-paste + body/CR 200ms 拆分），绕开 Ink TUI 把 paste body + \r 折叠
// 成 `[Pasted text +N lines]` attachment。v1 任务流系统已在 v-h 删除。
export function deriveInjector(projectId: string): Injector {
  return (text: string) => {
    writeTerminalInputSplit(projectId, buildPaste(text))
  }
}

// v-h: dispatcher 用它检测 PTY crash —— 注入后 PTY 实例换了说明 terminal-manager
// 重启了 PTY，prompt 落空，立即 fail 不再傻等超时。
export function deriveTerminalRefGetter(projectId: string): () => object | null {
  return () => terminalManager.getTerminalRef(projectId)
}

export function deriveBroadcast(
  projectId: string,
): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    broadcastFlowEvent(projectId, event, payload)
  }
}
