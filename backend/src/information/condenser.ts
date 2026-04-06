// backend/src/information/condenser.ts
//
// Iterative condense and reorganize using Claude CLI (haiku).
// Implements: half-window segmentation, cohesion tracking, context summary injection,
// single-turn overflow handling, guard rails.

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { atomicWriteSync } from '../config';
import { readMeta, writeMeta } from './conversation-sync';
import { ConversationMeta } from './types';

// Haiku context: ~200K tokens. Half window for input, half for output.
const HALF_WINDOW_TOKENS = 80000;
// Keywords that mark uncondensable user turns
const UNCONDENSABLE_RE = /不要|别|错了|改成|不是这样|必须|禁止|永远不要|以后请/;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Claude CLI ──

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

// ── JSON parsing ──

interface HaikuTurnResult {
  turn: string;
  condensed: string | null;
  cohesion?: number;
}

function extractJsonArray(text: string): HaikuTurnResult[] {
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const start = cleaned.indexOf('[');
  if (start === -1) throw new Error('No JSON array found');

  let depth = 0;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '[') depth++;
    else if (cleaned[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) {
    cleaned = cleaned.slice(start);
    cleaned = cleaned.replace(/,\s*\{[^}]*$/, '') + ']';
  } else {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

// ── Turn parsing ──

interface Turn {
  id: string;       // "U1", "A3", etc.
  header: string;   // full "## U1 [c1,45%]" line
  body: string;     // content after header
  tokens: number;
  condensed: boolean; // has been condensed in a previous iteration
  cohesion: number | null;
}

function parseTurns(content: string): Turn[] {
  const sections = content.split(/(?=^## [UA]\d+)/m).filter(Boolean);
  return sections.map(s => {
    const match = s.match(/^(## [UA]\d+.*)\n/);
    if (!match) return null;
    const header = match[1];
    const id = header.replace(/^## /, '').split(/[\s\[]/)[0];
    const body = s.slice(match[0].length).trim();
    const hasMarker = /\[c\d+/.test(header);
    return { id, header, body, tokens: estimateTokens(body), condensed: hasMarker, cohesion: null };
  }).filter(Boolean) as Turn[];
}

function extractMarkerChain(header: string): string {
  const match = header.match(/\[(.+)\]\s*$/);
  return match ? match[1] : '';
}

// ── Prompt building ──

const CONDENSE_RULES = `你是一个对话缩减器。目标：大幅压缩对话，只保留对未来 LLM 行为有影响的信息。

## 必须激进缩减为一句话的内容（这些占对话的 80%+）：
- LLM 的工具调用和输出 → "执行了 X，结果：Y"
- 构建/发布日志 → "构建成功" 或 "发布 vX.Y.Z"
- 代码修改的详细描述 → "修改了 file.ts 的 funcName"
- 文件内容展示 → "读取了 file.ts"
- 搜索/grep 结果 → "搜索 X，找到 N 处"
- LLM 的解释性文字（"让我检查一下""我来看看"等） → 删除
- 重复的同类操作（多次发版、多次构建） → 只保留最后一次的结果

## 必须保留原文的内容（condensed 设为 null）：
- 用户纠正 LLM 的发言（"不对""错了""改成""不要"）
- 用户表达需求或偏好（"我希望""请实现""以后请"）
- 设计决策讨论（"为什么选 A 不选 B"）
- 错误诊断（"报错 X，原因是 Y"）
- 标记了 [已缩减] 的轮次

## 不得违反：
- 绝不改变语义方向（肯定↔否定）
- 保留版本号、文件路径等标识符

对每轮输出 JSON：
[{"turn":"U1","condensed":"缩减内容或null","cohesion":0.8},...]
cohesion: 与上一轮的话题相关性（0-1）`;

function buildSegmentPrompt(turns: Turn[], condensedUpTo: number, contextSummary: string): string {
  const parts: string[] = [CONDENSE_RULES, ''];

  if (contextSummary) {
    parts.push(`[前文摘要：${contextSummary}]`, '');
  }

  parts.push('对话：');
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (i < condensedUpTo) {
      // Already condensed in previous iteration — mark as [已缩减]
      parts.push(`## ${t.id} [已缩减]`);
      parts.push(t.body);
    } else {
      parts.push(`## ${t.id}`);
      parts.push(t.body);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// ── Context summary generation ──

function generateContextSummary(turns: Turn[]): string {
  // Take first sentence of each turn, max 5 turns
  const summaryParts: string[] = [];
  for (const t of turns.slice(0, 5)) {
    const firstSentence = t.body.split(/[。！？\n]/)[0].slice(0, 40);
    summaryParts.push(`${t.id}: ${firstSentence}`);
  }
  if (turns.length > 5) summaryParts.push(`...共${turns.length}轮`);
  return summaryParts.join('；');
}

// ── Select segment that fits in half window ──

function selectSegment(
  turns: Turn[],
  startIdx: number,
  halfWindow: number,
): { endIdx: number; totalTokens: number } {
  let total = 0;
  const promptOverhead = estimateTokens(CONDENSE_RULES) + 200; // rules + formatting
  total += promptOverhead;

  for (let i = startIdx; i < turns.length; i++) {
    const turnCost = turns[i].tokens + 20; // header + formatting overhead
    if (total + turnCost > halfWindow && i > startIdx) {
      // Ensure we end on a complete U-A pair
      let endIdx = i;
      // If endIdx splits a U-A pair (ends on U without A), back up one
      if (endIdx > startIdx && turns[endIdx - 1]?.id.startsWith('U')) {
        endIdx--;
      }
      return { endIdx: Math.max(startIdx + 2, endIdx), totalTokens: total };
    }
    total += turnCost;
  }
  return { endIdx: turns.length, totalTokens: total };
}

// ── Find lowest cohesion cut point ──

function findLowestCohesionCut(turns: Turn[], startIdx: number, endIdx: number): number {
  let minCohesion = 2;
  let cutIdx = Math.floor((startIdx + endIdx) / 2); // fallback: midpoint

  for (let i = startIdx + 2; i < endIdx; i += 2) { // step by 2 to cut at U-A pair boundaries
    const c = turns[i].cohesion;
    if (c !== null && c < minCohesion) {
      minCohesion = c;
      cutIdx = i;
    }
  }

  // If all cohesion > 0.8, use midpoint fallback
  if (minCohesion > 0.8) cutIdx = Math.floor((startIdx + endIdx) / 2);

  return cutIdx;
}

// ── Pre-truncate oversized single turn ──

function truncateTurn(turn: Turn, maxTokens: number): Turn {
  const headTokens = Math.floor(maxTokens * 0.7);
  const tailTokens = Math.floor(maxTokens * 0.2);
  const headChars = headTokens * 4;
  const tailChars = tailTokens * 4;
  const omitted = estimateTokens(turn.body) - maxTokens;
  const truncatedBody = turn.body.slice(0, headChars) +
    `\n\n[...省略约 ${omitted} tokens...]\n\n` +
    turn.body.slice(-tailChars);
  return { ...turn, body: truncatedBody, tokens: estimateTokens(truncatedBody) };
}

// ── Iterative condense ──
// Strategy: slide a window through turns. Each window includes:
//   1. Context prefix: last CONTEXT_OVERLAP condensed turns from previous window (marked [已缩减])
//   2. New turns to condense (fills remaining window space)
// Haiku sees the context to understand conversation flow, but only condenses new turns.

const CONTEXT_OVERLAP = 6; // number of condensed turns to carry as context
const BUDGET_FOR_CONTEXT = 8000; // max tokens for context prefix

async function iterativeCondense(
  turns: Turn[],
): Promise<{ condensedTurns: Turn[]; cohesionMap: Record<string, number | null> }> {
  const halfWindow = HALF_WINDOW_TOKENS;
  const cohesionMap: Record<string, number | null> = {};
  let condensedUpTo = 0;

  // Pre-truncate any single turn larger than half window
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].tokens > halfWindow * 0.8) {
      turns[i] = truncateTurn(turns[i], Math.floor(halfWindow * 0.7));
    }
  }

  console.log(`[condenser] starting iterative condense: ${turns.length} turns`);

  while (condensedUpTo < turns.length) {
    // 1. Build context prefix from last few condensed turns
    let contextTurns: Turn[] = [];
    let contextTokens = 0;
    if (condensedUpTo > 0) {
      const contextStart = Math.max(0, condensedUpTo - CONTEXT_OVERLAP);
      for (let i = contextStart; i < condensedUpTo; i++) {
        if (contextTokens + turns[i].tokens + 20 > BUDGET_FOR_CONTEXT) break;
        contextTurns.push(turns[i]);
        contextTokens += turns[i].tokens + 20;
      }
    }

    // Also prepend a summary of everything before the context window
    let contextSummary = '';
    const contextStartIdx = condensedUpTo > CONTEXT_OVERLAP ? condensedUpTo - CONTEXT_OVERLAP : 0;
    if (contextStartIdx > 0) {
      contextSummary = generateContextSummary(turns.slice(0, contextStartIdx));
    }

    // 2. Fill remaining window with new turns
    const availableForNew = halfWindow - contextTokens - estimateTokens(CONDENSE_RULES) - 500;
    let newEnd = condensedUpTo;
    let newTokens = 0;
    while (newEnd < turns.length) {
      const cost = turns[newEnd].tokens + 20;
      if (newTokens + cost > availableForNew && newEnd > condensedUpTo) break;
      newTokens += cost;
      newEnd++;
    }

    if (newEnd <= condensedUpTo) break; // Stuck — no new turns fit

    // 3. Build prompt: context (marked [已缩减]) + new turns (to condense)
    const segmentTurns = [...contextTurns, ...turns.slice(condensedUpTo, newEnd)];
    const prompt = buildSegmentPrompt(segmentTurns, contextTurns.length, contextSummary);

    // 4. Call Haiku
    const results = await callHaikuAndParse(prompt, turns, condensedUpTo, newEnd, condensedUpTo);
    applyResults(turns, results, condensedUpTo, newEnd, cohesionMap);

    console.log(`[condenser] iteration: turns ${condensedUpTo}-${newEnd} (context: ${contextTurns.length} turns), ${results.size} results from Haiku`);
    condensedUpTo = newEnd;
  }

  console.log(`[condenser] done: ${condensedUpTo}/${turns.length} turns processed`);
  return { condensedTurns: turns, cohesionMap };
}

async function callHaikuAndParse(
  prompt: string,
  allTurns: Turn[],
  segStart: number,
  segEnd: number,
  condensedUpTo: number,
): Promise<Map<string, HaikuTurnResult>> {
  let rawResult: string;
  try {
    rawResult = await callHaiku(prompt);
  } catch (err) {
    // On failure, skip this segment (leave turns as-is)
    console.error('[condenser] Haiku call failed:', err instanceof Error ? err.message : err);
    return new Map();
  }

  let parsed: HaikuTurnResult[];
  try {
    parsed = extractJsonArray(rawResult);
  } catch {
    console.error('[condenser] JSON parse failed, skipping segment');
    return new Map();
  }

  const resultMap = new Map<string, HaikuTurnResult>();
  for (const r of parsed) {
    resultMap.set(r.turn, r);
  }
  return resultMap;
}

function applyResults(
  turns: Turn[],
  results: Map<string, HaikuTurnResult>,
  condensedUpTo: number,
  segEnd: number,
  cohesionMap: Record<string, number | null>,
): void {
  for (let i = condensedUpTo; i < segEnd && i < turns.length; i++) {
    const t = turns[i];
    const r = results.get(t.id);

    // Record cohesion
    if (r?.cohesion !== undefined) {
      t.cohesion = r.cohesion;
      cohesionMap[t.id] = r.cohesion;
    }

    // Guard rail: protect uncondensable user turns
    if (t.id.startsWith('U') && UNCONDENSABLE_RE.test(t.body)) {
      t.condensed = true; // Mark as processed but keep original
      continue;
    }

    // Guard rail: already condensed turns must not be re-condensed
    if (t.condensed) continue;

    // Apply condensation
    if (r && r.condensed !== null && r.condensed !== undefined) {
      t.body = r.condensed;
      t.tokens = estimateTokens(r.condensed);
    }
    t.condensed = true;
  }
}

// ── Build final content with markers ──

function buildFinalContent(
  originalTurns: Turn[], // from v0.md (for token % calculation)
  condensedTurns: Turn[],
  prevMarkers: Map<string, string>,
  level: number,
): string {
  const lines: string[] = [];
  for (let i = 0; i < condensedTurns.length; i++) {
    const ct = condensedTurns[i];
    const ot = originalTurns.find(t => t.id === ct.id);
    const origTokens = ot ? ot.tokens : ct.tokens;
    const newTokens = ct.tokens;

    let marker = '';
    if (origTokens > 0 && newTokens < origTokens * 0.95) {
      // Content was actually condensed (>5% reduction)
      const pct = Math.round(newTokens / origTokens * 100);
      const prevChain = prevMarkers.get(ct.id) || '';
      marker = prevChain ? ` [c${level},${pct}%;${prevChain}]` : ` [c${level},${pct}%]`;
    } else {
      const existing = prevMarkers.get(ct.id);
      if (existing) marker = ` [${existing}]`;
    }

    lines.push(`## ${ct.id}${marker}`);
    lines.push(ct.body);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Public: condenseConversation ──

export async function condenseConversation(
  convDir: string,
): Promise<{ version: string; before_tokens: number; after_tokens: number } | null> {
  const meta = readMeta(convDir);
  if (!meta) return null;

  const latestEntry = meta.versions[meta.latest];
  if (!latestEntry) return null;
  const baseContent = fs.readFileSync(path.join(convDir, latestEntry.file), 'utf-8');
  const v0Content = fs.readFileSync(path.join(convDir, 'v0.md'), 'utf-8');

  const originalTurns = parseTurns(v0Content);
  const baseTurns = parseTurns(baseContent);

  // Build prev markers map
  const prevMarkers = new Map<string, string>();
  for (const t of baseTurns) {
    const chain = extractMarkerChain(t.header);
    if (chain) prevMarkers.set(t.id, chain);
  }

  // Run iterative condense on base turns (deep copy bodies)
  const workingTurns: Turn[] = baseTurns.map(t => ({ ...t, condensed: /\[c\d+/.test(t.header) }));
  const { condensedTurns, cohesionMap } = await iterativeCondense(workingTurns);

  // Determine next version
  const versionNumbers = Object.keys(meta.versions).map(v => parseInt(v.replace('v', ''))).filter(n => !isNaN(n));
  const nextNum = Math.max(...versionNumbers) + 1;
  const nextVersion = `v${nextNum}`;

  // Build final content with markers
  const condensedContent = buildFinalContent(originalTurns, condensedTurns, prevMarkers, nextNum);
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
  // Merge cohesion map
  meta.cohesion_map = { ...meta.cohesion_map, ...cohesionMap };
  writeMeta(convDir, meta);

  return { version: nextVersion, before_tokens: beforeTokens, after_tokens: afterTokens };
}

// ── Public: reorganizeConversation ──

export async function reorganizeConversation(
  convDir: string,
): Promise<{ version: string; before_tokens: number; after_tokens: number; high_attention_turns: string[] } | null> {
  const meta = readMeta(convDir);
  if (!meta) return null;
  if (meta.reorganize_count >= 2) return null;

  const byTurn = meta.expand_stats.by_turn;
  const v0Content = fs.readFileSync(path.join(convDir, 'v0.md'), 'utf-8');
  const originalTurns = parseTurns(v0Content);

  const highAttention: string[] = [];
  const lowAttention: string[] = [];
  const neverAccessed: string[] = [];
  for (const turn of originalTurns) {
    const count = byTurn[turn.id] || 0;
    if (count >= 3) highAttention.push(turn.id);
    else if (count >= 1) lowAttention.push(turn.id);
    else neverAccessed.push(turn.id);
  }
  if (highAttention.length === 0) return null;

  const workingTurns: Turn[] = originalTurns.map(t => ({ ...t, condensed: false }));
  const highSet = new Set(highAttention);
  const halfWindow = HALF_WINDOW_TOKENS;
  let condensedUpTo = 0;
  const cohesionMap: Record<string, number | null> = {};

  // Pre-truncate oversized turns
  for (let i = 0; i < workingTurns.length; i++) {
    if (workingTurns[i].tokens > halfWindow * 0.8) {
      workingTurns[i] = truncateTurn(workingTurns[i], Math.floor(halfWindow * 0.7));
    }
  }

  // Iterative sliding window (same strategy as condense)
  while (condensedUpTo < workingTurns.length) {
    let contextTurns: Turn[] = [];
    let contextTokens = 0;
    if (condensedUpTo > 0) {
      const ctxStart = Math.max(0, condensedUpTo - CONTEXT_OVERLAP);
      for (let i = ctxStart; i < condensedUpTo; i++) {
        if (contextTokens + workingTurns[i].tokens + 20 > BUDGET_FOR_CONTEXT) break;
        contextTurns.push(workingTurns[i]);
        contextTokens += workingTurns[i].tokens + 20;
      }
    }

    let contextSummary = '';
    const ctxStartIdx = condensedUpTo > CONTEXT_OVERLAP ? condensedUpTo - CONTEXT_OVERLAP : 0;
    if (ctxStartIdx > 0) contextSummary = generateContextSummary(workingTurns.slice(0, ctxStartIdx));

    const reorgRulesTokens = 600; // approximate
    const availableForNew = halfWindow - contextTokens - reorgRulesTokens - estimateTokens(CONDENSE_RULES);
    let newEnd = condensedUpTo;
    let newTokens = 0;
    while (newEnd < workingTurns.length) {
      const cost = workingTurns[newEnd].tokens + 20;
      if (newTokens + cost > availableForNew && newEnd > condensedUpTo) break;
      newTokens += cost;
      newEnd++;
    }
    if (newEnd <= condensedUpTo) break;

    // Build reorganize prompt with attention hints
    const promptParts = [
      `你是一个对话重整器。基于使用数据，激进缩减对话。`,
      ``,
      `高关注轮次（用户反复查看，保留更多细节）：${highAttention.join(', ')}`,
      `低关注轮次（大幅缩减为一句话）：${lowAttention.join(', ')}`,
      `从未访问的轮次（高度缩减为几个字）：${neverAccessed.join(', ')}`,
      ``,
      `## 必须激进缩减的内容：`,
      `- 工具调用和输出 → "执行了 X，结果：Y"`,
      `- 构建/发布日志 → "构建成功" 或 "发布 vX.Y.Z"`,
      `- 代码修改描述 → "修改了 file.ts"`,
      `- 文件内容展示 → "读取了 file.ts"`,
      `- LLM 解释性文字（"让我检查""我来看看"） → 删除`,
      ``,
      `## 必须保留原文（condensed 设为 null）：`,
      `- 高关注轮次中的用户需求和决策讨论`,
      `- 用户纠正/否定（"不对""错了""改成"）`,
      `- 标记了 [已缩减] 的轮次`,
      ``,
      `## 不得违反：绝不改变语义方向，保留版本号和文件路径`,
      ``,
      `对每轮输出 JSON：[{"turn":"U1","condensed":"缩减内容或null","cohesion":0.8},...]`,
    ];
    if (contextSummary) promptParts.push(``, `[前文摘要：${contextSummary}]`);
    promptParts.push(``, `对话：`);
    for (const ct of contextTurns) { promptParts.push(`## ${ct.id} [已缩减]`, ct.body, ''); }
    for (let i = condensedUpTo; i < newEnd; i++) { promptParts.push(`## ${workingTurns[i].id}`, workingTurns[i].body, ''); }

    const results = await callHaikuAndParse(promptParts.join('\n'), workingTurns, condensedUpTo, newEnd, condensedUpTo);

    for (let i = condensedUpTo; i < newEnd && i < workingTurns.length; i++) {
      const t = workingTurns[i];
      const r = results.get(t.id);
      if (r?.cohesion !== undefined) { t.cohesion = r.cohesion; cohesionMap[t.id] = r.cohesion; }
      if (t.condensed) continue;
      if (t.id.startsWith('U') && UNCONDENSABLE_RE.test(t.body)) { t.condensed = true; continue; }
      if (highSet.has(t.id)) { t.condensed = true; continue; }
      if (r && r.condensed !== null && r.condensed !== undefined) {
        t.body = r.condensed;
        t.tokens = estimateTokens(r.condensed);
      }
      t.condensed = true;
    }
    condensedUpTo = newEnd;
  }

  // Build final
  const versionNumbers = Object.keys(meta.versions).map(v => parseInt(v.replace('v', ''))).filter(n => !isNaN(n));
  const nextNum = Math.max(...versionNumbers) + 1;
  const nextVersion = `v${nextNum}`;

  const condensedContent = buildFinalContent(originalTurns, workingTurns, new Map(), nextNum);
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
  meta.cohesion_map = { ...meta.cohesion_map, ...cohesionMap };
  writeMeta(convDir, meta);

  return { version: nextVersion, before_tokens: beforeTokens, after_tokens: afterTokens, high_attention_turns: highAttention };
}
