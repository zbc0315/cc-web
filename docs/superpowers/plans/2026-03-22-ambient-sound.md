# Ambient Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project ambient background sounds that play when the LLM is actively generating output, with 6 presets hosted on GitHub Release and support for custom uploads.

**Architecture:** Backend serves sound files (presets cached from GitHub, custom uploads via multer) through REST API. Frontend SoundPlayer component uses HTMLAudioElement for playback, detecting LLM activity via WebSocket `terminal_data` events. SoundSelector component provides UI for sound/mode/volume configuration stored in project settings.

**Tech Stack:** HTMLAudioElement (Web Audio API for gain/fade), multer (file uploads), Express static file serving, React

**Spec:** `docs/superpowers/specs/2026-03-22-ambient-sound-design.md`

---

## File Structure

### New files (backend)

| File | Responsibility |
|------|---------------|
| `backend/src/routes/sounds.ts` | Sound API: list presets, download from GitHub, serve files, handle uploads |

### New files (frontend)

| File | Responsibility |
|------|---------------|
| `frontend/src/components/SoundPlayer.tsx` | Invisible audio engine — play/pause/fade based on LLM activity |
| `frontend/src/components/SoundSelector.tsx` | UI for selecting sound, mode, volume, upload |

### Modified files

| File | Change |
|------|--------|
| `backend/package.json` | Add `multer` + `@types/multer` |
| `backend/src/index.ts` | Mount `/api/sounds` routes |
| `frontend/src/pages/ProjectPage.tsx` | Integrate SoundPlayer + SoundSelector, track LLM activity |
| `frontend/src/lib/api.ts` | Add sounds API functions |

---

## Task 1: Backend sounds route

**Files:**
- Create: `backend/src/routes/sounds.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Install multer**

```bash
cd /Users/tom/Projects/cc-web/backend && npm install multer && npm install -D @types/multer
```

- [ ] **Step 2: Create sounds.ts route file**

```typescript
// backend/src/routes/sounds.ts
import { Router, Response, Request } from 'express';
import { AuthRequest } from '../auth';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import multer from 'multer';

const router = Router();
const DATA_DIR = process.env.CCWEB_DATA_DIR || path.join(__dirname, '../../../data');
const PRESETS_DIR = path.join(DATA_DIR, 'sounds', 'presets');
const GLOBAL_SOUNDS_DIR = path.join(DATA_DIR, 'sounds', 'custom');

const PRESETS = [
  { id: 'singing-bowl', name: '磬声', type: 'strike', defaultMode: 'interval' },
  { id: 'water-drops', name: '水滴', type: 'strike', defaultMode: 'interval' },
  { id: 'wind', name: '风声', type: 'ambient', defaultMode: 'loop' },
  { id: 'rain', name: '雨声', type: 'ambient', defaultMode: 'loop' },
  { id: 'keyboard', name: '键盘敲击', type: 'strike', defaultMode: 'interval' },
  { id: 'stream', name: '溪流', type: 'ambient', defaultMode: 'loop' },
];

const GITHUB_SOUND_URL = 'https://github.com/zbc0315/cc-web/releases/download/sounds';

// Multer config: 10MB max, mp3/ogg only
const upload = multer({
  dest: '/tmp/ccweb-uploads',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/ogg', 'audio/mp3'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// GET /presets — list presets with download status
router.get('/presets', (_req: AuthRequest, res: Response): void => {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  const result = PRESETS.map((p) => ({
    ...p,
    downloaded: fs.existsSync(path.join(PRESETS_DIR, `${p.id}.mp3`)),
  }));
  res.json(result);
});

// POST /download/:id — download preset from GitHub Release
router.post('/download/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) { res.status(404).json({ error: 'Preset not found' }); return; }

  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  const destPath = path.join(PRESETS_DIR, `${id}.mp3`);

  if (fs.existsSync(destPath)) {
    res.json({ success: true, cached: true });
    return;
  }

  try {
    await downloadFile(`${GITHUB_SOUND_URL}/${id}.mp3`, destPath);
    res.json({ success: true, cached: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Download failed' });
  }
});

// GET /file/:name — serve global sound file
router.get('/file/:name', (req: AuthRequest, res: Response): void => {
  // Check presets first, then custom
  const presetPath = path.join(PRESETS_DIR, req.params.name);
  const customPath = path.join(GLOBAL_SOUNDS_DIR, req.params.name);
  const filePath = fs.existsSync(presetPath) ? presetPath : fs.existsSync(customPath) ? customPath : null;

  if (!filePath) { res.status(404).json({ error: 'Sound not found' }); return; }
  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(filePath).pipe(res);
});

// GET /project/:projectId/:name — serve project sound file
router.get('/project/:projectId/:name', (req: AuthRequest, res: Response): void => {
  // Need to look up project folder path
  const { getProject } = require('../config');
  const project = getProject(req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const filePath = path.join(project.folderPath, '.ccweb', 'sounds', req.params.name);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Sound not found' }); return; }
  res.setHeader('Content-Type', 'audio/mpeg');
  fs.createReadStream(filePath).pipe(res);
});

// POST /upload — upload custom sound
router.post('/upload', upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const scope = (req.body?.scope as string) || 'global';
  const projectId = req.body?.projectId as string;

  let destDir: string;
  if (scope === 'project' && projectId) {
    const { getProject } = require('../config');
    const project = getProject(projectId);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    destDir = path.join(project.folderPath, '.ccweb', 'sounds');
  } else {
    destDir = GLOBAL_SOUNDS_DIR;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, req.file.originalname);
  fs.renameSync(req.file.path, destPath);
  res.status(201).json({ name: req.file.originalname, scope });
});

// GET /list — list all available sounds (for a project)
router.get('/list', (req: AuthRequest, res: Response): void => {
  const projectId = req.query.projectId as string | undefined;
  const sounds: Array<{ name: string; source: string; type?: string; defaultMode?: string }> = [];

  // 1. Presets (downloaded only)
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  for (const p of PRESETS) {
    if (fs.existsSync(path.join(PRESETS_DIR, `${p.id}.mp3`))) {
      sounds.push({ name: p.name, source: `preset:${p.id}`, type: p.type, defaultMode: p.defaultMode });
    }
  }

  // 2. Global custom sounds
  fs.mkdirSync(GLOBAL_SOUNDS_DIR, { recursive: true });
  try {
    for (const f of fs.readdirSync(GLOBAL_SOUNDS_DIR)) {
      if (f.endsWith('.mp3') || f.endsWith('.ogg')) {
        sounds.push({ name: f, source: `global:${f}` });
      }
    }
  } catch { /* ignore */ }

  // 3. Project custom sounds
  if (projectId) {
    const { getProject } = require('../config');
    const project = getProject(projectId);
    if (project) {
      const projectSoundsDir = path.join(project.folderPath, '.ccweb', 'sounds');
      try {
        if (fs.existsSync(projectSoundsDir)) {
          for (const f of fs.readdirSync(projectSoundsDir)) {
            if (f.endsWith('.mp3') || f.endsWith('.ogg')) {
              sounds.push({ name: f, source: `project:${f}` });
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  res.json(sounds);
});

// Helper: download file following redirects
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u: string, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const mod = u.startsWith('https') ? https : require('http');
      mod.get(u, (response: any) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          get(response.headers.location, redirects + 1);
          return;
        }
        if (response.statusCode !== 200) {
          fs.unlinkSync(dest);
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err: Error) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    };
    get(url);
  });
}

export default router;
```

- [ ] **Step 3: Mount in index.ts**

In `backend/src/index.ts`, add import with other route imports:
```typescript
import soundsRouter from './routes/sounds';
```

After existing route registrations, add:
```typescript
app.use('/api/sounds', authMiddleware, soundsRouter);
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tom/Projects/cc-web/backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/sounds.ts backend/src/index.ts backend/package.json backend/package-lock.json
git commit -m "feat(sound): add sounds API route with preset download and file upload"
```

---

## Task 2: Frontend API functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add sound types and API functions**

Append to `frontend/src/lib/api.ts`:

```typescript
// ── Sound API ─────────────────────────────────────────────────────────────────

export interface SoundPreset {
  id: string;
  name: string;
  type: 'strike' | 'ambient';
  defaultMode: 'loop' | 'interval';
  downloaded: boolean;
}

export interface SoundConfig {
  enabled: boolean;
  source: string;       // "preset:wind" | "global:file.mp3" | "project:file.mp3"
  playMode: 'loop' | 'interval' | 'auto';
  volume: number;       // 0-1
  intervalRange: [number, number]; // seconds
}

export interface AvailableSound {
  name: string;
  source: string;
  type?: string;
  defaultMode?: string;
}

export async function getSoundPresets(): Promise<SoundPreset[]> {
  return request<SoundPreset[]>('GET', '/api/sounds/presets');
}

export async function downloadSoundPreset(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('POST', `/api/sounds/download/${id}`);
}

export async function getAvailableSounds(projectId?: string): Promise<AvailableSound[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return request<AvailableSound[]>('GET', `/api/sounds/list${query}`);
}

export function getSoundFileUrl(source: string, projectId?: string): string {
  const [scope, name] = source.split(':');
  if (scope === 'preset') return `${BASE_URL}/api/sounds/file/${name}.mp3`;
  if (scope === 'project' && projectId) return `${BASE_URL}/api/sounds/project/${projectId}/${name}`;
  return `${BASE_URL}/api/sounds/file/${name}`;
}

export async function uploadSound(file: File, scope: 'global' | 'project', projectId?: string): Promise<{ name: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('scope', scope);
  if (projectId) formData.append('projectId', projectId);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api/sounds/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json() as Promise<{ name: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(sound): add frontend sound API functions"
```

---

## Task 3: SoundPlayer component

**Files:**
- Create: `frontend/src/components/SoundPlayer.tsx`

- [ ] **Step 1: Implement SoundPlayer**

This is an invisible component (renders nothing). It manages audio playback using HTMLAudioElement with gain control via Web Audio API for smooth fade in/out.

```typescript
// frontend/src/components/SoundPlayer.tsx

import { useEffect, useRef, useCallback } from 'react';
import { SoundConfig, getSoundFileUrl } from '@/lib/api';

interface SoundPlayerProps {
  projectId: string;
  config: SoundConfig | null;
  isActive: boolean; // true when LLM is producing output
}

export function SoundPlayer({ projectId, config, isActive }: SoundPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef = useRef(false);

  // Determine effective play mode
  const getEffectiveMode = useCallback((): 'loop' | 'interval' => {
    if (!config) return 'loop';
    if (config.playMode === 'auto') {
      // Determine from source
      const [scope, id] = config.source.split(':');
      if (scope === 'preset') {
        const ambientPresets = ['wind', 'rain', 'stream'];
        return ambientPresets.includes(id) ? 'loop' : 'interval';
      }
      return 'loop'; // default for custom sounds
    }
    return config.playMode;
  }, [config]);

  // Play once (for interval mode)
  const playOnce = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isPlayingRef.current) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  // Schedule next interval play
  const scheduleNext = useCallback(() => {
    if (!config || !isPlayingRef.current) return;
    const [min, max] = config.intervalRange || [3, 8];
    const delay = (min + Math.random() * (max - min)) * 1000;
    intervalTimerRef.current = setTimeout(() => {
      playOnce();
      scheduleNext();
    }, delay);
  }, [config, playOnce]);

  // Start playback with fade in
  const startPlayback = useCallback(() => {
    if (isPlayingRef.current || !audioRef.current || !gainRef.current) return;
    isPlayingRef.current = true;

    const gain = gainRef.current;
    const volume = config?.volume ?? 0.5;
    gain.gain.setValueAtTime(0, audioCtxRef.current!.currentTime);
    gain.gain.linearRampToValueAtTime(volume, audioCtxRef.current!.currentTime + 0.5);

    const mode = getEffectiveMode();
    if (mode === 'loop') {
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.loop = false;
      playOnce();
      scheduleNext();
    }
  }, [config, getEffectiveMode, playOnce, scheduleNext]);

  // Stop playback with fade out
  const stopPlayback = useCallback(() => {
    if (!isPlayingRef.current || !gainRef.current || !audioCtxRef.current) return;
    isPlayingRef.current = false;

    if (intervalTimerRef.current) {
      clearTimeout(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }

    const gain = gainRef.current;
    const ctx = audioCtxRef.current;
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    setTimeout(() => {
      if (!isPlayingRef.current && audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }, 1100);
  }, []);

  // Setup audio element and Web Audio nodes when source changes
  useEffect(() => {
    if (!config?.enabled || !config?.source) return;

    const url = getSoundFileUrl(config.source, projectId);

    // Create AudioContext on first use
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;

    // Create audio element
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    // Connect through gain node
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    gainRef.current = gain;

    return () => {
      isPlayingRef.current = false;
      if (intervalTimerRef.current) clearTimeout(intervalTimerRef.current);
      audio.pause();
      audio.src = '';
      try { source.disconnect(); gain.disconnect(); } catch {}
    };
  }, [config?.source, config?.enabled, projectId]);

  // Update volume when it changes
  useEffect(() => {
    if (gainRef.current && isPlayingRef.current && audioCtxRef.current) {
      gainRef.current.gain.linearRampToValueAtTime(
        config?.volume ?? 0.5,
        audioCtxRef.current.currentTime + 0.3
      );
    }
  }, [config?.volume]);

  // React to activity changes
  useEffect(() => {
    if (!config?.enabled) return;
    if (isActive) {
      // Resume AudioContext if suspended (browser autoplay policy)
      audioCtxRef.current?.resume();
      startPlayback();
    } else {
      stopPlayback();
    }
  }, [isActive, config?.enabled, startPlayback, stopPlayback]);

  return null; // invisible component
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SoundPlayer.tsx
git commit -m "feat(sound): add SoundPlayer component with fade in/out"
```

---

## Task 4: SoundSelector component

**Files:**
- Create: `frontend/src/components/SoundSelector.tsx`

- [ ] **Step 1: Implement SoundSelector**

UI component with:
- Enable/disable toggle (Switch)
- Sound source dropdown (Select) showing presets + custom sounds
- Download button for presets not yet cached
- Play mode selector (循环/随机间隔/自动)
- Volume slider (input range)
- Upload button for custom sounds
- Compact popover layout (triggered from project header)

Uses shadcn/ui: Button, Select, Switch, Label, Popover/PopoverContent/PopoverTrigger.
Icons: Music, Volume2, Upload from lucide-react.

The component:
1. On mount, fetches presets and available sounds
2. When user selects a preset that isn't downloaded, triggers download first
3. Calls `onChange(newConfig)` whenever settings change
4. Upload uses the `uploadSound()` API function

Props: `{ projectId: string; config: SoundConfig; onChange: (config: SoundConfig) => void }`

Wrap UI in a Popover that opens from a music note icon button in the project header.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SoundSelector.tsx
git commit -m "feat(sound): add SoundSelector popover component"
```

---

## Task 5: Integrate into ProjectPage

**Files:**
- Modify: `frontend/src/pages/ProjectPage.tsx`
- Modify: `frontend/src/lib/api.ts` (add project sound config save/load)

- [ ] **Step 1: Add sound config API to api.ts**

Add to `frontend/src/lib/api.ts`:

```typescript
export async function getProjectSoundConfig(projectId: string): Promise<SoundConfig | null> {
  try {
    const project = await request<any>('GET', `/api/projects/${projectId}`);
    return project?.sound || null;
  } catch { return null; }
}

export async function saveProjectSoundConfig(projectId: string, sound: SoundConfig): Promise<void> {
  await request<any>('PATCH', `/api/projects/${projectId}`, { sound });
}
```

Note: This requires the backend projects route to support saving `sound` field. Add to the project PATCH handler in `backend/src/routes/projects.ts` if not already there — pass through `sound` field to `saveProject()`.

- [ ] **Step 2: Add sound config to project type**

In `backend/src/routes/projects.ts`, ensure the PATCH/update handler passes through the `sound` field from request body to the saved project.

- [ ] **Step 3: Integrate SoundPlayer + SoundSelector in ProjectPage**

In `frontend/src/pages/ProjectPage.tsx`:

1. Import SoundPlayer, SoundSelector, and sound config API functions
2. Add state: `const [soundConfig, setSoundConfig] = useState<SoundConfig | null>(null)`
3. Add state: `const [llmActive, setLlmActive] = useState(false)` with a debounce timer
4. On `onTerminalData` callback, set `llmActive = true` and reset a 3-second idle timer that sets it back to `false`
5. Load sound config on mount via the project data
6. Add SoundSelector button (Music icon) in the header bar, next to the backup button
7. Add `<SoundPlayer projectId={id} config={soundConfig} isActive={llmActive} />` in the component body

The LLM activity detection:
```typescript
const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// In the onTerminalData callback:
const handleTerminalData = useCallback((data: string) => {
  // ... existing terminal data handling ...

  // LLM activity detection for sound
  setLlmActive(true);
  if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  idleTimerRef.current = setTimeout(() => setLlmActive(false), 3000);
}, []);
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tom/Projects/cc-web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ProjectPage.tsx frontend/src/lib/api.ts backend/src/routes/projects.ts
git commit -m "feat(sound): integrate sound player and selector into project page"
```

---

## Task 6: Build, verify, version bump, publish

- [ ] **Step 1: Full build**

```bash
cd /Users/tom/Projects/cc-web && npm run build
```

Fix any TypeScript errors.

- [ ] **Step 2: Version bump to v1.5.14**

Update in 4 files:
- `package.json` → `"version": "1.5.14"`
- `frontend/src/components/UpdateButton.tsx` → `currentVersion = 'v1.5.14'`
- `README.md` → version line
- `CLAUDE.md` → version line

- [ ] **Step 3: Update docs**

Add to README.md features list:
```
- **Ambient Sound**: Background sounds (singing bowl, rain, wind, etc.) that play when LLM is active, with custom upload support
```

Add to CLAUDE.md backend table:
```
| `routes/sounds.ts` | Sound file API: presets, download, upload, streaming |
```

Add to CLAUDE.md frontend table:
```
| `components/SoundPlayer.tsx` | Audio playback engine (fade in/out, loop/interval modes) |
| `components/SoundSelector.tsx` | Sound selection and configuration UI |
```

- [ ] **Step 4: Final build, commit, push, npm publish**

```bash
npm run build
git add -A
git commit -m "v1.5.14: Add ambient sound feature"
git push
npm publish --registry https://registry.npmjs.org --access=public
```
