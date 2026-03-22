import { Router, Response, Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import multer from 'multer';
import { AuthRequest } from '../auth';
import { DATA_DIR, getProjects } from '../config';

const router = Router();

interface Preset {
  id: string;
  name: string;
  type: 'strike' | 'ambient';
  defaultMode: 'loop' | 'interval';
}

const PRESETS: Preset[] = [
  { id: 'singing-bowl', name: '颂钵', type: 'strike', defaultMode: 'interval' },
  { id: 'water-drops', name: '水滴', type: 'strike', defaultMode: 'interval' },
  { id: 'wind', name: '风声', type: 'ambient', defaultMode: 'loop' },
  { id: 'rain', name: '雨声', type: 'ambient', defaultMode: 'loop' },
  { id: 'keyboard', name: '键盘声', type: 'ambient', defaultMode: 'loop' },
  { id: 'stream', name: '溪流', type: 'ambient', defaultMode: 'loop' },
];

const GITHUB_SOUND_URL = 'https://github.com/zbc0315/cc-web/releases/download/sounds';

const PRESETS_DIR = path.join(DATA_DIR, 'sounds', 'presets');
const GLOBAL_SOUNDS_DIR = path.join(DATA_DIR, 'sounds', 'custom');

// Ensure directories exist
function ensureSoundDirs(): void {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_SOUNDS_DIR, { recursive: true });
}

// multer config: 10MB max, mp3/ogg only, dest /tmp/ccweb-uploads
const upload = multer({
  dest: '/tmp/ccweb-uploads',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/ogg', 'audio/mp3'];
    const extAllowed = ['.mp3', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || extAllowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only mp3 and ogg files are allowed'));
    }
  },
});

/** Download a URL to a destination file path, following redirects up to maxRedirects times */
function downloadFile(url: string, dest: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    function doGet(currentUrl: string, redirectsLeft: number): void {
      const lib = currentUrl.startsWith('https://') ? https : http;
      lib.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          // Follow redirect
          const location = res.headers.location;
          const nextUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
          res.resume(); // drain the response
          doGet(nextUrl, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const fileStream = fs.createWriteStream(dest);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        fileStream.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on('error', reject);
    }
    doGet(url, maxRedirects);
  });
}

/** Get project by id */
function getProject(projectId: string) {
  return getProjects().find((p) => p.id === projectId) || null;
}

// GET /api/sounds/presets — list presets with downloaded status
router.get('/presets', (_req: AuthRequest, res: Response): void => {
  ensureSoundDirs();
  const presetsWithStatus = PRESETS.map((preset) => {
    const filePath = path.join(PRESETS_DIR, `${preset.id}.mp3`);
    const downloaded = fs.existsSync(filePath);
    return { ...preset, downloaded };
  });
  res.json(presetsWithStatus);
});

// POST /api/sounds/download/:id — download preset MP3 from GitHub Release
router.post('/download/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) {
    res.status(404).json({ error: 'Preset not found' });
    return;
  }

  ensureSoundDirs();
  const dest = path.join(PRESETS_DIR, `${preset.id}.mp3`);

  if (fs.existsSync(dest)) {
    res.json({ success: true, message: 'Already downloaded' });
    return;
  }

  const url = `${GITHUB_SOUND_URL}/${preset.id}.mp3`;
  try {
    await downloadFile(url, dest, 5);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Download failed: ${message}` });
  }
});

// GET /api/sounds/file/:name — serve sound file (presets first, then custom)
router.get('/file/:name', (req: AuthRequest, res: Response): void => {
  const { name } = req.params;
  // Sanitize filename to prevent path traversal
  const safeName = path.basename(name);

  const presetPath = path.join(PRESETS_DIR, safeName);
  if (fs.existsSync(presetPath)) {
    res.sendFile(presetPath);
    return;
  }

  const customPath = path.join(GLOBAL_SOUNDS_DIR, safeName);
  if (fs.existsSync(customPath)) {
    res.sendFile(customPath);
    return;
  }

  res.status(404).json({ error: 'File not found' });
});

// GET /api/sounds/project/:projectId/:name — serve project sound file
router.get('/project/:projectId/:name', (req: AuthRequest, res: Response): void => {
  const { projectId, name } = req.params;
  const project = getProject(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const safeName = path.basename(name);
  const soundPath = path.join(project.folderPath, '.ccweb', 'sounds', safeName);

  if (!fs.existsSync(soundPath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.sendFile(soundPath);
});

// POST /api/sounds/upload — upload custom sound
router.post('/upload', upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { scope, projectId } = req.body as { scope?: string; projectId?: string };
  ensureSoundDirs();

  let destDir: string;
  if (scope === 'project' && projectId) {
    const project = getProject(projectId);
    if (!project) {
      // Clean up temp file
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    destDir = path.join(project.folderPath, '.ccweb', 'sounds');
  } else {
    destDir = GLOBAL_SOUNDS_DIR;
  }

  fs.mkdirSync(destDir, { recursive: true });

  const originalName = path.basename(req.file.originalname);
  const destPath = path.join(destDir, originalName);

  fs.rename(req.file.path, destPath, (err) => {
    if (err) {
      // Try copy + delete if rename fails (cross-device link)
      try {
        fs.copyFileSync(req.file!.path, destPath);
        fs.unlinkSync(req.file!.path);
        res.json({ success: true, filename: originalName });
      } catch (copyErr: unknown) {
        const message = copyErr instanceof Error ? copyErr.message : String(copyErr);
        res.status(500).json({ error: `Upload failed: ${message}` });
      }
      return;
    }
    res.json({ success: true, filename: originalName });
  });
});

// GET /api/sounds/list — list all available sounds
router.get('/list', (req: AuthRequest, res: Response): void => {
  ensureSoundDirs();
  const { projectId } = req.query as { projectId?: string };

  // Downloaded presets
  const downloadedPresets = PRESETS.filter((p) =>
    fs.existsSync(path.join(PRESETS_DIR, `${p.id}.mp3`))
  ).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    defaultMode: p.defaultMode,
    source: 'preset' as const,
    url: `/api/sounds/file/${p.id}.mp3`,
  }));

  // Global custom sounds
  const globalCustoms = fs.existsSync(GLOBAL_SOUNDS_DIR)
    ? fs.readdirSync(GLOBAL_SOUNDS_DIR)
        .filter((f) => /\.(mp3|ogg)$/i.test(f))
        .map((f) => ({
          id: f,
          name: path.basename(f, path.extname(f)),
          type: 'ambient' as const,
          defaultMode: 'loop' as const,
          source: 'custom' as const,
          url: `/api/sounds/file/${f}`,
        }))
    : [];

  // Project sounds (if projectId provided)
  let projectSounds: Array<{
    id: string; name: string; type: 'ambient'; defaultMode: 'loop';
    source: 'project'; url: string;
  }> = [];
  if (projectId) {
    const project = getProject(projectId);
    if (project) {
      const projectSoundsDir = path.join(project.folderPath, '.ccweb', 'sounds');
      if (fs.existsSync(projectSoundsDir)) {
        projectSounds = fs.readdirSync(projectSoundsDir)
          .filter((f) => /\.(mp3|ogg)$/i.test(f))
          .map((f) => ({
            id: f,
            name: path.basename(f, path.extname(f)),
            type: 'ambient' as const,
            defaultMode: 'loop' as const,
            source: 'project' as const,
            url: `/api/sounds/project/${projectId}/${f}`,
          }));
      }
    }
  }

  // Return flat array with source strings matching frontend format (e.g. "preset:rain", "global:file.mp3", "project:file.mp3")
  const all = [
    ...downloadedPresets.map((p) => ({ ...p, source: `preset:${p.id}` })),
    ...globalCustoms.map((g) => ({ ...g, source: `global:${g.id}` })),
    ...projectSounds.map((ps) => ({ ...ps, source: `project:${ps.id}` })),
  ];
  res.json(all);
});

export default router;
