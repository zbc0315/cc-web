import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { DATA_DIR } from './config';
import { modLogger } from './logger';

const log = modLogger('login-events');

export interface LoginEvent {
  username: string;
  ip: string;
  userAgent: string;
  at: string; // ISO timestamp
  /** Audit only. Absent on the real-time 'login' event (always a success). */
  result?: 'success' | 'fail';
}

/**
 * Emitted on every successful login. index.ts subscribes and pushes a
 * `login_alert` to all live alert-WS sockets of the SAME user, so any other
 * device/tab gets a real-time popup — mirrors the syncEvents/cliPromptDetector
 * pattern so route handlers don't need access to the WS registry.
 */
class LoginEvents extends EventEmitter {}
export const loginEvents = new LoginEvents();

const AUDIT_FILE = path.join(DATA_DIR, 'login-audit.jsonl');

/**
 * Append a durable, rotation-proof record of the login. The daily rolling
 * logs already carry `successful login` lines, but those age out; this
 * append-only file is the long-term forensic trail of who logged in from
 * which IP. Login events are rare, so unbounded growth is a non-issue.
 */
export function recordLoginAudit(ev: LoginEvent): void {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(ev) + '\n', 'utf-8');
  } catch (err) {
    log.warn({ err }, 'failed to append login audit');
  }
}
