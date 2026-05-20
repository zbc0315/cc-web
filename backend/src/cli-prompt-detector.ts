/**
 * CLI Interactive Prompt Detector
 *
 * Claude Code CLI (and likely other Ink-TUI CLI tools) renders interactive
 * select menus through ANSI escape sequences on the PTY. These do NOT show
 * up as stream-json lines, so the ChatOverlay (which only consumes JSON via
 * adapter.parseLineBlocks) is blind to them. The user is then stuck in the
 * terminal panel without knowing it from the chat-only view.
 *
 * This module is a passive PTY-output sniffer that watches for known menu
 * fingerprints (currently only Claude's `--continue` resume menu) and emits
 * `cli_prompt_detected` / `cli_prompt_dismissed` lifecycle events. The
 * ChatOverlay then renders interactive choice buttons whose labels mirror
 * the menu options — the click handler hits a backend API that writes the
 * chosen digit straight to the PTY.
 *
 * Why digits parsed from the menu, not hard-coded 1/2/3:
 *  CLAUDE.md 历史教训 #10 — wrapping external CLIs is bypass, not root-cause.
 *  If Claude CLI ever reorders the menu, hard-coded `1 = Resume summary` would
 *  silently mis-select. Instead we parse "<digit>. <label>" lines out of the
 *  ANSI-stripped buffer and bind buttons to the digit-label pairs we actually
 *  saw. If parsing fails (CLI changed format wholesale), we emit nothing —
 *  the user falls back to the terminal panel, which is the pre-feature state.
 *
 * State machine: per-project ring buffer of recent (ANSI-stripped) PTY output;
 * on every feed() we re-evaluate "any fingerprint visible + options parsable?"
 * and emit only on transitions (debounced — no per-chunk spam).
 */

import { EventEmitter } from 'events';

const BUFFER_CAP_CHARS = 8 * 1024;

/** Public event union (mirrors approval-manager style). */
export type CliPromptEvent =
  | {
      type: 'cli_prompt_detected';
      projectId: string;
      kind: CliPromptKind;
      /** Best-effort human label for the menu (en/zh-agnostic). */
      label: string;
      /** Parsed digit-label pairs the user can choose between. */
      options: CliPromptOption[];
      detectedAt: number;
    }
  | {
      type: 'cli_prompt_dismissed';
      projectId: string;
      kind: CliPromptKind;
    };

export type CliPromptKind = 'claude_resume_session';

export interface CliPromptOption {
  /** The digit shown next to the option in the menu (typically 1-based). */
  digit: number;
  /** Human label after the digit, e.g. "Resume from summary". */
  label: string;
  /** Highlighted by ❯ or marked "(recommended)" — UI default-focus hint. */
  recommended: boolean;
}

interface Fingerprint {
  kind: CliPromptKind;
  label: string;
  /** All phrases must appear in the buffer for a positive detection. */
  phrases: string[];
  /** Minimum number of parsed options required to consider this menu valid. */
  minOptions: number;
}

/**
 * Stable fingerprints — chosen to be robust against minor wording drift:
 *  - "Resume from summary" / "Resume full session" / "Don't ask me again"
 *    are the three menu options. Requiring ALL THREE makes false positives
 *    near-impossible (no normal conversation hits this combo) while still
 *    tolerating any single line being reworded one release at a time.
 */
const FINGERPRINTS: Fingerprint[] = [
  {
    kind: 'claude_resume_session',
    label: 'Claude 会话恢复选项',
    phrases: ['Resume from summary', 'Resume full session', "Don't ask me again"],
    minOptions: 2,
  },
];

/**
 * Strip ANSI CSI sequences (\x1b[...m / \x1b[...K / \x1b[...A / etc.)
 * Doesn't try to interpret cursor movement — Ink redraws the whole menu
 * every keystroke so the latest text always lands in the buffer anyway.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

/**
 * Parse menu options out of the ANSI-stripped buffer.
 *
 * Matches lines shaped like:
 *   "  1. Resume from summary (recommended)"
 *   "  ❯ 2. Resume full session as-is"
 *
 * Returns options keyed by parsed digit, latest occurrence wins (Ink redraws
 * the same menu repeatedly as the user navigates with ↑/↓; the *latest* slice
 * of buffer reflects the current state including which option is highlighted).
 */
export function parseOptions(buffer: string): CliPromptOption[] {
  // ❯ = ❯; allowed leading whitespace; capture digit + label.
  // Use [ \t]* to NOT cross newlines and keep matches per-line.
  const re = /^[ \t]*(❯|>)?[ \t]*(\d+)\.[ \t]+(.+?)[ \t]*$/gm;
  const byDigit = new Map<number, CliPromptOption>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(buffer)) !== null) {
    const marker = m[1];
    const digit = Number(m[2]);
    const rawLabel = m[3] ?? '';
    if (!Number.isFinite(digit) || digit <= 0) continue;
    const isRecommended = marker === '❯' || /\(recommended\)/i.test(rawLabel);
    // Strip the "(recommended)" tag from the human label — the flag carries
    // that semantic; keeping it in the label would also clutter the button.
    const cleanLabel = rawLabel.replace(/\s*\(recommended\)\s*$/i, '').trim();
    if (!cleanLabel) continue;
    byDigit.set(digit, { digit, label: cleanLabel, recommended: isRecommended });
  }
  return [...byDigit.values()].sort((a, b) => a.digit - b.digit);
}

interface ActiveState {
  kind: CliPromptKind;
  label: string;
  detectedAt: number;
  options: CliPromptOption[];
}

interface ProjectState {
  buffer: string;
  active: ActiveState | null;
}

class CliPromptDetector extends EventEmitter {
  private readonly states = new Map<string, ProjectState>();

  /**
   * Feed a chunk of raw PTY output. Synchronous, side-effect: may emit
   * 'cli_prompt_detected' or 'cli_prompt_dismissed' on state transitions.
   */
  feed(projectId: string, raw: string): void {
    const stripped = stripAnsi(raw);
    if (!stripped) return;

    let state = this.states.get(projectId);
    if (!state) {
      state = { buffer: '', active: null };
      this.states.set(projectId, state);
    }

    state.buffer += stripped;
    if (state.buffer.length > BUFFER_CAP_CHARS) {
      state.buffer = state.buffer.slice(state.buffer.length - BUFFER_CAP_CHARS);
    }

    const match = this.matchFingerprint(state.buffer);
    if (match) {
      // codex P1-1（跨帧混拼）已审：parseOptions 用 latest-wins by digit，
      // Ink 每帧重绘整段时新行覆盖旧行；唯一残留风险是 PTY chunk 撕开一帧
      // 中间到达（极罕见，多数实现按行 flush）。即使发生，UI 展示和后端
      // 校验同一份 options，行为一致；不修这个为 lastAnchor slice，因为
      // anchor 选最后一个 phrase 出现位置会切掉前面的 option 行（test 验证）。
      const options = parseOptions(state.buffer);
      if (options.length < match.fp.minOptions) {
        // Phrases visible but we can't read the options off the screen.
        // Stay silent — see CLAUDE.md 历史教训 #10. If currently active,
        // do NOT dismiss yet either: the menu is plausibly still up, options
        // just got obscured by redraw. Buffer-rolloff handles real dismissal.
        return;
      }
      if (!state.active) {
        const detectedAt = Date.now();
        state.active = { kind: match.fp.kind, label: match.fp.label, detectedAt, options };
        this.emit('event', {
          type: 'cli_prompt_detected',
          projectId,
          kind: match.fp.kind,
          label: match.fp.label,
          options,
          detectedAt,
        } satisfies CliPromptEvent);
      } else if (!sameOptions(state.active.options, options)) {
        // Same menu still up but options shifted (different "recommended"
        // highlight, or upstream tweaked label wording mid-session). Update
        // in place; clients re-render from the new options array. No
        // dismissed/detected pair so the card doesn't flicker.
        state.active = { ...state.active, options };
        this.emit('event', {
          type: 'cli_prompt_detected',
          projectId,
          kind: match.fp.kind,
          label: match.fp.label,
          options,
          detectedAt: state.active.detectedAt,
        } satisfies CliPromptEvent);
      }
    } else if (state.active) {
      const prev = state.active;
      state.active = null;
      this.emit('event', {
        type: 'cli_prompt_dismissed',
        projectId,
        kind: prev.kind,
      } satisfies CliPromptEvent);
    }
  }

  /** Drop all state for a project (call on terminal exit / project delete). */
  reset(projectId: string): void {
    const state = this.states.get(projectId);
    if (state?.active) {
      this.emit('event', {
        type: 'cli_prompt_dismissed',
        projectId,
        kind: state.active.kind,
      } satisfies CliPromptEvent);
    }
    this.states.delete(projectId);
  }

  /**
   * Snapshot of the currently active prompt for a project, if any. Used by
   * the REST endpoint that lets the frontend re-sync after WS reconnect /
   * page refresh — without it, a client that misses the transition emit
   * would never know the CLI is still waiting for input.
   */
  getActive(projectId: string): ActiveState | null {
    return this.states.get(projectId)?.active ?? null;
  }

  private matchFingerprint(buffer: string): { fp: Fingerprint } | null {
    for (const fp of FINGERPRINTS) {
      if (fp.phrases.every((p) => buffer.includes(p))) return { fp };
    }
    return null;
  }
}

function sameOptions(a: CliPromptOption[], b: CliPromptOption[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.digit !== y.digit || x.label !== y.label || x.recommended !== y.recommended) return false;
  }
  return true;
}

export const cliPromptDetector = new CliPromptDetector();
