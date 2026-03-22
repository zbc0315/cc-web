import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import { fork, ChildProcess, execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';

/** Compare two semver strings (e.g. "1.5.2" vs "1.5.10"). Returns >0 if a>b, <0 if a<b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

const PREFERRED_PORT = 3001;
let actualPort = PREFERRED_PORT;
let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

const GITHUB_REPO = 'zbc0315/cc-web';

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

  const home = process.env.HOME || '';
  const currentPath = process.env.PATH || '';

  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    const shellPath = execSync(`${userShell} -ilc 'echo $PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (shellPath && shellPath !== currentPath) {
      process.env.PATH = shellPath;
      return;
    }
  } catch {
    // fall through
  }

  const extraPaths = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ].filter((p) => !currentPath.includes(p));

  if (extraPaths.length > 0) {
    process.env.PATH = [...extraPaths, currentPath].join(':');
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
    { encoding: 'utf-8', mode: 0o600 }
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
      if (!resolved) { resolved = true; reject(err); }
    });
    serverProcess.on('exit', (code) => {
      if (!resolved) { resolved = true; reject(new Error(`Server exited with code ${code}`)); }
      serverProcess = null;
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('Server timeout')); }
    }, 20000);
  });
}

// ── Manual Update (no code signing required) ──────────────────────────────────

interface ReleaseInfo {
  version: string;
  zipUrl: string;
  dmgUrl: string;
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const req = https.get(url, { headers: { 'User-Agent': 'CCWeb-Updater' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (!loc || !loc.startsWith('https://')) { resolve(null); return; }
        https.get(loc, { headers: { 'User-Agent': 'CCWeb-Updater' } }, handleResponse);
        return;
      }
      handleResponse(res);
    });
    req.on('error', () => resolve(null));

    function handleResponse(res: http.IncomingMessage) {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const version = (data.tag_name as string).replace(/^v/, '');
          const assets = (data.assets || []) as { name: string; browser_download_url: string }[];
          const zip = assets.find((a) => a.name.endsWith('-mac.zip'));
          const dmg = assets.find((a) => a.name.endsWith('.dmg'));
          if (!zip && !dmg) { resolve(null); return; }
          resolve({
            version,
            zipUrl: zip?.browser_download_url || '',
            dmgUrl: dmg?.browser_download_url || '',
          });
        } catch { resolve(null); }
      });
    }
  });
}

function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string) => {
      // Security: only allow HTTPS downloads, reject HTTP downgrade
      if (!u.startsWith('https://')) {
        reject(new Error('Refusing non-HTTPS download URL'));
        return;
      }
      https.get(u, { headers: { 'User-Agent': 'CCWeb-Updater' } }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

/** Shell-escape a string for use inside single quotes in bash */
function shellEscape(s: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

async function applyUpdate(zipPath: string): Promise<void> {
  // Validate the zip exists and is under temp dir
  const tempBase = app.getPath('temp');
  const resolvedZip = path.resolve(zipPath);
  if (!resolvedZip.startsWith(tempBase + path.sep)) {
    throw new Error('Update zip must be in temp directory');
  }
  if (!fs.existsSync(resolvedZip)) {
    throw new Error('Update zip not found');
  }

  const appPath = path.dirname(path.dirname(path.dirname(process.execPath)));
  // Validate appPath looks like a .app bundle
  if (!appPath.endsWith('.app')) {
    throw new Error(`Unexpected app path: ${appPath}`);
  }

  const tempDir = path.join(tempBase, 'ccweb-update');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  // Unzip using execFile (no shell interpolation)
  const { execFileSync } = require('child_process');
  execFileSync('/usr/bin/ditto', ['-xk', resolvedZip, tempDir], { stdio: 'pipe' });

  // Find the .app inside — validate name has no shell metacharacters
  const extracted = fs.readdirSync(tempDir).find((f) => f.endsWith('.app'));
  if (!extracted) throw new Error('No .app found in zip');
  if (!/^[\w.-]+\.app$/.test(extracted)) {
    throw new Error(`Suspicious app name in zip: ${extracted}`);
  }

  const newAppPath = path.join(tempDir, extracted);

  // Remove quarantine using execFile
  try { execFileSync('/usr/bin/xattr', ['-cr', newAppPath], { stdio: 'pipe' }); } catch { /**/ }

  // Replace: use shell script with properly escaped paths (single quotes)
  const script = `#!/bin/bash
sleep 2
rm -rf ${shellEscape(appPath)}
mv ${shellEscape(newAppPath)} ${shellEscape(appPath)}
/usr/bin/xattr -cr ${shellEscape(appPath)}
open ${shellEscape(appPath)}
rm -rf ${shellEscape(tempDir)}
rm "$0"
`;
  const scriptPath = path.join(tempBase, 'ccweb-update.sh');
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  // Launch the update script detached
  const child = spawn('bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Quit the app
  app.quit();
}

function setupUpdaterIPC(): void {
  const currentVersion = app.getVersion();

  ipcMain.handle('updater:check', async () => {
    try {
      const release = await fetchLatestRelease();
      if (!release) return { available: false };
      if (compareSemver(release.version, currentVersion) <= 0) return { available: false };
      return { available: true, version: release.version };
    } catch (err) {
      return { available: false, error: String(err) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      const release = await fetchLatestRelease();
      if (!release?.zipUrl) return { success: false, error: 'No zip found' };

      const dest = path.join(app.getPath('temp'), `CCWeb-${release.version}-arm64-mac.zip`);
      await downloadFile(release.zipUrl, dest, (percent) => {
        mainWindow?.webContents.send('updater:status', { type: 'progress', info: { percent } });
      });

      mainWindow?.webContents.send('updater:status', { type: 'downloaded', info: { path: dest } });
      return { success: true, path: dest };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWindow?.webContents.send('updater:status', { type: 'error', info: msg });
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('updater:install', async (_event, zipPath?: string) => {
    try {
      const tempDir = app.getPath('temp');
      let fullPath: string;

      if (zipPath) {
        // Validate provided path is within temp directory
        const resolved = path.resolve(zipPath);
        if (!resolved.startsWith(tempDir + path.sep)) {
          throw new Error('Update file must be in temp directory');
        }
        fullPath = resolved;
      } else {
        // Find the downloaded zip in temp dir
        const zip = fs.readdirSync(tempDir)
          .filter((f) => f.startsWith('CCWeb-') && f.endsWith('-mac.zip'))
          .sort()
          .pop();
        if (!zip) throw new Error('No downloaded update found');
        fullPath = path.join(tempDir, zip);
      }

      // Stop backend
      if (serverProcess) { serverProcess.kill(); serverProcess = null; }

      await applyUpdate(fullPath);
    } catch (err) {
      dialog.showErrorBox('Update Failed', err instanceof Error ? err.message : String(err));
    }
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'CCWeb',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://localhost:${actualPort}`);
  mainWindow.on('closed', () => { mainWindow = null; });

  // Restrict navigation to our local server
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${actualPort}`)) {
      event.preventDefault();
    }
  });

  // Open external links in system browser (only https)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on('ready', async () => {
  fixPath();

  const { isFirstLaunch, username, password } = ensureConfig();

  setupUpdaterIPC();

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
      title: 'Welcome to CCWeb',
      message: 'Your login credentials have been created:',
      detail: `Username: ${username}\nPassword: ${password}\n\nPlease save these credentials.`,
      buttons: ['OK'],
    });
  }
});

app.on('window-all-closed', () => { app.quit(); });

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
