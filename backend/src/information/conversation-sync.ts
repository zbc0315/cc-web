// backend/src/information/conversation-sync.ts
//
// One JSONL file = one conversation directory.
// ID = JSONL filename (without .jsonl).
// Stop hook overwrites v0.md each time (JSONL is append-only with --continue).

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteSync } from '../config';
import { ChatBlock, ChatBlockItem } from '../session-manager';
import { ConversationMeta } from './types';

const INFO_DIR = 'information';
const MAX_TOOL_INPUT = 50;
const MAX_TOOL_OUTPUT = 100;

// ── Helpers ──

export function infoDir(projectFolder: string): string {
  return path.join(projectFolder, '.ccweb', INFO_DIR);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function readMeta(convDir: string): ConversationMeta | null {
  const file = path.join(convDir, 'meta.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeMeta(convDir: string, meta: ConversationMeta): void {
  atomicWriteSync(path.join(convDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

/** List all conversation IDs by scanning the information directory. */
export function listConversationIds(projectFolder: string): string[] {
  const dir = infoDir(projectFolder);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter(f => {
      try {
        return fs.statSync(path.join(dir, f)).isDirectory()
          && fs.existsSync(path.join(dir, f, 'meta.json'));
      } catch { return false; }
    });
  } catch { return []; }
}

// ── Format ChatBlocks → v0.md content ──

function formatToolBlock(item: ChatBlockItem): string {
  const content = item.content;
  if (item.type === 'tool_use') {
    const parenIdx = content.indexOf('(');
    if (parenIdx !== -1) {
      const name = content.slice(0, parenIdx);
      let input = content.slice(parenIdx + 1).replace(/\)$/, '');
      if (input.length > MAX_TOOL_INPUT) input = input.slice(0, MAX_TOOL_INPUT) + '...';
      return `[工具] ${name}(${input})`;
    }
    return `[工具] ${content.slice(0, MAX_TOOL_INPUT + MAX_TOOL_OUTPUT)}`;
  }
  if (item.type === 'tool_result') {
    let result = content.replace(/\n/g, ' ').trim();
    if (result.length > MAX_TOOL_OUTPUT) result = result.slice(0, MAX_TOOL_OUTPUT) + '...';
    return ` → ${result}`;
  }
  return content;
}

function formatChatBlocks(blocks: ChatBlock[]): { content: string; turns: number } {
  const lines: string[] = [];
  let userIdx = 0;
  let assistantIdx = 0;

  for (const block of blocks) {
    if (block.role === 'user') {
      userIdx++;
      const textParts = block.blocks.filter(b => b.type === 'text').map(b => b.content);
      const text = textParts.join('\n').trim();
      if (!text) continue;
      lines.push(`## U${userIdx}`);
      lines.push(text);
      lines.push('');
    } else if (block.role === 'assistant') {
      assistantIdx++;
      const parts: string[] = [];
      let pendingTool = '';

      for (const item of block.blocks) {
        if (item.type === 'text') {
          const text = item.content.trim();
          if (text) parts.push(text);
        } else if (item.type === 'tool_use') {
          pendingTool = formatToolBlock(item);
        } else if (item.type === 'tool_result') {
          if (pendingTool) {
            parts.push(pendingTool + formatToolBlock(item));
            pendingTool = '';
          } else {
            parts.push(`[工具结果] ${item.content.slice(0, MAX_TOOL_OUTPUT)}`);
          }
        }
      }
      if (pendingTool) parts.push(pendingTool + ' → [无结果]');
      if (parts.length === 0) continue;
      lines.push(`## A${assistantIdx}`);
      lines.push(parts.join('\n'));
      lines.push('');
    }
  }

  return { content: lines.join('\n'), turns: Math.max(userIdx, assistantIdx) };
}

// ── Sync a conversation from JSONL ──

/**
 * Sync a JSONL file to .ccweb/information/{jsonlId}/.
 * Overwrites v0.md if already exists (JSONL may have grown via --continue).
 * Returns conversation ID or null if too short.
 */
export function syncFromJsonl(
  projectFolder: string,
  jsonlPath: string,
  chatBlocks: ChatBlock[],
): string | null {
  if (chatBlocks.length < 6) return null; // Need at least 3 U-A pairs

  const jsonlName = path.basename(jsonlPath);
  const convId = jsonlName.replace('.jsonl', '');

  const dir = infoDir(projectFolder);
  fs.mkdirSync(dir, { recursive: true });
  const convDir = path.join(dir, convId);
  fs.mkdirSync(convDir, { recursive: true });

  // Format and write v0.md
  const { content, turns } = formatChatBlocks(chatBlocks);
  if (turns < 3) return null;

  const tokens = estimateTokens(content);
  atomicWriteSync(path.join(convDir, 'v0.md'), content);

  // Read existing meta or create new
  const existing = readMeta(convDir);
  const startedAt = chatBlocks[0]?.timestamp || new Date().toISOString();
  const endedAt = chatBlocks[chatBlocks.length - 1]?.timestamp || new Date().toISOString();

  const firstUserBlock = chatBlocks.find(b => b.role === 'user');
  const firstUserText = firstUserBlock?.blocks.find(b => b.type === 'text')?.content || '';
  const summary = firstUserText.slice(0, 50).replace(/\n/g, ' ').trim() || '(无摘要)';

  const meta: ConversationMeta = {
    jsonl_file: jsonlName,
    started_at: startedAt,
    ended_at: endedAt,
    turns,
    summary,
    original_tokens: tokens,
    sync_status: 'complete',
    versions: {
      ...(existing?.versions ?? {}),
      v0: { file: 'v0.md', tokens },
    },
    latest: existing?.latest ?? 'v0',
    cohesion_map: existing?.cohesion_map ?? {},
    expand_stats: existing?.expand_stats ?? { total_llm: 0, total_user: 0, by_turn: {}, recent: [] },
    reorganize_count: existing?.reorganize_count ?? 0,
    last_reorganize_at: existing?.last_reorganize_at ?? null,
  };
  writeMeta(convDir, meta);

  return convId;
}

/**
 * Scan JSONL directory and sync any not yet in .ccweb/information/.
 */
export function compensationSync(
  projectFolder: string,
  cliTool: string,
  parseLineBlocksFn: (line: string) => ChatBlock | null,
): { synced: number; updated: number; errors: number } {
  const { getAdapter } = require('../adapters');
  const adapter = getAdapter(cliTool);
  const sessionDir = adapter.getSessionDir(projectFolder);
  if (!sessionDir || !fs.existsSync(sessionDir)) return { synced: 0, updated: 0, errors: 0 };

  const dir = infoDir(projectFolder);
  const existingIds = new Set(listConversationIds(projectFolder));

  let synced = 0;
  let updated = 0;
  let errors = 0;

  try {
    const jsonlFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'));

    for (const fileName of jsonlFiles) {
      const convId = fileName.replace('.jsonl', '');
      const filePath = path.join(sessionDir, fileName);

      // Check if needs sync: new or JSONL is newer than v0.md
      const convDir = path.join(dir, convId);
      const isNew = !existingIds.has(convId);
      if (!isNew) {
        try {
          const jsonlMtime = fs.statSync(filePath).mtimeMs;
          const v0Path = path.join(convDir, 'v0.md');
          if (fs.existsSync(v0Path)) {
            const v0Mtime = fs.statSync(v0Path).mtimeMs;
            if (jsonlMtime <= v0Mtime) continue; // Already up to date
          }
        } catch { /* sync anyway */ }
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const blocks: ChatBlock[] = [];
        for (const line of lines) {
          const block = parseLineBlocksFn(line);
          if (block) blocks.push(block);
        }
        const result = syncFromJsonl(projectFolder, filePath, blocks);
        if (result) {
          if (isNew) synced++; else updated++;
        }
      } catch {
        errors++;
      }
    }
  } catch { /* dir not readable */ }

  return { synced, updated, errors };
}
