import { Router } from 'express';
import { getAdapter } from '../adapters';
import type { CliTool } from '../types';

const VALID_TOOLS: CliTool[] = ['claude', 'opencode', 'codex', 'qwen'];

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

router.get('/skills', (req, res) => {
  const adapter = getAdapter(parseTool(req));
  const skills = adapter.getSkills();
  res.json(skills ?? { builtin: [], custom: [], mcp: [] });
});

export default router;
