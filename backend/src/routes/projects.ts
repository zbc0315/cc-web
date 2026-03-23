import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProjects, saveProject, deleteProject, getProject, writeProjectConfig, readProjectConfig } from '../config';
import { terminalManager } from '../terminal-manager';
import { usageTerminal } from '../usage-terminal';
import { sessionManager } from '../session-manager';
import { Project, CliTool } from '../types';

const VALID_CLI_TOOLS: CliTool[] = ['claude', 'opencode', 'codex', 'qwen'];

const router = Router();

/** Initialize .notebook/ directory structure in a project folder */
function initNotebook(folderPath: string): void {
  try {
    const notebookDir = path.join(folderPath, '.notebook', 'pages');
    if (!fs.existsSync(notebookDir)) {
      fs.mkdirSync(notebookDir, { recursive: true });
    }
    const graphFile = path.join(folderPath, '.notebook', 'graph.yaml');
    if (!fs.existsSync(graphFile)) {
      fs.writeFileSync(graphFile, 'pages: []\nrelations: []\n', 'utf-8');
    }
  } catch (err) {
    console.error('[Projects] Failed to init .notebook/:', err);
  }
}

// GET /api/projects
router.get('/', (req: AuthRequest, res: Response): void => {
  const username = req.user?.username;
  const projects = getProjects().filter((p) =>
    // Show projects owned by this user, or legacy projects without owner (belong to admin/everyone)
    !p.owner || p.owner === username
  );
  res.json(projects);
});

// GET /api/projects/activity  →  { [projectId]: lastActivityAt (epoch ms) }
router.get('/activity', (_req: AuthRequest, res: Response): void => {
  res.json(terminalManager.getAllActivity());
});

// POST /api/projects
router.post('/', (req: AuthRequest, res: Response): void => {
  const { name, folderPath, permissionMode, cliTool } = req.body as {
    name?: string;
    folderPath?: string;
    permissionMode?: 'limited' | 'unlimited';
    cliTool?: CliTool;
  };

  if (!name || !folderPath || !permissionMode) {
    res.status(400).json({ error: 'name, folderPath, and permissionMode are required' });
    return;
  }

  if (permissionMode !== 'limited' && permissionMode !== 'unlimited') {
    res.status(400).json({ error: 'permissionMode must be "limited" or "unlimited"' });
    return;
  }

  if (cliTool && !VALID_CLI_TOOLS.includes(cliTool)) {
    res.status(400).json({ error: `cliTool must be one of: ${VALID_CLI_TOOLS.join(', ')}` });
    return;
  }

  const project: Project = {
    id: uuidv4(),
    name,
    folderPath,
    permissionMode,
    cliTool: cliTool ?? 'claude',
    createdAt: new Date().toISOString(),
    status: 'running',
    owner: req.user?.username,
  };

  saveProject(project);

  // Write .ccweb/project.json into the project folder
  try {
    writeProjectConfig(folderPath, project);
  } catch (err) {
    console.error('[Projects] Failed to write .ccweb/project.json:', err);
  }

  initNotebook(folderPath);

  // Start terminal; broadcast is a no-op until a WS client connects
  terminalManager.getOrCreate(project);

  res.status(201).json(project);
});

// POST /api/projects/open — open an existing project from its folder (.ccweb/project.json)
router.post('/open', (req: AuthRequest, res: Response): void => {
  const { folderPath } = req.body as { folderPath?: string };

  if (!folderPath) {
    res.status(400).json({ error: 'folderPath is required' });
    return;
  }

  if (!fs.existsSync(folderPath)) {
    res.status(400).json({ error: 'Folder does not exist' });
    return;
  }

  const config = readProjectConfig(folderPath);
  if (!config) {
    res.status(400).json({ error: 'No .ccweb/project.json found in this folder. This folder has not been used as a CC Web project before.' });
    return;
  }

  // Check if this project is already registered
  const existing = getProjects().find((p) => p.folderPath === folderPath);
  if (existing) {
    res.status(409).json({ error: 'This project is already open', project: existing });
    return;
  }

  const project: Project = {
    id: config.id,
    name: config.name,
    folderPath,
    permissionMode: config.permissionMode,
    cliTool: config.cliTool ?? 'claude',
    createdAt: config.createdAt,
    status: 'running',
    owner: req.user?.username,
  };

  saveProject(project);

  initNotebook(folderPath);

  // Start terminal
  terminalManager.getOrCreate(project);

  res.status(200).json(project);
});

// DELETE /api/projects/:id
router.delete('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  terminalManager.stop(id);
  deleteProject(id);

  res.json({ success: true });
});

// PATCH /api/projects/:id/stop
router.patch('/:id/stop', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  terminalManager.stop(id);
  // terminalManager.stop() already sets status='stopped' and saves

  // Re-read the project to return fresh state
  res.json(getProject(id) ?? project);
});

// PATCH /api/projects/:id/start
router.patch('/:id/start', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  project.status = 'running';
  saveProject(project);

  terminalManager.getOrCreate(project);

  res.json(project);
});

// PATCH /api/projects/:id/archive
router.patch('/:id/archive', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  // Stop terminal before archiving
  terminalManager.stop(id);

  project.archived = true;
  project.status = 'stopped';
  saveProject(project);

  res.json(getProject(id) ?? project);
});

// PATCH /api/projects/:id/unarchive
router.patch('/:id/unarchive', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  project.archived = false;
  saveProject(project);

  res.json(getProject(id) ?? project);
});

// PATCH /api/projects/:id — update project fields (e.g. sound config)
router.patch('/:id', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const project = getProject(id);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
  const { sound } = req.body as { sound?: any };
  if (sound !== undefined) (project as any).sound = sound;
  saveProject(project);
  res.json(project);
});

// GET /api/projects/:id/sessions
router.get('/:id/sessions', (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  res.json(sessionManager.listSessions(id));
});

// GET /api/projects/:id/sessions/:sessionId
router.get('/:id/sessions/:sessionId', (req: AuthRequest, res: Response): void => {
  const { id, sessionId } = req.params;
  const session = sessionManager.getSession(id, sessionId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  res.json(session);
});

// GET /api/projects/usage  →  Claude Code usage via OAuth API
// Pass ?refresh=true to bust the cache (e.g. after plan upgrade)
router.get('/usage', (req: AuthRequest, res: Response): void => {
  if (req.query['refresh'] === 'true') usageTerminal.clearUsageCache();
  usageTerminal.queryUsage()
    .then((data) => res.json(data))
    .catch(() => res.json(null));
});

export default router;
