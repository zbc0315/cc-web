import { Router, Response } from 'express';
import type { AuthRequest } from '../auth';
import { getProjects } from '../config';
import { getAllTodos, createTodo, updateTodo, deleteTodo, type TodoPatch } from '../todos';

const router = Router();

function requireUser(req: AuthRequest, res: Response): string | null {
  const u = req.user?.username;
  if (!u) { res.status(401).json({ error: 'Unauthenticated' }); return null; }
  return u;
}

// GET /api/todos → one block per (non-archived) project with its todos.
// Blocks are derived from the project list, so new/existing projects all show.
router.get('/', (req: AuthRequest, res: Response): void => {
  const user = requireUser(req, res);
  if (!user) return;
  const all = getAllTodos(user);
  const blocks = getProjects()
    .filter((p) => !p.archived)
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      todos: (all[p.id] ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  res.json({ blocks });
});

// POST /api/todos  { projectId, parentId?, title, description?, status?, plannedDate?, actualDate? }
router.post('/', (req: AuthRequest, res: Response): void => {
  const user = requireUser(req, res);
  if (!user) return;
  const b = (req.body ?? {}) as { projectId?: string; title?: string };
  if (!b.projectId || typeof b.title !== 'string' || !b.title.trim()) {
    res.status(400).json({ error: 'projectId and title are required' });
    return;
  }
  if (!getProjects().some((p) => p.id === b.projectId)) {
    res.status(404).json({ error: 'Unknown project' });
    return;
  }
  try {
    res.json(createTodo(user, req.body));
  } catch (e) {
    if (e instanceof Error && e.message === 'BAD_PARENT') {
      res.status(400).json({ error: 'parent not found in this project' });
      return;
    }
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// PUT /api/todos/:id  body: { projectId, ...patch }
router.put('/:id', (req: AuthRequest, res: Response): void => {
  const user = requireUser(req, res);
  if (!user) return;
  const { projectId, ...patch } = (req.body ?? {}) as { projectId?: string } & TodoPatch;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  const updated = updateTodo(user, projectId, req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json(updated);
});

// DELETE /api/todos/:id?projectId=  (cascades to descendants)
router.delete('/:id', (req: AuthRequest, res: Response): void => {
  const user = requireUser(req, res);
  if (!user) return;
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  res.json({ ok: deleteTodo(user, projectId, req.params.id) });
});

export default router;
