import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getAdapter } from '../adapters';
import { getProject, isProjectOwner } from '../config';
import { atomicWriteSync } from '../config';
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

/**
 * PUT /model  body: { model: string }
 *
 * Persists the model choice into `~/.claude/settings.json`'s top-level
 * `model` field. In-session switching still happens via sending `/model <x>`
 * to the TUI; this write guarantees that a subsequent `claude` invocation
 * (restart / ccweb wake) picks up the chosen alias as the default.
 *
 * The existing settings.json is merged rather than replaced — hooks,
 * mcpServers, and other user fields are preserved. Only applicable to the
 * `claude` adapter; other tools have their own config files.
 */
router.put('/model', (req: AuthRequest, res: Response) => {
  const tool = parseTool(req);
  if (tool !== 'claude') {
    res.status(400).json({ error: 'Persisting model is only implemented for the claude adapter' });
    return;
  }
  const body = (req.body ?? {}) as { model?: unknown };
  const raw = typeof body.model === 'string' ? body.model.trim() : '';
  // Whitelist: known aliases, `opus[1m]` / `sonnet[1m]` bracket forms, or a
  // model-like ID `claude-<family>-<ver>`. Refusing arbitrary free-form text
  // prevents injection via JSON-in-settings surprises.
  const OK_RE = /^([a-z]+(\[[a-z0-9-]+\])?|claude-[a-z0-9]+-[a-z0-9-]+)$/i;
  if (!raw || !OK_RE.test(raw) || raw.length > 64) {
    res.status(400).json({ error: 'invalid model alias' });
    return;
  }

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      } else {
        // Refuse to clobber a non-object settings.json (user error, malformed
        // migration, test fixture, etc.) — better to bail than stringify
        // `[...] + {model:...}` into something Claude Code can't parse.
        res.status(500).json({ error: 'settings.json is not an object — refusing to write `model` field' });
        return;
      }
    }
  } catch {
    res.status(500).json({ error: 'Failed to read ~/.claude/settings.json' });
    return;
  }
  settings.model = raw;
  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(settingsPath, JSON.stringify(settings, null, 2));
    res.json({ ok: true, model: raw });
  } catch (err) {
    res.status(500).json({ error: `Failed to write settings: ${(err as Error).message}` });
  }
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
