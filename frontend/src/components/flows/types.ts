// Mirror of backend/src/flows/types.ts — kept inline so the frontend can be
// type-checked independently and doesn't need a build step from backend.

export type FileProvider = 'user' | 'llm' | 'system';

/** Default destination for variables whose `file` is left blank — matches
 *  backend store.ts. */
export const DEFAULT_VAR_FILE = '.ccweb/task_var.json';

export interface FlowVariable {
  name: string;
  file: string;
  description: string;
}

export interface UserInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea';
}

export interface FileRef {
  path: string;
  provider: FileProvider;
}

export interface BranchRule {
  variable?: string;     // variable-mode (preferred)
  field?: string;        // field-mode (legacy: explicit JSON key on inputs[0])
  equals: unknown;
  goto: number;
}

export type NodeKind = 'user-input' | 'llm' | 'system-logic';

export interface UserInputNode {
  id: number;
  name: string;
  kind: 'user-input';
  userInputSchema: { fields: UserInputField[] };
  outputs: FileRef[];
  next: number | null;
}

export interface LlmNode {
  id: number;
  name: string;
  kind: 'llm';
  inputs: FileRef[];
  promptTemplate: string;
  outputs: FileRef[];
  timeoutSec: number;
  next: number | null;
  /** Names of flow variables this node should derive + write to disk. */
  initVariables?: string[];
}

export interface SystemLogicNode {
  id: number;
  name: string;
  kind: 'system-logic';
  inputs: FileRef[];
  branches: BranchRule[];
  maxRetries: number;
  defaultGoto?: number | null;
}

export type FlowNode = UserInputNode | LlmNode | SystemLogicNode;

export interface FlowDef {
  id: string;
  name: string;
  description?: string;
  entryNodeId: number;
  nodes: FlowNode[];
  variables?: FlowVariable[];
}

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'aborted';

export type PauseReason =
  | 'awaiting-user-input'
  | 'user-file-read-error'
  | 'llm-file-read-error'
  | 'timeout'
  | 'max-retries-exceeded'
  | 'user-paused'
  | null;

export interface FlowState {
  flowId: string;
  flowFilename: string;
  runId: string;
  startedAt: number;
  status: RunStatus;
  currentNodeId: number | null;
  loopCounters: Record<number, number>;
  history: Array<{ nodeId: number; startedAt: number; finishedAt: number | null; outcome: string }>;
  pauseReason: PauseReason;
  pauseDetail?: string;
  pendingUserInput?: { nodeId: number; fields: UserInputField[] };
}
