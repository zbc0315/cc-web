/** Frontend mirror of backend/src/flows/types.ts (schemaVersion 2).
 *  Keep these two files in sync — when you change one, change the other. */

export const SCHEMA_VERSION = 2 as const;

export interface FlowConstant {
  name: string;
  value: unknown;
  description?: string;
}

export interface FlowVariable {
  name: string;
  description: string;
  initialValue?: unknown;
}

export interface UserInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea';
  /** Mode A: submitted value writes to variables[name]. */
  outputVariable?: string;
  /** Mode B: displays variables[name] read-only. */
  bindVariable?: string;
  /** Mode C: displays constants[name] read-only. */
  bindConstant?: string;
}

export type NodeKind = 'user-input' | 'llm' | 'system-logic';

export interface UserInputNode {
  id: number;
  name: string;
  kind: 'user-input';
  userInputSchema: { fields: UserInputField[] };
  next: number | null;
}

export interface LlmNode {
  id: number;
  name: string;
  kind: 'llm';
  promptTemplate: string;       // supports {{var:name}} / {{const:name}}
  readVariables?: string[];
  readConstants?: string[];
  writeVariables?: string[];
  timeoutSec: number;
  next: number | null;
}

export interface BranchRule {
  variable?: string;
  constant?: string;
  equals: unknown;
  goto: number;
}

export interface SystemLogicNode {
  id: number;
  name: string;
  kind: 'system-logic';
  branches: BranchRule[];
  maxRetries: number;
  defaultGoto?: number | null;
}

export type FlowNode = UserInputNode | LlmNode | SystemLogicNode;

export interface FlowDef {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  entryNodeId: number;
  nodes: FlowNode[];
  constants?: FlowConstant[];
  variables?: FlowVariable[];
}

export type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'aborted';

export type PauseReason =
  | 'awaiting-user-input'
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
  pendingUserInput?: {
    nodeId: number;
    fields: UserInputField[];
    contextValues?: {
      variables?: Record<string, unknown>;
      constants?: Record<string, unknown>;
    };
  };
}
