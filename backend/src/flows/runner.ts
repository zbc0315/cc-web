import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { modLogger } from '../logger';
import {
  appendTaskProgress,
  clearFlowState,
  initWorkflowData,
  loadFlowState,
  readWorkflowData,
  saveFlowState,
  workflowDataPath,
  writeWorkflowData,
} from './store';
import type {
  BranchRule,
  FlowDef,
  FlowNode,
  FlowState,
  LlmNode,
  NodeHistoryEntry,
  SystemLogicNode,
  UserInputNode,
  WorkflowData,
} from './types';

const log = modLogger('flow-runner');

/** Injector signature — provided by the host (index.ts wires this to
 *  writeTerminalInputSplit so the runner stays decoupled from PTY plumbing). */
export type PromptInjector = (projectId: string, brackedPastePayload: string) => void;

/** Wrap text in a bracketed-paste sequence + trailing CR.
 *  Strips all ESC sequences and CRs from the body — escape sequences embedded
 *  in either promptTemplate (codex P2-G) or variable values would otherwise
 *  corrupt Ink TUI state or close paste mode prematurely. LF and TAB are
 *  preserved so the body's structure (paragraphs, code indentation) is
 *  intact. The final CR is re-added after the close-marker to submit. */
function buildPaste(text: string): string {
  const safe = text.replace(/[\x1b\r]/g, '');
  return `\x1b[200~${safe}\x1b[201~\r`;
}

// ── Value rendering & sanitization ────────────────────────────────────────

/** Strip terminal control bytes that would corrupt bracketed-paste mode or
 *  Ink TUI state when the value is later injected into a prompt. ESC sequences
 *  (incl. paste-mode markers) can confuse the agent's input parser; bare CR
 *  prematurely closes paste mode. We keep LF and TAB so multi-line content
 *  renders normally. */
function sanitizeForPrompt(s: string): string {
  return s.replace(/[\x1b\r]/g, '');
}

/** Format an arbitrary JSON value for prompt injection. Strings pass through
 *  (after sanitize); other values get JSON.stringify with 2-space indent so
 *  arrays/objects are human-readable to the LLM. `undefined` becomes the
 *  literal "(未设置)" marker so the LLM knows the variable hasn't been
 *  written yet rather than seeing a missing field silently. */
function formatValueForPrompt(value: unknown): string {
  if (value === undefined || value === null) return '(未设置)';
  if (typeof value === 'string') return sanitizeForPrompt(value);
  return sanitizeForPrompt(JSON.stringify(value, null, 2));
}

/** Substitute `{{var:name}}` and `{{const:name}}` tokens in the prompt
 *  template with the current value from workflow_data. Unset declared
 *  variables (those without initialValue and not yet written) render as
 *  "(未设置)" — the validator has already gated on the name being declared
 *  at save time, so an unknown name at runtime is impossible by construction.
 *  (codex P1-C: previously this returned "[ERROR ...]" which leaked into
 *  prompts whenever a declared-but-uninitialized variable was referenced.) */
function renderTemplate(tpl: string, data: WorkflowData): string {
  return tpl
    .replace(/\{\{var:([^}]+)\}\}/g, (_m, name: string) => {
      return formatValueForPrompt(data.variables[name.trim()]);
    })
    .replace(/\{\{const:([^}]+)\}\}/g, (_m, name: string) => {
      return formatValueForPrompt(data.constants[name.trim()]);
    });
}

// ── Prompt block builders ─────────────────────────────────────────────────

/** Build a "current variable values" context block for the prompt head. */
function buildReadVarBlock(names: string[], def: FlowDef, data: WorkflowData): string {
  if (names.length === 0) return '';
  const byName = new Map((def.variables ?? []).map((v) => [v.name, v] as const));
  const lines: string[] = ['──────── 流变量当前值 ────────'];
  for (const name of names) {
    const v = byName.get(name);
    if (!v) continue;
    const meaning = v.description || '(无描述)';
    lines.push(`变量 \`${v.name}\`（含义：${meaning}）：`);
    lines.push(formatValueForPrompt(data.variables[name]));
    lines.push('');
  }
  lines.push('');
  return lines.join('\n');
}

/** Build a "constants" context block. Constants are stable per run, so we
 *  just dump value + description. */
function buildReadConstBlock(names: string[], def: FlowDef, data: WorkflowData): string {
  if (names.length === 0) return '';
  const byName = new Map((def.constants ?? []).map((c) => [c.name, c] as const));
  const lines: string[] = ['──────── 流常量 ────────'];
  for (const name of names) {
    const c = byName.get(name);
    if (!c) continue;
    const meaning = c.description || '(无描述)';
    lines.push(`常量 \`${c.name}\`（含义：${meaning}）：`);
    lines.push(formatValueForPrompt(data.constants[name]));
    lines.push('');
  }
  lines.push('');
  return lines.join('\n');
}

/** Build the prompt suffix instructing the LLM to write each `writeVariables`
 *  entry into workflow_data.variables[name]. */
function buildWriteVarBlock(names: string[], def: FlowDef): string {
  if (names.length === 0) return '';
  const byName = new Map((def.variables ?? []).map((v) => [v.name, v] as const));
  const lines: string[] = [
    '',
    '──────── 变量写入指令 ────────',
    '完成本任务后，请按下面列出的含义判断每个变量的值，',
    '用 Edit 或 Write 工具把它们写入 .ccweb/workflow_data.json 的 variables 字段（顶层 key = 变量名）。',
    '保留 workflow_data.json 中其他变量、常量、task_progress 字段不要动。',
    '',
  ];
  for (const name of names) {
    const v = byName.get(name);
    if (!v) continue;
    lines.push(`- \`${v.name}\` → 写入 variables.${v.name}。含义：${v.description || '(无描述)'}`);
  }
  return lines.join('\n');
}

// ── Branch evaluation ─────────────────────────────────────────────────────

/** Loose equality for branch evaluation. JSON outputs from LLMs frequently
 *  type-shift (`true` → `"true"`, `1` → `"1"`); branch authors typically
 *  configure the typed primitive, so we coerce common cases. */
function branchMatches(value: unknown, expected: unknown): boolean {
  if (Object.is(value, expected)) return true;
  if (typeof expected === 'boolean') {
    if (typeof value === 'string') {
      const v = value.toLowerCase().trim();
      return (expected && (v === 'true' || v === '1' || v === 'yes')) ||
             (!expected && (v === 'false' || v === '0' || v === 'no'));
    }
    if (typeof value === 'number') return expected === (value !== 0);
  }
  if (typeof expected === 'number' && typeof value === 'string') {
    const n = Number(value);
    return !Number.isNaN(n) && n === expected;
  }
  if (typeof expected === 'string' && typeof value === 'number') {
    return value.toString() === expected;
  }
  return false;
}

// ── Active run bookkeeping ────────────────────────────────────────────────

interface ActiveRun {
  projectId: string;
  folderPath: string;
  flowDef: FlowDef;
  state: FlowState;
  watcher: fs.FSWatcher | null;
  watcherDebounce: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null;
  waitResolve: ((v: WaitOutcome) => void) | null;
  userInputResolve: ((data: Record<string, string>) => void) | null;
  userInputReject: ((reason: string) => void) | null;
  /** Index into workflow_data.task_progress[] for the running LLM node. */
  currentTaskIndex: number | null;
}

type WaitOutcome = 'finished' | 'timeout' | 'aborted' | 'paused';

export class FlowRunner extends EventEmitter {
  private active = new Map<string, ActiveRun>();
  private injector: PromptInjector | null = null;

  setPromptInjector(fn: PromptInjector): void {
    this.injector = fn;
  }

  start(
    projectId: string,
    folderPath: string,
    flowDef: FlowDef,
    flowFilename: string,
  ): { ok: boolean; reason?: string; state?: FlowState } {
    if (this.active.has(projectId)) {
      return { ok: false, reason: 'already-running' };
    }
    const startNode = flowDef.nodes.find((n) => n.id === flowDef.entryNodeId);
    if (!startNode) return { ok: false, reason: 'entry-node-not-found' };

    // Initialize workflow_data: constants written once, variables get
    // initialValue (where declared), task_progress reset for this run.
    initWorkflowData(folderPath, flowDef);

    const state: FlowState = {
      flowId: flowDef.id,
      flowFilename,
      runId: uuidv4(),
      startedAt: Date.now(),
      status: 'running',
      currentNodeId: flowDef.entryNodeId,
      loopCounters: {},
      history: [],
      pauseReason: null,
    };
    saveFlowState(folderPath, state);

    const run: ActiveRun = {
      projectId,
      folderPath,
      flowDef,
      state,
      watcher: null,
      watcherDebounce: null,
      timeoutTimer: null,
      waitResolve: null,
      userInputResolve: null,
      userInputReject: null,
      currentTaskIndex: null,
    };
    this.active.set(projectId, run);
    this.emit('state', { projectId, state });

    log.info(
      {
        projectId,
        flowId: flowDef.id,
        flowName: flowDef.name,
        schemaVersion: flowDef.schemaVersion,
        entryNodeId: flowDef.entryNodeId,
        nodeCount: flowDef.nodes.length,
        constantCount: (flowDef.constants ?? []).length,
        variableCount: (flowDef.variables ?? []).length,
        runId: state.runId,
      },
      'flow start',
    );

    void this.runLoop(run).catch((err) => {
      log.error(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'run loop crashed',
      );
      this.finalize(run, 'failed', err instanceof Error ? err.message : String(err));
    });

    return { ok: true, state };
  }

  resume(projectId: string): boolean {
    const run = this.active.get(projectId);
    if (!run) return false;
    if (run.state.status !== 'paused') return false;
    if (run.state.pauseReason === 'awaiting-user-input') return false;
    if (run.state.currentNodeId === null) return false;
    const prevReason = run.state.pauseReason;
    if (run.state.pauseReason === 'max-retries-exceeded') {
      delete run.state.loopCounters[run.state.currentNodeId];
    }
    run.state.status = 'running';
    run.state.pauseReason = null;
    run.state.pauseDetail = undefined;
    this.persist(run);
    log.info(
      { projectId, currentNodeId: run.state.currentNodeId, prevReason, resetLoopCounter: prevReason === 'max-retries-exceeded' },
      'flow resume',
    );
    void this.runLoop(run).catch((err) => {
      log.error(
        { projectId: run.projectId, err: err instanceof Error ? err.message : String(err) },
        'resumed run loop crashed',
      );
      this.finalize(run, 'failed', err instanceof Error ? err.message : String(err));
    });
    return true;
  }

  abort(projectId: string): boolean {
    const run = this.active.get(projectId);
    if (!run) return false;
    // Capture resolvers BEFORE clearWaiters — clearWaiters nulls
    // run.waitResolve, so reading it after is a no-op and the in-flight
    // wait Promise hangs forever (codex review P0).
    const wait = run.waitResolve;
    const userReject = run.userInputReject;
    const hadUserInputWait = !!userReject;
    const hadTaskWait = !!wait;
    run.userInputResolve = null;
    run.userInputReject = null;
    wait?.('aborted');
    userReject?.('aborted');
    log.info(
      { projectId, currentNodeId: run.state.currentNodeId, hadTaskWait, hadUserInputWait },
      'flow abort',
    );
    this.finalize(run, 'aborted');
    return true;
  }

  /** Resolves any pending user-input wait with the submitted form data. */
  submitUserInput(projectId: string, data: Record<string, string>): boolean {
    const run = this.active.get(projectId);
    if (!run || !run.userInputResolve) return false;
    const resolve = run.userInputResolve;
    run.userInputResolve = null;
    run.userInputReject = null;
    log.info(
      {
        projectId,
        currentNodeId: run.state.currentNodeId,
        fieldKeys: Object.keys(data),
        fieldLengths: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      },
      'flow user-input submitted',
    );
    resolve(data);
    return true;
  }

  getState(projectId: string): FlowState | null {
    return this.active.get(projectId)?.state ?? loadFlowState(this.lastFolderPath(projectId) ?? '');
  }

  isRunning(projectId: string): boolean {
    return this.active.has(projectId);
  }

  private lastFolderPath(projectId: string): string | null {
    return this.active.get(projectId)?.folderPath ?? null;
  }

  // ── Main loop ─────────────────────────────────────────────────────────

  private async runLoop(run: ActiveRun): Promise<void> {
    while (run.state.status === 'running' && run.state.currentNodeId !== null) {
      const node = run.flowDef.nodes.find((n) => n.id === run.state.currentNodeId);
      if (!node) {
        this.finalize(run, 'failed', `node id ${run.state.currentNodeId} not found`);
        return;
      }
      const histEntry: NodeHistoryEntry = {
        nodeId: node.id,
        startedAt: Date.now(),
        finishedAt: null,
        outcome: 'ok',
      };
      run.state.history.push(histEntry);
      this.persist(run);

      const outcome = await this.executeNode(run, node);
      histEntry.finishedAt = Date.now();
      histEntry.outcome = outcome.kind === 'ok' ? 'ok'
        : outcome.kind === 'pause' ? 'pause'
        : outcome.kind === 'retry' ? 'retry'
        : 'error';

      if (outcome.kind === 'pause' || outcome.kind === 'error') {
        this.persist(run);
        return;
      }
      if (outcome.kind === 'ok') {
        run.state.currentNodeId = outcome.next;
        this.persist(run);
        if (outcome.next === null) {
          this.finalize(run, 'completed');
          return;
        }
      }
    }
  }

  // ── Node executors ────────────────────────────────────────────────────

  private async executeNode(run: ActiveRun, node: FlowNode): Promise<NodeOutcome> {
    log.info({ projectId: run.projectId, nodeId: node.id, kind: node.kind, name: node.name }, 'executing node');
    this.emit('state', { projectId: run.projectId, state: run.state });

    if (node.kind === 'user-input') return this.executeUserInput(run, node);
    if (node.kind === 'llm') return this.executeLlm(run, node);
    if (node.kind === 'system-logic') return this.executeSystemLogic(run, node);
    return { kind: 'error', message: `unknown node kind: ${(node as { kind: string }).kind}` };
  }

  private async executeUserInput(run: ActiveRun, node: UserInputNode): Promise<NodeOutcome> {
    // Snapshot context values (bindVariable / bindConstant) so the frontend
    // can render them read-only without a separate fetch.
    const data = readWorkflowData(run.folderPath);
    const variablesCtx: Record<string, unknown> = {};
    const constantsCtx: Record<string, unknown> = {};
    for (const field of node.userInputSchema.fields) {
      if (field.bindVariable && field.bindVariable in data.variables) {
        variablesCtx[field.bindVariable] = data.variables[field.bindVariable];
      }
      if (field.bindConstant && field.bindConstant in data.constants) {
        constantsCtx[field.bindConstant] = data.constants[field.bindConstant];
      }
    }
    const contextValues =
      Object.keys(variablesCtx).length > 0 || Object.keys(constantsCtx).length > 0
        ? {
            variables: Object.keys(variablesCtx).length > 0 ? variablesCtx : undefined,
            constants: Object.keys(constantsCtx).length > 0 ? constantsCtx : undefined,
          }
        : undefined;

    run.state.status = 'paused';
    run.state.pauseReason = 'awaiting-user-input';
    run.state.pendingUserInput = {
      nodeId: node.id,
      fields: node.userInputSchema.fields,
      contextValues,
    };
    this.persist(run);
    this.emit('user-input', { projectId: run.projectId, nodeId: node.id, fields: node.userInputSchema.fields });
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        fieldKeys: node.userInputSchema.fields.map((f) => f.key),
      },
      'flow node user-input awaiting',
    );

    let submitted: Record<string, string>;
    try {
      submitted = await new Promise<Record<string, string>>((resolve, reject) => {
        run.userInputResolve = resolve;
        run.userInputReject = reject;
      });
    } catch {
      return { kind: 'pause' };
    }

    // Merge field values into variables. For bindVariable / bindConstant
    // fields we re-read from workflow_data (defense — client could lie even
    // though the UI disables those inputs); for outputVariable fields we
    // take the submitted value as-is.
    const fresh = readWorkflowData(run.folderPath);
    const variableUpdates: Record<string, unknown> = {};
    for (const field of node.userInputSchema.fields) {
      if (field.outputVariable) {
        variableUpdates[field.outputVariable] = submitted[field.key] ?? '';
      }
      // bindVariable / bindConstant fields contribute nothing to writes —
      // they're read-only displays.
    }
    if (Object.keys(variableUpdates).length > 0) {
      fresh.variables = { ...fresh.variables, ...variableUpdates };
      writeWorkflowData(run.folderPath, fresh);
    }

    run.state.status = 'running';
    run.state.pauseReason = null;
    run.state.pendingUserInput = undefined;
    this.persist(run);
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        wroteVariables: Object.keys(variableUpdates),
        next: node.next,
      },
      'flow node user-input completed',
    );
    return { kind: 'ok', next: node.next };
  }

  private async executeLlm(run: ActiveRun, node: LlmNode): Promise<NodeOutcome> {
    if (!this.injector) {
      return { kind: 'error', message: 'no prompt injector configured' };
    }

    // 1. Append a task_progress entry for the LLM to flip when done.
    const taskIndex = appendTaskProgress(run.folderPath, {
      nodeId: node.id,
      name: node.name,
      finish: false,
    });
    run.currentTaskIndex = taskIndex;

    // 2. Build prompt: header + read-context blocks + body + write block.
    const data = readWorkflowData(run.folderPath);

    const taskHeader =
      `当前任务 id=${node.id}，名为「${node.name}」。\n` +
      `完成后请把 .ccweb/workflow_data.json 中 task_progress[${taskIndex}].finish 改为 true（用 Edit/Write 工具直接更新该 JSON 文件）。\n` +
      '保留 workflow_data.json 中其他字段不要动。\n' +
      '\n──────── 任务正文 ────────\n';

    const refConstBlock = buildReadConstBlock(node.readConstants ?? [], run.flowDef, data);
    const refVarBlock = buildReadVarBlock(node.readVariables ?? [], run.flowDef, data);
    const body = renderTemplate(node.promptTemplate, data);
    const writeVarBlock = buildWriteVarBlock(node.writeVariables ?? [], run.flowDef);
    const fullPrompt = `${taskHeader}${refConstBlock}${refVarBlock}${body}${writeVarBlock}`;

    // 3. Inject into chat.
    this.injector(run.projectId, buildPaste(fullPrompt));
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        taskIndex,
        promptSize: fullPrompt.length,
        readVariables: node.readVariables ?? [],
        readConstants: node.readConstants ?? [],
        writeVariables: node.writeVariables ?? [],
        timeoutSec: node.timeoutSec,
      },
      'flow node llm prompt injected',
    );

    // 4. Wait for task_progress[taskIndex].finish OR timeout.
    const outcome = await this.waitForTaskFinish(run, taskIndex, node.timeoutSec * 1000);
    log.info({ projectId: run.projectId, nodeId: node.id, taskIndex, outcome }, 'flow node llm wait outcome');

    if (outcome === 'aborted' || outcome === 'paused') {
      return { kind: 'pause' };
    }
    if (outcome === 'timeout') {
      run.state.status = 'paused';
      run.state.pauseReason = 'timeout';
      run.state.pauseDetail = `node ${node.id} (${node.name}) timed out after ${node.timeoutSec}s`;
      this.emit('error', {
        projectId: run.projectId,
        nodeId: node.id,
        reason: 'timeout',
        detail: run.state.pauseDetail,
      });
      log.warn(
        { projectId: run.projectId, nodeId: node.id, timeoutSec: node.timeoutSec, taskIndex },
        'flow node llm timeout',
      );
      return { kind: 'pause' };
    }

    // Intentionally do NOT write finishedAt back to workflow_data here:
    // the LLM may keep editing variables briefly after flipping finish=true,
    // and our whole-file RMW would silently drop those edits (codex P1-B).
    // Duration audit lives in FlowState.history (saved by runLoop), which
    // is runner-owned so there's no concurrent writer.
    run.currentTaskIndex = null;
    return { kind: 'ok', next: node.next };
  }

  private async executeSystemLogic(run: ActiveRun, node: SystemLogicNode): Promise<NodeOutcome> {
    const data = readWorkflowData(run.folderPath);

    let matched: BranchRule | null = null;
    let matchedActual: unknown;
    let matchedSource: 'variable' | 'constant' | undefined;
    let matchedName: string | undefined;

    for (const rule of node.branches) {
      let actual: unknown;
      let source: 'variable' | 'constant';
      let name: string;
      if (rule.variable) {
        actual = data.variables[rule.variable];
        source = 'variable';
        name = rule.variable;
      } else if (rule.constant) {
        actual = data.constants[rule.constant];
        source = 'constant';
        name = rule.constant;
      } else {
        continue;
      }
      if (branchMatches(actual, rule.equals)) {
        matched = rule;
        matchedActual = actual;
        matchedSource = source;
        matchedName = name;
        break;
      }
    }

    const goto = matched ? matched.goto : (node.defaultGoto ?? null);
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        matchedSource,
        matchedName,
        matchedEquals: matched ? JSON.stringify(matched.equals) : undefined,
        actualValue: matched ? JSON.stringify(matchedActual) : undefined,
        goto,
        viaDefault: !matched,
      },
      'flow node system-logic branch evaluated',
    );

    if (goto === null) {
      return { kind: 'ok', next: null };
    }

    // Loop edge detection: target id is already in this run's history.
    const visited = new Set(run.state.history.map((h) => h.nodeId));
    const isBackward = visited.has(goto);
    if (isBackward) {
      const count = (run.state.loopCounters[node.id] ?? 0) + 1;
      run.state.loopCounters[node.id] = count;
      log.info(
        { projectId: run.projectId, nodeId: node.id, goto, loopCount: count, maxRetries: node.maxRetries },
        'flow node system-logic loop edge',
      );
      if (count > node.maxRetries) {
        run.state.status = 'paused';
        run.state.pauseReason = 'max-retries-exceeded';
        run.state.pauseDetail = `node ${node.id} backward edge to ${goto} exceeded maxRetries=${node.maxRetries}`;
        this.emit('error', {
          projectId: run.projectId,
          nodeId: node.id,
          reason: 'max-retries-exceeded',
          detail: run.state.pauseDetail,
        });
        log.warn(
          { projectId: run.projectId, nodeId: node.id, goto, maxRetries: node.maxRetries },
          'flow node system-logic max-retries exceeded',
        );
        return { kind: 'pause' };
      }
    }
    return { kind: 'ok', next: goto };
  }

  // ── Wait helpers ──────────────────────────────────────────────────────

  /** Watch workflow_data.json for `task_progress[index].finish = true`. The
   *  LLM is told to flip this flag when its work is done. Any other write to
   *  workflow_data (variable updates, etc.) also triggers the watcher; the
   *  50ms debounce + finish-check makes that cheap. */
  private waitForTaskFinish(run: ActiveRun, taskIndex: number, timeoutMs: number): Promise<WaitOutcome> {
    return new Promise<WaitOutcome>((resolve) => {
      let settled = false;
      const settle = (v: WaitOutcome) => {
        if (settled) return;
        settled = true;
        this.clearWaiters(run);
        resolve(v);
      };
      run.waitResolve = settle;

      const checkFinish = (): boolean => {
        try {
          const d = readWorkflowData(run.folderPath);
          return d.task_progress[taskIndex]?.finish === true;
        } catch {
          return false;
        }
      };

      // Initial check — finish may have raced ahead before we attached.
      if (checkFinish()) {
        log.info({ projectId: run.projectId, taskIndex, via: 'initial-check' }, 'flow task_progress finish detected');
        settle('finished');
        return;
      }

      const filePath = workflowDataPath(run.folderPath);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      } catch { /* ignore */ }
      try {
        run.watcher = fs.watch(filePath, { persistent: false }, () => {
          if (settled) return;
          if (run.watcherDebounce) clearTimeout(run.watcherDebounce);
          run.watcherDebounce = setTimeout(() => {
            run.watcherDebounce = null;
            if (settled) return;
            if (checkFinish()) {
              log.info({ projectId: run.projectId, taskIndex, via: 'watcher' }, 'flow task_progress finish detected');
              settle('finished');
            }
          }, 50);
        });
      } catch (err) {
        log.warn(
          { projectId: run.projectId, err: err instanceof Error ? err.message : String(err) },
          'workflow_data watch failed — falling back to polling',
        );
        const poll = setInterval(() => {
          if (checkFinish()) {
            clearInterval(poll);
            settle('finished');
          }
        }, 500);
        (run as ActiveRun & { _poll?: NodeJS.Timeout })._poll = poll;
      }

      run.timeoutTimer = setTimeout(() => settle('timeout'), timeoutMs);
    });
  }

  private clearWaiters(run: ActiveRun): void {
    if (run.watcher) {
      try { run.watcher.close(); } catch { /* ignore */ }
      run.watcher = null;
    }
    if (run.watcherDebounce) {
      clearTimeout(run.watcherDebounce);
      run.watcherDebounce = null;
    }
    if (run.timeoutTimer) {
      clearTimeout(run.timeoutTimer);
      run.timeoutTimer = null;
    }
    const r = run as ActiveRun & { _poll?: NodeJS.Timeout };
    if (r._poll) {
      clearInterval(r._poll);
      r._poll = undefined;
    }
    run.waitResolve = null;
  }

  private persist(run: ActiveRun): void {
    saveFlowState(run.folderPath, run.state);
    this.emit('state', { projectId: run.projectId, state: run.state });
  }

  private finalize(run: ActiveRun, status: 'completed' | 'failed' | 'aborted', detail?: string): void {
    run.state.status = status;
    run.state.currentNodeId = null;
    if (detail) run.state.pauseDetail = detail;
    this.clearWaiters(run);
    saveFlowState(run.folderPath, run.state);
    this.active.delete(run.projectId);
    this.emit('state', { projectId: run.projectId, state: run.state });
    log.info({ projectId: run.projectId, status, detail }, 'flow finalized');
  }
}

interface NodeOutcomeOk { kind: 'ok'; next: number | null; }
interface NodeOutcomePause { kind: 'pause'; }
interface NodeOutcomeError { kind: 'error'; message: string; }
interface NodeOutcomeRetry { kind: 'retry'; }
type NodeOutcome = NodeOutcomeOk | NodeOutcomePause | NodeOutcomeError | NodeOutcomeRetry;

// Suppress unused-export warnings — clearFlowState may be used by callers we
// don't see (e.g. project deletion cleanup).
void clearFlowState;

export const flowRunner = new FlowRunner();
