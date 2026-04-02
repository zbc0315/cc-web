// backend/src/plan-control/types.ts

// ── AST Node Types ──

export type StatementType =
  | 'comment' | 'blank'
  | 'var_assign' | 'task_assign' | 'task'
  | 'if' | 'elif' | 'else'
  | 'for' | 'loop'
  | 'func' | 'call'
  | 'break' | 'continue' | 'return';

export interface ASTNode {
  line: number;            // 1-based line number in main.pc
  indent: number;          // indentation level (0, 1, 2, ...)
  type: StatementType;
  raw: string;             // original line text (trimmed of indent)
  children: ASTNode[];     // child nodes (block body)

  // Type-specific fields (only present for matching type)
  varName?: string;        // var_assign, task_assign, for
  listItems?: string[];    // var_assign: parsed list literal
  description?: string;    // task, task_assign: raw description text
  condition?: string;      // if, elif: 'success' | 'failed' | 'blocked' | '${varName}'
  iterVar?: string;        // for: loop variable name
  iterRef?: string;        // for: variable reference name (without ${})
  loopCount?: number;      // loop: iteration count
  loopCounter?: string;    // loop: optional 'as' counter variable name
  funcName?: string;       // func, call: function name
  params?: string[];       // func: parameter names
  args?: CallArg[];        // call: argument list
}

export type CallArg =
  | { type: 'var'; name: string }              // ${var}
  | { type: 'list'; items: string[] };         // [a, b, c]

// ── Checker Types ──

export interface CheckError {
  line: number;
  message: string;
}

// ── Executor State Types ──

export type PlanStatus = 'running' | 'waiting' | 'replanning' | 'paused' | 'stopped' | 'completed';

export interface CallFrame {
  func: string;
  return_line: number;
  local_vars: Record<string, PlanVarValue>;
  saved_last_task_status: string | null;
}

export interface LoopFrame {
  type: 'for' | 'loop';
  var?: string;             // for: iterator variable name; loop: counter variable name
  list?: PlanVarValue[];    // for: list being iterated
  index: number;            // current iteration index (0-based)
  count?: number;           // loop: total count
  start_line: number;       // line number of the for/loop statement
  end_line: number;         // line number of the last child in the block
}

export type PlanVarValue = string | string[] | boolean | null;

export interface HistoryEntry {
  node_id: string;
  line: number;
  status: string;
  timestamp: string;
}

export interface PlanState {
  status: PlanStatus;
  current_line: number;
  executed_tasks: number;
  estimated_tasks: number;
  variables: Record<string, PlanVarValue>;
  call_stack: CallFrame[];
  loop_stack: LoopFrame[];
  last_task_status: string | null;
  history: HistoryEntry[];
  stop_line?: number;
  stop_node_id?: string;
  error?: string;          // error message when status is 'paused' due to runtime error
}

export interface NodeRecord {
  id: string;
  line: number;
  code: string;
  resolved_code: string;
  prompt: string;
  started_at: string;
  completed_at: string | null;
  nudge_count: number;
  status: string | null;
  result: PlanVarValue;
  summary: string | null;
  request_replan?: boolean;
  replan_reason?: string;
}

// ── Plan Tree (Frontend rendering) ──

export type TreeNodeType = 'task' | 'if' | 'elif' | 'else' | 'for' | 'loop' | 'call' | 'func' | 'var';
export type TreeNodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';

export interface PlanTreeNode {
  id: string;                 // "L{line}" e.g. "L10"
  type: TreeNodeType;
  label: string;              // display text (truncated description, var name, condition, etc.)
  line: number;
  node_id?: string;           // linked node-XXX.json ID (task types only)
  status?: TreeNodeStatus;
  children: PlanTreeNode[];
}

// ── Config ──

export interface PlanConfig {
  nudge_idle_seconds: number;
  nudge_max_count: number;
  nudge_interval_multiplier: number;
  send_idle_seconds: number;
  watch_poll_interval: number;
}

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  nudge_idle_seconds: 60,
  nudge_max_count: 3,
  nudge_interval_multiplier: 2,
  send_idle_seconds: 5,
  watch_poll_interval: 10000,
};
