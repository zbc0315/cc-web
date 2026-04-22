import { Router, Request, Response } from 'express';
import * as https from 'https';
import * as yaml from 'js-yaml';
import type { AuthRequest } from '../auth';
import {
  getHubToken, setHubToken, clearHubToken, getHubTokenStatus,
} from '../hub-auth';
import { modLogger } from '../logger';

const log = modLogger('hub');

/**
 * CCWeb Hub proxy.
 *
 * Serves a read-only view of `zbc0315/ccweb-hub`, which stores community-shared
 * Quick Prompts (Shortcuts) and Agent Prompts as individual `.md` files in
 * `quick-prompts/` and `agent-prompts/` directories. Each file has YAML
 * frontmatter (`label`, `kind`, `author`, `tags`, `description`) and a body
 * that is the prompt itself.
 *
 * Submission is handled client-side via a pre-filled GitHub Issue URL — there
 * is no longer any write path through this server (avoids pitfalls #30: no
 * token bundled in the npm package, ever).
 *
 * Plugin Hub (`/plugins` endpoint) still proxies `plugins.json` at repo root
 * for the separate PluginDock install flow.
 */

const router = Router();

const REPO_OWNER = 'zbc0315';
const REPO_NAME = 'ccweb-hub';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main`;
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

// ── HTTP ─────────────────────────────────────────────────────────────────────
//
// Two distinct helpers: `apiGet` talks to the GitHub v3 API (JSON, versioned
// Accept header); `rawGet` fetches raw file content with no content negotiation
// assumption.  Previously a single helper sent the API Accept header for raw
// requests too — harmless today but would break if GitHub raw ever starts to
// respect the Accept header strictly.

function request(url: string, accept: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CCWeb', 'Accept': accept } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) { reject(new Error('Too many redirects')); return; }
        const loc = res.headers.location;
        if (!loc.startsWith('https://')) { reject(new Error('Redirect to non-HTTPS URL blocked')); return; }
        request(loc, accept, maxRedirects - 1).then(resolve, reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve(data);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

const apiGet = (url: string) => request(url, 'application/vnd.github.v3+json');
const rawGet = (url: string) => request(url, '*/*');

/** POST to GitHub API with an Authorization: Bearer token.  Used for Issue
 *  creation under the caller's own PAT — the token never lives on the
 *  server beyond the duration of this call's Bearer header. */
function apiPost(urlPath: string, token: string, body: unknown): Promise<string> {
  const url = new URL(`${API_BASE}${urlPath}`);
  const postData = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'User-Agent': 'CCWeb',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
        } else {
          resolve(data);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Frontmatter parsing ──────────────────────────────────────────────────────
//
// Uses `js-yaml` (battle-tested) rather than a hand-rolled regex.  The earlier
// parser mishandled multiline values, quoted colons inside strings, block-style
// arrays, and doubled-quoted edge cases — any one of which would silently
// corrupt a hub entry. `js-yaml` + `FAILSAFE_SCHEMA` handles everything we
// document, and individual file failures never take down the whole hub
// (per-file try/catch in `fetchKind` swallows and moves on).

export interface HubItem {
  id: string;                    // stable key = `${kind}/${basename}`
  kind: 'quick-prompt' | 'agent-prompt';
  label: string;
  body: string;                  // prompt content (below frontmatter)
  author?: string;
  tags?: string[];
  description?: string;
  /** Filename in the hub repo. Preserved for debugging / direct linking. */
  file: string;
}

interface FrontmatterMeta {
  label?: string;
  kind?: string;
  author?: string;
  tags?: unknown;
  description?: string;
  [key: string]: unknown;
}

function parseMarkdown(raw: string): { meta: FrontmatterMeta; body: string } {
  // Recognize `---\n<yaml>\n---\n<body>`; anything else → whole file is body.
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  let meta: FrontmatterMeta = {};
  try {
    const loaded = yaml.load(match[1], { schema: yaml.FAILSAFE_SCHEMA });
    if (loaded && typeof loaded === 'object') meta = loaded as FrontmatterMeta;
  } catch {
    // YAML malformed — treat as no frontmatter rather than crashing the hub
  }
  return { meta, body: match[2].trimStart() };
}

function coerceTags(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const out = raw.filter((x): x is string => typeof x === 'string');
    return out.length ? out : undefined;
  }
  if (typeof raw === 'string') {
    // Single string → split on comma for forgiving input
    const split = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return split.length ? split : undefined;
  }
  return undefined;
}

// ── Cache ────────────────────────────────────────────────────────────────────

let cachedItems: HubItem[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

interface GithubContentFile {
  name: string;
  path: string;
  type: string;
  download_url?: string | null;
}

async function listDir(dir: string): Promise<GithubContentFile[]> {
  try {
    const raw = await apiGet(`${API_BASE}/contents/${dir}`);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as GithubContentFile[]).filter((f) => f && f.type === 'file' && f.name.endsWith('.md'))
      : [];
  } catch {
    return []; // 404 = directory empty / absent — not an error
  }
}

async function fetchKind(kind: 'quick-prompt' | 'agent-prompt'): Promise<HubItem[]> {
  const dir = kind === 'quick-prompt' ? 'quick-prompts' : 'agent-prompts';
  const files = await listDir(dir);
  if (files.length === 0) return [];

  // Raw fetches are on raw.githubusercontent.com (not counted against the
  // 60/hr GitHub API anon limit), so parallelizing is safe.
  const results = await Promise.allSettled(
    files.map(async (file): Promise<HubItem | null> => {
      if (!file.download_url) return null;
      try {
        const content = await rawGet(file.download_url);
        const { meta, body } = parseMarkdown(content);
        const basename = file.name.replace(/\.md$/, '');
        const label = typeof meta.label === 'string' && meta.label ? meta.label : basename;
        return {
          id: `${kind}/${basename}`,
          kind,
          label,
          body: body.trim(),
          author: typeof meta.author === 'string' ? meta.author : undefined,
          tags: coerceTags(meta.tags),
          description: typeof meta.description === 'string' ? meta.description : undefined,
          file: `${dir}/${file.name}`,
        };
      } catch {
        return null; // One bad file can't poison the whole kind
      }
    }),
  );
  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((x): x is HubItem => x !== null);
}

async function fetchAllItems(forceRefresh = false): Promise<HubItem[]> {
  const now = Date.now();
  if (!forceRefresh && cachedItems && (now - cacheTime) < CACHE_TTL) {
    return cachedItems;
  }
  // Resolve each kind independently — a transient failure on one directory
  // should not make the whole hub appear broken.
  const [quickRes, agentRes] = await Promise.allSettled([
    fetchKind('quick-prompt'),
    fetchKind('agent-prompt'),
  ]);
  const quick = quickRes.status === 'fulfilled' ? quickRes.value : [];
  const agent = agentRes.status === 'fulfilled' ? agentRes.value : [];
  if (quickRes.status === 'rejected') log.warn({ err: quickRes.reason }, 'hub quick-prompts fetch failed');
  if (agentRes.status === 'rejected') log.warn({ err: agentRes.reason }, 'hub agent-prompts fetch failed');
  cachedItems = [...quick, ...agent];
  cacheTime = now;
  return cachedItems;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /items  — unified list of Quick Prompts + Agent Prompts in ccweb-hub
router.get('/items', async (_req: Request, res: Response) => {
  try {
    const items = await fetchAllItems();
    res.json(items);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch ccweb-hub', detail: (err as Error).message });
  }
});

// GET /skills  — legacy alias for pre-hub clients.  Returns the Quick Prompts
// subset in the old SkillHubItem shape.  `createdAt` is set to current ISO so
// clients that sort by date don't choke on empty strings.
router.get('/skills', async (_req: Request, res: Response) => {
  try {
    const items = await fetchAllItems();
    const iso = new Date().toISOString();
    const legacy = items
      .filter((i) => i.kind === 'quick-prompt')
      .map((i) => ({
        id: i.id,
        label: i.label,
        command: i.body,
        description: i.description ?? '',
        author: i.author ?? 'anonymous',
        tags: i.tags ?? [],
        downloads: 0,
        createdAt: iso,
      }));
    res.json(legacy);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch ccweb-hub', detail: (err as Error).message });
  }
});

// ── Hub auth (per-user GitHub PAT for one-click Issue submit) ──────────────

function requireUsername(req: AuthRequest, res: Response): string | null {
  const u = req.user?.username;
  if (!u) { res.status(401).json({ error: 'Unauthenticated' }); return null; }
  return u;
}

// GET /auth  → { configured, needsReset }
router.get('/auth', (req: AuthRequest, res: Response) => {
  const user = requireUsername(req, res);
  if (!user) return;
  res.json(getHubTokenStatus(user));
});

// PUT /auth  body { token: string }
router.put('/auth', (req: AuthRequest, res: Response) => {
  const user = requireUsername(req, res);
  if (!user) return;
  const token = typeof (req.body as { token?: unknown })?.token === 'string'
    ? (req.body as { token: string }).token.trim()
    : '';
  if (!token) { res.status(400).json({ error: 'token required' }); return; }
  // Light sanity check — GitHub PATs start with ghp_ / github_pat_ etc. and
  // are ≥40 chars.  Don't block unusual forms outright; GitHub will reject.
  // Printable ASCII only — GitHub PATs live in this range; rejecting
  // zero-width spaces / BOM / other invisibles prevents the common
  // copy-paste-from-formatted-source bug that would otherwise store a
  // token GitHub will silently 401 on forever.
  if (token.length < 20 || token.length > 200 || !/^[\x21-\x7E]+$/.test(token)) {
    res.status(400).json({ error: 'token contains whitespace / non-printable characters, or has an unexpected length' });
    return;
  }
  setHubToken(user, token);
  res.json({ ok: true, ...getHubTokenStatus(user) });
});

// DELETE /auth  → wipe stored token
router.delete('/auth', (req: AuthRequest, res: Response) => {
  const user = requireUsername(req, res);
  if (!user) return;
  clearHubToken(user);
  res.json({ ok: true });
});

// POST /submit  body { kind, label, body, description?, tags?, author? }
// Posts an Issue to zbc0315/ccweb-hub using the caller's stored PAT.
router.post('/submit', async (req: AuthRequest, res: Response) => {
  const user = requireUsername(req, res);
  if (!user) return;

  const token = getHubToken(user);
  if (!token) {
    res.status(412).json({ error: 'Hub token not configured — set one in Settings → CCWeb Hub' });
    return;
  }

  const b = (req.body ?? {}) as {
    kind?: string;
    label?: string;
    body?: string;
    description?: string;
    tags?: unknown;
    author?: string;
  };
  if (b.kind !== 'quick-prompt' && b.kind !== 'agent-prompt') {
    res.status(400).json({ error: 'kind must be "quick-prompt" or "agent-prompt"' });
    return;
  }
  if (!b.label || typeof b.label !== 'string' || !b.body || typeof b.body !== 'string') {
    res.status(400).json({ error: 'label and body are required strings' });
    return;
  }
  // Newlines in GitHub Issue title get silently truncated; reject early so
  // the submit flow doesn't produce a half-titled issue.  Same-ish for the
  // optional fields — keep them single-line, reasonable length.
  if (/[\r\n]/.test(b.label) || b.label.length > 200) {
    res.status(400).json({ error: 'label must be single-line and ≤ 200 chars' });
    return;
  }
  if (typeof b.description === 'string' && (/[\r\n]/.test(b.description) || b.description.length > 300)) {
    res.status(400).json({ error: 'description must be single-line and ≤ 300 chars' });
    return;
  }
  if (typeof b.author === 'string' && (/[\r\n\s]/.test(b.author) || b.author.length > 64)) {
    res.status(400).json({ error: 'author must be a single token (no whitespace), ≤ 64 chars' });
    return;
  }

  const kindLabel = b.kind === 'quick-prompt' ? 'Quick Prompt' : 'Agent Prompt';
  // Code-point-safe title slice to avoid splitting surrogate pairs
  const titleRaw = `[${kindLabel}] ${b.label}`;
  const title = Array.from(titleRaw).slice(0, 240).join('');

  // Dynamic fence — user content containing backticks can't close the block
  const backtickRuns = b.body.match(/`+/g) ?? [];
  const maxRun = backtickRuns.reduce((m, r) => Math.max(m, r.length), 0);
  const fence = '`'.repeat(Math.max(3, maxRun + 1));

  const author = typeof b.author === 'string' && b.author.trim() ? b.author.trim() : 'anonymous';
  const tagList = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === 'string')
    : [];

  const bodyMd =
    `<!-- Submitted via ccweb. Review, then commit to ${b.kind}s/ as a .md file. -->\n\n` +
    '```yaml\n' +
    '---\n' +
    `label: ${JSON.stringify(b.label)}\n` +
    `kind: ${JSON.stringify(b.kind)}\n` +
    `author: ${JSON.stringify(author)}\n` +
    (tagList.length ? `tags: ${JSON.stringify(tagList)}\n` : '') +
    (b.description && b.description.trim() ? `description: ${JSON.stringify(b.description.trim())}\n` : '') +
    '---\n' +
    '```\n\n' +
    '## Body\n\n' +
    `${fence}\n` +
    b.body +
    `\n${fence}\n`;

  try {
    const raw = await apiPost('/issues', token, {
      title,
      body: bodyMd,
      labels: [b.kind],
    });
    const parsed = JSON.parse(raw) as { number?: number; html_url?: string };
    res.json({ ok: true, issueNumber: parsed.number, issueUrl: parsed.html_url });
  } catch (err) {
    const msg = (err as Error).message;
    // Surface GitHub 401 / 403 distinctly so the UI can prompt for a fresh token
    const is401 = /GitHub API 401/.test(msg);
    const is403 = /GitHub API 403/.test(msg);
    res.status(is401 || is403 ? 401 : 502).json({
      error: is401
        ? 'GitHub token invalid or expired — update in Settings'
        : is403
          ? 'GitHub rejected the request (token scope too narrow, or rate-limited)'
          : `Failed to submit: ${msg}`,
    });
  }
});

// ── Plugin Hub (unchanged — proxies plugins.json at hub repo root) ─────────

let _pluginCache: unknown[] | null = null;
let _pluginCacheTime = 0;
const PLUGIN_CACHE_TTL = 5 * 60_000;

router.get('/plugins', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (_pluginCache && now - _pluginCacheTime < PLUGIN_CACHE_TTL) {
    return res.json(_pluginCache);
  }
  try {
    const data = await rawGet(`${RAW_BASE}/plugins.json`);
    const plugins = JSON.parse(data);
    _pluginCache = Array.isArray(plugins) ? plugins : [];
    _pluginCacheTime = now;
    res.json(_pluginCache);
  } catch {
    res.json(_pluginCache ?? []);
  }
});

export default router;
