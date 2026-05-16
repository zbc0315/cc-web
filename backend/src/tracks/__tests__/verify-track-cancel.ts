/**
 * Regression test for the v-15-f/g daemon-crash bug:
 *
 *   POST /tracks/abort while a track is suspended in __ccweb_ask_user
 *   used to bubble the reject up through bridge.requestInput →
 *   builtin → train.runFile → runner.run → registry.start's `void
 *   runner.run(...).then(...)`. Because that .then had no .catch, the
 *   rejection escaped as `unhandledRejection`, and the global fatal
 *   handler in logger.ts called process.exit(1) — ccweb daemon died.
 *
 * This script:
 *   1. Installs an unhandledRejection listener that flips a flag.
 *   2. Starts a registry-driven track that blocks on __ccweb_ask_user.
 *   3. Calls registry.abort() once the ask_user push fires.
 *   4. Verifies:
 *      - flag stays false (no escaping promise)
 *      - registry.getState() reports status === 'cancelled'
 *      - track_run_complete broadcast has ok=false, errorType=UserCancelError
 *
 * Run:  cd backend && npx ts-node src/tracks/__tests__/verify-track-cancel.ts
 */

import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { createTrackRegistry, saveTrack } from '..'
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

async function writeWf(p: string, w: WorkflowData): Promise<void> {
  await fs.writeFile(p, JSON.stringify(w, null, 2), 'utf8')
}

async function testAbortDuringAskUser(): Promise<void> {
  console.log('\n=== abort during pending ask_user (regression v-15-f/g) ===')

  let unhandled: unknown = null
  const onUnhandled = (reason: unknown): void => {
    unhandled = reason
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccweb-cancel-'))
    const projectDir = path.join(tmpDir, 'proj')
    await fs.mkdir(path.join(projectDir, '.ccweb'), { recursive: true })
    const wfPath = path.join(projectDir, '.ccweb', 'workflow_data.json')
    await writeWf(wfPath, { constants: {}, variables: {}, task_progress: [] })

    saveTrack(
      projectDir,
      'pause.tr',
      `func main() -> any {
  let r = __ccweb_ask_user({
    fields: [
      { key: "decision", label: "go?", type: "enum", variants: ["yes","no"] }
    ]
  })
  return r.decision
}
export main
`,
    )
    const trackAbs = path.join(projectDir, '.ccweb', 'tracks', 'pause.tr')

    const broadcastEvents: Array<{ msg: Record<string, unknown> }> = []
    const registry = createTrackRegistry({
      getProjectFolder: (id) => (id === 'proj' ? projectDir : null),
      injectIntoPty: () => {},
      broadcast: (_projectId, msg) => {
        broadcastEvents.push({ msg })
      },
    })

    const start = await registry.start('proj', trackAbs, 'pause.tr', [])
    check('registry.start ok', start.ok)

    // Wait until the bridge actually pushed the ask_user event — that's
    // the signal that bridge.requestInput is parked on the Promise and
    // the abort path will trip the signalHandler reject.
    const startTs = Date.now()
    while (
      broadcastEvents.find((e) => e.msg.type === 'track_ask_user') === undefined &&
      Date.now() - startTs < 8000
    ) {
      await new Promise((r) => setTimeout(r, 20))
    }
    check(
      'track_ask_user broadcast fired before abort',
      broadcastEvents.find((e) => e.msg.type === 'track_ask_user') !== undefined,
    )
    check('ask_user is pending before abort', registry.getPendingAskUser('proj') !== null)

    // The actual abort — this is what used to crash ccweb.
    const aborted = registry.abort('proj')
    check('registry.abort returned true', aborted)

    // Give the promise chain enough ticks to settle and the fatal
    // handler enough chance to fire if it would have.
    await new Promise((r) => setTimeout(r, 200))

    check(
      'no unhandledRejection escaped (would have killed ccweb)',
      unhandled === null,
      unhandled instanceof Error ? unhandled.message : String(unhandled),
    )

    const finalState = registry.getState('proj')
    check('final state non-null', finalState !== null)
    check(
      'final status is cancelled (not failed/running)',
      finalState?.status === 'cancelled',
      `got: ${finalState?.status}`,
    )
    check(
      'final error.errorType is UserCancelError',
      finalState?.error?.errorType === 'UserCancelError',
      `got: ${finalState?.error?.errorType}`,
    )
    check('isRunning false after abort', !registry.isRunning('proj'))

    const completes = broadcastEvents.filter(
      (e) => e.msg.type === 'track_run_complete',
    )
    check(
      'exactly one track_run_complete broadcast',
      completes.length === 1,
      `got ${completes.length}`,
    )
    if (completes.length === 1) {
      const c = completes[0]!.msg as { ok: boolean; error?: { errorType?: string } }
      check('track_run_complete ok=false', c.ok === false)
      check(
        'track_run_complete errorType=UserCancelError',
        c.error?.errorType === 'UserCancelError',
        `got: ${c.error?.errorType}`,
      )
    }

    await fs.rm(tmpDir, { recursive: true, force: true })
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
}

async function main(): Promise<void> {
  console.log('=== verify-track-cancel ===')
  await testAbortDuringAskUser()
  console.log(
    `\n${failed === 0 ? '✅ ALL CANCEL CHECKS PASSED' : `❌ ${failed} CHECK(S) FAILED`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify-track-cancel crashed:', e)
  process.exit(2)
})
