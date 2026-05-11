import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { modLogger } from '../logger';
import {
  appendTaskTodo,
  clearFlowState,
  loadFlowState,
  readTaskTodo,
  resetTaskTodo,
  saveFlowState,
  taskTodoPath,
  writeTaskTodo,
} from './store';
import type {
  BranchRule,
  FileRef,
  FlowDef,
  FlowNode,
  FlowState,
  LlmNode,
  NodeHistoryEntry,
  SystemLogicNode,
  UserInputNode,
} from './types';

const log = modLogger('flow-runner');

/** Injector signature — provided by the host (index.ts wires this to
 *  writeTerminalInputSplit so the runner stays decoupled from PTY plumbing). */
export type PromptInjector = (projectId: string, brackedPastePayload: string) => void;

/** Build a bracketed-paste payload that the LLM CLI submits as one chat
 *  message. The CR at the end triggers Enter; embedded paste markers in
 *  the body are stripped to prevent mode escape. */
function buildPaste(text: string): string {
  const safe = text.replace(/\x1b\[20[01]~/g, '');
  return `\x1b[200~${safe}\x1b[201~\r`;
}

/** Substitute `{{file:relpath}}` tokens with the file's UTF-8 content.
 *  Missing files render as `[ERROR reading <path>: <reason>]` — the runner
 *  separately surfaces read failures via provider-aware error routing
 *  before we get here, so this substitution path is only a defense for
 *  unexpected misses. */
function renderTemplate(folderPath: string, tpl: string): string {
  return tpl.replace(/\{\{file:([^}]+)\}\}/g, (_m, rel: string) => {
    const abs = path.join(folderPath, rel.trim());
    try {
      return fs.readFileSync(abs, 'utf-8');
    } catch (err) {
      return `[ERROR reading ${rel}: ${err instanceof Error ? err.message : 'unknown'}]`;
    }
  });
}

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

interface ReadResult {
  ok: boolean;
  /** When ok=false, identifies whether to ask user vs LLM to fix. */
  failingProvider?: FileRef['provider'];
  error?: string;
}

function readInputs(folderPath: string, inputs: FileRef[]): ReadResult {
  for (const inp of inputs) {
    const abs = path.join(folderPath, inp.path);
    try {
      const raw = fs.readFileSync(abs, 'utf-8');
      // Best-effort JSON parse — non-JSON inputs (e.g. bibtex) pass through
      // here as long as the file exists; a stricter parse, if needed, lives
      // in the consuming node (e.g. system-logic parses JSON itself).
      if (inp.path.endsWith('.json')) JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        failingProvider: inp.provider,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ok: true };
}

interface ActiveRun {
  projectId: string;
  folderPath: string;
  flowDef: FlowDef;
  state: FlowState;
  watcher: fs.FSWatcher | null;
  watcherDebounce: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null;
  /** Resolver of the currently-pending wait, if any. */
  waitResolve: ((v: WaitOutcome) => void) | null;
  /** When awaiting user input: resolver/rejector for the externally-supplied
   *  form data. */
  userInputResolve: ((data: Record<string, string>) => void) | null;
  userInputReject: ((reason: string) => void) | null;
  /** Index into task_todo.tasks for the currently-running LLM node. */
  currentTaskIndex: number | null;
  /** Pending error to surface in the next LLM prompt (provider=llm path). */
  pendingLlmError: { path: string; error: string } | null;
}

type WaitOutcome = 'finished' | 'timeout' | 'aborted' | 'paused';

export class FlowRunner extends EventEmitter {
  private active = new Map<string, ActiveRun>();
  private injector: PromptInjector | null = null;

  setPromptInjector(fn: PromptInjector): void {
    this.injector = fn;
  }

  /** Returns null if a flow is already running for this project. */
  start(
    projectId: string,
    folderPath: string,
    flowDef: FlowDef,
  ): { ok: boolean; reason?: string; state?: FlowState } {
    if (this.active.has(projectId)) {
      return { ok: false, reason: 'already-running' };
    }
    const startNode = flowDef.nodes.find((n) => n.id === flowDef.entryNodeId);
    if (!startNode) return { ok: false, reason: 'entry-node-not-found' };

    resetTaskTodo(folderPath);

    const state: FlowState = {
      flowId: flowDef.id,
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
      pendingLlmError: null,
    };
    this.active.set(projectId, run);
    this.emit('state', { projectId, state });

    log.info(
      {
        projectId,
        flowId: flowDef.id,
        flowName: flowDef.name,
        entryNodeId: flowDef.entryNodeId,
        nodeCount: flowDef.nodes.length,
        runId: state.runId,
      },
      'flow start',
    );

    // Fire-and-forget; the loop persists state on each transition.
    void this.runLoop(run).catch((err) => {
      log.error(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'run loop crashed',
      );
      this.finalize(run, 'failed', err instanceof Error ? err.message : String(err));
    });

    return { ok: true, state };
  }

  /**
   * Resume a paused run by re-executing the current node. Caller intent:
   *  - timeout → re-inject prompt, wait again
   *  - max-retries-exceeded → reset that node's loop counter so user gets
   *    a fresh allotment (otherwise resume would immediately hit the same
   *    cap and pause again)
   *  - file-read-error → user fixed the file; re-read succeeds and node
   *    proceeds normally
   *  - awaiting-user-input → wrong path; caller should use submitUserInput
   */
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
    // settle() inside waitForTaskFinish calls clearWaiters internally, so
    // we don't need to call it here for the wait path. For the user-input
    // path we still need finalize to clean up (no watcher/timer there).
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
    // Log keys + value lengths only — field values may contain user research
    // goals / unpublished hypotheses that we don't want in plaintext logs.
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
        // executeNode already set status/pauseReason; persist + bail out.
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
      // 'retry' just persists; loop continues with same state.currentNodeId
    }
  }

  // ── Node executors ────────────────────────────────────────────────────

  private async executeNode(
    run: ActiveRun,
    node: FlowNode,
  ): Promise<NodeOutcome> {
    log.info({ projectId: run.projectId, nodeId: node.id, kind: node.kind, name: node.name }, 'executing node');
    this.emit('state', { projectId: run.projectId, state: run.state });

    if (node.kind === 'user-input') return this.executeUserInput(run, node);
    if (node.kind === 'llm') return this.executeLlm(run, node);
    if (node.kind === 'system-logic') return this.executeSystemLogic(run, node);
    return { kind: 'error', message: `unknown node kind: ${(node as { kind: string }).kind}` };
  }

  private async executeUserInput(run: ActiveRun, node: UserInputNode): Promise<NodeOutcome> {
    run.state.status = 'paused';
    run.state.pauseReason = 'awaiting-user-input';
    run.state.pendingUserInput = { nodeId: node.id, fields: node.userInputSchema.fields };
    this.persist(run);
    this.emit('user-input', { projectId: run.projectId, nodeId: node.id, fields: node.userInputSchema.fields });
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        fieldKeys: node.userInputSchema.fields.map((f) => f.key),
        outputCount: node.outputs.length,
      },
      'flow node user-input awaiting',
    );

    let data: Record<string, string>;
    try {
      data = await new Promise<Record<string, string>>((resolve, reject) => {
        run.userInputResolve = resolve;
        run.userInputReject = reject;
      });
    } catch (err) {
      // Reject via abort() — outer handler does finalize.
      return { kind: 'pause' };
    }

    // Write outputs: synthesize a JSON object from user fields and write to
    // each declared output file. For Phase 1, multi-output user-input nodes
    // get the same payload written to each — keeps the schema simple.
    const payload: Record<string, string> = {};
    for (const field of node.userInputSchema.fields) payload[field.key] = data[field.key] ?? '';
    for (const out of node.outputs) {
      const abs = path.join(run.folderPath, out.path);
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, JSON.stringify(payload, null, 2));
      } catch (err) {
        run.state.status = 'failed';
        run.state.pauseReason = null;
        run.state.pauseDetail = `failed to write ${out.path}: ${err instanceof Error ? err.message : 'unknown'}`;
        return { kind: 'error', message: run.state.pauseDetail };
      }
    }

    run.state.status = 'running';
    run.state.pauseReason = null;
    run.state.pendingUserInput = undefined;
    this.persist(run);
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        outputsWritten: node.outputs.map((o) => o.path),
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

    // 1. Read & validate inputs (provider-aware error routing)
    const readResult = readInputs(run.folderPath, node.inputs);
    if (!readResult.ok) {
      log.warn(
        {
          projectId: run.projectId,
          nodeId: node.id,
          failingProvider: readResult.failingProvider,
          error: readResult.error,
          inputs: node.inputs.map((i) => i.path),
        },
        'flow node llm input read failed',
      );
      if (readResult.failingProvider === 'user') {
        run.state.status = 'paused';
        run.state.pauseReason = 'user-file-read-error';
        run.state.pauseDetail = `failed to read input file (provider=user): ${readResult.error}`;
        this.emit('error', {
          projectId: run.projectId,
          nodeId: node.id,
          reason: 'user-file-read-error',
          detail: run.state.pauseDetail,
        });
        return { kind: 'pause' };
      }
      // provider=llm or system — stash error to inject in the next prompt to
      // the LLM. Since the input was supposedly produced by an upstream LLM
      // node, we still send the prompt to *this* node's LLM but with an
      // explanatory wrapper, asking it to handle/repair.
      run.pendingLlmError = {
        path: node.inputs.find((i) => i.provider !== 'user')?.path ?? '?',
        error: readResult.error ?? 'unknown',
      };
    }

    // 2. task_todo entry
    const taskIndex = appendTaskTodo(run.folderPath, {
      id: node.id,
      name: node.name,
      finish: false,
    });
    run.currentTaskIndex = taskIndex;

    // 3. Build prompt
    const errorBlock = run.pendingLlmError
      ? `\n\n[文件读取错误] 上游产物 ${run.pendingLlmError.path} 解析失败：${run.pendingLlmError.error}\n请先修复该文件再继续本任务。\n`
      : '';
    run.pendingLlmError = null;

    const taskHeader = `当前任务 id=${node.id}，名为「${node.name}」。\n` +
      `完成后请把 .ccweb/task_todo.json 中索引 ${taskIndex} 处 entry 的 finish 字段改为 true（用 Edit/Write 工具直接更新该 JSON 文件）。\n` +
      `\n──────── 任务正文 ────────\n`;

    const body = renderTemplate(run.folderPath, node.promptTemplate);
    const fullPrompt = `${taskHeader}${body}${errorBlock}`;

    // 4. Inject into chat
    this.injector(run.projectId, buildPaste(fullPrompt));
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        taskIndex,
        promptSize: fullPrompt.length,
        hasErrorBlock: errorBlock.length > 0,
        timeoutSec: node.timeoutSec,
        inputs: node.inputs.map((i) => i.path),
      },
      'flow node llm prompt injected',
    );

    // 5. Wait for task_todo finish:true OR timeout
    const outcome = await this.waitForTaskFinish(run, taskIndex, node.timeoutSec * 1000);
    log.info(
      { projectId: run.projectId, nodeId: node.id, taskIndex, outcome },
      'flow node llm wait outcome',
    );

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
    // finished — clear stale per-task fields
    run.currentTaskIndex = null;
    return { kind: 'ok', next: node.next };
  }

  private async executeSystemLogic(run: ActiveRun, node: SystemLogicNode): Promise<NodeOutcome> {
    // Read first input file as JSON
    const inp = node.inputs[0];
    if (!inp) return { kind: 'error', message: `system-logic node ${node.id} has no inputs` };
    const abs = path.join(run.folderPath, inp.path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        { projectId: run.projectId, nodeId: node.id, path: inp.path, provider: inp.provider, error: msg },
        'flow node system-logic input parse failed',
      );
      run.state.status = 'paused';
      run.state.pauseReason = inp.provider === 'user' ? 'user-file-read-error' : 'llm-file-read-error';
      run.state.pauseDetail = `failed to parse ${inp.path} (provider=${inp.provider}): ${msg}`;
      if (inp.provider !== 'user') {
        // Stash for any subsequent LLM node prompt to consume.
        run.pendingLlmError = { path: inp.path, error: msg };
      }
      this.emit('error', {
        projectId: run.projectId,
        nodeId: node.id,
        reason: run.state.pauseReason,
        detail: run.state.pauseDetail,
      });
      return { kind: 'pause' };
    }

    // Evaluate branches with loose comparison — LLM often writes JSON
    // booleans as strings ("true"/"false") or numbers; branch authors
    // probably configured the typed primitive.
    const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
    let matched: BranchRule | null = null;
    for (const rule of node.branches) {
      if (branchMatches(obj[rule.field], rule.equals)) {
        matched = rule;
        break;
      }
    }
    const goto = matched ? matched.goto : (node.defaultGoto ?? null);
    log.info(
      {
        projectId: run.projectId,
        nodeId: node.id,
        topLevelKeys: Object.keys(obj),
        matchedField: matched?.field,
        matchedEquals: matched ? JSON.stringify(matched.equals) : undefined,
        actualValue: matched ? JSON.stringify(obj[matched.field]) : undefined,
        goto,
        viaDefault: !matched,
      },
      'flow node system-logic branch evaluated',
    );
    if (goto === null) return { kind: 'ok', next: null };

    // Backward edge detection by history (codex review P1d) — node ids may
    // not be topologically ordered, so `goto < node.id` is unsafe. Visiting
    // the same id twice in this run = loop edge.
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

      // Initial check — finish may have raced ahead before we attached.
      try {
        const todo = readTaskTodo(run.folderPath);
        if (todo.tasks[taskIndex]?.finish === true) {
          log.info(
            { projectId: run.projectId, taskIndex, via: 'initial-check' },
            'flow task_todo finish detected',
          );
          settle('finished');
          return;
        }
      } catch { /* ignore */ }

      const filePath = taskTodoPath(run.folderPath);
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
            try {
              const todo = readTaskTodo(run.folderPath);
              if (todo.tasks[taskIndex]?.finish === true) {
                log.info(
                  { projectId: run.projectId, taskIndex, via: 'watcher' },
                  'flow task_todo finish detected',
                );
                settle('finished');
              }
            } catch { /* keep waiting */ }
          }, 50);
        });
      } catch (err) {
        log.warn(
          { projectId: run.projectId, err: err instanceof Error ? err.message : String(err) },
          'task_todo watch failed — falling back to polling',
        );
        // Fallback: 500ms poll
        const poll = setInterval(() => {
          try {
            const todo = readTaskTodo(run.folderPath);
            if (todo.tasks[taskIndex]?.finish === true) {
              clearInterval(poll);
              settle('finished');
            }
          } catch { /* ignore */ }
        }, 500);
        // Tie poll to settle: we can't directly cancel here, but settle's
        // clearWaiters won't reach it. Wrap by mirroring as a fake watcher
        // via run.timeoutTimer ergonomics — simpler: stash on run object.
        // For phase-1 acceptable, just accept the small leak past timeout.
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

export const flowRunner = new FlowRunner();
