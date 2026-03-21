import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import { fork, ChildProcess, execSync } from 'child_process';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PREFERRED_PORT = 3001;
let actualPort = PREFERRED_PORT;
let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// ── Path helpers ──────────────────────────────────────────────────────────────

function getAppRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..', '..');
}

function getDataDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'data');
  }
  return path.join(getAppRoot(), 'data');
}

// ── Fix PATH on macOS ─────────────────────────────────────────────────────────

function fixPath(): void {
  if (process.platform !== 'darwin') return;
  try {
    const shellPath = execSync('echo $PATH', {
      shell: process.env.SHELL || '/bin/zsh',
      encoding: 'utf-8',
    }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    // ignore
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

  let bcrypt;
  try {
    bcrypt = require(path.join(getAppRoot(), 'backend', 'node_modules', 'bcryptjs'));
  } catch {
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

  const projectsFile = path.join(dataDir, 'projects.json');
  if (!fs.existsSync(projectsFile)) {
    fs.writeFileSync(projectsFile, '[]', 'utf-8');
  }

  return { isFirstLaunch: true, username, password };
}

// ── Server management ─────────────────────────────────────────────────────────

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(getAppRoot(), 'backend', 'dist', 'index.js');
    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Backend not found at: ${serverPath}`));
      return;
    }

    const dataDir = getDataDir();

    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        CCWEB_DATA_DIR: dataDir,
        CCWEB_PORT: String(PREFERRED_PORT),
        NODE_ENV: 'production',
      },
      cwd: getAppRoot(),
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    let resolved = false;

    serverProcess.on('message', (msg: { type: string; port?: number }) => {
      if (msg.type === 'server-port' && typeof msg.port === 'number' && !resolved) {
        resolved = true;
        resolve(msg.port);
      }
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[Server]', data.toString().trim());
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Server]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      console.error('[Server] Failed to start:', err);
      if (!resolved) { resolved = true; reject(err); }
    });

    serverProcess.on('exit', (code) => {
      console.log(`[Server] Exited with code ${code}`);
      if (!resolved) { resolved = true; reject(new Error(`Server exited with code ${code}`)); }
      serverProcess = null;
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Server did not report its port in time'));
      }
    }, 20000);
  });
}

// ── Auto Updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  function sendStatus(type: string, info?: unknown) {
    mainWindow?.webContents.send('updater:status', { type, info });
  }

  autoUpdater.on('checking-for-update', () => sendStatus('checking'));
  autoUpdater.on('update-available', (info) => sendStatus('available', info));
  autoUpdater.on('update-not-available', () => sendStatus('not-available'));
  autoUpdater.on('download-progress', (progress) => sendStatus('progress', progress));
  autoUpdater.on('update-downloaded', () => sendStatus('downloaded'));
  autoUpdater.on('error', (err) => sendStatus('error', err?.message));

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo) {
        return { available: true, version: result.updateInfo.version };
      }
      return { available: false };
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
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
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://localhost:${actualPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('ready', async () => {
  fixPath();

  const { isFirstLaunch, username, password } = ensureConfig();

  setupAutoUpdater();

  try {
    actualPort = await startServer();
    console.log(`[Electron] Backend running on port ${actualPort}`);
  } catch (err) {
    dialog.showErrorBox(
      'Startup Failed',
      `Backend server could not start:\n${err instanceof Error ? err.message : err}`
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
