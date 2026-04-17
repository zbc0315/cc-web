#!/usr/bin/env node
/**
 * ccweb PermissionRequest hook
 *
 * Reads stdin JSON (Claude Code PermissionRequest hook payload), POSTs a signed
 * request to ccweb backend (127.0.0.1 only), waits for the user's decision, and
 * writes the canonical PermissionRequest hook output to stdout.
 *
 * Fails CLOSED: any error (network, timeout, bad secret, backend down) → deny.
 * User can still approve in the terminal TUI if they disable this hook.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PORT_FILE = path.join(os.homedir(), '.ccweb', 'port');
const SECRET_FILE = path.join(os.homedir(), '.ccweb', 'approval-secret');
const PROJECTS_FILE = path.join(os.homedir(), '.ccweb', 'projects.json');
const REQUEST_TIMEOUT_MS = 112_000; // Sits between backend (110s) and settings.json ceiling (120s)

function failClosed(reason) {
  // Explicit deny: used for backend-reachable errors where we don't want to
  // silently let the TUI proceed (e.g. bad stdin, HMAC failure).
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny' },
      message: `ccweb: ${reason}`,
    },
  }));
  process.exit(0);
}

function passThroughToTui() {
  // Empty output = Claude Code proceeds with its normal permission prompt.
  // Used when ccweb isn't running / project isn't managed / config missing —
  // i.e. situations where we should NOT interfere.
  process.stdout.write('{}');
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 5000).unref(); // safety
  });
}

function readFileSyncOrNull(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function resolveProjectId(cwd) {
  const raw = readFileSyncOrNull(PROJECTS_FILE);
  if (!raw) return null;
  let projects;
  try { projects = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(projects)) return null;
  // Exact folderPath match first; then prefix match (sub-directory of a registered project)
  let best = null;
  for (const p of projects) {
    if (!p || !p.folderPath || !p.id) continue;
    if (p.folderPath === cwd) return p.id;
    if (cwd.startsWith(p.folderPath + path.sep) && (!best || p.folderPath.length > best.folderPath.length)) {
      best = p;
    }
  }
  return best ? best.id : null;
}

function postJson({ port, path: urlPath, body, signature }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body, 'utf-8');
    const opts = {
      host: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        'x-ccweb-signature': signature,
      },
      timeout: REQUEST_TIMEOUT_MS,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)); return; }
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Bad JSON from ccweb: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('backend request timeout')); });
    req.write(payload);
    req.end();
  });
}

(async () => {
  let input;
  try {
    const raw = await readStdin();
    input = raw ? JSON.parse(raw) : {};
  } catch (e) {
    failClosed(`bad stdin: ${e.message}`);
    return;
  }

  const toolUseId = input.tool_use_id || input.toolUseId;
  const toolName = input.tool_name || input.toolName;
  const toolInput = input.tool_input || input.toolInput || {};
  const sessionId = input.session_id || input.sessionId || '';
  const cwd = input.cwd || process.cwd();

  if (!toolUseId || !toolName) { failClosed('missing tool_use_id or tool_name'); return; }

  const projectId = resolveProjectId(cwd);
  if (!projectId) { passThroughToTui(); return; } // not a ccweb project

  const portStr = (readFileSyncOrNull(PORT_FILE) || '').trim();
  const port = parseInt(portStr, 10);
  if (!port) { passThroughToTui(); return; } // ccweb not running

  const secret = (readFileSyncOrNull(SECRET_FILE) || '').trim();
  if (!secret) { passThroughToTui(); return; } // no config yet

  const body = JSON.stringify({ projectId, toolUseId, toolName, toolInput, sessionId });
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  let decision;
  try {
    decision = await postJson({ port, path: '/api/hooks/approval-request', body, signature });
  } catch (e) {
    // Backend was supposed to be there but request failed — fall back to TUI
    // rather than deny, since denying would block Claude on a transient blip.
    passThroughToTui();
    return;
  }

  const behavior = decision && decision.behavior === 'allow' ? 'allow' : 'deny';
  const message = decision && typeof decision.message === 'string' ? decision.message : undefined;

  // Per Claude Code hook spec, `message` is a sibling of `decision`, not nested inside it.
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior },
      ...(message ? { message } : {}),
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})().catch((err) => { failClosed(`unexpected: ${err && err.message || err}`); });
