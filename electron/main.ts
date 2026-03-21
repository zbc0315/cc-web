import { app, BrowserWindow, dialog, shell } from 'electron';
import { fork, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as crypto from 'crypto';

const PORT = 3001;
let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// ── Path helpers ──────────────────────────────────────────────────────────────

function getAppRoot(): string {
  if (app.isPackaged) {
    // asar disabled — files are directly under resources/app/
    return path.join(process.resourcesPath, 'app');
  }
  // __dirname = electron/dist/ → project root is ../../
  return path.join(__dirname, '..', '..');
}

function getDataDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'data');
  }
  return path.join(getAppRoot(), 'data');
}

// ── Fix PATH on macOS ─────────────────────────────────────────────────────────
// Electron on macOS doesn't inherit the user's shell PATH, so `claude` CLI
// won't be found. We read the full PATH from the user's default shell.

function fixPath(): void {
  if (process.platform !== 'darwin') return;
  try {
    const shellPath = execSync('echo $PATH', {
      shell: process.env.SHELL || '/bin/zsh',
      encoding: 'utf-8',
    }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    // ignore — keep existing PATH
  }
}

// ── First-launch setup ───────────────────────────────────────────────────────

function ensureConfig(): { isFirstLaunch: boolean; username?: string; password?: string } {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const configFile = path.join(dataDir, 'config.json');
  if (fs.existsSync(configFile)) {
    return { isFirstLaunch: false };
  }

  // Auto-generate credentials on first launch
  // bcryptjs is in backend/node_modules — require it directly
  let bcrypt;
  try {
    bcrypt = require(path.join(getAppRoot(), 'backend', 'node_modules', 'bcryptjs'));
  } catch {
    // Fallback: try from root node_modules
    bcrypt = require('bcryptjs');
  }

  const username = 'admin';
  const password = crypto.randomBytes(8).toString('hex');
  const passwordHash = bcrypt.hashSync(password, 12);
  const jwtSecret = crypto.randomBytes(64).toString('hex');

  fs.writeFileSync(
    configFile,
    JSON.stringify({ username, passwordHash, jwtSecret }, null, 2),
    'utf-8'
  );

  // Also create empty projects.json
  const projectsFile = path.join(dataDir, 'projects.json');
  if (!fs.existsSync(projectsFile)) {
    fs.writeFileSync(projectsFile, '[]', 'utf-8');
  }

  return { isFirstLaunch: true, username, password };
}

// ── Server management ─────────────────────────────────────────────────────────

function startServer(): void {
  const serverPath = path.join(getAppRoot(), 'backend', 'dist', 'index.js');
  if (!fs.existsSync(serverPath)) {
    dialog.showErrorBox(
      'Server Not Found',
      `Could not find backend at: ${serverPath}\nPlease ensure the app is built correctly.`
    );
    app.quit();
    return;
  }

  const dataDir = getDataDir();

  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      CCWEB_DATA_DIR: dataDir,
      CCWEB_PORT: String(PORT),
      NODE_ENV: 'production',
    },
    cwd: getAppRoot(),
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[Server]', data.toString().trim());
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[Server]', data.toString().trim());
  });

  serverProcess.on('error', (err) => {
    console.error('[Server] Failed to start:', err);
    dialog.showErrorBox('Server Error', `Backend failed to start:\n${err.message}`);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Server] Exited with code ${code}`);
    serverProcess = null;
  });
}

async function waitForServer(timeout = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ port: PORT, host: '127.0.0.1' });
        socket.on('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', reject);
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'CC Web',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('ready', async () => {
  fixPath();

  const { isFirstLaunch, username, password } = ensureConfig();

  startServer();

  const ready = await waitForServer();
  if (!ready) {
    dialog.showErrorBox(
      'Startup Failed',
      'The backend server did not start in time.\nPlease check that port 3001 is available.'
    );
    app.quit();
    return;
  }

  createWindow();

  if (isFirstLaunch) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Welcome to CC Web',
      message: 'Your login credentials have been created:',
      detail: `Username: ${username}\nPassword: ${password}\n\nPlease save these credentials. You can change them later by re-running setup.`,
      buttons: ['OK'],
    });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
