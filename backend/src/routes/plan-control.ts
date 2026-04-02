// backend/src/routes/plan-control.ts
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getProject } from '../config';
import { PlanExecutor } from '../plan-control/executor';
import { PlanTreeNode, TreeNodeType, TreeNodeStatus, ASTNode } from '../plan-control/types';
import { parseProgram } from '../plan-control/parser';
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
      status = undefined;
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
