import { Response, NextFunction } from 'express';
import { AuthRequest } from '../auth';
import { getProject, isAdminUser, isProjectOwner } from '../config';

/**
 * Require admin. Use after `authMiddleware`.
 * Fails closed (403) when req.user is missing or not admin.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
}

/**
 * Require owner (or admin) of the project identified by the given route param.
 * Use after `authMiddleware`. 404 when project not found, 403 when not owner.
 */
export function requireProjectOwner(paramName: string = 'projectId') {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const id = (req.params as Record<string, string>)[paramName];
    if (!id) {
      res.status(400).json({ error: `Missing param: ${paramName}` });
      return;
    }
    const project = getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!isProjectOwner(project, req.user?.username)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
