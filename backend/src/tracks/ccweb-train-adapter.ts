/**
 * CcwebTrainAdapter — bridges train-lang's LLMAdapter interface to
 * ccweb's PTY + workflow_data.json infrastructure.
 *
 * Paradigm: writesWorkflowData=true (agent CLI). train-lang composes
 * the [System][Inputs][Task][Outputs] prompt; ccweb appends a
 * writeProtocolHint that tells the LLM to write outputs into
 * `.ccweb/workflow_data.json` at `variables.<name>`, then signal
 * completion via `task_progress.push({...finish:true})`.
 *
 * 详见 ~/Obsidian/Base/cc-web/工作轨重构规划.md §5。
 */

import type {
  LLMAdapter,
  FaiCall,
  FaiResult,
} from '@tom2012/train-adapter-spec'
import type { WorkflowDataWatcher } from './workflow-data-watcher'

export interface CcwebAdapterDeps {
  projectId: string
  runId: string
  /** Inject text into the project's active CLI PTY. */
  injector: (text: string) => Promise<void> | void
  /** Watcher for `.ccweb/workflow_data.json`. */
  watcher: WorkflowDataWatcher
  /** Per-run monotonic counter assigning task_progress[] index. */
  nextTaskIndex: () => number
  /** Optional logger (pino-compatible interface). */
  logger?: {
    debug?: (msg: string, ...args: unknown[]) => void
    info?: (msg: string, ...args: unknown[]) => void
    warn?: (msg: string, ...args: unknown[]) => void
    error?: (msg: string, ...args: unknown[]) => void
  }
}

/**
 * The writeProtocolHint string injected into train's prompt. ccweb's
 * single authoritative "how to write back" instruction — replaces
 * train's default `stack[<callId>].outputs` hint (which doesn't match
 * ccweb v2 schema).
 */
export function buildCcwebWriteProtocolHint(): string {
  return [
    '[Write outputs to .ccweb/workflow_data.json, then signal completion:]',
    '  1. For each declared output `<name>` in [Required outputs] above:',
    '       set variables.<name> = <your value matching the declared type>',
    '  2. Append to task_progress:',
    '       { nodeId: <taskIndex from prompt header>, name: "<fai name>", ' +
      'finish: true, finishedAt: <unix ms> }',
    '',
    'Do NOT touch other variables. Do NOT modify constants. Do NOT remove ' +
      'existing task_progress entries.',
    'After writing, the train runtime will read variables.<name> and continue.',
  ].join('\n')
}

/**
 * Compose the ccweb-specific prompt prefix that identifies the current
 * call's taskIndex (for the writeProtocolHint instructions to reference).
 *
 * This is prepended (NOT appended) to the prompt train already composed,
 * so it's visible above [Required outputs].
 */
function buildCcwebHeader(taskIndex: number, fnName: string): string {
  return `[ccweb track context]\n  taskIndex = ${taskIndex}\n  fai = ${fnName}\n`
}

/**
 * Filter workflow_data.variables to just the outputs declared on the
 * fai call. Extra keys are ignored (train validator will catch missing
 * keys as schema mismatch).
 */
function pickOutputs(
  variables: Record<string, unknown>,
  outputSchema: FaiCall['outputs'],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(outputSchema)) {
    if (key in variables) {
      out[key] = variables[key]
    }
  }
  return out
}

export function createCcwebTrainAdapter(deps: CcwebAdapterDeps): LLMAdapter {
  return {
    name: 'ccweb',
    version: '0.0.0',
    capabilities: {
      parallel: false, // one CLI process per project
      cancellation: true, // honors req.options.signal
      writesWorkflowData: true,
    },

    async call(req: FaiCall): Promise<FaiResult> {
      const taskIndex = deps.nextTaskIndex()
      deps.logger?.debug?.(
        '[CcwebTrainAdapter] dispatch',
        { fnName: req.fnName, taskIndex, callId: req.callId, attempt: req.options.attempt },
      )

      // Compose final prompt = ccweb header + train's prompt (which
      // already includes writeProtocolHint from RunOptions).
      const finalPrompt = buildCcwebHeader(taskIndex, req.fnName) + '\n' + req.prompt

      // 1. Inject into PTY
      try {
        await deps.injector(finalPrompt)
      } catch (e) {
        return {
          kind: 'error',
          message: `ccweb adapter: failed to inject prompt: ${(e as Error).message}`,
          recoverable: false,
        }
      }

      // 2. Wait for task_progress[taskIndex].finish=true
      const outcome = await deps.watcher.waitForFinish(
        taskIndex,
        req.options.timeoutMs,
        req.options.signal,
      )

      if (outcome.kind === 'timeout') {
        deps.logger?.warn?.('[CcwebTrainAdapter] timeout', { taskIndex })
        return { kind: 'timeout' }
      }
      if (outcome.kind === 'cancelled') {
        deps.logger?.info?.('[CcwebTrainAdapter] cancelled', { taskIndex })
        return { kind: 'cancelled' }
      }
      if (outcome.kind === 'error') {
        return {
          kind: 'error',
          message: `ccweb adapter: watcher error: ${outcome.message}`,
          recoverable: false,
        }
      }

      // 3. Read outputs from workflow_data.variables
      const outputs = pickOutputs(outcome.data.variables ?? {}, req.outputs)
      deps.logger?.debug?.(
        '[CcwebTrainAdapter] success',
        { taskIndex, outputKeys: Object.keys(outputs) },
      )
      return { kind: 'success', outputs }
    },
  }
}
