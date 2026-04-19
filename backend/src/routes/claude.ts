import { Router, Response } from 'express';
import { getAdapter } from '../adapters';
import { getProject, isProjectOwner } from '../config';
import type { CliTool } from '../types';
import type { AuthRequest } from '../auth';

const VALID_TOOLS: CliTool[] = ['claude', 'opencode', 'codex', 'qwen', 'gemini', 'terminal'];

function parseTool(req: { query: { tool?: string } }): CliTool {
  const raw = req.query.tool as string | undefined;
  if (raw && VALID_TOOLS.includes(raw as CliTool)) return raw as CliTool;
  return 'claude';
}

const router = Router();

router.get('/model', (req, res) => {
  const adapter = getAdapter(parseTool(req));
  const model = adapter.getCurrentModel();
  res.json({ model: model ?? null });
});

router.get('/models', (req, res) => {
  const adapter = getAdapter(parseTool(req));
  res.json(adapter.getAvailableModels());
});

// Skills endpoint. If `projectId` is supplied, we resolve the project's
// folderPath *server-side* after verifying the caller owns (or shares with
// edit) that project — an earlier version accepted a raw `projectPath`
// string from the client, which let any authenticated user enumerate
// `.md` / SKILL.md files under arbitrary paths on the server.
router.get('/skills', (req: AuthRequest, res: Response) => {
  const adapter = getAdapter(parseTool(req));
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

  let projectPath: string | undefined;
  if (projectId) {
    const project = getProject(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    const username = req.user?.username;
    const shared = project.shares?.some((s) => s.username === username);
    if (!isProjectOwner(project, username) && !shared) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    projectPath = project.folderPath;
  }

  const skills = adapter.getSkills(projectPath);
  res.json(skills ?? { builtin: [], custom: [], mcp: [] });
});

export default router;
