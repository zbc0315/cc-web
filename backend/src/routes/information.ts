// backend/src/routes/information.ts

import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';
import { infoDir, readMeta, writeMeta, listConversationIds } from '../information/conversation-sync';
import { ExpandRecord } from '../information/types';

const router = Router();
const MAX_RECENT_EXPANDS = 50;

function resolveProjectFolder(projectId: string, username: string, res: Response): string | null {
  const project = getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!isAdminUser(username) && !isProjectOwner(project, username) &&
      !project.shares?.some((s: { username: string; permission: string }) => s.username === username && s.permission === 'edit')) {
    res.status(403).json({ error: 'Access denied' }); return null;
  }
  return project.folderPath;
}

// ── GET /api/information/:projectId/conversations ──

router.get('/:projectId/conversations', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const ids = listConversationIds(folder);
  const dir = infoDir(folder);

  const conversations: Array<{
    id: string;
    started_at: string;
    ended_at: string;
    summary: string;
    turns: number;
    latest: string;
    latest_tokens: number;
    original_tokens: number;
    expand_count: number;
  }> = [];

  for (const id of ids) {
    const meta = readMeta(path.join(dir, id));
    if (!meta) continue;
    const latestVersion = meta.versions[meta.latest];
    conversations.push({
      id,
      started_at: meta.started_at,
      ended_at: meta.ended_at,
      summary: meta.summary,
      turns: meta.turns,
      latest: meta.latest,
      latest_tokens: latestVersion?.tokens ?? meta.original_tokens,
      original_tokens: meta.original_tokens,
      expand_count: meta.expand_stats.total_llm + meta.expand_stats.total_user,
    });
  }

  conversations.sort((a, b) => b.started_at.localeCompare(a.started_at));

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  res.json(conversations.slice(offset, offset + limit));
});

// ── GET /api/information/:projectId/conversations/:convId ──

router.get('/:projectId/conversations/:convId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const convDir = path.join(infoDir(folder), req.params.convId);
  const meta = readMeta(convDir);
  if (!meta) { res.status(404).json({ error: 'Conversation not found' }); return; }

  let version = (req.query.version as string) || 'latest';
  if (version === 'latest') version = meta.latest;
  const versionEntry = meta.versions[version];
  if (!versionEntry) { res.status(404).json({ error: `Version ${version} not found` }); return; }

  const filePath = path.join(convDir, versionEntry.file);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    res.status(500).json({ error: 'Failed to read conversation file' });
    return;
  }

  // Filter to specific turns if requested
  const turnsParam = req.query.turns as string;
  if (turnsParam) {
    const requestedTurns = turnsParam.split(',').map(t => t.trim());
    const sections = content.split(/(?=^## )/m);
    content = sections.filter(section => {
      const match = section.match(/^## ([UA]\d+)/);
      return match && requestedTurns.includes(match[1]);
    }).join('\n');
  }

  // Record expand if requesting non-latest version
  const source = (req.query.source as string) === 'user' ? 'user' : 'llm';
  if (version !== meta.latest) {
    const record: ExpandRecord = { from: meta.latest, to: version, at: new Date().toISOString(), source };
    if (source === 'llm') {
      meta.expand_stats.total_llm += 1;
      if (turnsParam) {
        for (const turn of turnsParam.split(',').map(t => t.trim())) {
          meta.expand_stats.by_turn[turn] = (meta.expand_stats.by_turn[turn] || 0) + 1;
        }
      }
    } else {
      meta.expand_stats.total_user += 1;
    }
    meta.expand_stats.recent.push(record);
    if (meta.expand_stats.recent.length > MAX_RECENT_EXPANDS) {
      meta.expand_stats.recent = meta.expand_stats.recent.slice(-MAX_RECENT_EXPANDS);
    }
    try { writeMeta(convDir, meta); } catch { /* non-fatal */ }
  }

  res.json({
    conv_id: req.params.convId,
    version,
    tokens: versionEntry.tokens,
    content,
    available_versions: Object.keys(meta.versions),
    expand_stats: meta.expand_stats,
  });
});

export default router;
