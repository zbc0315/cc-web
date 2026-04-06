// backend/src/routes/information.ts

import { Router, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';
import { infoDir, readMeta, writeMeta, compensationSync } from '../information/conversation-sync';
import { ConversationMeta, ExpandRecord } from '../information/types';
import { getAdapter } from '../adapters';

const router = Router();
const MAX_RECENT_EXPANDS = 50;

// ── Meta cache: avoid re-reading unchanged meta.json files ──
const metaCache = new Map<string, { mtime: number; data: ConversationMeta }>();

function readMetaCached(convDir: string): ConversationMeta | null {
  const metaPath = convDir + '/meta.json';
  try {
    const stat = require('fs').statSync(metaPath);
    const cached = metaCache.get(convDir);
    if (cached && cached.mtime === stat.mtimeMs) return cached.data;
    const data = readMeta(convDir);
    if (data) metaCache.set(convDir, { mtime: stat.mtimeMs, data });
    return data;
  } catch {
    return null;
  }
}

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

  const dir = infoDir(folder);
  if (!fs.existsSync(dir)) { res.json([]); return; }

  // Read index for conversation IDs, aggregate from meta.json
  const indexFile = path.join(dir, 'index.json');
  let convIds: string[] = [];
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    convIds = index.conversations || [];
  } catch {
    // Fallback: scan directories
    try {
      convIds = fs.readdirSync(dir).filter(f => {
        const stat = fs.statSync(path.join(dir, f));
        return stat.isDirectory() && fs.existsSync(path.join(dir, f, 'meta.json'));
      });
    } catch { /* empty */ }
  }

  // Aggregate from meta.json, sorted by time descending
  const conversations: Array<{
    id: string;
    session: string;
    started_at: string;
    ended_at: string;
    summary: string;
    turns: number;
    latest: string;
    latest_tokens: number;
    original_tokens: number;
    expand_count: number;
  }> = [];

  for (const id of convIds) {
    const meta = readMetaCached(path.join(dir, id));
    if (!meta) continue;
    const latestVersion = meta.versions[meta.latest];
    conversations.push({
      id,
      session: meta.session,
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

  // Sort by started_at descending
  conversations.sort((a, b) => b.started_at.localeCompare(a.started_at));

  // Pagination
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
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

  // Determine version to read
  let version = (req.query.version as string) || 'latest';
  if (version === 'latest') version = meta.latest;
  const versionEntry = meta.versions[version];
  if (!versionEntry) { res.status(404).json({ error: `Version ${version} not found` }); return; }

  // Read file content
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
    const turnRegex = /^## (U\d+|A\d+)/;
    const sections = content.split(/(?=^## )/m);
    content = sections.filter(section => {
      const match = section.match(turnRegex);
      return match && requestedTurns.includes(match[1]);
    }).join('\n');
  }

  // Record expand if requesting non-latest version
  const source = (req.query.source as string) === 'user' ? 'user' : 'llm';
  if (version !== meta.latest) {
    const record: ExpandRecord = {
      from: meta.latest,
      to: version,
      at: new Date().toISOString(),
      source,
    };

    if (source === 'llm') {
      meta.expand_stats.total_llm += 1;
      // Track per-turn expands
      if (turnsParam) {
        const requestedTurns = turnsParam.split(',').map(t => t.trim());
        for (const turn of requestedTurns) {
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

    try {
      writeMeta(convDir, meta);
      // Invalidate cache so next list request picks up updated expand stats
      metaCache.delete(convDir);
    } catch { /* non-fatal */ }
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

// ── DELETE /api/information/:projectId/conversations/:convId ──

router.delete('/:projectId/conversations/:convId', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const dir = infoDir(folder);
  const convDir = path.join(dir, req.params.convId);
  if (!fs.existsSync(convDir)) { res.status(404).json({ error: 'Conversation not found' }); return; }

  // Remove conversation directory
  try {
    fs.rmSync(convDir, { recursive: true, force: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete: ' + err.message });
    return;
  }

  // Remove from index
  try {
    const indexFile = path.join(dir, 'index.json');
    if (fs.existsSync(indexFile)) {
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
      index.conversations = (index.conversations || []).filter((id: string) => id !== req.params.convId);
      fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8');
    }
  } catch { /* non-fatal */ }

  res.json({ deleted: true });
});

// ── POST /api/information/:projectId/sync ──

router.post('/:projectId/sync', (req: AuthRequest, res: Response): void => {
  const folder = resolveProjectFolder(req.params.projectId, req.user?.username || '', res);
  if (!folder) return;

  const project = getProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const adapter = getAdapter(project.cliTool ?? 'claude');
  const result = compensationSync(
    folder,
    project.cliTool ?? 'claude',
    (line: string) => adapter.parseLineBlocks(line),
  );

  // Invalidate meta cache for this project (new conversations added)
  if (result.synced > 0) {
    const dir = infoDir(folder);
    for (const key of metaCache.keys()) {
      if (key.startsWith(dir)) metaCache.delete(key);
    }
  }

  res.json(result);
});

export default router;
