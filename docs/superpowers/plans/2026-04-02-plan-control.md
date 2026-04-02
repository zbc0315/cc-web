# Plan-Control System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic task orchestration system for ccweb that parses a custom DSL (pc language), executes tasks via the existing PTY terminal, monitors completion via JSON files, and displays a real-time task topology graph in the frontend.

**Architecture:** Three backend engines (Checker, Parser, Executor) — all pure deterministic logic. The Executor sends structured prompts to the PTY, monitors node JSON files for AI responses, and manages a state machine (IDLE→SENDING→WAITING→PROCESSING). Frontend adds a "任务" tab to LeftPanel with an SVG topology graph that updates in real-time via WebSocket events.

**Tech Stack:** TypeScript (backend + frontend), node fs.watch + polling for file monitoring, Express REST routes, WebSocket events on existing `/ws/projects/:id`, React + SVG for topology graph, framer-motion for animations.

**Spec:** `docs/superpowers/specs/2026-04-02-plan-control-design.md`

---

## File Structure

### Backend — New Files

| File | Responsibility |
|------|---------------|
| `backend/src/plan-control/types.ts` | All type definitions: AST node types, state types, PlanTreeNode, config types |
| `backend/src/plan-control/parser.ts` | Line-level PEG parsing + indentation-based AST construction (two-pass: collect funcs, then build tree) |
| `backend/src/plan-control/checker.ts` | Semantic validation: predecessor-task rule, break/continue/return placement, recursion detection, variable references |
| `backend/src/plan-control/templates.ts` | Static template content for init.md, plan-code.md, output-format.md |
| `backend/src/plan-control/executor.ts` | State machine: node dispatch, file watching, nudge, replan, crash recovery |
| `backend/src/routes/plan-control.ts` | REST API: init, check, start, pause, resume, stop, status, nodes, tree |

### Backend — Modified Files

| File | Change |
|------|--------|
| `backend/src/index.ts` | Mount plan-control routes, add WS event broadcasting for plan events |
| `backend/src/config.ts` | Export `atomicWriteSync` |

### Frontend — New Files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/PlanPanel.tsx` | Plan tab container: toolbar (init/check/start/pause/stop/resume) + TaskTree + error list |
| `frontend/src/components/TaskTree.tsx` | SVG topology graph: tree layout, zoom/pan, status coloring, node click details |

### Frontend — Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/LeftPanel.tsx` | Add 'plan' tab alongside 'files' and 'git' |
| `frontend/src/lib/api.ts` | Add plan-control API functions |
| `frontend/src/lib/websocket.ts` | Add plan event handlers to `useProjectWebSocket` |

---

## Task 1: Types

**Files:**
- Create: `backend/src/plan-control/types.ts`

- [ ] **Step 1: Create types file with all type definitions**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/plan-control/types.ts
git commit -m "feat(plan-control): add type definitions for AST, state, tree, and config"
```

---

## Task 2: Parser

**Files:**
- Create: `backend/src/plan-control/parser.ts`

The parser has two responsibilities:
1. Parse individual lines into `ASTNode` objects (line-level PEG)
2. Build a tree structure from indentation (parent-child relationships)

- [ ] **Step 1: Create parser with line parsing + AST building**

```typescript
// backend/src/plan-control/parser.ts
import { ASTNode, StatementType, CallArg } from './types';

const IDENTIFIER_RE = /^[a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*$/;
const VARREF_RE = /^\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}$/;
const INTERPOLATION_RE = /\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}/g;

/** Parse a single line (after indent stripping) into an ASTNode-like object. */
export function parseLine(raw: string, line: number, indent: number): ASTNode {
  const base: ASTNode = { line, indent, type: 'blank', raw, children: [] };

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    base.type = trimmed.startsWith('#') ? 'comment' : 'blank';
    return base;
  }

  // task_assign: identifier = task description
  const taskAssignMatch = trimmed.match(/^([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\s+=\s+task\s+(.+)$/);
  if (taskAssignMatch) {
    base.type = 'task_assign';
    base.varName = taskAssignMatch[1];
    base.description = taskAssignMatch[2];
    return base;
  }

  // var_assign: identifier = [list]
  const varAssignMatch = trimmed.match(/^([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\s+=\s+\[([^\]]*)\]$/);
  if (varAssignMatch) {
    base.type = 'var_assign';
    base.varName = varAssignMatch[1];
    const inner = varAssignMatch[2].trim();
    base.listItems = inner === '' ? [] : inner.split(',').map(s => s.trim());
    return base;
  }

  // task: task description
  if (trimmed.startsWith('task ')) {
    base.type = 'task';
    base.description = trimmed.slice(5);
    return base;
  }

  // if: if condition:
  const ifMatch = trimmed.match(/^if\s+(.+):$/);
  if (ifMatch) {
    base.type = 'if';
    base.condition = ifMatch[1];
    return base;
  }

  // elif: elif condition:
  const elifMatch = trimmed.match(/^elif\s+(.+):$/);
  if (elifMatch) {
    base.type = 'elif';
    base.condition = elifMatch[1];
    return base;
  }

  // else:
  if (trimmed === 'else:') {
    base.type = 'else';
    return base;
  }

  // for: for var in ${ref}:
  const forMatch = trimmed.match(/^for\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\s+in\s+\$\{([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\}:$/);
  if (forMatch) {
    base.type = 'for';
    base.iterVar = forMatch[1];
    base.iterRef = forMatch[2];
    return base;
  }

  // loop: loop N [as counter]:
  const loopMatch = trimmed.match(/^loop\s+(\d+)(?:\s+as\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*))?:$/);
  if (loopMatch) {
    base.type = 'loop';
    base.loopCount = parseInt(loopMatch[1], 10);
    if (loopMatch[2]) base.loopCounter = loopMatch[2];
    return base;
  }

  // func: func name(params):
  const funcMatch = trimmed.match(/^func\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\(([^)]*)\):$/);
  if (funcMatch) {
    base.type = 'func';
    base.funcName = funcMatch[1];
    const paramStr = funcMatch[2].trim();
    base.params = paramStr === '' ? [] : paramStr.split(/,\s*/).map(s => s.trim());
    return base;
  }

  // call: call name(args)
  const callMatch = trimmed.match(/^call\s+([a-zA-Z_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*)\(([^)]*)\)$/);
  if (callMatch) {
    base.type = 'call';
    base.funcName = callMatch[1];
    base.args = parseArgList(callMatch[2]);
    return base;
  }

  if (trimmed === 'break') { base.type = 'break'; return base; }
  if (trimmed === 'continue') { base.type = 'continue'; return base; }
  if (trimmed === 'return') { base.type = 'return'; return base; }

  // Unrecognized line — treated as parse error (checker will flag it)
  return base;
}

function parseArgList(argStr: string): CallArg[] {
  const s = argStr.trim();
  if (s === '') return [];
  const args: CallArg[] = [];
  // Split by commas, respecting brackets
  let depth = 0, start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || (s[i] === ',' && depth === 0)) {
      const part = s.slice(start, i).trim();
      const varMatch = part.match(VARREF_RE);
      if (varMatch) {
        args.push({ type: 'var', name: varMatch[1] });
      } else if (part.startsWith('[') && part.endsWith(']')) {
        const inner = part.slice(1, -1).trim();
        args.push({ type: 'list', items: inner === '' ? [] : inner.split(',').map(x => x.trim()) });
      }
      start = i + 1;
    } else if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
  }
  return args;
}

/** Parse all lines and build indentation-based AST tree. */
export function parseProgram(source: string): ASTNode[] {
  const lines = source.split('\n');
  const nodes: ASTNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/\t/g, '  '); // normalize tabs
    const indentMatch = stripped.match(/^( *)/);
    const spaces = indentMatch ? indentMatch[1].length : 0;
    const indent = Math.floor(spaces / 2);
    const raw = stripped.trimStart();
    nodes.push(parseLine(raw, i + 1, indent)); // 1-based line numbers
  }

  return buildTree(nodes);
}

/** Build parent-child tree from flat indented nodes. */
function buildTree(flatNodes: ASTNode[]): ASTNode[] {
  const root: ASTNode[] = [];
  const stack: { indent: number; children: ASTNode[] }[] = [{ indent: -1, children: root }];

  for (const node of flatNodes) {
    if (node.type === 'blank' || node.type === 'comment') {
      // Attach to current parent
      stack[stack.length - 1].children.push(node);
      continue;
    }

    // Pop stack until we find a parent with lower indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= node.indent) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);

    // If this node can have children (block opener), push it
    if (['if', 'elif', 'else', 'for', 'loop', 'func'].includes(node.type)) {
      stack.push({ indent: node.indent, children: node.children });
    }
  }

  return root;
}

/** Collect all func definitions from AST (first pass). */
export function collectFuncs(ast: ASTNode[]): Map<string, ASTNode> {
  const funcs = new Map<string, ASTNode>();
  function walk(nodes: ASTNode[]) {
    for (const n of nodes) {
      if (n.type === 'func' && n.funcName) {
        funcs.set(n.funcName, n);
      }
      if (n.children.length > 0) walk(n.children);
    }
  }
  walk(ast);
  return funcs;
}

/** Interpolate ${var} references in a description string. */
export function interpolate(text: string, variables: Record<string, unknown>): string {
  return text.replace(INTERPOLATION_RE, (match, name) => {
    const val = variables[name];
    if (val === undefined || val === null) return match; // leave unresolved
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  });
}

/** Count estimated tasks in AST (loop N multiplied, for counted as 1x). */
export function estimateTasks(ast: ASTNode[], loopMultiplier = 1): number {
  let count = 0;
  for (const node of ast) {
    if (node.type === 'task' || node.type === 'task_assign') {
      count += loopMultiplier;
    } else if (node.type === 'loop' && node.loopCount) {
      count += estimateTasks(node.children, loopMultiplier * node.loopCount);
    } else if (node.children.length > 0) {
      count += estimateTasks(node.children, loopMultiplier);
    }
  }
  return count;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/plan-control/parser.ts
git commit -m "feat(plan-control): implement pc language parser with line parsing and AST building"
```

---

## Task 3: Checker

**Files:**
- Create: `backend/src/plan-control/checker.ts`

- [ ] **Step 1: Create checker with all semantic validation rules**

```typescript
// backend/src/plan-control/checker.ts
import { ASTNode, CheckError } from './types';
import { collectFuncs } from './parser';

export function check(ast: ASTNode[]): CheckError[] {
  const errors: CheckError[] = [];
  const funcs = collectFuncs(ast);

  // Validate all nodes
  walkCheck(ast, errors, funcs, { inLoop: false, inFunc: false });

  // Check for recursion
  checkRecursion(funcs, errors);

  return errors;
}

function walkCheck(
  nodes: ASTNode[],
  errors: CheckError[],
  funcs: Map<string, ASTNode>,
  ctx: { inLoop: boolean; inFunc: boolean }
) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Skip blanks and comments
    if (node.type === 'blank' || node.type === 'comment') continue;

    // Unrecognized line
    if (node.type === 'blank' && node.raw.trim() !== '') {
      errors.push({ line: node.line, message: `无法识别的语法: ${node.raw}` });
      continue;
    }

    // Indentation must be exact multiple of 2 spaces
    // (already handled by parser, but check for tab usage)
    if (node.raw !== node.raw.replace(/\t/g, '  ')) {
      errors.push({ line: node.line, message: '缩进必须使用空格，不允许 tab' });
    }

    // Check predecessor-task rule for if/elif with status conditions
    if ((node.type === 'if' || node.type === 'elif') && node.condition) {
      const isStatusCondition = ['success', 'failed', 'blocked'].includes(node.condition);
      if (isStatusCondition) {
        const hasPrecedingTask = nodes.slice(0, i).some(
          n => (n.type === 'task' || n.type === 'task_assign') && n.indent === node.indent
        );
        if (!hasPrecedingTask) {
          errors.push({
            line: node.line,
            message: `if/elif 使用状态条件 "${node.condition}" 时，同级前方必须存在 task 语句`,
          });
        }
      }
    }

    // break/continue must be inside a loop
    if (node.type === 'break' || node.type === 'continue') {
      if (!ctx.inLoop) {
        errors.push({ line: node.line, message: `${node.type} 必须在 for 或 loop 循环体内` });
      }
    }

    // return must be inside a function
    if (node.type === 'return') {
      if (!ctx.inFunc) {
        errors.push({ line: node.line, message: 'return 必须在 func 函数体内' });
      }
    }

    // call must reference a defined function
    if (node.type === 'call' && node.funcName) {
      if (!funcs.has(node.funcName)) {
        errors.push({ line: node.line, message: `未定义的函数: ${node.funcName}` });
      }
    }

    // Recurse into children with updated context
    if (node.children.length > 0) {
      const childCtx = {
        inLoop: ctx.inLoop || node.type === 'for' || node.type === 'loop',
        inFunc: ctx.inFunc || node.type === 'func',
      };
      walkCheck(node.children, errors, funcs, childCtx);
    }
  }
}

/** Detect recursion (direct + mutual) via call graph DFS cycle detection. */
function checkRecursion(funcs: Map<string, ASTNode>, errors: CheckError[]) {
  // Build call graph: func name -> set of called func names
  const callGraph = new Map<string, Set<string>>();
  for (const [name, node] of funcs) {
    const calls = new Set<string>();
    collectCalls(node.children, calls);
    callGraph.set(name, calls);
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(name: string): boolean {
    if (inStack.has(name)) return true; // cycle found
    if (visited.has(name)) return false;
    visited.add(name);
    inStack.add(name);
    for (const callee of callGraph.get(name) ?? []) {
      if (callGraph.has(callee) && dfs(callee)) {
        const funcNode = funcs.get(name)!;
        errors.push({ line: funcNode.line, message: `检测到递归调用: ${name} → ${callee}` });
        return true;
      }
    }
    inStack.delete(name);
    return false;
  }

  for (const name of funcs.keys()) {
    dfs(name);
  }
}

function collectCalls(nodes: ASTNode[], calls: Set<string>) {
  for (const node of nodes) {
    if (node.type === 'call' && node.funcName) {
      calls.add(node.funcName);
    }
    if (node.children.length > 0) collectCalls(node.children, calls);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/plan-control/checker.ts
git commit -m "feat(plan-control): implement checker with semantic validation rules"
```

---

## Task 4: Templates

**Files:**
- Create: `backend/src/plan-control/templates.ts`

- [ ] **Step 1: Create templates file**

The init.md, plan-code.md, and output-format.md templates. The plan-code.md is the pc language spec (extracted from design doc). The output-format.md is the node output JSON format. The init.md guides the AI through the interview process.

```typescript
// backend/src/plan-control/templates.ts

export const INIT_MD = `# Plan-Control 初始化指引

你现在处于 Plan-Control 初始化模式。请按以下步骤操作：

## 第一步：深度访谈

对用户进行深度访谈，了解：
1. 具体目标和预期成果
2. 当前可用资源（计算资源、远程服务器、API、数据库等）
3. 约束条件和优先级
4. 成功标准

## 第二步：制定计划

基于访谈结果，制定详细的执行计划。

## 第三步：编写 main.pc

依据 .plan-control/plan-code.md 中的 pc 语言规范，将计划编写为 .plan-control/main.pc 文件。

注意事项：
- 使用 2 空格缩进
- task 描述要具体明确，AI 执行时能理解
- 合理使用 if/for/loop 控制流
- 需要返回值时使用 \`变量 = task 描述\` 语法
`;

export const OUTPUT_FORMAT_MD = `# 节点输出格式

任务完成后，请更新指定的 JSON 文件，严格按以下格式：

\`\`\`json
{
  "status": "success | failed | blocked | replan",
  "result": null,
  "summary": "",
  "request_replan": false,
  "replan_reason": ""
}
\`\`\`

## 字段说明

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| status | 是 | string | success=完成 / failed=失败 / blocked=需人工介入 / replan=计划需调整 |
| result | 是 | bool/string/array | 返回值。布尔值供 if 判断，列表供 for 遍历，字符串供插值 |
| summary | 是 | string | 一句话描述执行结果 |
| request_replan | 否 | bool | 如认为后续计划需要调整，设为 true |
| replan_reason | 否 | string | 当 request_replan=true 时必填，说明调整原因 |

## 示例

任务成功并返回列表：
\`\`\`json
{
  "status": "success",
  "result": ["PubChem", "NIST"],
  "summary": "检测到2个可用的开源分子数据库"
}
\`\`\`

任务失败：
\`\`\`json
{
  "status": "failed",
  "result": false,
  "summary": "PubChem API 返回 503，服务暂时不可用"
}
\`\`\`
`;

export const PLAN_CODE_MD = `# pc 语言规范

## 基础语法

- 固定 2 空格缩进（不允许 tab）
- 任务描述为纯自然语言，不需要引号
- 变量引用统一使用 \`\${变量名}\` 语法

## 关键字

| 关键字 | 示例 |
|--------|------|
| task | \`task 从PubChem下载候选分子\` |
| if/elif/else | \`if success:\` / \`elif failed:\` / \`else:\` |
| for...in | \`for db in \${databases}:\` |
| loop N | \`loop 3:\` / \`loop 5 as i:\` |
| func/call | \`func 计算(targets):\` / \`call 计算(\${molecules})\` |
| break | 跳出最内层循环 |
| continue | 跳到下一次迭代 |
| return | 从函数返回 |

## 变量

静态定义（仅列表）：
\`\`\`
databases = [PubChem, ZINC, ChEMBL]
\`\`\`

动态赋值（task返回值）：
\`\`\`
results = task 查询所有数据库
\`\`\`

## 条件判断

基于最近 task 的状态：\`success\` / \`failed\` / \`blocked\`
变量条件：\`if \${has_gpu}:\` 检查 truthy

## 完整示例

\`\`\`
methods = [ML预测, xtb计算, DFT计算]

func 性质计算(targets, method_list):
  for m in \${method_list}:
    results = task 使用\${m}计算\${targets}的性质
    if success:
      return
  task 所有方法均失败，请分析原因

databases = task 查询所有开源分子数据库
for db in \${databases}:
  task 从\${db}下载候选分子
  if success:
    molecules = task 提取候选分子列表
    call 性质计算(\${molecules}, \${methods})
    break

task 生成最终报告
\`\`\`
`;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/plan-control/templates.ts
git commit -m "feat(plan-control): add init, plan-code, and output-format templates"
```

---

## Task 5: Executor

**Files:**
- Create: `backend/src/plan-control/executor.ts`
- Modify: `backend/src/config.ts` (export atomicWriteSync)

This is the largest and most complex component. It implements the full state machine.

- [ ] **Step 1: Export atomicWriteSync from config.ts**

In `backend/src/config.ts`, change:
```typescript
function atomicWriteSync(filePath: string, data: string): void {
```
to:
```typescript
export function atomicWriteSync(filePath: string, data: string): void {
```

- [ ] **Step 2: Create executor with state machine**

```typescript
// backend/src/plan-control/executor.ts
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteSync } from '../config';
import {
  ASTNode, PlanState, PlanStatus, NodeRecord, PlanConfig,
  DEFAULT_PLAN_CONFIG, PlanVarValue, CallFrame, LoopFrame, HistoryEntry,
} from './types';
import { parseProgram, collectFuncs, interpolate, estimateTasks } from './parser';
import { check } from './checker';

type StateMachineState = 'IDLE' | 'SENDING' | 'WAITING' | 'PROCESSING' | 'REPLANNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';

interface ExecutorDeps {
  /** Write text to the project's PTY stdin. */
  writeToPty: (text: string) => void;
  /** Get the PTY's last activity timestamp (epoch ms). */
  getLastActivity: () => number | null;
  /** Broadcast a WS event to all project clients. */
  broadcast: (event: Record<string, unknown>) => void;
}

export class PlanExecutor extends EventEmitter {
  private projectPath: string;
  private pcDir: string;
  private deps: ExecutorDeps;
  private config: PlanConfig;

  private state: PlanState | null = null;
  private ast: ASTNode[] = [];
  private funcs: Map<string, ASTNode> = new Map();
  private flatNodes: ASTNode[] = []; // all non-blank/comment nodes in order
  private machineState: StateMachineState = 'STOPPED';
  private nodeCounter = 0;
  private currentNodeId: string | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeCount = 0;
  private preReplanLines: string[] | null = null; // saved lines for replan validation
  private pendingPause = false;

  constructor(projectPath: string, deps: ExecutorDeps, config?: Partial<PlanConfig>) {
    super();
    this.projectPath = projectPath;
    this.pcDir = path.join(projectPath, '.plan-control');
    this.deps = deps;
    this.config = { ...DEFAULT_PLAN_CONFIG, ...config };
  }

  // ── Public API ──

  /** Check syntax of main.pc. Returns errors or empty array. */
  checkSyntax(): { errors: { line: number; message: string }[]; ast: ASTNode[] } {
    const source = this.readMainPc();
    if (!source) return { errors: [{ line: 0, message: 'main.pc 文件不存在' }], ast: [] };
    const ast = parseProgram(source);
    const errors = check(ast);
    return { errors, ast };
  }

  /** Start execution from the beginning. */
  start(): void {
    const { errors, ast } = this.checkSyntax();
    if (errors.length > 0) throw new Error('语法检查失败，请先修复错误');

    this.ast = ast;
    this.funcs = collectFuncs(ast);
    this.flattenAst();
    this.nodeCounter = 0;

    this.state = {
      status: 'running',
      current_line: this.findFirstExecutableLine(),
      executed_tasks: 0,
      estimated_tasks: estimateTasks(ast),
      variables: {},
      call_stack: [],
      loop_stack: [],
      last_task_status: null,
      history: [],
    };

    // Process static var_assign nodes at top level before first task
    this.processInitialVarAssigns();

    this.saveState();
    this.machineState = 'IDLE';
    this.broadcastStatus();
    this.tick();
  }

  /** Resume from paused/stopped state. */
  resume(): void {
    if (!this.state) {
      this.tryRecoverState();
      if (!this.state) throw new Error('无执行状态可恢复');
    }

    const source = this.readMainPc();
    if (!source) throw new Error('main.pc 不存在');
    this.ast = parseProgram(source);
    this.funcs = collectFuncs(this.ast);
    this.flattenAst();

    // Restore node counter from history
    if (this.state.history.length > 0) {
      const maxId = Math.max(...this.state.history.map(h => parseInt(h.node_id, 10)));
      this.nodeCounter = maxId;
    }

    this.state.status = 'running';
    this.saveState();
    this.machineState = 'IDLE';
    this.pendingPause = false;
    this.broadcastStatus();
    this.tick();
  }

  /** Pause execution (after current node completes if waiting). */
  pause(): void {
    if (this.machineState === 'WAITING') {
      this.pendingPause = true; // will pause after current node
      return;
    }
    this.enterPaused('用户暂停');
  }

  /** Stop execution immediately. */
  stop(): void {
    this.cleanup();
    if (this.state) {
      this.state.status = 'stopped';
      this.state.stop_line = this.state.current_line;
      this.state.stop_node_id = this.currentNodeId ?? undefined;
      this.saveState();
    }
    this.machineState = 'STOPPED';
    this.broadcastStatus();
  }

  /** Get current state (for API). */
  getState(): PlanState | null {
    return this.state;
  }

  /** Get all node records (for API). */
  getNodes(): NodeRecord[] {
    const nodesDir = path.join(this.pcDir, 'nodes');
    if (!fs.existsSync(nodesDir)) return [];
    return fs.readdirSync(nodesDir)
      .filter(f => f.startsWith('node-') && f.endsWith('.json'))
      .sort()
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(nodesDir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean) as NodeRecord[];
  }

  /** Get a single node record. */
  getNode(nodeId: string): NodeRecord | null {
    const file = path.join(this.pcDir, 'nodes', `node-${nodeId}.json`);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
    catch { return null; }
  }

  /** Check if .plan-control/ exists. */
  isInitialized(): boolean {
    return fs.existsSync(this.pcDir) && fs.existsSync(path.join(this.pcDir, 'plan-code.md'));
  }

  /** Check if main.pc exists. */
  hasMainPc(): boolean {
    return fs.existsSync(path.join(this.pcDir, 'main.pc'));
  }

  // ── State Machine ──

  private tick(): void {
    if (this.machineState !== 'IDLE' || !this.state) return;

    const node = this.findNodeAtLine(this.state.current_line);
    if (!node) {
      // No more lines — execution complete
      this.state.status = 'completed';
      this.saveState();
      this.machineState = 'COMPLETED';
      this.broadcastStatus();
      return;
    }

    if (node.type === 'task' || node.type === 'task_assign') {
      this.dispatchTask(node);
    } else {
      this.processControlFlow(node);
      // After processing, advance and tick again
      this.advanceLine();
      this.saveState();
      this.broadcastStatus();
      // Use setImmediate to avoid deep recursion for sequential control-flow lines
      setImmediate(() => this.tick());
    }
  }

  private dispatchTask(node: ASTNode): void {
    this.machineState = 'SENDING';
    const description = node.description ?? '';
    const resolvedDesc = interpolate(description, this.getEffectiveVariables());

    // Create node JSON skeleton
    const nodeId = this.nextNodeId();
    this.currentNodeId = nodeId;
    const resolvedCode = node.type === 'task_assign'
      ? `${node.varName} = task ${resolvedDesc}`
      : `task ${resolvedDesc}`;

    const prompt = this.buildPrompt(nodeId, resolvedDesc, node);
    const record: NodeRecord = {
      id: nodeId,
      line: node.line,
      code: node.raw,
      resolved_code: resolvedCode,
      prompt,
      started_at: new Date().toISOString(),
      completed_at: null,
      nudge_count: 0,
      status: null,
      result: null,
      summary: null,
    };

    const nodesDir = path.join(this.pcDir, 'nodes');
    fs.mkdirSync(nodesDir, { recursive: true });
    fs.writeFileSync(path.join(nodesDir, `node-${nodeId}.json`), JSON.stringify(record, null, 2));

    this.waitForIdle(() => {
      this.deps.writeToPty(prompt + '\n');
      this.machineState = 'WAITING';
      this.state!.status = 'waiting';
      this.saveState();
      this.broadcastStatus();
      this.startFileWatch(nodeId);
      this.startNudgeTimer(nodeId);
    });
  }

  private processControlFlow(node: ASTNode): void {
    const state = this.state!;
    const vars = this.getEffectiveVariables();

    switch (node.type) {
      case 'var_assign':
        if (node.varName && node.listItems) {
          this.setVariable(node.varName, node.listItems);
        }
        break;

      case 'if': {
        const matched = this.evaluateCondition(node.condition!);
        if (!matched) {
          // Skip to elif/else/end of if-chain
          this.skipIfChain(node);
          return; // advanceLine handled by skipIfChain
        }
        // Enter the if body — next line is first child
        break;
      }

      case 'elif': {
        // If we reach elif normally, the preceding if/elif was true — skip rest of chain
        this.skipIfChain(node);
        return;
      }

      case 'else': {
        // If we reach else normally, a preceding if/elif was true — skip else body
        // But if we jumped here from a false if, we enter the body
        // This is handled by skipIfChain setting current_line
        break;
      }

      case 'for': {
        const listVal = vars[node.iterRef!];
        let list: PlanVarValue[];
        if (Array.isArray(listVal)) {
          list = listVal;
        } else if (typeof listVal === 'string') {
          list = [listVal];
        } else if (listVal === null || listVal === undefined || typeof listVal === 'boolean') {
          this.enterPaused(`for 循环变量 \${${node.iterRef}} 不是列表（值: ${JSON.stringify(listVal)}）`);
          return;
        } else {
          list = [];
        }

        if (list.length === 0) {
          // Skip loop body
          this.skipBlock(node);
          return;
        }

        const endLine = this.findBlockEndLine(node);
        state.loop_stack.push({
          type: 'for',
          var: node.iterVar,
          list,
          index: 0,
          start_line: node.line,
          end_line: endLine,
        });
        this.setVariable(node.iterVar!, list[0]);
        break;
      }

      case 'loop': {
        const endLine = this.findBlockEndLine(node);
        state.loop_stack.push({
          type: 'loop',
          var: node.loopCounter,
          count: node.loopCount,
          index: 0,
          start_line: node.line,
          end_line: endLine,
        });
        if (node.loopCounter) {
          this.setVariable(node.loopCounter, '1');
        }
        break;
      }

      case 'break': {
        const frame = state.loop_stack.pop();
        if (frame) {
          state.current_line = frame.end_line;
          // advanceLine will move past the block
        }
        break;
      }

      case 'continue': {
        const frame = state.loop_stack[state.loop_stack.length - 1];
        if (frame) {
          frame.index++;
          if (this.isLoopDone(frame)) {
            state.loop_stack.pop();
            state.current_line = frame.end_line;
          } else {
            this.updateLoopVar(frame);
            state.current_line = frame.start_line; // will advance into body
          }
        }
        break;
      }

      case 'func':
        // Function definitions are skipped during normal execution
        this.skipBlock(node);
        return;

      case 'call': {
        if (state.call_stack.length >= 20) {
          this.enterPaused('call_stack 深度超过限制 (20)');
          return;
        }
        const funcNode = this.funcs.get(node.funcName!);
        if (!funcNode) break; // checker should have caught this

        // Push call frame
        const frame: CallFrame = {
          func: node.funcName!,
          return_line: this.findNextLineAfter(node.line),
          local_vars: {},
          saved_last_task_status: state.last_task_status,
        };

        // Bind arguments to parameters
        if (funcNode.params && node.args) {
          for (let i = 0; i < funcNode.params.length; i++) {
            const param = funcNode.params[i];
            const arg = node.args[i];
            if (arg) {
              if (arg.type === 'var') {
                frame.local_vars[param] = vars[arg.name] ?? null;
              } else {
                frame.local_vars[param] = arg.items;
              }
            }
          }
        }

        state.call_stack.push(frame);
        state.current_line = funcNode.line; // will advance into func body
        break;
      }

      case 'return': {
        const callFrame = state.call_stack.pop();
        if (callFrame) {
          state.last_task_status = callFrame.saved_last_task_status;
          state.current_line = callFrame.return_line - 1; // advanceLine will go to return_line
        }
        break;
      }

      case 'comment':
      case 'blank':
        break;
    }
  }

  // ── File Watching ──

  private startFileWatch(nodeId: string): void {
    const nodeFile = path.join(this.pcDir, 'nodes', `node-${nodeId}.json`);
    this.nudgeCount = 0;

    try {
      this.fileWatcher = fs.watch(nodeFile, () => this.checkNodeResult(nodeId));
    } catch { /* fs.watch may not work on all platforms */ }

    this.pollTimer = setInterval(() => this.checkNodeResult(nodeId), this.config.watch_poll_interval);
  }

  private checkNodeResult(nodeId: string): void {
    if (this.machineState !== 'WAITING') return;

    const record = this.getNode(nodeId);
    if (!record || record.status === null) return;

    // Validate status
    const validStatuses = ['success', 'failed', 'blocked', 'replan'];
    if (!validStatuses.includes(record.status)) {
      this.deps.writeToPty(
        `\n[PLAN-CONTROL] 错误：status 值 "${record.status}" 无效。有效值: ${validStatuses.join(', ')}\n`
      );
      return;
    }

    this.cleanup();
    record.completed_at = new Date().toISOString();
    fs.writeFileSync(
      path.join(this.pcDir, 'nodes', `node-${nodeId}.json`),
      JSON.stringify(record, null, 2)
    );

    this.processResult(record);
  }

  private processResult(record: NodeRecord): void {
    if (!this.state) return;
    this.machineState = 'PROCESSING';

    const node = this.findNodeAtLine(this.state.current_line);

    // Update variable if task_assign
    if (node?.type === 'task_assign' && node.varName) {
      this.setVariable(node.varName, record.result);
    }

    // Normalize last_task_status: 'replan' → 'success'
    const normalizedStatus = record.status === 'replan' ? 'success' : record.status!;
    this.state.last_task_status = normalizedStatus;
    this.state.executed_tasks++;

    // Record history
    this.state.history.push({
      node_id: record.id,
      line: record.line,
      status: record.status!,
      timestamp: record.completed_at!,
    });

    // Broadcast node update
    this.deps.broadcast({
      type: 'plan_node_update',
      node_id: record.id,
      status: record.status,
      summary: record.summary,
    });

    // Check for replan
    const needsReplan = record.request_replan || record.status === 'replan';
    if (needsReplan) {
      this.enterReplanning(record);
      return;
    }

    // Check pending pause
    if (this.pendingPause) {
      this.pendingPause = false;
      this.enterPaused('用户暂停');
      return;
    }

    // Advance to next line
    this.advanceLine();
    this.state.status = 'running';
    this.saveState();
    this.machineState = 'IDLE';
    this.broadcastStatus();
    this.tick();
  }

  // ── Nudge ──

  private startNudgeTimer(nodeId: string): void {
    const interval = this.config.nudge_idle_seconds * 1000 *
      Math.pow(this.config.nudge_interval_multiplier, this.nudgeCount);

    this.nudgeTimer = setTimeout(() => {
      if (this.machineState !== 'WAITING') return;

      const lastActivity = this.deps.getLastActivity();
      const now = Date.now();
      const idle = lastActivity ? (now - lastActivity) > this.config.nudge_idle_seconds * 1000 : true;

      if (!idle) {
        // Not idle yet, reschedule
        this.startNudgeTimer(nodeId);
        return;
      }

      this.nudgeCount++;
      if (this.nudgeCount > this.config.nudge_max_count) {
        // Max nudges exceeded — mark as blocked
        const record = this.getNode(nodeId);
        if (record && !record.status) {
          record.status = 'blocked';
          record.summary = `${this.config.nudge_max_count} 次催促后仍无响应`;
          record.completed_at = new Date().toISOString();
          fs.writeFileSync(
            path.join(this.pcDir, 'nodes', `node-${nodeId}.json`),
            JSON.stringify(record, null, 2)
          );
          this.cleanup();
          this.processResult(record);
        }
        return;
      }

      this.deps.writeToPty(
        `\n请继续当前任务。如果已完成，请按照 .plan-control/output-format.md 的格式更新 .plan-control/nodes/node-${nodeId}.json\n`
      );

      // Update nudge count in record
      const record = this.getNode(nodeId);
      if (record) {
        record.nudge_count = this.nudgeCount;
        fs.writeFileSync(
          path.join(this.pcDir, 'nodes', `node-${nodeId}.json`),
          JSON.stringify(record, null, 2)
        );
      }

      this.deps.broadcast({ type: 'plan_nudge', node_id: nodeId, nudge_count: this.nudgeCount });
      this.startNudgeTimer(nodeId); // schedule next
    }, interval);
  }

  // ── Replan ──

  private enterReplanning(record: NodeRecord): void {
    if (!this.state) return;
    this.state.status = 'replanning';
    this.saveState();
    this.machineState = 'REPLANNING';

    // Save current main.pc lines for validation
    const source = this.readMainPc();
    this.preReplanLines = source ? source.split('\n') : [];

    const prompt = `\n[PLAN-CONTROL] 计划调整请求
原因：${record.replan_reason || '未提供原因'}
请修改 .plan-control/main.pc，保留前 ${this.state.current_line} 行不变，调整后续计划。
修改完成后，请更新 .plan-control/nodes/node-${record.id}.json 的 status 为 "success"。
[/PLAN-CONTROL]\n`;

    this.deps.writeToPty(prompt);
    this.deps.broadcast({ type: 'plan_replan', node_id: record.id, reason: record.replan_reason });
    this.broadcastStatus();

    // Watch for the node JSON to be updated to success (replan completion signal)
    this.startFileWatch(record.id);
  }

  /** Called when replan signal (node status changed) is detected. */
  private handleReplanComplete(nodeId: string): void {
    if (!this.state || !this.preReplanLines) return;

    // Validate that first N lines are unchanged
    const newSource = this.readMainPc();
    if (!newSource) {
      this.deps.writeToPty('\n[PLAN-CONTROL] 错误：main.pc 不存在\n');
      return;
    }

    const newLines = newSource.split('\n');
    const preserveCount = this.state.current_line;
    for (let i = 0; i < preserveCount && i < this.preReplanLines.length; i++) {
      if (newLines[i] !== this.preReplanLines[i]) {
        this.deps.writeToPty(
          `\n[PLAN-CONTROL] 错误：前 ${preserveCount} 行不可修改（第 ${i + 1} 行已变更），请恢复并仅修改第 ${preserveCount + 1} 行之后的内容\n`
        );
        return;
      }
    }

    // Re-check syntax
    const ast = parseProgram(newSource);
    const errors = check(ast);
    if (errors.length > 0) {
      const errText = errors.map(e => `第 ${e.line} 行: ${e.message}`).join('\n');
      this.deps.writeToPty(`\n[PLAN-CONTROL] 语法错误:\n${errText}\n请修复后重试。\n`);
      return;
    }

    // Success — rebuild AST and continue
    this.preReplanLines = null;
    this.ast = ast;
    this.funcs = collectFuncs(ast);
    this.flattenAst();
    this.state.estimated_tasks = estimateTasks(ast);
    this.state.status = 'running';
    this.advanceLine();
    this.saveState();
    this.machineState = 'IDLE';
    this.broadcastStatus();
    this.tick();
  }

  // ── Crash Recovery ──

  tryRecoverState(): void {
    const stateFile = path.join(this.pcDir, 'state.json');
    if (!fs.existsSync(stateFile)) return;

    try {
      this.state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch { return; }

    if (!this.state || this.state.status === 'completed') {
      this.state = null;
      return;
    }

    // Parse AST
    const source = this.readMainPc();
    if (!source) return;
    this.ast = parseProgram(source);
    this.funcs = collectFuncs(this.ast);
    this.flattenAst();

    // Restore node counter
    if (this.state.history.length > 0) {
      this.nodeCounter = Math.max(...this.state.history.map(h => parseInt(h.node_id, 10)));
    }
  }

  // ── Helpers ──

  private readMainPc(): string | null {
    const file = path.join(this.pcDir, 'main.pc');
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8');
  }

  private saveState(): void {
    if (!this.state) return;
    fs.mkdirSync(this.pcDir, { recursive: true });
    atomicWriteSync(path.join(this.pcDir, 'state.json'), JSON.stringify(this.state, null, 2));
  }

  private nextNodeId(): string {
    this.nodeCounter++;
    return String(this.nodeCounter).padStart(3, '0');
  }

  private getEffectiveVariables(): Record<string, PlanVarValue> {
    if (!this.state) return {};
    const vars = { ...this.state.variables };
    // Overlay local vars from call stack (top frame)
    if (this.state.call_stack.length > 0) {
      const frame = this.state.call_stack[this.state.call_stack.length - 1];
      Object.assign(vars, frame.local_vars);
    }
    return vars;
  }

  private setVariable(name: string, value: PlanVarValue): void {
    if (!this.state) return;
    if (this.state.call_stack.length > 0) {
      this.state.call_stack[this.state.call_stack.length - 1].local_vars[name] = value;
    } else {
      this.state.variables[name] = value;
    }
  }

  private evaluateCondition(condition: string): boolean {
    if (!this.state) return false;
    // Status conditions
    if (['success', 'failed', 'blocked'].includes(condition)) {
      return this.state.last_task_status === condition;
    }
    // VarRef condition: ${var}
    const varMatch = condition.match(/^\$\{(.+)\}$/);
    if (varMatch) {
      const val = this.getEffectiveVariables()[varMatch[1]];
      if (val === null || val === undefined || val === false) return false;
      if (val === '') return false;
      if (Array.isArray(val) && val.length === 0) return false;
      return true;
    }
    return false;
  }

  private findNodeAtLine(line: number): ASTNode | undefined {
    return this.flatNodes.find(n => n.line === line);
  }

  private flattenAst(): void {
    this.flatNodes = [];
    const walk = (nodes: ASTNode[]) => {
      for (const n of nodes) {
        if (n.type !== 'blank' && n.type !== 'comment') {
          this.flatNodes.push(n);
        }
        if (n.children.length > 0) walk(n.children);
      }
    };
    walk(this.ast);
    this.flatNodes.sort((a, b) => a.line - b.line);
  }

  private findFirstExecutableLine(): number {
    for (const n of this.flatNodes) {
      if (n.type !== 'blank' && n.type !== 'comment') return n.line;
    }
    return 1;
  }

  private advanceLine(): void {
    if (!this.state) return;
    const currentIdx = this.flatNodes.findIndex(n => n.line === this.state!.current_line);
    if (currentIdx < 0 || currentIdx + 1 >= this.flatNodes.length) {
      // Check if we need to loop back
      if (this.checkLoopEnd()) return;
      // End of program
      this.state.current_line = this.flatNodes.length > 0
        ? this.flatNodes[this.flatNodes.length - 1].line + 1
        : 1;
      return;
    }

    const nextNode = this.flatNodes[currentIdx + 1];
    this.state.current_line = nextNode.line;

    // Check if we've exited a loop block
    this.checkLoopEnd();
  }

  private checkLoopEnd(): boolean {
    if (!this.state || this.state.loop_stack.length === 0) return false;
    const frame = this.state.loop_stack[this.state.loop_stack.length - 1];

    if (this.state.current_line > frame.end_line) {
      frame.index++;
      if (this.isLoopDone(frame)) {
        this.state.loop_stack.pop();
        return false;
      }
      this.updateLoopVar(frame);
      this.state.current_line = frame.start_line;
      // Move to first child of loop
      const loopNode = this.findNodeAtLine(frame.start_line);
      if (loopNode && loopNode.children.length > 0) {
        this.state.current_line = loopNode.children[0].line;
      }
      return true;
    }
    return false;
  }

  private isLoopDone(frame: LoopFrame): boolean {
    if (frame.type === 'for') {
      return frame.index >= (frame.list?.length ?? 0);
    }
    return frame.index >= (frame.count ?? 0);
  }

  private updateLoopVar(frame: LoopFrame): void {
    if (frame.type === 'for' && frame.var && frame.list) {
      this.setVariable(frame.var, frame.list[frame.index] as PlanVarValue);
    } else if (frame.type === 'loop' && frame.var) {
      this.setVariable(frame.var, String(frame.index + 1));
    }
  }

  private skipBlock(node: ASTNode): void {
    if (!this.state) return;
    const endLine = this.findBlockEndLine(node);
    this.state.current_line = endLine;
  }

  private skipIfChain(node: ASTNode): void {
    // Skip to the end of the entire if/elif/else chain
    if (!this.state) return;
    // Find the parent's children list containing this node
    const siblings = this.findSiblings(node);
    if (!siblings) return;

    const idx = siblings.findIndex(s => s.line === node.line);
    // Find the last elif/else in this chain
    let lastInChain = idx;
    for (let i = idx + 1; i < siblings.length; i++) {
      if (siblings[i].type === 'elif' || siblings[i].type === 'else') {
        lastInChain = i;
      } else break;
    }

    const lastNode = siblings[lastInChain];
    const endLine = this.findBlockEndLine(lastNode);
    this.state.current_line = endLine;
  }

  private findSiblings(node: ASTNode): ASTNode[] | null {
    const find = (nodes: ASTNode[]): ASTNode[] | null => {
      for (const n of nodes) {
        if (n.line === node.line) return nodes;
        const found = find(n.children);
        if (found) return found;
      }
      return null;
    };
    return find(this.ast);
  }

  private findBlockEndLine(node: ASTNode): number {
    if (node.children.length === 0) return node.line;
    const lastChild = node.children[node.children.length - 1];
    if (lastChild.children.length > 0) return this.findBlockEndLine(lastChild);
    return lastChild.line;
  }

  private findNextLineAfter(line: number): number {
    const idx = this.flatNodes.findIndex(n => n.line === line);
    if (idx < 0 || idx + 1 >= this.flatNodes.length) return line + 1;
    return this.flatNodes[idx + 1].line;
  }

  private processInitialVarAssigns(): void {
    // Process top-level var_assign nodes to populate initial variables
    for (const node of this.ast) {
      if (node.type === 'var_assign' && node.varName && node.listItems) {
        this.state!.variables[node.varName] = node.listItems;
      }
    }
  }

  private waitForIdle(callback: () => void): void {
    const check = () => {
      const lastActivity = this.deps.getLastActivity();
      const now = Date.now();
      const idle = !lastActivity || (now - lastActivity) > this.config.send_idle_seconds * 1000;
      if (idle) {
        callback();
      } else {
        setTimeout(check, 5000);
      }
    };
    check();
  }

  private buildPrompt(nodeId: string, resolvedDesc: string, node: ASTNode): string {
    const state = this.state!;
    let prompt = `[PLAN-CONTROL] 任务 #${nodeId}
指令：${resolvedDesc}
上下文：第${state.executed_tasks + 1}个任务（已完成${state.executed_tasks}个）`;

    // Previous task reference
    if (state.history.length > 0) {
      const prev = state.history[state.history.length - 1];
      prompt += `\n前置任务：#${prev.node_id} (${prev.status})`;
    }

    prompt += `\n输出文件：.plan-control/nodes/node-${nodeId}.json`;
    prompt += `\n输出格式：见 .plan-control/output-format.md`;

    // Return requirement for task_assign
    if (node.type === 'task_assign') {
      prompt += `\n返回要求：result 字段请填写为字符串列表、字符串或布尔值`;
    }

    prompt += '\n[/PLAN-CONTROL]';
    return prompt;
  }

  private enterPaused(reason: string): void {
    if (!this.state) return;
    this.cleanup();
    this.state.status = 'paused';
    this.state.error = reason;
    this.saveState();
    this.machineState = 'PAUSED';
    this.broadcastStatus();
  }

  private cleanup(): void {
    if (this.fileWatcher) { this.fileWatcher.close(); this.fileWatcher = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.idleCheckTimer) { clearInterval(this.idleCheckTimer); this.idleCheckTimer = null; }
    if (this.nudgeTimer) { clearTimeout(this.nudgeTimer); this.nudgeTimer = null; }
  }

  private broadcastStatus(): void {
    if (!this.state) return;
    this.deps.broadcast({
      type: 'plan_status',
      status: this.state.status,
      executed_tasks: this.state.executed_tasks,
      estimated_tasks: this.state.estimated_tasks,
      current_line: this.state.current_line,
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/plan-control/executor.ts backend/src/config.ts
git commit -m "feat(plan-control): implement executor state machine with file watching, nudge, and replan"
```

---

## Task 6: REST API Routes

**Files:**
- Create: `backend/src/routes/plan-control.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create plan-control routes**

```typescript
// backend/src/routes/plan-control.ts
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getProject } from '../config';
import { PlanExecutor } from '../plan-control/executor';
import { PlanTreeNode, TreeNodeType, TreeNodeStatus, ASTNode } from '../plan-control/types';
import { parseProgram, collectFuncs } from '../plan-control/parser';
import { INIT_MD, PLAN_CODE_MD, OUTPUT_FORMAT_MD } from '../plan-control/templates';

const router = Router();

// In-memory executor instances per project
const executors = new Map<string, PlanExecutor>();

/** Get or create executor for a project. Deps will be injected by index.ts. */
export function getExecutor(projectId: string): PlanExecutor | undefined {
  return executors.get(projectId);
}

export function setExecutor(projectId: string, executor: PlanExecutor): void {
  executors.set(projectId, executor);
}

export function removeExecutor(projectId: string): void {
  executors.delete(projectId);
}

// POST /init — Initialize .plan-control/ directory
router.post('/:id/plan/init', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pcDir = path.join(project.folderPath, '.plan-control');
  try {
    fs.mkdirSync(pcDir, { recursive: true });
    fs.mkdirSync(path.join(pcDir, 'nodes'), { recursive: true });
    fs.writeFileSync(path.join(pcDir, 'init.md'), INIT_MD);
    fs.writeFileSync(path.join(pcDir, 'plan-code.md'), PLAN_CODE_MD);
    fs.writeFileSync(path.join(pcDir, 'output-format.md'), OUTPUT_FORMAT_MD);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `初始化失败: ${(err as Error).message}` });
  }
});

// GET /status — Get execution state
router.get('/:id/plan/status', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const stateFile = path.join(project.folderPath, '.plan-control', 'state.json');
  const pcDir = path.join(project.folderPath, '.plan-control');
  const hasPcDir = fs.existsSync(pcDir);
  const hasMainPc = fs.existsSync(path.join(pcDir, 'main.pc'));

  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      res.json({ initialized: hasPcDir, hasMainPc, state });
    } catch {
      res.json({ initialized: hasPcDir, hasMainPc, state: null });
    }
  } else {
    res.json({ initialized: hasPcDir, hasMainPc, state: null });
  }
});

// POST /check — Syntax check main.pc
router.post('/:id/plan/check', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const executor = ensureExecutor(req.params.id, project.folderPath);
  const result = executor.checkSyntax();
  res.json({ errors: result.errors, valid: result.errors.length === 0 });
});

// POST /start — Start execution
router.post('/:id/plan/start', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const executor = ensureExecutor(req.params.id, project.folderPath);
  try {
    executor.start();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /pause
router.post('/:id/plan/pause', (req: Request, res: Response) => {
  const executor = executors.get(req.params.id);
  if (!executor) return res.status(404).json({ error: 'No executor' });
  executor.pause();
  res.json({ success: true });
});

// POST /resume
router.post('/:id/plan/resume', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const executor = ensureExecutor(req.params.id, project.folderPath);
  try {
    executor.resume();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /stop
router.post('/:id/plan/stop', (req: Request, res: Response) => {
  const executor = executors.get(req.params.id);
  if (!executor) return res.status(404).json({ error: 'No executor' });
  executor.stop();
  res.json({ success: true });
});

// GET /nodes — List all node records
router.get('/:id/plan/nodes', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const executor = ensureExecutor(req.params.id, project.folderPath);
  res.json(executor.getNodes());
});

// GET /nodes/:nodeId — Single node detail
router.get('/:id/plan/nodes/:nodeId', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const executor = ensureExecutor(req.params.id, project.folderPath);
  const node = executor.getNode(req.params.nodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node);
});

// GET /tree — Get AST topology tree for frontend rendering
router.get('/:id/plan/tree', (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pcDir = path.join(project.folderPath, '.plan-control');
  const mainPcPath = path.join(pcDir, 'main.pc');
  if (!fs.existsSync(mainPcPath)) {
    return res.json({ tree: null });
  }

  const source = fs.readFileSync(mainPcPath, 'utf-8');
  const ast = parseProgram(source);

  // Load state and node records to merge status
  let currentLine: number | null = null;
  let stateStatus: string | null = null;
  const stateFile = path.join(pcDir, 'state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      currentLine = state.current_line;
      stateStatus = state.status;
    } catch { /* ignore */ }
  }

  // Load node records for status mapping
  const nodeRecords = new Map<number, { id: string; status: string | null }>();
  const nodesDir = path.join(pcDir, 'nodes');
  if (fs.existsSync(nodesDir)) {
    for (const f of fs.readdirSync(nodesDir)) {
      if (!f.startsWith('node-') || !f.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(nodesDir, f), 'utf-8'));
        nodeRecords.set(rec.line, { id: rec.id, status: rec.status });
      } catch { /* ignore */ }
    }
  }

  const tree = astToTree(ast, currentLine, stateStatus, nodeRecords);
  res.json({ tree });
});

function astToTree(
  nodes: ASTNode[],
  currentLine: number | null,
  stateStatus: string | null,
  nodeRecords: Map<number, { id: string; status: string | null }>
): PlanTreeNode[] {
  const result: PlanTreeNode[] = [];

  for (const node of nodes) {
    if (node.type === 'blank' || node.type === 'comment') continue;

    const typeMap: Record<string, TreeNodeType> = {
      task: 'task', task_assign: 'task',
      if: 'if', elif: 'elif', else: 'else',
      for: 'for', loop: 'loop',
      func: 'func', call: 'call',
      var_assign: 'var',
    };

    const treeType = typeMap[node.type];
    if (!treeType) continue;

    const label = getNodeLabel(node);
    const rec = nodeRecords.get(node.line);

    let status: TreeNodeStatus | undefined;
    if (rec) {
      if (rec.status === 'success') status = 'success';
      else if (rec.status === 'failed') status = 'failed';
      else if (rec.status === 'blocked') status = 'blocked';
      else if (rec.status === null && currentLine === node.line &&
               (stateStatus === 'waiting' || stateStatus === 'running')) {
        status = 'running';
      } else if (rec.status === null) status = 'pending';
    } else if (currentLine !== null && node.line < currentLine) {
      // Line already passed without a node record — it's a control flow node
      status = undefined; // no status for non-task nodes that have been passed
    }

    const treeNode: PlanTreeNode = {
      id: `L${node.line}`,
      type: treeType,
      label,
      line: node.line,
      node_id: rec?.id,
      status,
      children: node.children.length > 0
        ? astToTree(node.children, currentLine, stateStatus, nodeRecords)
        : [],
    };

    result.push(treeNode);
  }

  return result;
}

function getNodeLabel(node: ASTNode): string {
  switch (node.type) {
    case 'task':
    case 'task_assign': {
      const desc = node.description ?? '';
      const prefix = node.type === 'task_assign' ? `${node.varName} = ` : '';
      return prefix + (desc.length > 30 ? desc.slice(0, 30) + '...' : desc);
    }
    case 'if':
    case 'elif':
      return `${node.type} ${node.condition}`;
    case 'else':
      return 'else';
    case 'for':
      return `for ${node.iterVar} in \${${node.iterRef}}`;
    case 'loop':
      return node.loopCounter ? `loop ${node.loopCount} as ${node.loopCounter}` : `loop ${node.loopCount}`;
    case 'func':
      return `func ${node.funcName}(${node.params?.join(', ') ?? ''})`;
    case 'call':
      return `call ${node.funcName}(...)`;
    case 'var_assign':
      return `${node.varName} = [${node.listItems?.join(', ') ?? ''}]`;
    default:
      return node.raw;
  }
}

function ensureExecutor(projectId: string, folderPath: string): PlanExecutor {
  let executor = executors.get(projectId);
  if (!executor) {
    // Create with no-op deps (will be connected when start/resume is called from index.ts)
    executor = new PlanExecutor(folderPath, {
      writeToPty: () => {},
      getLastActivity: () => null,
      broadcast: () => {},
    });
    executors.set(projectId, executor);
  }
  return executor;
}

export default router;
```

- [ ] **Step 2: Mount routes and wire WS broadcasting in index.ts**

Add to `backend/src/index.ts`:

1. Import at the top with other route imports:
```typescript
import planControlRouter, { getExecutor, setExecutor } from './routes/plan-control';
```

2. Mount the route (near other `app.use` lines):
```typescript
app.use('/api/projects', authMiddleware, planControlRouter);
```

3. In the project WS connection handler (the `switch` statement that handles `terminal_subscribe`, etc.), add plan event broadcasting capability. After the existing `initProjectTerminal` call in the WS handler, add a helper that creates/connects the executor to the WS:

```typescript
// After the existing projectClients setup, add plan-control WS broadcasting
function broadcastToPlanClients(projectId: string, event: Record<string, unknown>) {
  const clients = projectClients.get(projectId);
  if (!clients) return;
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /**/ }
    }
  }
}
```

4. When a plan/start or plan/resume is called, we need the executor to have real deps. Update the route handlers in `plan-control.ts` to accept a function that wires deps. The simplest approach: in the `POST /start` and `POST /resume` handlers, create the executor with real deps:

In `routes/plan-control.ts`, update `ensureExecutor` to accept deps and use them when available. The deps need `terminalManager` and `projectClients` — these are in `index.ts`. The cleanest pattern: export a `connectExecutor` function from index.ts that wires the deps.

Add to index.ts:
```typescript
import { PlanExecutor } from './plan-control/executor';

export function connectPlanExecutor(projectId: string, project: { folderPath: string }): PlanExecutor {
  const executor = new PlanExecutor(project.folderPath, {
    writeToPty: (text: string) => terminalManager.writeRaw(projectId, text),
    getLastActivity: () => terminalManager.getLastActivityAt(projectId),
    broadcast: (event) => broadcastToPlanClients(projectId, event),
  });
  setExecutor(projectId, executor);
  return executor;
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/plan-control.ts backend/src/index.ts
git commit -m "feat(plan-control): add REST API routes and WS event broadcasting"
```

---

## Task 7: Frontend API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add plan-control API types and functions to api.ts**

Add at the end of `frontend/src/lib/api.ts`:

```typescript
// ── Plan-Control ──

export interface PlanTreeNode {
  id: string;
  type: 'task' | 'if' | 'elif' | 'else' | 'for' | 'loop' | 'call' | 'func' | 'var';
  label: string;
  line: number;
  node_id?: string;
  status?: 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';
  children: PlanTreeNode[];
}

export interface PlanStatusResponse {
  initialized: boolean;
  hasMainPc: boolean;
  state: {
    status: string;
    current_line: number;
    executed_tasks: number;
    estimated_tasks: number;
    error?: string;
  } | null;
}

export interface PlanCheckResponse {
  valid: boolean;
  errors: { line: number; message: string }[];
}

export interface PlanNodeRecord {
  id: string;
  line: number;
  code: string;
  resolved_code: string;
  prompt: string;
  started_at: string;
  completed_at: string | null;
  nudge_count: number;
  status: string | null;
  result: unknown;
  summary: string | null;
}

export async function getPlanStatus(projectId: string): Promise<PlanStatusResponse> {
  return request<PlanStatusResponse>('GET', `/api/projects/${projectId}/plan/status`);
}

export async function initPlanControl(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/init`);
}

export async function checkPlanSyntax(projectId: string): Promise<PlanCheckResponse> {
  return request<PlanCheckResponse>('POST', `/api/projects/${projectId}/plan/check`);
}

export async function startPlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/start`);
}

export async function pausePlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/pause`);
}

export async function resumePlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/resume`);
}

export async function stopPlan(projectId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/projects/${projectId}/plan/stop`);
}

export async function getPlanNodes(projectId: string): Promise<PlanNodeRecord[]> {
  return request<PlanNodeRecord[]>('GET', `/api/projects/${projectId}/plan/nodes`);
}

export async function getPlanTree(projectId: string): Promise<{ tree: PlanTreeNode[] | null }> {
  return request<{ tree: PlanTreeNode[] | null }>('GET', `/api/projects/${projectId}/plan/tree`);
}
```

- [ ] **Step 2: Add plan event handlers to websocket.ts**

In `frontend/src/lib/websocket.ts`, extend `UseProjectWebSocketOptions`:

```typescript
interface UseProjectWebSocketOptions {
  onTerminalData?: (data: string) => void;
  onStatus?: (status: string) => void;
  onConnected?: () => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onProjectStopped?: (projectId: string, projectName: string) => void;
  // Plan-Control events
  onPlanStatus?: (data: { status: string; executed_tasks: number; estimated_tasks: number; current_line: number }) => void;
  onPlanNodeUpdate?: (data: { node_id: string; status: string; summary: string | null }) => void;
  onPlanNudge?: (data: { node_id: string; nudge_count: number }) => void;
  onPlanReplan?: (data: { node_id: string; reason: string }) => void;
}
```

Add cases to the `switch` in the `onmessage` handler:

```typescript
case 'plan_status':
  optionsRef.current.onPlanStatus?.(parsed as any);
  break;
case 'plan_node_update':
  optionsRef.current.onPlanNodeUpdate?.(parsed as any);
  break;
case 'plan_nudge':
  optionsRef.current.onPlanNudge?.(parsed as any);
  break;
case 'plan_replan':
  optionsRef.current.onPlanReplan?.(parsed as any);
  break;
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/websocket.ts
git commit -m "feat(plan-control): add frontend API functions and WS event handlers"
```

---

## Task 8: PlanPanel Component

**Files:**
- Create: `frontend/src/components/PlanPanel.tsx`

- [ ] **Step 1: Create PlanPanel with toolbar and state management**

```typescript
// frontend/src/components/PlanPanel.tsx
import { useState, useEffect, useCallback } from 'react';
import { Play, Pause, Square, RotateCcw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  getPlanStatus, initPlanControl, checkPlanSyntax,
  startPlan, pausePlan, resumePlan, stopPlan, getPlanTree,
  type PlanStatusResponse, type PlanCheckResponse, type PlanTreeNode,
} from '@/lib/api';
import { TaskTree } from './TaskTree';

interface PlanPanelProps {
  projectId: string;
  projectPath: string;
  // WS event data (passed from parent that owns WS connection)
  planStatus?: { status: string; executed_tasks: number; estimated_tasks: number; current_line: number } | null;
  planNodeUpdate?: { node_id: string; status: string; summary: string | null } | null;
  planReplan?: boolean; // true when replan event fires, triggers tree refetch
}

export function PlanPanel({ projectId, planStatus, planNodeUpdate, planReplan }: PlanPanelProps) {
  const [status, setStatus] = useState<PlanStatusResponse | null>(null);
  const [checkResult, setCheckResult] = useState<PlanCheckResponse | null>(null);
  const [tree, setTree] = useState<PlanTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch initial status and tree
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getPlanStatus(projectId);
        if (!cancelled) setStatus(s);
        if (s.hasMainPc) {
          const t = await getPlanTree(projectId);
          if (!cancelled) setTree(t.tree);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Update tree from WS node updates (local patch, no refetch)
  useEffect(() => {
    if (!planNodeUpdate || !tree) return;
    setTree(prev => {
      if (!prev) return prev;
      return patchTreeNodeStatus(prev, planNodeUpdate.node_id, planNodeUpdate.status);
    });
  }, [planNodeUpdate]);

  // Update status from WS
  useEffect(() => {
    if (!planStatus) return;
    setStatus(prev => prev ? {
      ...prev,
      state: prev.state ? { ...prev.state, ...planStatus } : {
        status: planStatus.status,
        current_line: planStatus.current_line,
        executed_tasks: planStatus.executed_tasks,
        estimated_tasks: planStatus.estimated_tasks,
      },
    } : prev);
  }, [planStatus]);

  // Refetch tree on replan
  useEffect(() => {
    if (!planReplan) return;
    getPlanTree(projectId).then(t => setTree(t.tree)).catch(() => {});
  }, [planReplan, projectId]);

  const handleInit = useCallback(async () => {
    setLoading(true);
    try {
      await initPlanControl(projectId);
      const s = await getPlanStatus(projectId);
      setStatus(s);
      toast.success('Plan Control 已初始化');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleCheck = useCallback(async () => {
    setLoading(true);
    try {
      const result = await checkPlanSyntax(projectId);
      setCheckResult(result);
      if (result.valid) {
        toast.success('语法检查通过');
        const t = await getPlanTree(projectId);
        setTree(t.tree);
      } else {
        toast.error(`${result.errors.length} 个语法错误`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleStart = useCallback(async () => {
    try {
      await startPlan(projectId);
      const s = await getPlanStatus(projectId);
      setStatus(s);
    } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const handlePause = useCallback(async () => {
    try { await pausePlan(projectId); } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const handleResume = useCallback(async () => {
    try {
      await resumePlan(projectId);
      const s = await getPlanStatus(projectId);
      setStatus(s);
    } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const handleStop = useCallback(async () => {
    try { await stopPlan(projectId); } catch (err) { toast.error((err as Error).message); }
  }, [projectId]);

  const state = status?.state;
  const planStatusStr = state?.status ?? (status?.hasMainPc ? 'ready' : status?.initialized ? 'editing' : 'none');

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-none h-8 flex items-center gap-1 px-2 border-b border-border text-xs">
        {planStatusStr === 'none' && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleInit} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            初始化
          </Button>
        )}
        {(planStatusStr === 'editing' || planStatusStr === 'ready') && (
          <>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleCheck} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
              检查
            </Button>
            {checkResult?.valid && (
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleStart}>
                <Play className="h-3 w-3 mr-1" />启动
              </Button>
            )}
          </>
        )}
        {(planStatusStr === 'running' || planStatusStr === 'waiting') && (
          <>
            <span className="text-muted-foreground">
              已完成 {state?.executed_tasks ?? 0}（≥{state?.estimated_tasks ?? 0}）
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handlePause}>
              <Pause className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleStop}>
              <Square className="h-3 w-3" />
            </Button>
          </>
        )}
        {(planStatusStr === 'paused' || planStatusStr === 'stopped') && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleResume}>
            <RotateCcw className="h-3 w-3 mr-1" />继续
          </Button>
        )}
        {planStatusStr === 'completed' && (
          <span className="text-green-500 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" /> 已完成
          </span>
        )}
      </div>

      {/* Error list */}
      {checkResult && !checkResult.valid && (
        <div className="flex-none max-h-24 overflow-y-auto px-2 py-1 border-b border-border bg-red-500/5">
          {checkResult.errors.map((e, i) => (
            <div key={i} className="text-[10px] text-red-400 flex gap-1">
              <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span>第{e.line}行: {e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Task Tree */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tree ? (
          <TaskTree tree={tree} currentLine={state?.current_line ?? null} />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {!status?.initialized ? '点击"初始化"开始' : !status?.hasMainPc ? '等待 AI 编写计划...' : '点击"检查"查看任务树'}
          </div>
        )}
      </div>
    </div>
  );
}

/** Patch a single node's status in the tree (in-place clone). */
function patchTreeNodeStatus(tree: PlanTreeNode[], nodeId: string, status: string): PlanTreeNode[] {
  return tree.map(node => {
    if (node.node_id === nodeId) {
      return { ...node, status: status as PlanTreeNode['status'] };
    }
    if (node.children.length > 0) {
      return { ...node, children: patchTreeNodeStatus(node.children, nodeId, status) };
    }
    return node;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/PlanPanel.tsx
git commit -m "feat(plan-control): add PlanPanel component with toolbar and state management"
```

---

## Task 9: TaskTree SVG Component

**Files:**
- Create: `frontend/src/components/TaskTree.tsx`

- [ ] **Step 1: Create TaskTree with tree layout and SVG rendering**

```typescript
// frontend/src/components/TaskTree.tsx
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { PlanTreeNode } from '@/lib/api';

const NODE_W = 140;
const NODE_H = 36;
const H_GAP = 20;
const V_GAP = 16;
const PAD_X = 40;
const PAD_Y = 20;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: PlanTreeNode['type'];
  label: string;
  status?: PlanTreeNode['status'];
  node_id?: string;
  line: number;
  children: LayoutNode[];
}

interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  dashed?: boolean;
}

const STATUS_COLORS: Record<string, { fill: string; stroke: string }> = {
  pending:  { fill: '#71717a20', stroke: '#71717a' },
  running:  { fill: '#3b82f633', stroke: '#3b82f6' },
  success:  { fill: '#22c55e26', stroke: '#22c55e' },
  failed:   { fill: '#ef444426', stroke: '#ef4444' },
  blocked:  { fill: '#eab30826', stroke: '#eab308' },
  skipped:  { fill: '#71717a14', stroke: '#71717a' },
};
const DEFAULT_COLOR = { fill: '#71717a15', stroke: '#52525b' };

interface TaskTreeProps {
  tree: PlanTreeNode[];
  currentLine: number | null;
}

export function TaskTree({ tree, currentLine }: TaskTreeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);

  // Layout computation
  const { layoutNodes, edges, bounds } = useMemo(() => {
    const lNodes: LayoutNode[] = [];
    const lEdges: Edge[] = [];
    let nextY = PAD_Y;

    function layoutChildren(children: PlanTreeNode[], parentX: number, startY: number, depth: number): { nodes: LayoutNode[]; height: number } {
      const nodes: LayoutNode[] = [];
      let y = startY;

      for (const child of children) {
        const x = PAD_X + depth * (NODE_W + H_GAP);
        const node: LayoutNode = {
          id: child.id,
          x, y, w: NODE_W, h: NODE_H,
          type: child.type,
          label: child.label,
          status: child.status,
          node_id: child.node_id,
          line: child.line,
          children: [],
        };

        if (child.children.length > 0) {
          const childResult = layoutChildren(child.children, x, y + NODE_H + V_GAP, depth + 1);
          node.children = childResult.nodes;
          y = Math.max(y + NODE_H + V_GAP, y + NODE_H + V_GAP + childResult.height);

          // Draw edges from parent to children
          for (const c of childResult.nodes) {
            lEdges.push({
              x1: node.x + NODE_W / 2, y1: node.y + NODE_H,
              x2: c.x + NODE_W / 2, y2: c.y,
              dashed: child.type === 'call',
            });
          }
        } else {
          y += NODE_H + V_GAP;
        }

        nodes.push(node);
        lNodes.push(node);
      }

      return { nodes, height: y - startY };
    }

    const result = layoutChildren(tree, 0, PAD_Y, 0);

    // Connect sequential siblings with edges
    for (let i = 1; i < result.nodes.length; i++) {
      const prev = result.nodes[i - 1];
      const curr = result.nodes[i];
      if (prev.x === curr.x) {
        // Find the bottom-most node in prev's subtree
        const prevBottom = getBottomY(prev);
        lEdges.push({
          x1: prev.x + NODE_W / 2, y1: prevBottom,
          x2: curr.x + NODE_W / 2, y2: curr.y,
        });
      }
    }

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of lNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }

    return {
      layoutNodes: lNodes,
      edges: lEdges,
      bounds: { minX, minY, maxX: maxX + PAD_X, maxY: maxY + PAD_Y },
    };
  }, [tree]);

  // Auto-fit on load
  useEffect(() => {
    fitView();
  }, [tree]);

  // Scroll current line into view
  useEffect(() => {
    if (currentLine === null) return;
    const node = layoutNodes.find(n => n.line === currentLine);
    if (!node || !svgRef.current) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const cx = node.x + NODE_W / 2;
    const cy = node.y + NODE_H / 2;
    setPan({ x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom });
  }, [currentLine]);

  const fitView = useCallback(() => {
    if (!svgRef.current || layoutNodes.length === 0) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    if (w === 0 || h === 0) return;
    const scale = Math.min(rect.width / w, rect.height / h, 2) * 0.9;
    setZoom(scale);
    setPan({
      x: (rect.width - w * scale) / 2 - bounds.minX * scale,
      y: (rect.height - h * scale) / 2 - bounds.minY * scale,
    });
  }, [layoutNodes, bounds]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.2, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  return (
    <div className="relative w-full h-full">
      {/* Toolbar */}
      <div className="absolute top-1 right-1 z-10 flex gap-0.5">
        <button className="p-1 rounded bg-muted/50 hover:bg-muted" onClick={() => setZoom(z => Math.min(3, z + 0.2))}>
          <ZoomIn className="h-3 w-3" />
        </button>
        <button className="p-1 rounded bg-muted/50 hover:bg-muted" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}>
          <ZoomOut className="h-3 w-3" />
        </button>
        <button className="p-1 rounded bg-muted/50 hover:bg-muted" onClick={fitView}>
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {edges.map((e, i) => (
            <line
              key={`e${i}`}
              x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke="#71717a" strokeWidth={1}
              strokeDasharray={e.dashed ? '4,2' : undefined}
              markerEnd="url(#arrow)"
            />
          ))}

          {/* Nodes */}
          {layoutNodes.map(node => {
            const colors = STATUS_COLORS[node.status ?? ''] ?? DEFAULT_COLOR;
            const isCurrent = currentLine === node.line;

            return (
              <g key={node.id} onClick={() => setSelectedNode(node)} style={{ cursor: 'pointer' }}>
                <rect
                  x={node.x} y={node.y}
                  width={node.w} height={node.h}
                  rx={6}
                  fill={colors.fill}
                  stroke={isCurrent ? '#60a5fa' : colors.stroke}
                  strokeWidth={isCurrent ? 2 : 1}
                  strokeDasharray={node.status === 'skipped' ? '4,2' : undefined}
                />
                {/* Running pulse */}
                {node.status === 'running' && (
                  <rect
                    x={node.x} y={node.y}
                    width={node.w} height={node.h}
                    rx={6}
                    fill="none" stroke="#3b82f6" strokeWidth={2}
                    opacity={0.5}
                  >
                    <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
                {/* Type tag */}
                <text
                  x={node.x + 6} y={node.y + 13}
                  fontSize={9} fill="#a1a1aa" fontFamily="monospace"
                >
                  {node.type}
                </text>
                {/* Label */}
                <text
                  x={node.x + 6} y={node.y + 26}
                  fontSize={10} fill="#e4e4e7"
                  clipPath={`inset(0 0 0 0)`}
                >
                  {node.label.length > 16 ? node.label.slice(0, 16) + '…' : node.label}
                </text>
                {/* Node ID badge */}
                {node.node_id && (
                  <text
                    x={node.x + node.w - 4} y={node.y + 10}
                    fontSize={7} fill="#71717a" textAnchor="end"
                  >
                    #{node.node_id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Node detail popover */}
      {selectedNode && (
        <div
          className="absolute bottom-2 left-2 right-2 bg-background/95 border border-border rounded-lg p-3 text-xs shadow-lg z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-start mb-1">
            <span className="font-mono text-muted-foreground">{selectedNode.type} L{selectedNode.line}</span>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedNode(null)}>✕</button>
          </div>
          <div className="text-foreground mb-1">{selectedNode.label}</div>
          {selectedNode.status && (
            <div className="text-muted-foreground">状态: {selectedNode.status}</div>
          )}
          {selectedNode.node_id && (
            <div className="text-muted-foreground">节点 ID: #{selectedNode.node_id}</div>
          )}
        </div>
      )}
    </div>
  );
}

function getBottomY(node: LayoutNode): number {
  if (node.children.length === 0) return node.y + node.h;
  return Math.max(node.y + node.h, ...node.children.map(getBottomY));
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TaskTree.tsx
git commit -m "feat(plan-control): add TaskTree SVG topology graph component"
```

---

## Task 10: LeftPanel Integration

**Files:**
- Modify: `frontend/src/components/LeftPanel.tsx`

- [ ] **Step 1: Add 'plan' tab to LeftPanel**

In `frontend/src/components/LeftPanel.tsx`:

1. Add lazy import at the top:
```typescript
import { lazy, Suspense } from 'react';
const PlanPanel = lazy(() => import('./PlanPanel').then(m => ({ default: m.PlanPanel })));
```

2. Update tab type and labels:
```typescript
type LeftTab = 'files' | 'git' | 'plan';

const TAB_LABELS: Record<LeftTab, string> = {
  files: '文件',
  git: 'Git',
  plan: '任务',
};
```

3. Update the tab button array:
```typescript
{(['files', 'git', 'plan'] as LeftTab[]).map((t) => (
```

4. Add the plan tab content inside `<AnimatePresence>`:
```typescript
{tab === 'plan' && (
  <motion.div
    key="plan"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.15 }}
    className="flex-1 min-w-0 overflow-hidden"
  >
    <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>}>
      <PlanPanel projectId={projectId} projectPath={projectPath} />
    </Suspense>
  </motion.div>
)}
```

- [ ] **Step 2: Wire WS plan events from TerminalView to PlanPanel**

The PlanPanel needs WS events for real-time updates. Since the WS connection lives in `TerminalView`, we need to pass plan events through. The simplest approach: add plan event state to `TerminalView` and pass down to LeftPanel → PlanPanel.

In `frontend/src/components/TerminalView.tsx`, add the plan WS handlers to the `useProjectWebSocket` options:

```typescript
const [planStatus, setPlanStatus] = useState<any>(null);
const [planNodeUpdate, setPlanNodeUpdate] = useState<any>(null);
const [planReplan, setPlanReplan] = useState(false);

// Add to useProjectWebSocket options:
onPlanStatus: (data) => setPlanStatus(data),
onPlanNodeUpdate: (data) => setPlanNodeUpdate(data),
onPlanReplan: () => setPlanReplan(prev => !prev), // toggle to trigger refetch
```

Then expose these via ref or props to ProjectPage → LeftPanel → PlanPanel. The exact wiring depends on the existing component structure — the implementer should thread `planStatus`, `planNodeUpdate`, and `planReplan` through `ProjectPage` to `LeftPanel` to `PlanPanel` as props.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LeftPanel.tsx frontend/src/components/TerminalView.tsx frontend/src/pages/ProjectPage.tsx
git commit -m "feat(plan-control): integrate PlanPanel tab in LeftPanel with WS event wiring"
```

---

## Task 11: Build Verification

- [ ] **Step 1: Build backend**

```bash
cd /Users/tom/Projects/cc-web/backend && npm run build
```

Expected: Compiles without errors.

- [ ] **Step 2: Build frontend**

```bash
cd /Users/tom/Projects/cc-web/frontend && npm run build
```

Expected: Compiles without errors. PlanPanel and TaskTree are code-split (separate chunks).

- [ ] **Step 3: Fix any build errors**

Address any TypeScript errors, missing imports, or type mismatches.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(plan-control): resolve build errors"
```
