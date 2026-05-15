/**
 * ccweb "工作轨" (Track) subsystem — public exports.
 *
 * Entry points for the rest of the backend:
 *   - createTrackRunner({ ... }) → run .tr files
 *   - createCcwebTrainAdapter({ ... }) → train-lang LLMAdapter impl
 *   - createWorkflowDataWatcher(path) → workflow_data.json file watch
 *
 * See ~/Obsidian/Base/cc-web/工作轨重构规划.md for the architecture
 * design and phase plan.
 */

export {
  createTrackRunner,
  type TrackRunner,
  type TrackRunnerDeps,
  type TrackRunResult,
} from './track-runner'

export {
  createCcwebTrainAdapter,
  buildCcwebWriteProtocolHint,
  type CcwebAdapterDeps,
} from './ccweb-train-adapter'

export {
  createWorkflowDataWatcher,
  type WorkflowDataWatcher,
  type FinishOutcome,
} from './workflow-data-watcher'

export type {
  WorkflowData,
  TaskProgressEntry,
  TrackCallState,
  TrackRunStatus,
  TrackRunState,
  AdapterCallContext,
} from './types'

export {
  createAskUserBridge,
  createAskUserBuiltin,
  type AskUserBridge,
  type AskUserFieldSpec,
  type AskUserRequest,
  type AskUserPushEvent,
  type AskUserPushFn,
} from './ask-user-bridge'

export { loadTrainCore, makeBuiltinDynamic } from './train-loader'

export {
  createTrackRegistry,
  type TrackRegistry,
  type TrackRegistryDeps,
} from './registry'

export {
  listTracks,
  loadTrack,
  saveTrack,
  deleteTrack,
  resolveTrackPath,
  sanitizeTrackFilename,
  listGlobalTracks,
  loadGlobalTrack,
  saveGlobalTrack,
  deleteGlobalTrack,
  resolveGlobalTrackPath,
  type TrackFileInfo,
} from './store'
