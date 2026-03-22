#!/usr/bin/env node
'use strict';

const { fork, execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

// ── Paths ─────────────────────────────────────────────────────────────────────

const PKG_ROOT = path.join(__dirname, '..');
const BACKEND_ENTRY = path.join(PKG_ROOT, 'backend', 'dist', 'index.js');
const BACKEND_DIR = path.join(PKG_ROOT, 'backend');

/** All user data lives in ~/.ccweb — survives package updates */
const DATA_DIR = path.join(os.homedir(), '.ccweb');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PID_FILE = path.join(DATA_DIR, 'ccweb.pid');
const PORT_FILE = path.join(DATA_DIR, 'ccweb.port');
const LOG_FILE = path.join(DATA_DIR, 'ccweb.log');
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');

const LAUNCHD_LABEL = 'com.ccweb.server';
const LAUNCHD_PLIST = path.join(
  os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`
);
const SYSTEMD_SERVICE = path.join(
  os.homedir(), '.config', 'systemd', 'user', 'ccweb.service'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); } catch { return {}; }
}

function savePrefs(updates) {
  ensureDataDir();
  const prefs = { ...readPrefs(), ...updates };
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch { return null; }
}

function readPort() {
  try {
    const port = parseInt(fs.readFileSync(PORT_FILE, 'utf-8').trim(), 10);
    return isNaN(port) ? null : port;
  } catch { return null; }
}

function isProcessRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getStatus() {
  const pid = readPid();
  if (!pid) return { running: false };
  if (!isProcessRunning(pid)) {
    try { fs.unlinkSync(PID_FILE); } catch {}
    try { fs.unlinkSync(PORT_FILE); } catch {}
    return { running: false };
  }
  return { running: true, pid, port: readPort() };
}

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultVal !== undefined ? ` (default: ${defaultVal})` : '';
    rl.question(question + hint + ': ', (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(question, defaultYes = true) {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${hint} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') execSync(`open ${url}`, { stdio: 'ignore' });
    else if (process.platform === 'win32') execSync(`start "" "${url}"`, { shell: true, stdio: 'ignore' });
    else execSync(`xdg-open ${url}`, { stdio: 'ignore' });
  } catch { /* ignore — browser open is best-effort */ }
}

// ── Dependency check ─────────────────────────────────────────────────────────

function checkDependencies() {
  // If backend dist doesn't exist, offer to build
  if (!fs.existsSync(BACKEND_ENTRY)) {
    console.error('Backend not built. Run: npm run build\n');
    console.error(`(from: ${PKG_ROOT})`);
    process.exit(1);
  }

  // If backend node_modules doesn't exist, install them
  if (!fs.existsSync(path.join(BACKEND_DIR, 'node_modules'))) {
    console.log('Installing backend dependencies (first run)...');
    try {
      execSync('npm install --production', { cwd: BACKEND_DIR, stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to install dependencies:', err.message);
      process.exit(1);
    }
  }
}

function requireBcrypt() {
  // Try backend's bcryptjs first, then global
  for (const p of [
    path.join(BACKEND_DIR, 'node_modules', 'bcryptjs'),
    'bcryptjs',
  ]) {
    try { return require(p); } catch {}
  }
  console.error('bcryptjs not found. Please run: npm install (in the backend directory)');
  process.exit(1);
}

// ── Setup wizard ──────────────────────────────────────────────────────────────

async function runSetup() {
  console.log('\n=== CCWeb Setup ===\n');

  let username = await ask('Username', 'admin');
  if (!username) username = 'admin';

  let password;
  while (true) {
    password = await ask('Password (min 6 chars)');
    if (password.length >= 6) break;
    console.log('  Password must be at least 6 characters.');
  }

  const bcrypt = requireBcrypt();
  const passwordHash = bcrypt.hashSync(password, 12);
  const jwtSecret = crypto.randomBytes(64).toString('hex');

  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ username, passwordHash, jwtSecret }, null, 2), { mode: 0o600 });

  console.log(`\nCredentials saved (data dir: ${DATA_DIR})`);
  console.log(`Username: ${username}\n`);
}

// ── Auto-start ────────────────────────────────────────────────────────────────

async function enableAutoStart() {
  const nodePath = process.execPath;
  const scriptPath = fs.realpathSync(process.argv[1]);

  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>       <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>start</string>
    <string>--daemon</string>
  </array>
  <key>RunAtLoad</key>   <true/>
  <key>KeepAlive</key>   <false/>
  <key>StandardOutPath</key>  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>`;

    fs.mkdirSync(path.dirname(LAUNCHD_PLIST), { recursive: true });
    fs.writeFileSync(LAUNCHD_PLIST, plist, 'utf-8');
    try {
      execSync(`launchctl load "${LAUNCHD_PLIST}"`, { stdio: 'ignore' });
      console.log('Auto-start enabled (macOS launchd).');
    } catch {
      console.log(`Plist saved. Enable with:\n  launchctl load "${LAUNCHD_PLIST}"`);
    }

  } else if (process.platform === 'linux') {
    const service = [
      '[Unit]',
      'Description=CCWeb Server',
      '',
      '[Service]',
      `ExecStart=${nodePath} ${scriptPath} start --daemon`,
      `Environment=HOME=${os.homedir()}`,
      'Restart=no',
      '',
      '[Install]',
      'WantedBy=default.target',
    ].join('\n');

    fs.mkdirSync(path.dirname(SYSTEMD_SERVICE), { recursive: true });
    fs.writeFileSync(SYSTEMD_SERVICE, service, 'utf-8');
    try {
      execSync('systemctl --user daemon-reload && systemctl --user enable ccweb', { stdio: 'ignore' });
      console.log('Auto-start enabled (systemd user service).');
    } catch {
      console.log(`Service saved. Enable with:\n  systemctl --user enable ccweb`);
    }

  } else {
    console.log('Auto-start is not yet supported on Windows.');
  }

  savePrefs({ autoStartConfigured: true });
}

async function disableAutoStart() {
  if (process.platform === 'darwin') {
    try { execSync(`launchctl unload "${LAUNCHD_PLIST}"`, { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(LAUNCHD_PLIST); } catch {}
    console.log('Auto-start disabled.');
  } else if (process.platform === 'linux') {
    try { execSync('systemctl --user disable ccweb', { stdio: 'ignore' }); } catch {}
    try { fs.unlinkSync(SYSTEMD_SERVICE); } catch {}
    console.log('Auto-start disabled.');
  }
  savePrefs({ autoStartConfigured: true });
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

async function startServer(opts = {}) {
  checkDependencies();
  ensureDataDir();

  // Already running?
  const status = getStatus();
  if (status.running) {
    console.log(`CCWeb is already running — http://localhost:${status.port}  (PID ${status.pid})`);
    if (opts.open !== false) openBrowser(`http://localhost:${status.port}`);
    return;
  }

  // First-time setup
  if (!fs.existsSync(CONFIG_FILE)) {
    await runSetup();

    // Ask about auto-start (only on first run)
    const prefs = readPrefs();
    if (!prefs.autoStartConfigured) {
      const doAutoStart = await askYN('Enable auto-start on login?', false);
      if (doAutoStart) await enableAutoStart();
      else savePrefs({ autoStartConfigured: true });
    }
  }

  // Daemon mode: explicit flag > interactive prompt
  let daemon = opts.daemon;
  if (daemon === undefined) {
    daemon = await askYN('Run in background?', true);
  }

  console.log('\nStarting CCWeb...');

  // Open log file for daemon mode
  let outFd, errFd;
  if (daemon) {
    outFd = fs.openSync(LOG_FILE, 'a');
    errFd = fs.openSync(LOG_FILE, 'a');
  }

  const child = fork(BACKEND_ENTRY, [], {
    env: {
      ...process.env,
      CCWEB_DATA_DIR: DATA_DIR,
      NODE_ENV: 'production',
    },
    cwd: PKG_ROOT,
    stdio: daemon
      ? ['ignore', outFd, errFd, 'ipc']
      : ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  // Wait for the actual port from the backend
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Server did not start within 20 s')),
      20000
    );
    child.on('message', (msg) => {
      if (msg && msg.type === 'server-port' && msg.port) {
        clearTimeout(timeout);
        resolve(msg.port);
      }
    });
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited unexpectedly (code ${code})`));
    });
  });

  if (daemon && outFd !== undefined) { try { fs.closeSync(outFd); } catch {} }
  if (daemon && errFd !== undefined) { try { fs.closeSync(errFd); } catch {} }

  // Persist state
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf-8');
  fs.writeFileSync(PORT_FILE, String(port), 'utf-8');

  console.log(`\nCCWeb running at http://localhost:${port}`);
  openBrowser(`http://localhost:${port}`);

  if (daemon) {
    child.disconnect(); // close IPC; child keeps running
    child.unref();      // let parent exit without waiting
    console.log(`Running in background  PID ${child.pid}`);
    console.log(`Logs : ${LOG_FILE}`);
    console.log(`Stop : ccweb stop\n`);
    process.exit(0);
  } else {
    console.log('Press Ctrl+C to stop.\n');
    const cleanup = () => {
      try { fs.unlinkSync(PID_FILE); } catch {}
      try { fs.unlinkSync(PORT_FILE); } catch {}
      try { child.kill(); } catch {}
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    child.on('exit', () => {
      try { fs.unlinkSync(PID_FILE); } catch {}
      try { fs.unlinkSync(PORT_FILE); } catch {}
    });
  }
}

function stopServer() {
  const status = getStatus();
  if (!status.running) { console.log('CCWeb is not running.'); return; }
  try {
    process.kill(status.pid, 'SIGTERM');
    try { fs.unlinkSync(PID_FILE); } catch {}
    try { fs.unlinkSync(PORT_FILE); } catch {}
    console.log(`Stopped (PID ${status.pid}).`);
  } catch (err) {
    console.error('Failed to stop:', err.message);
  }
}

function showStatus() {
  const status = getStatus();
  if (status.running) {
    console.log(`Status : running`);
    console.log(`PID    : ${status.pid}`);
    console.log(`URL    : http://localhost:${status.port}`);
    console.log(`Data   : ${DATA_DIR}`);
    console.log(`Logs   : ${LOG_FILE}`);
  } else {
    console.log('Status : stopped');
    console.log(`Data   : ${DATA_DIR}`);
  }
}

function showHelp() {
  console.log(`
CCWeb — Self-hosted Claude Code web interface

Usage:
  ccweb                      Start server (interactive)
  ccweb start                Start server (interactive)
  ccweb start --daemon       Start in background (no prompt)
  ccweb start --foreground   Start in foreground (no prompt)
  ccweb stop                 Stop background server
  ccweb status               Show running status
  ccweb open                 Open browser to running server
  ccweb setup                Reconfigure username / password
  ccweb enable-autostart     Enable auto-start on login
  ccweb disable-autostart    Disable auto-start on login
  ccweb logs                 Tail log file (background mode)

Data directory : ${DATA_DIR}
Config file    : ${CONFIG_FILE}
Log file       : ${LOG_FILE}
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) || 'start';
const isDaemon = args.includes('--daemon');
const isForeground = args.includes('--foreground');

(async () => {
  try {
    switch (command) {
      case 'start':
        await startServer({
          daemon: isDaemon ? true : isForeground ? false : undefined,
        });
        break;

      case 'stop':
        stopServer();
        break;

      case 'status':
        showStatus();
        break;

      case 'open': {
        const s = getStatus();
        if (!s.running) { console.log('CCWeb is not running. Start it with: ccweb start'); break; }
        openBrowser(`http://localhost:${s.port}`);
        console.log(`Opening http://localhost:${s.port}`);
        break;
      }

      case 'setup':
        await runSetup();
        break;

      case 'enable-autostart':
        await enableAutoStart();
        break;

      case 'disable-autostart':
        await disableAutoStart();
        break;

      case 'logs': {
        if (!fs.existsSync(LOG_FILE)) { console.log('No log file found.'); break; }
        // Tail the log file (cross-platform)
        try {
          if (process.platform === 'win32') {
            execSync(`Get-Content -Wait "${LOG_FILE}"`, { shell: 'powershell', stdio: 'inherit' });
          } else {
            execFileSync('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
          }
        } catch {}
        break;
      }

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error('\nError:', err.message || err);
    process.exit(1);
  }
})();
