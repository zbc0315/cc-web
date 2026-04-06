// backend/src/information/conversation-sync.ts

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteSync } from '../config';
import { ChatBlock, ChatBlockItem } from '../session-manager';
import { ConversationMeta, ConversationIndex } from './types';

const INFO_DIR = 'information';
const INDEX_FILE = 'index.json';
const MAX_TOOL_INPUT = 50;
const MAX_TOOL_OUTPUT = 100;

// ── Helpers ──

export function infoDir(projectFolder: string): string {
  return path.join(projectFolder, '.ccweb', INFO_DIR);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readIndex(dir: string): ConversationIndex {
  const file = path.join(dir, INDEX_FILE);
  if (!fs.existsSync(file)) return { version: 1, conversations: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { version: 1, conversations: [] };
  }
}

function writeIndex(dir: string, index: ConversationIndex): void {
  atomicWriteSync(path.join(dir, INDEX_FILE), JSON.stringify(index, null, 2));
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

// ── Format ChatBlocks → v0.md content ──

function formatToolBlock(item: ChatBlockItem): string {
  // tool_use: content is "toolName(inputJson)"
  // tool_result: content is the result text
  const content = item.content;
  if (item.type === 'tool_use') {
    // Truncate: "Bash(npm run build --very-long...)" → "[工具] Bash(npm run build --ve...)"
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
        // skip thinking blocks
      }
      // Flush any pending tool_use without result
      if (pendingTool) parts.push(pendingTool + ' → [无结果]');

      if (parts.length === 0) continue;
      lines.push(`## A${assistantIdx}`);
      lines.push(parts.join('\n'));
      lines.push('');
    }
  }

  // Ensure turn counts match (U and A should pair up)
  const turns = Math.max(userIdx, assistantIdx);
  return { content: lines.join('\n'), turns };
}

// ── Sync a conversation ──

export function syncConversation(
  projectFolder: string,
  sessionId: string,
  chatBlocks: ChatBlock[],
): string | null {
  if (chatBlocks.length < 3) return null; // Too short

  const dir = infoDir(projectFolder);
  fs.mkdirSync(dir, { recursive: true });

  // Check if already synced
  const index = readIndex(dir);

  // Generate conversation ID: {date}_{shortSessionId}
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // 2026-04-05
  const shortId = sessionId.slice(-8) || now.getTime().toString(36);
  const convId = `${dateStr}_${shortId}`;

  // Skip if this session is already synced (check by session ID in existing metas)
  for (const existingId of index.conversations) {
    const existingMeta = readMeta(path.join(dir, existingId));
    if (existingMeta && existingMeta.session === sessionId) {
      return existingId; // Already synced
    }
  }

  // Format conversation
  const { content, turns } = formatChatBlocks(chatBlocks);
  if (turns < 2) return null; // Need at least 1 U-A pair

  const tokens = estimateTokens(content);

  // Determine timestamps from chat blocks
  const startedAt = chatBlocks[0]?.timestamp || now.toISOString();
  const endedAt = chatBlocks[chatBlocks.length - 1]?.timestamp || now.toISOString();

  // Generate summary: first user message, truncated to 50 chars
  const firstUserBlock = chatBlocks.find(b => b.role === 'user');
  const firstUserText = firstUserBlock?.blocks.find(b => b.type === 'text')?.content || '';
  const summary = firstUserText.slice(0, 50).replace(/\n/g, ' ').trim() || '(无摘要)';

  // Create conversation directory
  const convDir = path.join(dir, convId);
  fs.mkdirSync(convDir, { recursive: true });

  // Write v0.md
  atomicWriteSync(path.join(convDir, 'v0.md'), content);

  // Write meta.json
  const meta: ConversationMeta = {
    session: sessionId,
    started_at: startedAt,
    ended_at: endedAt,
    turns,
    summary,
    original_tokens: tokens,
    sync_status: 'complete',
    versions: {
      v0: { file: 'v0.md', tokens },
    },
    latest: 'v0',
    cohesion_map: {},
    expand_stats: {
      total_llm: 0,
      total_user: 0,
      by_turn: {},
      recent: [],
    },
    reorganize_count: 0,
    last_reorganize_at: null,
  };
  writeMeta(convDir, meta);

  // Update index
  if (!index.conversations.includes(convId)) {
    index.conversations.push(convId);
    writeIndex(dir, index);
  }

  return convId;
}

/**
 * Check if a session has already been synced.
 */
export function isSessionSynced(projectFolder: string, sessionId: string): boolean {
  const dir = infoDir(projectFolder);
  const index = readIndex(dir);
  for (const convId of index.conversations) {
    const meta = readMeta(path.join(dir, convId));
    if (meta && meta.session === sessionId) return true;
  }
  return false;
}
