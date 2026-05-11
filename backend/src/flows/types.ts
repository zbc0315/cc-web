/**
 * Task-flow data model. Three persisted JSON files:
 *  - <project>/.ccweb/flows/<name>.json   — flow definition (design-time)
 *  - <project>/.ccweb/task_todo.json      — co-maintained progress (system + LLM)
 *  - <project>/.ccweb/flow_state.json     — runtime status (system-only)
 */

export type FileProvider = 'user' | 'llm' | 'system';

/** Default destination for variables whose `file` is left blank in the
 *  editor. Lives under `.ccweb/` so it doesn't clutter the project root. */
export const DEFAULT_VAR_FILE = '.ccweb/task_var.json';

/** Flow-level shared variables. Defined at edit time; LLM nodes can mark a
 *  subset as "initialize here" (prompt augmentation), and system-logic
 *  branches can reference them by name (auto-resolve to file+field). */
export interface FlowVariable {
  /** Unique within a flow. Used as the JSON top-level field name in `file`. */
  name: string;
  /** Relative path; UI defaults to DEFAULT_VAR_FILE when blank. */
  file: string;
  /** Human-readable meaning — injected into LLM prompt at init nodes so the
   *  agent knows what value to derive. */
  description: string;
}

export interface UserInputField {
  key: string;
  label: string;
  /** Phase-1 supports `text` (single line) and `textarea` (multi-line). */
  type: 'text' | 'textarea';
}

export interface FileRef {
  path: string;          // relative to project folder
  provider: FileProvider;
}

export interface BranchRule {
  /** Variable-mode (preferred): reference a flow variable by name; runner
   *  resolves to its file + uses `name` as the JSON top-level field. */
  variable?: string;
  /** Field-mode (legacy): explicit JSON field on the node's first input
   *  file. Kept for backward compat with pre-variable flow defs. */
  field?: string;
  equals: unknown;       // string | number | boolean | null
  goto: number;          // target node id
}

export type NodeKind = 'user-input' | 'llm' | 'system-logic';

interface NodeBase {
  id: number;
  name: string;
  kind: NodeKind;
}

export interface UserInputNode extends NodeBase {
  kind: 'user-input';
  userInputSchema: { fields: UserInputField[] };
  outputs: FileRef[];    // system writes one JSON file with {field.key: value}
  next: number | null;   // null = terminal
}

export interface LlmNode extends NodeBase {
  kind: 'llm';
  inputs: FileRef[];
  /** Template supports {{file:relpath}} substitution. */
  promptTemplate: string;
  outputs: FileRef[];    // declarative only — LLM does the actual writing
  timeoutSec: number;
  next: number | null;
  /** Names of flow variables this node should produce and write to disk.
   *  Runner injects a per-variable init instruction at the end of the prompt
   *  using the variable's description + file. */
  initVariables?: string[];
}

export interface SystemLogicNode extends NodeBase {
  kind: 'system-logic';
  inputs: FileRef[];     // first input file is parsed for the branch decision
  branches: BranchRule[];
  /** Loop-cap for backward goto edges. If exceeded → pause flow. */
  maxRetries: number;
  /** Where to go if no branch matches. null = terminal, otherwise nodeId. */
  defaultGoto?: number | null;
}

export type FlowNode = UserInputNode | LlmNode | SystemLogicNode;

export interface FlowDef {
  id: string;            // uuid
  name: string;
  description?: string;
  /** Node id of the first node to execute. */
  entryNodeId: number;
  nodes: FlowNode[];
  /** Flow-level shared variables. Optional for backward compat with pre-
   *  variables flow defs (treated as []). Names must be unique. */
  variables?: FlowVariable[];
}

// ── Runtime state ──────────────────────────────────────────────────────────

export type RunStatus =
  | 'running'
  | 'paused'           // awaiting external action (user input / error decision)
  | 'completed'
  | 'failed'
  | 'aborted';

export type PauseReason =
  | 'awaiting-user-input'
  | 'user-file-read-error'
  | 'llm-file-read-error'
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
  /** Disk filename of the flow def (under `.ccweb/flows/`). Persisted so the
   *  frontend can re-fetch the FlowDef on page reload without an extra
   *  list-then-match round-trip. */
  flowFilename: string;
  runId: string;
  startedAt: number;
  status: RunStatus;
  currentNodeId: number | null;
  /** nodeId → number of times that backward edge was taken in this run. */
  loopCounters: Record<number, number>;
  history: NodeHistoryEntry[];
  pauseReason: PauseReason;
  pauseDetail?: string;
  /** When status='paused' and reason='awaiting-user-input', the schema to
   *  show; cleared on submit. */
  pendingUserInput?: { nodeId: number; fields: UserInputField[] };
}

// ── task_todo.json ──────────────────────────────────────────────────────────

export interface TaskTodoEntry {
  id: number;           // node id (same id may repeat in loops — append-only)
  name: string;
  finish: boolean;
}

export interface TaskTodo {
  tasks: TaskTodoEntry[];
}
