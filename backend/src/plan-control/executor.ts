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
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private idleWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeCount = 0;
  private preReplanLines: string[] | null = null;
  private pendingPause = false;
  /** Track if-chain matched state per chain (keyed by the `if` node's line number). */
  private ifChainMatched = new Map<number, boolean>();

  constructor(projectPath: string, deps: ExecutorDeps, config?: Partial<PlanConfig>) {
    super();
    this.projectPath = projectPath;
    this.pcDir = path.join(projectPath, '.plan-control');
    this.deps = deps;
    this.config = { ...DEFAULT_PLAN_CONFIG, ...config };
  }

  // ── Public API ──

  checkSyntax(): { errors: { line: number; message: string }[]; ast: ASTNode[] } {
    const source = this.readMainPc();
    if (!source) return { errors: [{ line: 0, message: 'main.pc 文件不存在' }], ast: [] };
    const ast = parseProgram(source);
    const errors = check(ast);
    return { errors, ast };
  }

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

    this.processInitialVarAssigns();
    this.saveState();
    this.machineState = 'IDLE';
    this.broadcastStatus();
    this.tick();
  }

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

  pause(): void {
    if (this.machineState === 'WAITING') {
      this.pendingPause = true;
      return;
    }
    this.enterPaused('用户暂停');
  }

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

  getState(): PlanState | null {
    return this.state;
  }

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

  getNode(nodeId: string): NodeRecord | null {
    const file = path.join(this.pcDir, 'nodes', `node-${nodeId}.json`);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
    catch { return null; }
  }

  isInitialized(): boolean {
    return fs.existsSync(this.pcDir) && fs.existsSync(path.join(this.pcDir, 'plan-code.md'));
  }

  hasMainPc(): boolean {
    return fs.existsSync(path.join(this.pcDir, 'main.pc'));
  }

  // ── State Machine ──

  private tick(): void {
    if (this.machineState !== 'IDLE' || !this.state) return;

    const node = this.findNodeAtLine(this.state.current_line);
    if (!node) {
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
      this.advanceLine();
      this.saveState();
      this.broadcastStatus();
      setImmediate(() => this.tick());
    }
  }

  private dispatchTask(node: ASTNode): void {
    this.machineState = 'SENDING';
    const description = node.description ?? '';
    const resolvedDesc = interpolate(description, this.getEffectiveVariables());

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
    atomicWriteSync(path.join(nodesDir, `node-${nodeId}.json`), JSON.stringify(record, null, 2));

    this.waitForIdle(() => {
      this.deps.writeToPty(prompt + '\r');
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

    switch (node.type) {
      case 'var_assign':
        if (node.varName && node.listItems) {
          this.setVariable(node.varName, node.listItems);
        }
        break;

      case 'if': {
        const matched = this.evaluateCondition(node.condition!);
        if (!matched) {
          this.ifChainMatched.delete(node.line); // ensure clean state
          this.skipToNextBranch(node);
          return;
        }
        this.ifChainMatched.set(node.line, true);
        // If no elif/else follows, clean up when advancing past the block
        this.scheduleIfChainCleanup(node);
        break;
      }

      case 'elif': {
        const chainKey = this.findChainIfLine(node);
        if (this.ifChainMatched.get(chainKey)) {
          // Previous branch matched and executed — skip rest of chain
          this.ifChainMatched.delete(chainKey);
          this.skipIfChain(node);
          return;
        }
        // Previous condition failed — evaluate this elif
        const matched = this.evaluateCondition(node.condition!);
        if (!matched) {
          this.skipToNextBranch(node);
          return;
        }
        this.ifChainMatched.set(chainKey, true);
        break;
      }

      case 'else': {
        const chainKey = this.findChainIfLine(node);
        if (this.ifChainMatched.get(chainKey)) {
          this.ifChainMatched.delete(chainKey);
          this.skipBlock(node);
          return;
        }
        // Previous conditions all failed — enter else body
        break;
      }

      case 'for': {
        const vars = this.getEffectiveVariables();
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
            state.current_line = frame.start_line;
          }
        }
        break;
      }

      case 'func':
        this.skipBlock(node);
        return;

      case 'call': {
        if (state.call_stack.length >= 20) {
          this.enterPaused('call_stack 深度超过限制 (20)');
          return;
        }
        const funcNode = this.funcs.get(node.funcName!);
        if (!funcNode) break;

        const vars = this.getEffectiveVariables();
        const frame: CallFrame = {
          func: node.funcName!,
          return_line: this.findNextLineAfter(node.line),
          local_vars: {},
          saved_last_task_status: state.last_task_status,
        };

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
        state.current_line = funcNode.line;
        break;
      }

      case 'return': {
        const callFrame = state.call_stack.pop();
        if (callFrame) {
          state.last_task_status = callFrame.saved_last_task_status;
          state.current_line = callFrame.return_line - 1;
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

    const interval = setInterval(() => this.checkNodeResult(nodeId), this.config.watch_poll_interval);
    interval.unref();
    this.pollTimer = interval;
  }

  private checkNodeResult(nodeId: string): void {
    if (this.machineState === 'REPLANNING') {
      const record = this.getNode(nodeId);
      if (record && record.status === 'success') {
        this.cleanup();
        record.completed_at = new Date().toISOString();
        fs.writeFileSync(
          path.join(this.pcDir, 'nodes', `node-${nodeId}.json`),
          JSON.stringify(record, null, 2)
        );
        this.handleReplanComplete(nodeId);
      }
      return;
    }

    if (this.machineState !== 'WAITING') return;

    const record = this.getNode(nodeId);
    if (!record || record.status === null) return;

    const validStatuses = ['success', 'failed', 'blocked', 'replan'];
    if (!validStatuses.includes(record.status)) {
      this.deps.writeToPty(
        `[PLAN-CONTROL] 错误：status 值 "${record.status}" 无效。有效值: ${validStatuses.join(', ')}\r`
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

    if (node?.type === 'task_assign' && node.varName) {
      this.setVariable(node.varName, record.result);
    }

    const normalizedStatus = record.status === 'replan' ? 'success' : record.status!;
    this.state.last_task_status = normalizedStatus;
    this.state.executed_tasks++;

    this.state.history.push({
      node_id: record.id,
      line: record.line,
      status: record.status!,
      timestamp: record.completed_at!,
    });

    this.deps.broadcast({
      type: 'plan_node_update',
      node_id: record.id,
      status: record.status,
      summary: record.summary,
    });

    const needsReplan = record.request_replan || record.status === 'replan';
    if (needsReplan) {
      this.enterReplanning(record);
      return;
    }

    if (this.pendingPause) {
      this.pendingPause = false;
      this.enterPaused('用户暂停');
      return;
    }

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
        this.startNudgeTimer(nodeId);
        return;
      }

      this.nudgeCount++;
      if (this.nudgeCount > this.config.nudge_max_count) {
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
        `请继续当前任务。如果已完成，请按照 .plan-control/output-format.md 的格式更新 .plan-control/nodes/node-${nodeId}.json\r`
      );

      const record = this.getNode(nodeId);
      if (record) {
        record.nudge_count = this.nudgeCount;
        fs.writeFileSync(
          path.join(this.pcDir, 'nodes', `node-${nodeId}.json`),
          JSON.stringify(record, null, 2)
        );
      }

      this.deps.broadcast({ type: 'plan_nudge', node_id: nodeId, nudge_count: this.nudgeCount });
      this.startNudgeTimer(nodeId);
    }, interval);
    if (this.nudgeTimer) (this.nudgeTimer as ReturnType<typeof setTimeout>).unref();
  }

  // ── Replan ──

  private enterReplanning(record: NodeRecord): void {
    if (!this.state) return;
    this.state.status = 'replanning';
    this.saveState();
    this.machineState = 'REPLANNING';

    const source = this.readMainPc();
    this.preReplanLines = source ? source.split('\n') : [];

    const prompt = `\n[PLAN-CONTROL] 计划调整请求
原因：${record.replan_reason || '未提供原因'}
请修改 .plan-control/main.pc，保留前 ${this.state.current_line} 行不变，调整后续计划。
修改完成后，请更新 .plan-control/nodes/node-${record.id}.json 的 status 为 "success"。
[/PLAN-CONTROL]\n`;

    this.deps.writeToPty(prompt + '\r');
    this.deps.broadcast({ type: 'plan_replan', node_id: record.id, reason: record.replan_reason });
    this.broadcastStatus();

    this.cleanup(); // close previous watcher/timers before starting new ones
    this.startFileWatch(record.id);
  }

  private handleReplanComplete(nodeId: string): void {
    if (!this.state || !this.preReplanLines) return;

    const newSource = this.readMainPc();
    if (!newSource) {
      this.deps.writeToPty('[PLAN-CONTROL] 错误：main.pc 不存在\r');
      return;
    }

    const newLines = newSource.split('\n');
    const preserveCount = this.state.current_line;
    for (let i = 0; i < preserveCount && i < this.preReplanLines.length; i++) {
      if (newLines[i] !== this.preReplanLines[i]) {
        this.deps.writeToPty(
          `[PLAN-CONTROL] 错误：前 ${preserveCount} 行不可修改（第 ${i + 1} 行已变更），请恢复并仅修改第 ${preserveCount + 1} 行之后的内容\r`
        );
        return;
      }
    }

    const ast = parseProgram(newSource);
    const errors = check(ast);
    if (errors.length > 0) {
      const errText = errors.map(e => `第 ${e.line} 行: ${e.message}`).join('\n');
      this.deps.writeToPty(`[PLAN-CONTROL] 语法错误:\n${errText}\n请修复后重试。\r`);
      return;
    }

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

    const source = this.readMainPc();
    if (!source) return;
    this.ast = parseProgram(source);
    this.funcs = collectFuncs(this.ast);
    this.flattenAst();

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
    if (['success', 'failed', 'blocked'].includes(condition)) {
      return this.state.last_task_status === condition;
    }
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
    let currentIdx = this.flatNodes.findIndex(n => n.line === this.state!.current_line);

    // current_line may point to a blank/comment line (not in flatNodes).
    // Find the next flatNode after current_line instead of jumping to end.
    if (currentIdx < 0) {
      const nextIdx = this.flatNodes.findIndex(n => n.line > this.state!.current_line);
      if (nextIdx >= 0) {
        this.state.current_line = this.flatNodes[nextIdx].line;
        this.checkLoopEnd();
        this.checkCallEnd();
        return;
      }
      if (this.checkLoopEnd()) return;
      this.state.current_line = this.flatNodes.length > 0
        ? this.flatNodes[this.flatNodes.length - 1].line + 1
        : 1;
      return;
    }

    if (currentIdx + 1 >= this.flatNodes.length) {
      if (this.checkLoopEnd()) return;
      this.state.current_line = this.flatNodes[this.flatNodes.length - 1].line + 1;
      return;
    }

    const nextNode = this.flatNodes[currentIdx + 1];
    this.state.current_line = nextNode.line;

    this.checkLoopEnd();
    this.checkCallEnd();
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
      const loopNode = this.findNodeAtLine(frame.start_line);
      if (loopNode && loopNode.children.length > 0) {
        this.state.current_line = loopNode.children[0].line;
      }
      return true;
    }
    return false;
  }

  /** Implicit return: if current_line left the function body, pop the call frame. */
  private checkCallEnd(): void {
    if (!this.state || this.state.call_stack.length === 0) return;
    const frame = this.state.call_stack[this.state.call_stack.length - 1];
    const funcNode = this.funcs.get(frame.func);
    if (!funcNode) return;
    const endLine = this.findBlockEndLine(funcNode);
    if (this.state.current_line > endLine) {
      this.state.call_stack.pop();
      this.state.last_task_status = frame.saved_last_task_status;
      this.state.current_line = frame.return_line;
    }
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

  /** Skip to the next elif/else sibling after a failed if/elif condition. */
  private skipToNextBranch(node: ASTNode): void {
    if (!this.state) return;
    const siblings = this.findSiblings(node);
    if (!siblings) { this.skipBlock(node); return; }

    const idx = siblings.findIndex(s => s.line === node.line);
    for (let i = idx + 1; i < siblings.length; i++) {
      if (siblings[i].type === 'elif' || siblings[i].type === 'else') {
        this.state.current_line = siblings[i].line;
        return;
      }
    }
    // No more branches — skip past the if block
    this.skipBlock(node);
  }

  private skipIfChain(node: ASTNode): void {
    if (!this.state) return;
    const siblings = this.findSiblings(node);
    if (!siblings) return;

    const idx = siblings.findIndex(s => s.line === node.line);
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

  /** Schedule cleanup of ifChainMatched entry after the if-block's last branch ends. */
  private scheduleIfChainCleanup(ifNode: ASTNode): void {
    const siblings = this.findSiblings(ifNode);
    if (!siblings) return;
    // If there are no elif/else siblings, the Map entry would never be cleaned up
    const hasElif = siblings.some(s => s.line !== ifNode.line && (s.type === 'elif' || s.type === 'else'));
    if (!hasElif) {
      // No elif/else — clean up immediately after block body (entry only needed for elif/else)
      this.ifChainMatched.delete(ifNode.line);
    }
  }

  /** Find the `if` node's line that starts the chain containing this elif/else node. */
  private findChainIfLine(node: ASTNode): number {
    const siblings = this.findSiblings(node);
    if (siblings) {
      for (const s of siblings) {
        if (s.type === 'if') return s.line;
      }
    }
    return node.line; // fallback
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
    for (const node of this.ast) {
      if (node.type === 'var_assign' && node.varName && node.listItems) {
        this.state!.variables[node.varName] = node.listItems;
      }
    }
  }

  private waitForIdle(callback: () => void): void {
    const check = () => {
      if (this.machineState !== 'SENDING') return; // cancelled by stop/pause
      const lastActivity = this.deps.getLastActivity();
      const now = Date.now();
      const idle = !lastActivity || (now - lastActivity) > this.config.send_idle_seconds * 1000;
      if (idle) {
        this.idleWaitTimer = null;
        callback();
      } else {
        this.idleWaitTimer = setTimeout(check, 5000);
        (this.idleWaitTimer as ReturnType<typeof setTimeout>).unref();
      }
    };
    check();
  }

  private buildPrompt(nodeId: string, resolvedDesc: string, node: ASTNode): string {
    const state = this.state!;
    let prompt = `[PLAN-CONTROL] 任务 #${nodeId}
指令：${resolvedDesc}
上下文：第${state.executed_tasks + 1}个任务（已完成${state.executed_tasks}个）`;

    // Attach recent task context (last 3 completed tasks with summary + result)
    if (state.history.length > 0) {
      const recent = state.history.slice(-3);
      prompt += '\n\n前序任务摘要：';
      for (const h of recent) {
        const rec = this.getNode(h.node_id);
        if (rec) {
          const resultStr = rec.result !== null && rec.result !== undefined
            ? (typeof rec.result === 'string' ? rec.result : JSON.stringify(rec.result))
            : '无';
          prompt += `\n  #${h.node_id} (${h.status}) — ${rec.summary || '无摘要'} | result: ${resultStr}`;
        } else {
          prompt += `\n  #${h.node_id} (${h.status})`;
        }
      }
    }

    prompt += `\n\n输出文件：.plan-control/nodes/node-${nodeId}.json`;
    prompt += `\n输出格式：见 .plan-control/output-format.md`;

    if (node.type === 'task_assign') {
      prompt += `\n返回要求：result 字段请填写为字符串列表、字符串或布尔值`;
    }

    prompt += `\nGit：执行前先 commit 当前工作，执行完成后再 commit 本次变更`;
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
    if (this.idleWaitTimer) { clearTimeout(this.idleWaitTimer); this.idleWaitTimer = null; }
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
