import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import multer from 'multer';
import { getProjects, isAdminUser, getUserWorkspace } from '../config';
import { AuthRequest } from '../auth';

const router = Router();

/**
 * Security: restrict filesystem access to user's workspace and registered project directories.
 * Prevents path traversal attacks (e.g. reading /etc/shadow).
 */
function isWithinAllowedDirs(p: string, username?: string): boolean {
  if (isAdminUser(username)) {
    const home = os.homedir();
    return p === home || p.startsWith(home + path.sep);
  }
  const workspace = getUserWorkspace(username);
  if (p === workspace || p.startsWith(workspace + path.sep)) return true;
  const projects = getProjects();
  for (const proj of projects) {
    if (proj.owner && proj.owner !== username) continue;
    const projectDir = path.resolve(proj.folderPath);
    if (p === projectDir || p.startsWith(projectDir + path.sep)) return true;
  }
  return false;
}

function isPathAllowed(resolvedPath: string, username?: string): boolean {
  if (!isWithinAllowedDirs(resolvedPath, username)) return false;
  // Also verify the real path (after symlink resolution) is within allowed dirs.
  // This prevents symlink attacks where a link inside an allowed dir points outside.
  try {
    const lstat = fs.lstatSync(resolvedPath);
    if (lstat.isSymbolicLink()) {
      // Symlinks must resolve successfully and point within allowed dirs.
      // Broken symlinks are denied — there's no safe fallback.
      try {
        const realPath = fs.realpathSync(resolvedPath);
        if (!isWithinAllowedDirs(realPath, username)) return false;
      } catch {
        return false; // broken symlink — deny
      }
    } else {
      // For regular files/dirs, resolve any parent symlinks
      try {
        const realPath = fs.realpathSync(resolvedPath);
        if (realPath !== resolvedPath && !isWithinAllowedDirs(realPath, username)) return false;
      } catch {
        // Path may not exist yet (e.g. for new file writes) — skip realpath check
      }
    }
  } catch {
    // lstat failed — path doesn't exist yet (new file write), skip symlink check
  }
  return true;
}

// GET /api/filesystem?path=...
router.get('/', (req: AuthRequest, res: Response): void => {
  const username = req.user?.username;
  const defaultPath = getUserWorkspace(username);
  const requestedPath = (req.query['path'] as string | undefined) || defaultPath;

  // Normalize and resolve the path
  const resolvedPath = path.resolve(requestedPath);

  if (!isPathAllowed(resolvedPath, username)) {
    res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    return;
  }

  // Auto-create workspace directory if it doesn't exist (e.g. ~/Projects on fresh WSL installs)
  if (!fs.existsSync(resolvedPath) && resolvedPath === path.resolve(defaultPath)) {
    try { fs.mkdirSync(resolvedPath, { recursive: true }); } catch { /* will fail below with ENOENT */ }
  }

  let entries: { name: string; type: 'dir' | 'file'; path: string }[] = [];

  try {
    const dirents = fs.readdirSync(resolvedPath, { withFileTypes: true });
    entries = dirents
      .map((d) => ({
        name: d.name,
        type: (d.isDirectory() ? 'dir' : 'file') as 'dir' | 'file',
        path: path.join(resolvedPath, d.name),
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied', path: resolvedPath });
      return;
    }
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Path not found', path: resolvedPath });
      return;
    }
    res.status(500).json({ error: 'Failed to read directory', path: resolvedPath });
    return;
  }

  const parent = path.dirname(resolvedPath);
  // Don't expose parent if it would be outside the user's workspace
  const parentAllowed = parent !== resolvedPath && isPathAllowed(parent, username);

  res.json({
    path: resolvedPath,
    parent: parentAllowed ? parent : null,
    entries,
  });
});

// POST /api/filesystem/mkdir  body: { path: string, name: string }
router.post('/mkdir', (req: AuthRequest, res: Response): void => {
  const { path: parentPath, name } = req.body as { path?: string; name?: string };

  if (!parentPath || !name) {
    res.status(400).json({ error: 'path and name are required' });
    return;
  }

  // Reject names with path separators, parent traversal, or dangerous characters (including Windows-invalid chars)
  if (/[/\\\0:*?<>|"]/.test(name) || name === '..' || name === '.' || name.trim() !== name || name.length > 255) {
    res.status(400).json({ error: 'Invalid folder name' });
    return;
  }

  const resolvedParent = path.resolve(parentPath);

  if (!isPathAllowed(resolvedParent, req.user?.username)) {
    res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    return;
  }

  const newDir = path.join(resolvedParent, name);

  try {
    fs.mkdirSync(newDir, { recursive: false });
    res.json({ path: newDir });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EEXIST') {
      res.status(409).json({ error: 'Folder already exists' });
      return;
    }
    if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// GET /api/filesystem/file?path=...
router.get('/file', (req: AuthRequest, res: Response): void => {
  const requestedPath = req.query['path'] as string | undefined;
  if (!requestedPath) {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  const resolvedPath = path.resolve(requestedPath);

  if (!isPathAllowed(resolvedPath, req.user?.username)) {
    res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    return;
  }

  const SIZE_LIMIT = parseInt(process.env.CCWEB_FILE_SIZE_LIMIT || '', 10) || 1 * 1024 * 1024; // 1 MB default

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to stat file' });
    return;
  }

  if (!stat.isFile()) {
    res.status(400).json({ error: 'Path is not a file' });
    return;
  }

  if (stat.size > SIZE_LIMIT) {
    res.json({ path: resolvedPath, tooLarge: true, size: stat.size, content: null });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(resolvedPath);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    res.status(500).json({ error: 'Failed to read file' });
    return;
  }

  // Heuristic binary detection: look for null bytes in first 8KB
  const sample = buffer.slice(0, 8192);
  const isBinary = sample.includes(0);

  if (isBinary) {
    res.json({ path: resolvedPath, binary: true, size: stat.size, content: null });
    return;
  }

  res.json({ path: resolvedPath, binary: false, tooLarge: false, size: stat.size, content: buffer.toString('utf8') });
});

// GET /api/filesystem/raw?path=...  — serve file with correct Content-Type (for images, etc.)
const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

router.get('/raw', (req: AuthRequest, res: Response): void => {
  const requestedPath = req.query['path'] as string | undefined;
  if (!requestedPath) { res.status(400).json({ error: 'path is required' }); return; }

  const resolvedPath = path.resolve(requestedPath);
  if (!isPathAllowed(resolvedPath, req.user?.username)) { res.status(403).json({ error: 'Access denied' }); return; }

  let stat: fs.Stats;
  try { stat = fs.statSync(resolvedPath); } catch {
    res.status(404).json({ error: 'File not found' }); return;
  }
  if (!stat.isFile()) { res.status(400).json({ error: 'Not a file' }); return; }

  const RAW_LIMIT = 20 * 1024 * 1024; // 20 MB
  if (stat.size > RAW_LIMIT) { res.status(413).json({ error: 'File too large' }); return; }

  const ext = path.extname(resolvedPath).slice(1).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.query['dl'] === '1') {
    const fileName = path.basename(resolvedPath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  }
  fs.createReadStream(resolvedPath).pipe(res);
});

// PUT /api/filesystem/file  body: { path: string, content: string }
router.put('/file', (req: AuthRequest, res: Response): void => {
  const { path: filePath, content } = req.body as { path?: string; content?: string };

  if (!filePath || content === undefined) {
    res.status(400).json({ error: 'path and content are required' });
    return;
  }

  const resolvedPath = path.resolve(filePath);

  if (!isPathAllowed(resolvedPath, req.user?.username)) {
    res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    return;
  }

  const WRITE_LIMIT = parseInt(process.env.CCWEB_FILE_SIZE_LIMIT || '', 10) || 10 * 1024 * 1024; // 10 MB
  if (Buffer.byteLength(content, 'utf-8') > WRITE_LIMIT) {
    res.status(413).json({ error: 'File too large to write' });
    return;
  }

  try {
    fs.writeFileSync(resolvedPath, content, 'utf-8');
    res.json({ path: resolvedPath, size: Buffer.byteLength(content, 'utf-8') });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// POST /api/filesystem/upload  — upload files to a directory
const upload = multer({ dest: path.join(os.tmpdir(), 'ccweb-uploads'), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/upload', upload.array('files', 20), (req: AuthRequest, res: Response): void => {
  const targetDir = req.body?.path as string | undefined;
  if (!targetDir) { res.status(400).json({ error: 'path is required' }); return; }

  const resolvedDir = path.resolve(targetDir);
  if (!isPathAllowed(resolvedDir, req.user?.username)) {
    res.status(403).json({ error: 'Access denied: path outside allowed directories' });
    return;
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const results: { name: string; path: string; size: number }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const dest = path.join(resolvedDir, file.originalname);
    try {
      fs.renameSync(file.path, dest);
      results.push({ name: file.originalname, path: dest, size: file.size });
    } catch {
      // rename may fail across filesystems, fallback to copy+delete
      try {
        fs.copyFileSync(file.path, dest);
        fs.unlinkSync(file.path);
        results.push({ name: file.originalname, path: dest, size: file.size });
      } catch (err) {
        errors.push(`${file.originalname}: ${(err as Error).message}`);
        try { fs.unlinkSync(file.path); } catch {}
      }
    }
  }

  res.json({ uploaded: results, errors });
});

export default router;
