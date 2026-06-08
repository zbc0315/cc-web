/**
 * MCP tool registry. Each tool wraps one daemon-side REST endpoint with a
 * Zod input schema (validated by McpServer) + a JSON response payload.
 *
 * Tools return `{ content: [{ type: 'text', text: string }] }` per the MCP
 * spec. For structured data, we serialize JSON into the text block — most
 * MCP clients (Claude Code / Codex) display it raw or feed it back to the
 * model. We also set isError=true on failures so the model sees the failure.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDaemonClient } from './daemon-client.js';

interface Project {
  id: string;
  name: string;
  folderPath: string;
  cliTool?: string;
  archived?: boolean;
  status?: string;
  tags?: string[];
  shares?: { username: string; permission: string }[];
}

const PROJECT_ID = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'projectId must be a UUID',
  );

function ok(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function err(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function safe<T>(fn: () => Promise<T>): Promise<T | { content: { type: 'text'; text: string }[]; isError: true }> {
  try {
    return await fn();
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function registerTools(server: McpServer): void {
  const client = getDaemonClient();

  // ─── projects ─────────────────────────────────────────────────────────────

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'List all projects visible to the caller. Filter by `archived: true|false`. Omitting `archived` returns every project (active + archived).',
      inputSchema: { archived: z.boolean().optional() },
    },
    async ({ archived }) => safe(async () => {
      const projects = await client.request<Project[]>('GET', '/api/projects');
      const filtered = archived === undefined
        ? projects
        : projects.filter((p) => !!p.archived === archived);
      return ok(filtered.map((p) => ({
        id: p.id,
        name: p.name,
        folderPath: p.folderPath,
        cliTool: p.cliTool,
        archived: !!p.archived,
        status: p.status,
        tags: p.tags ?? [],
      })));
    }),
  );

  server.registerTool(
    'archive_project',
    {
      title: 'Archive a project',
      description: 'Move a project to the archived list. Stops its terminal first.',
      inputSchema: { projectId: PROJECT_ID },
    },
    async ({ projectId }) => safe(async () => {
      const result = await client.request<Project>('PATCH', `/api/projects/${projectId}/archive`);
      return ok({ id: result.id, name: result.name, archived: !!result.archived });
    }),
  );

  server.registerTool(
    'unarchive_project',
    {
      title: 'Unarchive a project',
      description: 'Move a project back from the archived list. Does not auto-start its terminal.',
      inputSchema: { projectId: PROJECT_ID },
    },
    async ({ projectId }) => safe(async () => {
      const result = await client.request<Project>('PATCH', `/api/projects/${projectId}/unarchive`);
      return ok({ id: result.id, name: result.name, archived: !!result.archived });
    }),
  );

  // ─── filesystem ───────────────────────────────────────────────────────────

  server.registerTool(
    'list_files',
    {
      title: 'List a project directory',
      description:
        'List files and directories inside the project folder. `subPath` is relative to the project root; omit to list root.',
      inputSchema: { projectId: PROJECT_ID, subPath: z.string().optional() },
    },
    async ({ projectId, subPath }) => safe(async () => {
      const projects = await client.request<Project[]>('GET', '/api/projects');
      const project = projects.find((p) => p.id === projectId);
      if (!project) return err(`Project ${projectId} not found`);
      const target = subPath
        ? `${project.folderPath}/${subPath}`.replace(/\/+/g, '/')
        : project.folderPath;
      const result = await client.request<{
        path: string;
        parent: string | null;
        entries: { name: string; type: 'dir' | 'file'; path: string }[];
      }>('GET', `/api/filesystem?path=${encodeURIComponent(target)}`);
      return ok({
        path: result.path,
        entries: result.entries.map((e) => ({
          name: e.name,
          type: e.type,
          relativePath: e.path.startsWith(project.folderPath + '/')
            ? e.path.slice(project.folderPath.length + 1)
            : e.path,
        })),
      });
    }),
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read a file from a project',
      description:
        'Read a UTF-8 text file from the project. `path` may be absolute or relative to the project root. Files > 5 MB or binary return metadata only (no content).',
      inputSchema: { projectId: PROJECT_ID, path: z.string() },
    },
    async ({ projectId, path: filePath }) => safe(async () => {
      const projects = await client.request<Project[]>('GET', '/api/projects');
      const project = projects.find((p) => p.id === projectId);
      if (!project) return err(`Project ${projectId} not found`);
      const target = filePath.startsWith('/')
        ? filePath
        : `${project.folderPath}/${filePath}`;
      const result = await client.request<{
        path: string;
        binary?: boolean;
        tooLarge?: boolean;
        size: number;
        content: string | null;
      }>('GET', `/api/filesystem/file?path=${encodeURIComponent(target)}`);
      if (result.tooLarge) {
        return ok({
          path: result.path,
          size: result.size,
          tooLarge: true,
          note: 'File exceeds the 5 MB inline read limit. Read it from disk directly or have the user split it before retrying.',
        });
      }
      if (result.binary) {
        return ok({
          path: result.path,
          size: result.size,
          binary: true,
          note: 'File contains binary data (null bytes in first 8KB). Cannot return as text.',
        });
      }
      return ok({ path: result.path, size: result.size, content: result.content });
    }),
  );

  // ─── memory ───────────────────────────────────────────────────────────────

  server.registerTool(
    'read_memory',
    {
      title: 'Read project memory prompts',
      description:
        'List all memory prompts (CLAUDE.md / AGENTS.md fragments) for a project, including which are currently inserted into the instructions file.',
      inputSchema: { projectId: PROJECT_ID },
    },
    async ({ projectId }) => safe(async () => {
      const result = await client.request<{
        items: { filename: string; body: string; inserted: boolean }[];
        instructionsFilename: string;
        claudeMdLineCount: number;
      }>('GET', `/api/memory/project/${projectId}`);
      return ok({
        instructionsFilename: result.instructionsFilename,
        instructionsFileLineCount: result.claudeMdLineCount,
        prompts: result.items.map((p) => ({
          filename: p.filename,
          inserted: p.inserted,
          body: p.body,
        })),
      });
    }),
  );

  // ─── LLM I/O ──────────────────────────────────────────────────────────────

  server.registerTool(
    'send_to_llm',
    {
      title: 'Send a prompt to a project\'s LLM',
      description:
        'Send text into the project\'s CLI session (paste-mode by default, which submits via Enter). Returns `{ ok, sentAt }` immediately — does NOT wait for the LLM to respond. Pass the returned `sentAt` to `wait_for_llm` so it can recognize the new assistant turn even if it completes very quickly. Use mode="raw" for slash commands like "/help" that need to be typed line-start.',
      inputSchema: {
        projectId: PROJECT_ID,
        text: z.string(),
        mode: z.enum(['paste', 'raw']).optional(),
      },
    },
    async ({ projectId, text, mode }) => safe(async () => {
      const result = await client.request<{ ok: boolean; sentAt: string }>(
        'POST',
        `/api/projects/${projectId}/send-input`,
        { text, mode },
      );
      return ok({ ok: result.ok, sentAt: result.sentAt });
    }),
  );

  server.registerTool(
    'wait_for_llm',
    {
      title: 'Wait for the LLM to finish a turn',
      description:
        'Wait for the project\'s LLM turn to complete, then return the chat blocks the LLM produced. Pass the `sentAt` returned by `send_to_llm` (recommended) — wait_for_llm will return as soon as a NEW assistant ChatBlock with timestamp > sentAt has arrived AND the PTY has been quiet for ~30s. Without sentAt the tool falls back to active→idle edge detection, which can miss turns shorter than the 1s poll interval. `timeoutMs` defaults to 600000 (10 min).',
      inputSchema: {
        projectId: PROJECT_ID,
        sentAt: z.string().datetime().optional(),
        timeoutMs: z.number().int().positive().max(3_600_000).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ projectId, sentAt, timeoutMs, limit }) => safe(async () => {
      const deadline = Date.now() + (timeoutMs ?? 600_000);
      const POLL_MS = 1000;
      const sentAtMs = sentAt ? Date.parse(sentAt) : null;
      const historyLimit = limit ?? 10;
      let observedActive = false;
      let sawIdle = false;
      let sawNewAssistant = false;

      // Returns true once we believe the turn the caller anchored is done.
      // Two-conditions when sentAt is provided:
      //   1. there is at least one assistant ChatBlock with timestamp > sentAt
      //   2. semantic-status is currently idle (active=false) — guards against
      //      returning between two assistant blocks in the same turn (Claude
      //      can emit multiple blocks if it uses tools mid-turn)
      // Falls back to active-edge detection when sentAt is absent.
      const checkDone = async (): Promise<boolean> => {
        const status = await client.request<{ active: boolean }>(
          'GET',
          `/api/projects/${projectId}/semantic-status`,
        );
        if (status.active) {
          observedActive = true;
          sawIdle = false;
          return false;
        }
        // active=false from here on
        if (sentAtMs !== null) {
          // Cheap check first: only fetch history if we haven't yet observed
          // a new assistant block.
          if (!sawNewAssistant) {
            const recent = await client.request<{
              blocks: { role?: string; timestamp?: string }[];
            }>('GET', `/api/projects/${projectId}/chat-history?limit=${historyLimit}`);
            sawNewAssistant = recent.blocks.some(
              (b) => b.role === 'assistant' && b.timestamp && Date.parse(b.timestamp) > sentAtMs,
            );
          }
          if (sawNewAssistant) {
            sawIdle = true;
            return true;
          }
          return false;
        }
        // Legacy path: rely on active→idle edge.
        if (observedActive) { sawIdle = true; return true; }
        return false;
      };

      while (Date.now() < deadline) {
        if (await checkDone()) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      const history = await client.request<{
        blocks: { id: string; role?: string; timestamp?: string; blocks?: unknown[] }[];
        hasMore: boolean;
      }>('GET', `/api/projects/${projectId}/chat-history?limit=${historyLimit}`);

      const deadlineHit = Date.now() >= deadline;
      return ok({
        observedActive,
        idle: sawIdle,
        sawNewAssistant: sentAtMs !== null ? sawNewAssistant : undefined,
        deadlineHit,
        blocks: history.blocks,
      });
    }),
  );
}
