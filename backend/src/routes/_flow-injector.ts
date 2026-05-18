import { buildPaste, writeTerminalInputSplit } from '../terminal-paste'
import { broadcastFlowEvent } from '../track-flow-ws'
import type { Injector } from '../track-flow/llm-dispatcher'

// v3 工作轨 LLM 节点把 prompt 注入 CLI PTY。复用 chat 输入与 v1 任务流的同一条
// paste 包裹 + body/CR 200ms 拆分路径，绕开 Ink TUI 把 `paste body + \r` 折叠
// 成 `[Pasted text +N lines]` attachment（导致 prompt 滞留输入框需第二次回车）。
export function deriveInjector(projectId: string): Injector {
  return (text: string) => {
    writeTerminalInputSplit(projectId, buildPaste(text))
  }
}

export function deriveBroadcast(
  projectId: string,
): (event: string, payload: Record<string, unknown>) => void {
  return (event, payload) => {
    broadcastFlowEvent(projectId, event, payload)
  }
}
