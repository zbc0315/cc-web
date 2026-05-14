/**
 * Task-flow data model (schemaVersion 2).
 *
 * All persistent data lives in a single file under each project:
 *   <project>/.ccweb/workflow_data.json
 *
 * It holds three sections:
 *   - constants:     immutable values declared in FlowDef.constants (initialized
 *                    once at flow start; never written by user-input/LLM)
 *   - variables:     mutable values written by user-input nodes and/or LLM nodes
 *                    (read by any node, branched on by system-logic)
 *   - task_progress: append-only progress log; the LLM signals node completion
 *                    by flipping `task_progress[N].finish = true` via Edit/Write
 *
 * The runner's transient bookkeeping (currentNodeId, history, loopCounters,
 * pauseReason, etc.) lives separately in <project>/.ccweb/flow_state.json so
 * the data file stays user-readable and version-controllable.
 */

export const SCHEMA_VERSION = 2 as const;

/** Default location of the unified workflow data file. */
export const WORKFLOW_DATA_PATH = '.ccweb/workflow_data.json';

// ── FlowDef ────────────────────────────────────────────────────────────────

/** Immutable value declared at flow-definition time. Written into
 *  workflow_data.constants[name] once at flow start; nodes can read it but
 *  cannot overwrite it (validator forbids constants in writeVariables, etc.). */
export interface FlowConstant {
  /** Unique within the flow; shares a namespace with FlowVariable.name —
   *  variables and constants must not collide. */
  name: string;
  /** Any JSON-serializable value: string / number / boolean / array / object. */
  value: unknown;
  description?: string;
}

/** Mutable value written at runtime by user-input or LLM nodes. */
export interface FlowVariable {
  /** Unique within the flow (with constants). */
  name: string;
  description: string;
  /** Optional initial value written into workflow_data.variables[name] at
   *  flow start. Without it, the variable starts as `undefined` (missing key). */
  initialValue?: unknown;
}

export type NodeKind = 'user-input' | 'llm' | 'system-logic';

interface NodeBase {
  id: number;
  name: string;
  kind: NodeKind;
}

/** User-input form field. A field may be in exactly one of three modes —
 *  read-write input, read-only variable display, or read-only constant display.
 *  Validator enforces XOR. */
export interface UserInputField {
  key: string;       // unique within the node's fields[]
  label: string;
  type: 'text' | 'textarea';
  /** Mode A: submitted value is merged into variables[name]. */
  outputVariable?: string;
  /** Mode B: render variables[name]'s current value, read-only. */
  bindVariable?: string;
  /** Mode C: render constants[name]'s value, read-only. */
  bindConstant?: string;
}

export interface UserInputNode extends NodeBase {
  kind: 'user-input';
  userInputSchema: { fields: UserInputField[] };
  next: number | null;
}

export interface LlmNode extends NodeBase {
  kind: 'llm';
  /** Supports {{var:name}} and {{const:name}} interpolation. */
  promptTemplate: string;
  /** Variable names whose current values are prepended to the prompt as a
   *  read-only "current values" context block. */
  readVariables?: string[];
  /** Constant names whose values are prepended to the prompt as a context
   *  block. */
  readConstants?: string[];
  /** Variable names this node is asked to produce. A per-variable write
   *  instruction is appended at the end of the prompt (description + target
   *  path workflow_data.variables[name]). */
  writeVariables?: string[];
  /** Seconds to wait for `task_progress[N].finish = true` before pausing. */
  timeoutSec: number;
  next: number | null;
}

/** Branch rule for system-logic nodes. Either `variable` or `constant`
 *  must be set (XOR) — the runner reads workflow_data accordingly and
 *  matches via loose equality. */
export interface BranchRule {
  variable?: string;
  constant?: string;
  equals: unknown;        // string | number | boolean | null
  goto: number;           // target node id
}

export interface SystemLogicNode extends NodeBase {
  kind: 'system-logic';
  branches: BranchRule[];
  /** Loop-cap for backward goto edges. */
  maxRetries: number;
  /** Where to go if no branch matches. null = terminal, otherwise nodeId. */
  defaultGoto?: number | null;
}

export type FlowNode = UserInputNode | LlmNode | SystemLogicNode;

export interface FlowDef {
  /** Schema version. Hard-break from v1; loader rejects anything but 2. */
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;            // uuid
  name: string;
  description?: string;
  /** Node id of the first node to execute. */
  entryNodeId: number;
  nodes: FlowNode[];
  /** Immutable values, initialized into workflow_data once. Optional → []. */
  constants?: FlowConstant[];
  /** Mutable values. Optional → []. */
  variables?: FlowVariable[];
}

// ── Runtime state ──────────────────────────────────────────────────────────

export type RunStatus =
  | 'running'
  | 'paused'           // awaiting external action (user input / timeout / loop cap)
  | 'completed'
  | 'failed'
  | 'aborted';

/** Reduced pause reasons (vs v1): file-read-error variants are gone — v2
 *  doesn't read user-supplied filesystem paths, so file-read failures are
 *  impossible by construction. */
export type PauseReason =
  | 'awaiting-user-input'
  | 'timeout'
  | 'max-retries-exceeded'
  | 'user-paused'
  | null;

export interface NodeHistoryEntry {
  nodeId: number;
  startedAt: number;
  finishedAt: number | null;
  outcome: 'ok' | 'retry' | 'pause' | 'error';
  message?: string;
}

export interface FlowState {
  flowId: string;
  flowFilename: string;
  runId: string;
  startedAt: number;
  status: RunStatus;
  currentNodeId: number | null;
  loopCounters: Record<number, number>;
  history: NodeHistoryEntry[];
  pauseReason: PauseReason;
  pauseDetail?: string;
  /** When status='paused' and reason='awaiting-user-input', the schema to
   *  show. `contextValues` carries pre-read snapshot of bindVariable and
   *  bindConstant referenced by the form so the frontend can render them
   *  read-only without an extra fetch. */
  pendingUserInput?: {
    nodeId: number;
    fields: UserInputField[];
    contextValues?: {
      variables?: Record<string, unknown>;
      constants?: Record<string, unknown>;
    };
  };
}

// ── workflow_data.json ────────────────────────────────────────────────────

export interface TaskProgressEntry {
  /** Node id. Same id may repeat on loop re-entries — entries are append-only. */
  nodeId: number;
  name: string;
  finish: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface WorkflowData {
  /** Snapshot of FlowDef.constants. The runner writes this once at start and
   *  never mutates it again. */
  constants: Record<string, unknown>;
  /** Mutable variables. Top-level key = variable name. Values are arbitrary
   *  JSON. Missing keys = undefined (variable was never written). */
  variables: Record<string, unknown>;
  /** Append-only progress log. The runner appends an entry when an llm node
   *  starts; the LLM flips `finish = true` to signal completion. The runner
   *  watches this file (50ms debounce) for the current entry's finish. */
  task_progress: TaskProgressEntry[];
}
