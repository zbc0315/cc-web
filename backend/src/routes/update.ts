import { Router, Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuthRequest } from '../auth';
import { getProjects, isAdminUser } from '../config';
import { terminalManager } from '../terminal-manager';

const DATA_DIR = process.env.CCWEB_DATA_DIR || path.join(os.homedir(), '.ccweb');
const UPDATE_STATUS_FILE = path.join(DATA_DIR, 'update-status.json');
const UPDATE_AGENT_LOG = path.join(DATA_DIR, 'update-agent.log');

const router = Router();

const MEMORY_SAVE_COMMAND =
  '请更新与本项目相关的全部记忆、工作计划、已完成工作、未完成工作和后台任务\r';

// Idle = no PTY output for this many ms
const IDLE_THRESHOLD_MS = 5000;
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120000; // 2 minutes max per project

interface ProjectUpdateStatus {
  id: string;
  name: string;
  status: 'skipped' | 'command_sent' | 'waiting_idle' | 'stopped' | 'ready' | 'error';
  message?: string;
}

/**
 * GET /api/update/check-version
 * Queries npm registry for the latest version. Returns { current, latest, updateAvailable }.
 */
router.get('/check-version', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isAdminUser(req.user?.username)) { res.status(403).json({ error: 'Admin only' }); return; }
  try {
    const pkgPath = path.join(__dirname, '../../../package.json');
    const current = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch('https://registry.npmjs.org/@tom2012/cc-web/latest', { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`npm registry ${resp.status}`);
    const data = await resp.json() as { version?: string };
    const latest = data.version || current;
    const updateAvailable = latest !== current;
    res.json({ current, latest, updateAvailable });
  } catch (err) {
    res.status(502).json({ error: `Failed to check npm registry: ${err instanceof Error ? err.message : err}` });
  }
});

/**
 * GET /api/update/check-running
 * Returns list of running projects so the frontend can warn the user.
 */
router.get('/check-running', (req: AuthRequest, res: Response): void => {
  if (!isAdminUser(req.user?.username)) { res.status(403).json({ error: 'Admin only' }); return; }
  const projects = getProjects();
  const running = projects.filter(
    (p) => p.status === 'running' && terminalManager.hasTerminal(p.id)
  );
  res.json({
    runningCount: running.length,
    projects: running.map((p) => ({ id: p.id, name: p.name, status: p.status })),
  });
});

/**
 * POST /api/update/prepare
 * For each running project:
 *   1. Send memory-save command to Claude
 *   2. Wait until Claude goes idle (no PTY output for IDLE_THRESHOLD_MS)
 * Returns per-project status.
 */
router.post('/prepare', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isAdminUser(req.user?.username)) { res.status(403).json({ error: 'Admin only' }); return; }
  const projects = getProjects();
  const running = projects.filter(
    (p) => p.status === 'running' && terminalManager.hasTerminal(p.id)
  );

  if (running.length === 0) {
    res.json({ success: true, results: [], message: 'No running projects' });
    return;
  }

  const results: ProjectUpdateStatus[] = [];

  for (const project of running) {
    const status: ProjectUpdateStatus = {
      id: project.id,
      name: project.name,
      status: 'command_sent',
    };

    try {
      // 1. Send the memory-save command
      terminalManager.writeRaw(project.id, MEMORY_SAVE_COMMAND);
      status.status = 'waiting_idle';

      // 2. Wait for Claude to finish processing (go idle)
      const idle = await waitForIdle(project.id, IDLE_THRESHOLD_MS, MAX_WAIT_MS);
      if (!idle) {
        status.status = 'ready';
        status.message = 'Timed out waiting for idle — will resume after update';
      } else {
        status.status = 'ready';
        status.message = 'Memory saved — will resume after update';
      }

      // Do NOT stop terminals — they keep 'running' status so resumeAll()
      // can restart them with --continue after the server restarts.
    } catch (err) {
      status.status = 'error';
      status.message = err instanceof Error ? err.message : 'Unknown error';
    }

    results.push(status);
  }

  res.json({ success: true, results });
});

/**
 * Wait until a terminal has been idle (no PTY output) for `idleMs` milliseconds.
 * Returns true if idle was detected, false if `timeoutMs` exceeded.
 */
function waitForIdle(projectId: string, idleMs: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let intervalTimer: ReturnType<typeof setInterval> | null = null;

    const done = (result: boolean) => {
      if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
      clearTimeout(startDelay);
      clearTimeout(safetyTimer);
      resolve(result);
    };

    // Give Claude a moment to start processing before checking idle
    const startDelay = setTimeout(() => {
      intervalTimer = setInterval(() => {
        if (Date.now() > deadline) { done(false); return; }
        if (!terminalManager.hasTerminal(projectId)) { done(true); return; }
        const lastActivity = terminalManager.getLastActivityAt(projectId);
        if (lastActivity !== null && Date.now() - lastActivity >= idleMs) { done(true); }
      }, POLL_INTERVAL_MS);
    }, 3000);

    // Safety: if deadline passes before interval starts, resolve false
    const safetyTimer = setTimeout(() => done(false), timeoutMs + 100);
  });
}

let updateInProgress = false;

/**
 * POST /api/update/execute
 * Admin-only. Spawns a detached updater agent, then shuts down the server.
 * The agent waits for exit, runs npm install -g, and restarts ccweb.
 */
router.post('/execute', (req: AuthRequest, res: Response): void => {
  if (!isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  if (updateInProgress) {
    res.status(409).json({ error: 'Update already in progress' });
    return;
  }

  const accessMode = process.env.CCWEB_ACCESS_MODE || 'local';
  const serverPid = process.pid;
  const previousVersion = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'));
      return pkg.version || 'unknown';
    } catch { return 'unknown'; }
  })();

  // Clean up any stale status file
  try { fs.unlinkSync(UPDATE_STATUS_FILE); } catch { /**/ }

  // Build the inline agent script — runs in a separate Node process, survives server exit
  const agentScript = `
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_PID = ${serverPid};
const ACCESS_MODE = ${JSON.stringify(accessMode)};
const STATUS_FILE = ${JSON.stringify(UPDATE_STATUS_FILE)};
const PREV_VERSION = ${JSON.stringify(previousVersion)};
const PKG = '@tom2012/cc-web';

function writeStatus(obj) {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2)); } catch(e) { console.error('writeStatus failed:', e); }
}

// 1. Wait for server to exit (max 30s)
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const os = require('os');
const HOME = os.homedir();
try { process.chdir(HOME); } catch (e) { /* already chdir'd via spawn cwd */ }

const { spawnSync: _sleep } = require('child_process');
let waited = 0;
while (isAlive(SERVER_PID) && waited < 30000) {
  _sleep('sleep', ['0.5'], { stdio: 'ignore', cwd: HOME });
  waited += 500;
}
if (isAlive(SERVER_PID)) {
  writeStatus({ success: false, error: 'Server did not exit within 30s', completedAt: Date.now(), previousVersion: PREV_VERSION });
  process.exit(1);
}

// 2. npm install
let newVersion = PREV_VERSION;
let installOk = false;
try {
  console.log('Running npm install -g ' + PKG + '@latest ...');
  execSync('npm install -g ' + PKG + '@latest --include=dev', { timeout: 300000, stdio: 'inherit', cwd: HOME });
  try { newVersion = execSync('npm info ' + PKG + ' version', { encoding: 'utf-8', cwd: HOME }).trim(); } catch {}
  console.log('Update complete: ' + PREV_VERSION + ' -> ' + newVersion);
  installOk = true;
} catch (err) {
  const msg = err.stderr ? err.stderr.toString().slice(0, 500) : String(err);
  writeStatus({ success: false, error: 'npm install failed: ' + msg, completedAt: Date.now(), previousVersion: PREV_VERSION });
  console.error('npm install failed, attempting restart of old version...');
}

// 3. Write success status only if install succeeded
if (installOk) {
  writeStatus({ success: true, completedAt: Date.now(), previousVersion: PREV_VERSION, newVersion: newVersion });
}

// 4. Restart (attempt even on failure — old version may still work)
try {
  var mode = ACCESS_MODE;
  if (['local','lan','public'].indexOf(mode) === -1) mode = 'local';
  // Resolve absolute path to ccweb binary (npm global bin)
  var npmBin = '';
  try { npmBin = execSync('npm bin -g', { encoding: 'utf-8', cwd: HOME }).trim(); } catch {
    try { npmBin = execSync('npm prefix -g', { encoding: 'utf-8', cwd: HOME }).trim() + '/bin'; } catch {}
  }
  var ccwebBin = npmBin ? npmBin + '/ccweb' : 'ccweb';
  console.log('Restarting ccweb: ' + ccwebBin + ' start --daemon --' + mode);
  var spawnSync2 = require('child_process').spawnSync;
  var result = spawnSync2(ccwebBin, ['start', '--daemon', '--' + mode], { timeout: 30000, stdio: 'inherit', cwd: HOME });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error('ccweb exited with code ' + result.status);
  }
  console.log('ccweb restarted successfully');
} catch (err) {
  console.error('Restart failed:', (err && err.message) || err);
  writeStatus({ success: false, error: 'Restart failed: ' + ((err && err.message) || err), completedAt: Date.now(), previousVersion: PREV_VERSION, newVersion: newVersion });
}
`.trim();

  // Spawn detached agent
  try {
    const logFd = fs.openSync(UPDATE_AGENT_LOG, 'a');
    const child = spawn(process.execPath, ['-e', agentScript], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: os.homedir(),
      env: { ...process.env, HOME: os.homedir(), PATH: process.env.PATH },
    });
    child.unref();
    try { fs.closeSync(logFd); } catch { /**/ }
  } catch (err) {
    res.status(500).json({ error: `Failed to spawn updater: ${err instanceof Error ? err.message : err}` });
    return;
  }

  updateInProgress = true;
  res.json({ status: 'updating', previousVersion });

  // Trigger graceful shutdown after response is flushed
  setTimeout(() => {
    process.kill(process.pid, 'SIGUSR2');
  }, 500);
});

/**
 * GET /api/update/status
 * Returns the update result written by the updater agent.
 */
router.get('/status', (_req: AuthRequest, res: Response): void => {
  try {
    if (!fs.existsSync(UPDATE_STATUS_FILE)) {
      res.json(null);
      return;
    }
    const content = JSON.parse(fs.readFileSync(UPDATE_STATUS_FILE, 'utf-8'));
    res.json(content);
    // Clean up after reading a terminal state (success or failure)
    if (content && (content.success === true || content.success === false)) {
      try { fs.unlinkSync(UPDATE_STATUS_FILE); } catch { /**/ }
    }
  } catch {
    res.json(null);
  }
});

export default router;
