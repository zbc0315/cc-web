/**
 * T0 verification script for the Track subsystem.
 *
 * NOT a vitest/jest test — ccweb backend has no test framework yet.
 * Runs as a standalone Node script to verify end-to-end:
 *
 *   1. TrackRunner can load a .tr file
 *   2. train-lang composes prompt + calls CcwebTrainAdapter
 *   3. CcwebTrainAdapter injects prompt (capture into a mock buffer)
 *   4. We programmatically simulate the LLM writing outputs by editing
 *      workflow_data.json + setting task_progress[].finish = true
 *   5. WorkflowDataWatcher detects the finish signal
 *   6. Adapter reads variables.<name> → returns FaiResult.success
 *   7. train continues execution → main() returns
 *   8. TrackRunner reports ok=true with the returned value
 *
 * Run:  cd backend && npx ts-node src/tracks/__tests__/verify-track.ts
 */

import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import {
  createTrackRunner,
  createWorkflowDataWatcher,
  buildCcwebWriteProtocolHint,
} from '..'
import type { WorkflowData } from '../types'

let failed = 0
function check(name: string, cond: boolean, msg?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${msg ? ': ' + msg : ''}`)
  }
}

const DEMO_TR = `
fai analyze(file_path: string, prompt: prompt) -> rating: int 0-10, comment: string maxLen=500 { }

func main(input_path: string) -> string {
  let r = analyze(input_path, "评分 0-10")
  return r.comment
}

export main
`

async function readWf(p: string): Promise<WorkflowData> {
  const text = await fs.readFile(p, 'utf8')
  return JSON.parse(text) as WorkflowData
}

async function writeWf(p: string, w: WorkflowData): Promise<void> {
  await fs.writeFile(p, JSON.stringify(w, null, 2), 'utf8')
}

async function main(): Promise<void> {
  console.log('=== Track T0 verification ===\n')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccweb-track-t0-'))
  console.log(`tmpDir = ${tmpDir}`)
  const trackPath = path.join(tmpDir, 'demo.tr')
  const wfPath = path.join(tmpDir, 'workflow_data.json')

  await fs.writeFile(trackPath, DEMO_TR, 'utf8')
  await writeWf(wfPath, {
    constants: {},
    variables: {},
    task_progress: [],
  })

  const watcher = createWorkflowDataWatcher(wfPath)

  // Capture prompts injected by adapter
  const promptsInjected: string[] = []

  // Mock injector: instead of writing to a PTY, it parses the
  // [Required outputs] section from the prompt, fabricates legal
  // values, and writes them to workflow_data.json after a short
  // delay (simulating LLM round-trip latency).
  const injector = async (text: string): Promise<void> => {
    promptsInjected.push(text)
    // Extract taskIndex from the ccweb header (first 3 lines)
    const m = text.match(/taskIndex = (\d+)/)
    if (!m) throw new Error('no taskIndex in prompt — adapter contract broken')
    const taskIndex = Number(m[1])

    // Simulate LLM writing outputs after 30ms
    setTimeout(async () => {
      const wf = await readWf(wfPath)
      // Pretend the LLM gave rating=8 + comment="OK"
      wf.variables.rating = 8
      wf.variables.comment = 'OK'
      wf.task_progress.push({
        nodeId: taskIndex,
        name: 'analyze',
        finish: true,
        startedAt: Date.now() - 10,
        finishedAt: Date.now(),
      })
      await writeWf(wfPath, wf)
    }, 30)
  }

  const runner = createTrackRunner({
    projectId: 'demo-proj',
    injector,
    watcher,
    maxFaiAttempts: 2,
    defaultFaiTimeoutMs: 5000,
  })

  const result = await runner.run(trackPath, ['src/foo.ts'])

  // Assertions
  check('result.ok is true', result.ok, JSON.stringify(result.error))
  check(
    'result.value is the LLM-supplied comment ("OK")',
    result.value === 'OK',
    `got: ${JSON.stringify(result.value)}`,
  )
  check('injector called exactly once', promptsInjected.length === 1)
  check(
    'prompt contains writeProtocolHint marker',
    promptsInjected[0]?.includes('[Write outputs to .ccweb/workflow_data.json') ?? false,
  )
  check(
    'prompt does NOT contain stale train default hint',
    !(promptsInjected[0]?.includes('stack[<callId>]') ?? false),
  )
  check(
    'prompt contains ccweb track context header (taskIndex)',
    promptsInjected[0]?.includes('taskIndex = ') ?? false,
  )
  check(
    'final workflow_data.task_progress has 1 finished entry',
    (await readWf(wfPath)).task_progress.length === 1,
  )

  // Verify cancellation path
  console.log('\n--- cancellation path ---')
  await writeWf(wfPath, {
    constants: {},
    variables: {},
    task_progress: [],
  })
  // Use an injector that never resolves the finish signal
  const slowPromptsInjected: string[] = []
  const slowInjector = async (text: string): Promise<void> => {
    slowPromptsInjected.push(text)
    // Don't write anything — simulate LLM hung
  }
  const watcher2 = createWorkflowDataWatcher(wfPath)
  const cancelRunner = createTrackRunner({
    projectId: 'demo-proj',
    injector: slowInjector,
    watcher: watcher2,
    maxFaiAttempts: 1,
    defaultFaiTimeoutMs: 60_000, // long timeout — we'll cancel before this
  })
  // Cancel after 100ms
  const cancelTimer = setTimeout(() => cancelRunner.cancel(), 100)
  const cancelResult = await cancelRunner.run(trackPath, ['src/foo.ts'])
  clearTimeout(cancelTimer)
  check('cancel: ok is false', !cancelResult.ok)
  check(
    'cancel: error is UserCancelError-like',
    /cancel/i.test(cancelResult.error?.errorType ?? '') ||
      /cancel/i.test(cancelResult.error?.message ?? ''),
    `got: ${JSON.stringify(cancelResult.error)}`,
  )

  // Verify writeProtocolHint factory shape (smoke test)
  console.log('\n--- buildCcwebWriteProtocolHint shape ---')
  const hint = buildCcwebWriteProtocolHint()
  check('hint mentions workflow_data.json', hint.includes('workflow_data.json'))
  check('hint mentions variables', hint.includes('variables.<name>'))
  check('hint mentions task_progress', hint.includes('task_progress'))
  check('hint mentions finish: true', hint.includes('finish: true'))

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true })

  console.log(`\n${failed === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failed} CHECK(S) FAILED`}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify-track crashed:', e)
  process.exit(2)
})
