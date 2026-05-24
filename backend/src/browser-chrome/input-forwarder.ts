import type { Session } from './session-manager';
import { modLogger } from '../logger';

const log = modLogger('browser-chrome:input');

// Whitelist of modifier names accepted from the client. Anything else is
// silently dropped — defends against bogus values being passed straight
// to playwright's keyboard API.
const VALID_MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta'] as const;
type Modifier = typeof VALID_MODIFIERS[number];
const VALID_BUTTONS = ['left', 'right', 'middle'] as const;
type Button = typeof VALID_BUTTONS[number];

export type InputMsg =
  | { type: 'click'; x: number; y: number; button?: string; modifiers?: string[] }
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'key'; action: 'down' | 'up' | 'press'; key: string; modifiers?: string[] }
  | { type: 'type'; text: string }
  | { type: 'resize'; w: number; h: number }
  | { type: 'clipboard-read' };

/** Callback used by handlers that need to push a reply back to the client
 * out-of-band (e.g. clipboard-read returns the copied text). */
export type ReplyFn = (msg: object) => void;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sanitizeModifiers(arr?: string[]): Modifier[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((m): m is Modifier => (VALID_MODIFIERS as readonly string[]).includes(m));
}

function sanitizeButton(b?: string): Button {
  return (VALID_BUTTONS as readonly string[]).includes(b ?? '') ? (b as Button) : 'left';
}

export async function handleInput(session: Session, msg: InputMsg, reply?: ReplyFn): Promise<void> {
  session.lastActivityAt = Date.now();
  switch (msg.type) {
    case 'click': {
      const x = clamp(msg.x, 0, session.viewport.w);
      const y = clamp(msg.y, 0, session.viewport.h);
      const mods = sanitizeModifiers(msg.modifiers);
      for (const m of mods) await session.page.keyboard.down(m);
      try {
        await session.page.mouse.click(x, y, { button: sanitizeButton(msg.button) });
      } finally {
        for (const m of [...mods].reverse()) await session.page.keyboard.up(m).catch(() => {});
      }
      break;
    }
    case 'mousemove': {
      const x = clamp(msg.x, 0, session.viewport.w);
      const y = clamp(msg.y, 0, session.viewport.h);
      await session.page.mouse.move(x, y);
      break;
    }
    case 'scroll': {
      const x = clamp(msg.x, 0, session.viewport.w);
      const y = clamp(msg.y, 0, session.viewport.h);
      await session.page.mouse.move(x, y);
      await session.page.mouse.wheel(
        clamp(msg.deltaX, -10000, 10000),
        clamp(msg.deltaY, -10000, 10000),
      );
      break;
    }
    case 'key': {
      if (typeof msg.key !== 'string' || msg.key.length === 0 || msg.key.length > 32) return;
      const mods = sanitizeModifiers(msg.modifiers);
      // Hold modifiers, perform key action, release modifiers (in reverse).
      for (const m of mods) await session.page.keyboard.down(m);
      try {
        if (msg.action === 'down') await session.page.keyboard.down(msg.key);
        else if (msg.action === 'up') await session.page.keyboard.up(msg.key);
        else await session.page.keyboard.press(msg.key);
      } finally {
        for (const m of [...mods].reverse()) await session.page.keyboard.up(m).catch(() => {});
      }
      break;
    }
    case 'type': {
      if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > 1000) return;
      await session.page.keyboard.type(msg.text);
      break;
    }
    case 'resize': {
      const w = clamp(msg.w, 200, 3840);
      const h = clamp(msg.h, 200, 2160);
      await session.page.setViewportSize({ width: w, height: h });
      session.viewport = { w, h };
      log.info({ sid: session.sid, w, h }, 'viewport resized');
      break;
    }
    case 'clipboard-read': {
      if (!reply) return;
      // Pull the page's current text selection. `navigator.clipboard.readText`
      // in chromium headless is locked down (no user-gesture context that
      // CDP can fake reliably), so we read window.getSelection() which is
      // what the user logically wants after pressing Ctrl/Cmd+C on a real
      // selection. Empty string when nothing selected.
      let text = '';
      try {
        text = await session.page.evaluate(() => {
          const s = (globalThis as unknown as { getSelection?: () => { toString(): string } | null }).getSelection?.();
          return s ? s.toString() : '';
        });
      } catch {
        // page navigating / detached — return empty.
      }
      reply({ type: 'clipboard-text', text });
      break;
    }
  }
}
