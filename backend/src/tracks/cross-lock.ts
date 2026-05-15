/**
 * Cross-subsystem lock between flows and tracks.
 *
 * Both flows/runner.ts and tracks/registry.ts write
 * <project>/.ccweb/workflow_data.json. Concurrent runs on the same
 * project would corrupt that file (RMW race). This module exposes a
 * small registry so each side can ask "is the other currently running
 * on this project?" without creating an import cycle between
 * routes/flows.ts and routes/tracks.ts or between flows/runner.ts and
 * tracks/registry.ts.
 *
 * Usage:
 *   - index.ts constructs `trackRegistry` and calls
 *     `setTrackRunningProbe((pid) => trackRegistry.isRunning(pid))`
 *   - routes/flows.ts's run handler calls `isTrackRunning(pid)` before
 *     starting a flow; rejects with 409 if a track is in flight.
 *   - routes/tracks.ts's run handler imports flowRunner directly
 *     (already in the same module graph) and calls
 *     `flowRunner.isRunning(pid)` before starting a track.
 *
 * The asymmetry (flows side uses a probe, tracks side imports
 * flowRunner) is intentional: flowRunner has been a stable module
 * singleton since v1; trackRegistry was created later inside index.ts
 * to avoid leaking PTY infra into module init.
 */

type RunningProbe = (projectId: string) => boolean

let trackProbe: RunningProbe | null = null

export function setTrackRunningProbe(fn: RunningProbe): void {
  trackProbe = fn
}

export function isTrackRunning(projectId: string): boolean {
  if (!trackProbe) return false
  try {
    return trackProbe(projectId)
  } catch {
    return false
  }
}
