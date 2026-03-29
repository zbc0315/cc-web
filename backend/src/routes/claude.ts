import { Router } from 'express';
import { readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const router = Router();

router.get('/model', (_req, res) => {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    res.json({ model: settings.model || 'sonnet' });
  } catch {
    res.json({ model: 'sonnet' });
  }
});

router.get('/skills', (_req, res) => {
  const builtin = [
    { command: '/help', description: 'Show available commands and usage' },
    { command: '/clear', description: 'Clear conversation history and free context' },
    { command: '/memory', description: 'Edit CLAUDE.md memory files' },
    { command: '/model', description: 'Switch AI model (sonnet/opus/haiku)' },
    { command: '/cost', description: 'Show token usage and cost for this session' },
    { command: '/status', description: 'Show account and system status' },
    { command: '/doctor', description: 'Check Claude Code installation health' },
    { command: '/review', description: 'Request code review' },
    { command: '/terminal', description: 'Run a bash command in the terminal' },
    { command: '/vim', description: 'Open file in vim-like editor mode' },
    { command: '/init', description: 'Initialize project CLAUDE.md' },
    { command: '/bug', description: 'Report a bug to Anthropic' },
    { command: '/release-notes', description: 'View recent release notes' },
    { command: '/pr_comments', description: 'View PR review comments' },
    { command: '/logout', description: 'Sign out of Claude account' },
    { command: '/login', description: 'Sign in to Claude account' },
  ];

  const custom: { command: string; description: string }[] = [];
  const mcp: { name: string; description: string }[] = [];

  try {
    const commandsDir = join(homedir(), '.claude', 'commands');
    const files = readdirSync(commandsDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const name = file.replace(/\.md$/, '');
        const content = readFileSync(join(commandsDir, file), 'utf-8');
        const firstLine = content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || name;
        custom.push({ command: `/${name}`, description: firstLine });
      }
    }
  } catch { /* no commands dir */ }

  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    if (settings.mcpServers && typeof settings.mcpServers === 'object') {
      for (const name of Object.keys(settings.mcpServers as Record<string, unknown>)) {
        mcp.push({ name, description: 'MCP Server' });
      }
    }
  } catch { /* no settings */ }

  res.json({ builtin, custom, mcp });
});

export default router;
