// backend/src/information/condenser.ts
//
// Condense and reorganize conversations using Claude CLI (haiku).

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { atomicWriteSync } from '../config';
import { readMeta, writeMeta } from './conversation-sync';
import { ConversationMeta, VersionEntry } from './types';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Call Claude CLI in non-interactive mode with haiku. */
function callHaiku(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('claude', ['-p', prompt, '--model', 'haiku'],
      { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      }
    );
  });
}

/** Extract JSON array from Haiku response (handles code fences, extra text). */
function extractJsonArray(text: string): { turn: string; condensed: string | null }[] {
  // Strip markdown code fences
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  // Try to find the JSON array
  const start = cleaned.indexOf('[');
  if (start === -1) throw new Error('No JSON array found');

  // Find matching closing bracket
  let depth = 0;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '[') depth++;
    else if (cleaned[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) {
    // Array was truncated — try to repair by closing it
    cleaned = cleaned.slice(start) + ']';
    // Remove any trailing incomplete object
    cleaned = cleaned.replace(/,\s*\{[^}]*$/, ']');
  } else {
    cleaned = cleaned.slice(start, end + 1);
  }

  return JSON.parse(cleaned);
}

/** Parse v0.md into turn sections. */
function parseTurns(content: string): { id: string; header: string; body: string }[] {
  const sections = content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
  return sections.map(s => {
    const match = s.match(/^(## [UA]\d+.*)\n/);
    if (!match) return { id: '', header: '', body: s };
    return { id: match[1].replace(/^## /, '').split(/[\s\[]/)[0], header: match[1], body: s.slice(match[0].length).trim() };
  }).filter(t => t.id);
}

/** Build condensed content from turns with [cN,P%] markers. */
function buildCondensedContent(
  originalTurns: { id: string; body: string }[],
  condensedBodies: Map<string, string | null>, // turnId → condensed text (null = keep original)
  prevMarkers: Map<string, string>, // turnId → existing marker chain from previous version
  level: number,
): string {
  const lines: string[] = [];
  for (const turn of originalTurns) {
    const condensed = condensedBodies.get(turn.id);
    const body = condensed ?? turn.body;
    const origTokens = estimateTokens(turn.body);
    const newTokens = estimateTokens(body);

    let marker = '';
    if (condensed !== null && condensed !== undefined) {
      // This turn was condensed
      const pct = origTokens > 0 ? Math.round(newTokens / origTokens * 100) : 100;
      const prevChain = prevMarkers.get(turn.id) || '';
      marker = prevChain ? ` [c${level},${pct}%;${prevChain}]` : ` [c${level},${pct}%]`;
    } else {
      // Keep existing marker from previous version
      const existing = prevMarkers.get(turn.id);
      if (existing) marker = ` [${existing}]`;
    }

    lines.push(`## ${turn.id}${marker}`);
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n');
}

/** Extract existing [cN,P%] marker chain from a header. */
function extractMarkerChain(header: string): string {
  const match = header.match(/\[(.+)\]\s*$/);
  return match ? match[1] : '';
}

// ── Condense ──

export async function condenseConversation(
  convDir: string,
): Promise<{ version: string; before_tokens: number; after_tokens: number } | null> {
  const meta = readMeta(convDir);
  if (!meta) return null;

  // Read the latest version as base
  const latestEntry = meta.versions[meta.latest];
  if (!latestEntry) return null;
  const baseContent = fs.readFileSync(path.join(convDir, latestEntry.file), 'utf-8');

  // Read original for token comparison
  const v0Content = fs.readFileSync(path.join(convDir, 'v0.md'), 'utf-8');
  const originalTurns = parseTurns(v0Content);
  const baseTurns = parseTurns(baseContent);

  // Build prev markers map
  const prevMarkers = new Map<string, string>();
  for (const t of baseTurns) {
    const chain = extractMarkerChain(t.header);
    if (chain) prevMarkers.set(t.id, chain);
  }

  // Build prompt
  const prompt = `你是一个对话缩减器。对以下对话的每一轮进行缩减。

判断标准：如果未来的 LLM 只看到缩减后的版本，行为是否会与看到原文时不同？
- 不同 → 保留原文
- 相同 → 大幅缩减

硬性规则：
1. 用户纠正/否定行为的发言 → 必须保留原文
2. 绝不改变语义方向（肯定↔否定）
3. 保留所有数字、标识符、文件路径
4. 构建/部署日志 → 一句话结果
5. 确认性回复 → 保留原文

对每轮输出 JSON 数组：
[{"turn":"U1","condensed":"缩减后的内容或null表示保留原文"},...]

对话（如果过长已截取最近部分）：
${baseContent.length > 40000 ? '...[前文已省略]\n\n' + baseContent.slice(-40000) : baseContent}`;

  let result: string;
  try {
    result = await callHaiku(prompt);
  } catch (err) {
    throw new Error('Claude CLI 调用失败: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Parse JSON from response (handles code fences, truncation)
  let condensedArray: { turn: string; condensed: string | null }[];
  try {
    condensedArray = extractJsonArray(result);
  } catch (parseErr) {
    throw new Error('无法解析 Haiku 返回的 JSON: ' + (parseErr instanceof Error ? parseErr.message : ''));
  }

  // Build condensed bodies map
  const condensedBodies = new Map<string, string | null>();
  for (const item of condensedArray) {
    condensedBodies.set(item.turn, item.condensed);
  }

  // Guard rail: protect uncondensable turns
  for (const turn of originalTurns) {
    if (turn.id.startsWith('U')) {
      const body = turn.body.toLowerCase();
      if (/不要|别|错了|改成|不是|必须|禁止/.test(body)) {
        condensedBodies.set(turn.id, null); // Force keep original
      }
    }
  }

  // Determine next version number
  const versionNumbers = Object.keys(meta.versions)
    .map(v => parseInt(v.replace('v', '')))
    .filter(n => !isNaN(n));
  const nextNum = Math.max(...versionNumbers) + 1;
  const nextVersion = `v${nextNum}`;

  // Build condensed content
  const condensedContent = buildCondensedContent(originalTurns, condensedBodies, prevMarkers, nextNum);
  const afterTokens = estimateTokens(condensedContent);
  const beforeTokens = latestEntry.tokens;

  // Write file
  const fileName = `${nextVersion}.md`;
  atomicWriteSync(path.join(convDir, fileName), condensedContent);

  // Update meta
  meta.versions[nextVersion] = {
    file: fileName,
    tokens: afterTokens,
    created_at: new Date().toISOString(),
    action: 'condense',
    base: meta.latest,
  };
  meta.latest = nextVersion;
  writeMeta(convDir, meta);

  return { version: nextVersion, before_tokens: beforeTokens, after_tokens: afterTokens };
}

// ── Reorganize ──

export async function reorganizeConversation(
  convDir: string,
): Promise<{ version: string; before_tokens: number; after_tokens: number; high_attention_turns: string[] } | null> {
  const meta = readMeta(convDir);
  if (!meta) return null;
  if (meta.reorganize_count >= 2) return null; // Max 2 reorganizations

  // Classify turns by expand stats
  const byTurn = meta.expand_stats.by_turn;
  const highAttention: string[] = [];
  const lowAttention: string[] = [];
  const neverAccessed: string[] = [];

  const v0Content = fs.readFileSync(path.join(convDir, 'v0.md'), 'utf-8');
  const originalTurns = parseTurns(v0Content);

  for (const turn of originalTurns) {
    const count = byTurn[turn.id] || 0;
    if (count >= 3) highAttention.push(turn.id);
    else if (count >= 1) lowAttention.push(turn.id);
    else neverAccessed.push(turn.id);
  }

  if (highAttention.length === 0) return null; // Nothing to reorganize

  const prompt = `你是一个对话重整器。以下对话被缩减后，用户反复需要展开某些轮次。
请从原始对话重新生成缩减版，调整策略：

高关注轮次（保留更多细节）：${highAttention.join(', ')}
低关注轮次（大幅缩减）：${lowAttention.join(', ')}
从未访问的轮次（高度缩减为一句话）：${neverAccessed.join(', ')}

硬性规则：
1. 用户纠正/否定行为的发言 → 必须保留原文
2. 绝不改变语义方向
3. 保留所有数字、标识符、文件路径

对每轮输出 JSON 数组：
[{"turn":"U1","condensed":"缩减后的内容或null表示保留原文"},...]

原始对话：
${v0Content.length > 40000 ? '...[前文已省略]\n\n' + v0Content.slice(-40000) : v0Content}`;

  let result: string;
  try {
    result = await callHaiku(prompt);
  } catch (err) {
    throw new Error('Claude CLI 调用失败: ' + (err instanceof Error ? err.message : String(err)));
  }

  let condensedArray: { turn: string; condensed: string | null }[];
  try {
    condensedArray = extractJsonArray(result);
  } catch (parseErr) {
    throw new Error('无法解析 Haiku 返回的 JSON: ' + (parseErr instanceof Error ? parseErr.message : ''));
  }

  const condensedBodies = new Map<string, string | null>();
  for (const item of condensedArray) {
    condensedBodies.set(item.turn, item.condensed);
  }

  // Guard rail
  for (const turn of originalTurns) {
    if (turn.id.startsWith('U') && /不要|别|错了|改成|不是|必须|禁止/.test(turn.body.toLowerCase())) {
      condensedBodies.set(turn.id, null);
    }
  }

  const versionNumbers = Object.keys(meta.versions)
    .map(v => parseInt(v.replace('v', '')))
    .filter(n => !isNaN(n));
  const nextNum = Math.max(...versionNumbers) + 1;
  const nextVersion = `v${nextNum}`;

  const condensedContent = buildCondensedContent(originalTurns, condensedBodies, new Map(), nextNum);
  const afterTokens = estimateTokens(condensedContent);
  const latestEntry = meta.versions[meta.latest];
  const beforeTokens = latestEntry?.tokens ?? meta.original_tokens;

  const fileName = `${nextVersion}.md`;
  atomicWriteSync(path.join(convDir, fileName), condensedContent);

  meta.versions[nextVersion] = {
    file: fileName,
    tokens: afterTokens,
    created_at: new Date().toISOString(),
    action: 'reorganize',
    base: 'v0',
    high_attention_turns: highAttention,
  };
  meta.latest = nextVersion;
  meta.reorganize_count += 1;
  meta.last_reorganize_at = new Date().toISOString();
  writeMeta(convDir, meta);

  return { version: nextVersion, before_tokens: beforeTokens, after_tokens: afterTokens, high_attention_turns: highAttention };
}
