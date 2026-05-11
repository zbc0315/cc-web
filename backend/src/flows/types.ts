/**
 * Task-flow data model. Three persisted JSON files:
 *  - <project>/.ccweb/flows/<name>.json   — flow definition (design-time)
 *  - <project>/.ccweb/task_todo.json      — co-maintained progress (system + LLM)
 *  - <project>/.ccweb/flow_state.json     — runtime status (system-only)
 */

export type FileProvider = 'user' | 'llm' | 'system';

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
  field: string;         // top-level JSON key in the parsed input file
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
