import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const router = Router();

// GET /api/filesystem?path=...
router.get('/', (req: Request, res: Response): void => {
  const requestedPath = (req.query['path'] as string | undefined) || os.homedir();

  // Normalize and resolve the path
  const resolvedPath = path.resolve(requestedPath);

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

  res.json({
    path: resolvedPath,
    parent: parent !== resolvedPath ? parent : null,
    entries,
  });
});

// POST /api/filesystem/mkdir  body: { path: string, name: string }
router.post('/mkdir', (req: Request, res: Response): void => {
  const { path: parentPath, name } = req.body as { path?: string; name?: string };

  if (!parentPath || !name) {
    res.status(400).json({ error: 'path and name are required' });
    return;
  }

  // Reject names with path separators or dangerous characters
  if (/[/\0]/.test(name)) {
    res.status(400).json({ error: 'Invalid folder name' });
    return;
  }

  const resolvedParent = path.resolve(parentPath);
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
router.get('/file', (req: Request, res: Response): void => {
  const requestedPath = req.query['path'] as string | undefined;
  if (!requestedPath) {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  const resolvedPath = path.resolve(requestedPath);
  const SIZE_LIMIT = 1 * 1024 * 1024; // 1 MB

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

// PUT /api/filesystem/file  body: { path: string, content: string }
router.put('/file', (req: Request, res: Response): void => {
  const { path: filePath, content } = req.body as { path?: string; content?: string };

  if (!filePath || content === undefined) {
    res.status(400).json({ error: 'path and content are required' });
    return;
  }

  const resolvedPath = path.resolve(filePath);

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

export default router;
