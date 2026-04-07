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

function formatAssistantBlock(block: ChatBlock): string[] {
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
  return parts;
}

function formatChatBlocks(blocks: ChatBlock[]): { content: string; turns: number } {
  const lines: string[] = [];
  let userIdx = 0;
  let assistantIdx = 0;

  // Merge consecutive assistant blocks into one turn
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.role === 'user') {
      userIdx++;
      const textParts = block.blocks.filter(b => b.type === 'text').map(b => b.content);
      const text = textParts.join('\n').trim();
      if (text) {
        lines.push(`## U${userIdx}`);
        lines.push(text);
        lines.push('');
      }
      i++;
    } else if (block.role === 'assistant') {
      // Collect all consecutive assistant blocks
      const mergedParts: string[] = [];
      while (i < blocks.length && blocks[i].role === 'assistant') {
        mergedParts.push(...formatAssistantBlock(blocks[i]));
        i++;
      }
      if (mergedParts.length > 0) {
        assistantIdx++;
        lines.push(`## A${assistantIdx}`);
        lines.push(mergedParts.join('\n'));
        lines.push('');
      }
    } else {
      i++;
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
  const convId = jsonlName.replace(/\.(jsonl|json)$/, '');

  const dir = infoDir(projectFolder);
  fs.mkdirSync(dir, { recursive: true });
  const convDir = path.join(dir, convId);
  fs.mkdirSync(convDir, { recursive: true });

  // Format and write v0.md
  const { content, turns } = formatChatBlocks(chatBlocks);
  if (turns < 3) return null;

  const tokens = estimateTokens(content);

  // Read existing meta
  const existing = readMeta(convDir);

  // Read old v0 to detect changes
  const oldV0Path = path.join(convDir, 'v0.md');
  const hadOldV0 = existing && fs.existsSync(oldV0Path);
  let oldV0Content = '';
  if (hadOldV0) {
    try { oldV0Content = fs.readFileSync(oldV0Path, 'utf-8'); } catch { /* */ }
  }

  // Write new v0.md
  atomicWriteSync(path.join(convDir, 'v0.md'), content);

  // Turn ID mapping (old → new), used for vN updates and meta remapping
  let oldToNew: Map<string, string> | null = null;

  // Update vN files if they exist
  if (existing && hadOldV0) {
    // Build old turn ID → new turn ID mapping
    // Old v0 might have: U1, A1, A2, A3, U2, A4 (unmerged)
    // New v0 might have: U1, A1, U2, A2 (merged: old A1+A2+A3 → new A1, old A4 → new A2)
    // Strategy: parse both, align by user turns (U never merge), map assistant turns
    const oldSections = oldV0Content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
    const newSections = content.split(/(?=^## [UA]\d+)/m).filter(Boolean);

    // Build mapping: for each new section, what old sections does it correspond to?
    // New A sections between two U's correspond to all old A sections in the same gap
    const oldIds = oldSections.map(s => { const m = s.match(/^## ([UA]\d+)/); return m ? m[1] : ''; }).filter(Boolean);
    const newIds = newSections.map(s => { const m = s.match(/^## ([UA]\d+)/); return m ? m[1] : ''; }).filter(Boolean);

    // Map old turn IDs to new turn IDs by sequential alignment
    // Both sequences follow U-A-U-A pattern; user turns align 1:1, assistant turns between same user pair merge
    oldToNew = new Map<string, string>(); // old ID → new ID
    let oi = 0, ni = 0;
    while (oi < oldIds.length && ni < newIds.length) {
      if (oldIds[oi].startsWith('U') && newIds[ni].startsWith('U')) {
        oldToNew.set(oldIds[oi], newIds[ni]);
        oi++; ni++;
      } else if (oldIds[oi].startsWith('A') && newIds[ni].startsWith('A')) {
        // Map this old A and all consecutive old A's to this one new A
        const targetNewA = newIds[ni];
        while (oi < oldIds.length && oldIds[oi].startsWith('A')) {
          oldToNew.set(oldIds[oi], targetNewA);
          oi++;
        }
        ni++;
      } else if (oldIds[oi].startsWith('A')) {
        // Old has A but new has U — old A's before this U map to previous new A
        oi++;
      } else {
        ni++;
      }
    }

    // New sections that have no mapping from old = genuinely new turns
    const mappedNewIds = new Set(oldToNew.values());
    const appendSections = newSections.filter(s => {
      const m = s.match(/^## ([UA]\d+)/);
      return m && !mappedNewIds.has(m[1]);
    });

    // Build new v0 turn → token count map (for recalculating [cN,P%])
    const newV0Tokens = new Map<string, number>();
    for (const section of newSections) {
      const m = section.match(/^## ([UA]\d+).*\n/);
      if (m) {
        const body = section.slice(m[0].length).trim();
        newV0Tokens.set(m[1], estimateTokens(body));
      }
    }

    // Process vN files IN ORDER (v1 first, then v2, then v3...)
    // so that v2 can read v1's updated markers as its history chain.
    const sortedVersionKeys = Object.keys(existing.versions)
      .filter(k => k !== 'v0')
      .sort((a, b) => parseInt(a.replace('v', '')) - parseInt(b.replace('v', '')));

    // Track previous version's markers for building history chains
    // Start with v0 (no markers = 100% for all turns)
    let prevVersionMarkers = new Map<string, string>(); // newId → marker string (e.g. "[c1,60%]")

    for (const vkey of sortedVersionKeys) {
      const ventry = existing.versions[vkey];
      const vPath = path.join(convDir, ventry.file);
      if (!fs.existsSync(vPath)) continue;

      const level = parseInt(vkey.replace('v', '')) || 1;

      try {
        const vContent = fs.readFileSync(vPath, 'utf-8');
        const vSections = vContent.split(/(?=^## [UA]\d+)/m).filter(Boolean);

        // Merge bodies per new ID
        const mergedBodies = new Map<string, string>();
        const mergedOrder: string[] = [];
        for (const section of vSections) {
          const idMatch = section.match(/^## ([UA]\d+).*\n/);
          if (!idMatch) continue;
          const oldId = idMatch[1];
          const body = section.slice(idMatch[0].length);
          const newId = oldToNew!.get(oldId);
          if (!newId) continue;

          if (mergedBodies.has(newId)) {
            mergedBodies.set(newId, mergedBodies.get(newId)! + '\n' + body);
          } else {
            mergedBodies.set(newId, body);
            mergedOrder.push(newId);
          }
        }

        // Rebuild with markers: current level P% + history from previous version's markers
        const rebuilt: string[] = [];
        const thisVersionMarkers = new Map<string, string>();

        for (const newId of mergedOrder) {
          const body = mergedBodies.get(newId)!;
          const vTurnTokens = estimateTokens(body.trim());
          const origTokens = newV0Tokens.get(newId) ?? vTurnTokens;

          let marker = '';
          if (origTokens > 0 && vTurnTokens < origTokens * 0.95) {
            const pct = Math.round(vTurnTokens / origTokens * 100);
            // Get history chain from previous version's marker for this turn
            const prevMarker = prevVersionMarkers.get(newId) || '';
            const prevChain = prevMarker.replace(/^\[/, '').replace(/\]$/, '').trim();
            marker = prevChain
              ? ` [c${level},${pct}%;${prevChain}]`
              : ` [c${level},${pct}%]`;
          } else {
            // Not condensed at this level — carry forward previous version's marker
            const prevMarker = prevVersionMarkers.get(newId) || '';
            if (prevMarker) marker = ` ${prevMarker}`;
          }

          thisVersionMarkers.set(newId, marker.trim());
          rebuilt.push(`## ${newId}${marker}`);
          rebuilt.push(body);
          rebuilt.push('');
        }

        // Append genuinely new turns (raw, no markers)
        if (appendSections.length > 0) {
          rebuilt.push(...appendSections);
        }

        atomicWriteSync(vPath, rebuilt.join('\n'));
        prevVersionMarkers = thisVersionMarkers; // Pass to next version
      } catch { /* skip */ }
    }
  }

  const startedAt = chatBlocks[0]?.timestamp || new Date().toISOString();
  const endedAt = chatBlocks[chatBlocks.length - 1]?.timestamp || new Date().toISOString();

  const firstUserBlock = chatBlocks.find(b => b.role === 'user');
  const firstUserText = firstUserBlock?.blocks.find(b => b.type === 'text')?.content || '';
  const summary = firstUserText.slice(0, 50).replace(/\n/g, ' ').trim() || '(无摘要)';

  // Update token counts for all versions
  const updatedVersions: Record<string, any> = { ...(existing?.versions ?? {}), v0: { file: 'v0.md', tokens } };
  // Recount tokens for all vN files (they may have been merged/appended)
  if (existing) {
    for (const [vkey, ventry] of Object.entries(updatedVersions)) {
      if (vkey === 'v0') continue;
      const vPath = path.join(convDir, ventry.file);
      if (fs.existsSync(vPath)) {
        try {
          const vContent = fs.readFileSync(vPath, 'utf-8');
          updatedVersions[vkey] = { ...ventry, tokens: estimateTokens(vContent) };
        } catch { /* keep old count */ }
      }
    }
  }

  // Remap cohesion_map and expand_stats.by_turn if turn IDs changed
  let cohesionMap = existing?.cohesion_map ?? {};
  let expandStats = existing?.expand_stats ?? { total_llm: 0, total_user: 0, by_turn: {}, recent: [] };
  if (existing && hadOldV0) {
    // Check if oldToNew mapping exists (it's defined in the block above)
    // Rebuild cohesion_map with new IDs
    const oldCohesion = existing.cohesion_map ?? {};
    const newCohesion: Record<string, number | null> = {};
    for (const [oldId, val] of Object.entries(oldCohesion)) {
      const newId = oldToNew?.get(oldId);
      if (newId && !(newId in newCohesion)) newCohesion[newId] = val;
    }
    cohesionMap = newCohesion;

    // Rebuild expand_stats.by_turn with new IDs (sum counts for merged turns)
    const oldByTurn = existing.expand_stats?.by_turn ?? {};
    const newByTurn: Record<string, number> = {};
    for (const [oldId, count] of Object.entries(oldByTurn)) {
      const newId = oldToNew?.get(oldId);
      if (newId) newByTurn[newId] = (newByTurn[newId] ?? 0) + count;
    }
    expandStats = { ...expandStats, by_turn: newByTurn };
  }

  const meta: ConversationMeta = {
    jsonl_file: jsonlName,
    started_at: startedAt,
    ended_at: endedAt,
    turns,
    summary,
    original_tokens: tokens,
    sync_status: 'complete',
    versions: updatedVersions,
    latest: existing?.latest ?? 'v0',
    cohesion_map: cohesionMap,
    expand_stats: expandStats,
    reorganize_count: existing?.reorganize_count ?? 0,
    last_reorganize_at: existing?.last_reorganize_at ?? null,
  };
  writeMeta(convDir, meta);

  return convId;
}

/**
 * Collect all JSONL files for a project.
 * Claude: flat directory per project.
 * Codex: nested date dirs, filter by cwd in session_meta.
 */
function collectJsonlFiles(
  projectFolder: string,
  cliTool: string,
): string[] {
  const { getAdapter } = require('../adapters');
  const adapter = getAdapter(cliTool);

  // Codex has getSessionFilesForProject that filters by cwd
  if (typeof adapter.getSessionFilesForProject === 'function') {
    return adapter.getSessionFilesForProject(projectFolder);
  }

  // Claude/default: flat directory with session files belonging to this project
  const sessionDir = adapter.getSessionDir(projectFolder);
  if (!sessionDir || !fs.existsSync(sessionDir)) return [];
  const ext = typeof adapter.getSessionFileExtension === 'function'
    ? adapter.getSessionFileExtension()
    : '.jsonl';
  try {
    return fs.readdirSync(sessionDir)
      .filter(f => f.endsWith(ext))
      .map(f => path.join(sessionDir, f));
  } catch { return []; }
}

/**
 * Scan JSONL files and sync any not yet in .ccweb/information/.
 */
export function compensationSync(
  projectFolder: string,
  cliTool: string,
  parseLineBlocksFn: (line: string) => ChatBlock | null,
  force = false,
): { synced: number; updated: number; errors: number } {
  const jsonlFiles = collectJsonlFiles(projectFolder, cliTool);
  if (jsonlFiles.length === 0) return { synced: 0, updated: 0, errors: 0 };

  const dir = infoDir(projectFolder);
  const existingIds = new Set(listConversationIds(projectFolder));

  let synced = 0;
  let updated = 0;
  let errors = 0;

  for (const filePath of jsonlFiles) {
    const fileName = path.basename(filePath);
    const convId = fileName.replace(/\.(jsonl|json)$/, '');

    // Check if needs sync: new, JSONL newer than v0.md, or force
    const convDir = path.join(dir, convId);
    const isNew = !existingIds.has(convId);
    if (!isNew && !force) {
      try {
        const jsonlMtime = fs.statSync(filePath).mtimeMs;
        const v0Path = path.join(convDir, 'v0.md');
        if (fs.existsSync(v0Path)) {
          const v0Mtime = fs.statSync(v0Path).mtimeMs;
          if (jsonlMtime <= v0Mtime) continue;
        }
      } catch { /* sync anyway */ }
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      let blocks: ChatBlock[] = [];

      // Whole-file JSON tools (Gemini): use parseSessionFile
      const { getAdapter } = require('../adapters');
      const currentAdapter = getAdapter(cliTool);
      if (typeof currentAdapter.parseSessionFile === 'function') {
        blocks = currentAdapter.parseSessionFile(content);
      } else {
        // JSONL tools: parse line by line
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          const block = parseLineBlocksFn(line);
          if (block) blocks.push(block);
        }
      }
      const result = syncFromJsonl(projectFolder, filePath, blocks);
      if (result) {
        if (isNew) synced++; else updated++;
      }
    } catch {
      errors++;
    }
  }

  return { synced, updated, errors };
}
