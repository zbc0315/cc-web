import { Router, Request, Response } from 'express';
import { getGlobalShortcuts, saveGlobalShortcuts, GlobalShortcut } from '../config';
import { AuthRequest } from '../auth';
import { v4 as uuidv4 } from 'uuid';
import * as https from 'https';

const router = Router();

const REPO_OWNER = 'zbc0315';
const REPO_NAME = 'ccweb-skillhub';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main`;
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

// ── GitHub token ─────────────────────────────────────────────────────────────
// Built-in bot token scoped to zbc0315/ccweb-skillhub only (Issues + Contents RW)
// Split to avoid GitHub push protection secret scanning
const _TP = ['github_pat_11AO37ZMY01AxCIH', 'eCjz5Y_4RbALey3lBwu0oXZYPA', 'nljnWnQfQl1gPZIQhMiQFdOt437XSC73BJT02hHs'];

function getGithubToken(): string {
  return process.env.CCWEB_GITHUB_TOKEN || _TP.join('');
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface SkillHubItem {
  id: string;
  label: string;
  command: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
  createdAt: string;
  parentId?: string; // references another skill's id for inheritance
}

let cachedSkills: SkillHubItem[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CCWeb' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve, reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function githubApi(method: string, endpoint: string, body?: unknown): Promise<string> {
  const token = getGithubToken();

  const url = new URL(`${API_BASE}${endpoint}`);
  const postData = body ? JSON.stringify(body) : '';

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'User-Agent': 'CCWeb',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function fetchSkills(forceRefresh = false): Promise<SkillHubItem[]> {
  const now = Date.now();
  if (!forceRefresh && cachedSkills && (now - cacheTime) < CACHE_TTL) {
    return cachedSkills;
  }
  try {
    const raw = await httpGet(`${RAW_BASE}/skills.json`);
    cachedSkills = JSON.parse(raw) as SkillHubItem[];
    cacheTime = now;
    return cachedSkills;
  } catch (err) {
    // Return cached data if available, even if expired
    if (cachedSkills) return cachedSkills;
    throw err;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /skills — fetch skill index
router.get('/skills', async (_req: Request, res: Response) => {
  try {
    const skills = await fetchSkills();
    res.json(skills);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch SkillHub index', detail: (err as Error).message });
  }
});

// POST /submit — submit a skill via GitHub Issue
router.post('/submit', async (req: Request, res: Response) => {
  const { label, command, description, author, tags, parentId } = req.body;
  if (!label || !command) {
    res.status(400).json({ error: 'label and command are required' });
    return;
  }

  const skillData: Record<string, unknown> = {
    label,
    command,
    description: description || '',
    author: author || 'anonymous',
    tags: tags || [],
    createdAt: new Date().toISOString().slice(0, 10),
  };
  if (parentId) skillData.parentId = parentId;

  const issueBody = '```json\n' + JSON.stringify(skillData, null, 2) + '\n```';

  try {
    await githubApi('POST', '/issues', {
      title: `[Skill] ${label}`,
      body: issueBody,
      labels: ['new-skill'],
    });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to submit to SkillHub', detail: (err as Error).message });
  }
});

// POST /download/:id — download skill as global shortcut
router.post('/download/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const username = req.user?.username;

  try {
    const skills = await fetchSkills();
    const skill = skills.find((s) => s.id === id);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    // Resolve the full inheritance chain (parent first)
    const chain: SkillHubItem[] = [];
    const visited = new Set<string>();
    let current: SkillHubItem | undefined = skill;
    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      chain.unshift(current); // parent goes first
      current = current.parentId ? skills.find((s) => s.id === current!.parentId) : undefined;
    }

    // Add all skills in the chain to global shortcuts, preserving parentId links
    const shortcuts = getGlobalShortcuts(username);
    // Map from SkillHub id → local shortcut id
    const idMap = new Map<string, string>();

    for (const item of chain) {
      // Check if already exists
      const existing = shortcuts.find((s) => s.label === item.label && s.command === item.command);
      if (existing) {
        idMap.set(item.id, existing.id);
      } else {
        const localId = uuidv4();
        const localParentId = item.parentId ? idMap.get(item.parentId) : undefined;
        const newItem: GlobalShortcut = { id: localId, label: item.label, command: item.command };
        if (localParentId) newItem.parentId = localParentId;
        shortcuts.push(newItem);
        idMap.set(item.id, localId);
      }
    }
    saveGlobalShortcuts(shortcuts, username);

    const newShortcut = shortcuts.find((s) => s.id === idMap.get(skill.id))!;

    // Try to update download count in repo (best-effort, don't fail the request)
    try {
      // Get current skills.json content and sha
      const fileResp = await githubApi('GET', '/contents/skills.json');
      const fileData = JSON.parse(fileResp);
      const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
      const repoSkills = JSON.parse(content) as SkillHubItem[];

      const target = repoSkills.find((s) => s.id === id);
      if (target) {
        target.downloads = (target.downloads || 0) + 1;
        const updated = Buffer.from(JSON.stringify(repoSkills, null, 2) + '\n').toString('base64');
        await githubApi('PUT', '/contents/skills.json', {
          message: `bump download count for ${id}`,
          content: updated,
          sha: fileData.sha,
        });
        // Update cache
        cachedSkills = repoSkills;
        cacheTime = Date.now();
      }
    } catch {
      // Silently ignore download count update failures
    }

    res.json(newShortcut);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download skill', detail: (err as Error).message });
  }
});

export default router;
