/**
 * /api/projects/:projectId/tracks/* routes — track CRUD (read/delete only).
 *
 * Runtime (run/start/stop/status) removed in M0 cleanup.
 */

import { Router, Response } from 'express'
import { AuthRequest } from '../auth'
import { getProject } from '../config'
import { requireProjectOwner } from '../middleware/authz'
import {
  deleteTrack,
  listTracks,
  loadTrack,
  sanitizeTrackFilename,
  loadSidecar,
} from '../tracks/store'
import { modLogger } from '../logger'

const log = modLogger('tracks-route')

export function buildTracksRouter(): Router {
  const router = Router()

  // GET /api/projects/:projectId/tracks
  router.get(
    '/:projectId/tracks',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.json({ files: listTracks(project.folderPath) })
    },
  )

  // GET /api/projects/:projectId/tracks/file/:filename → { source }
  router.get(
    '/:projectId/tracks/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const safe = sanitizeTrackFilename(req.params.filename)
      if (!safe) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const source = loadTrack(project.folderPath, safe)
      if (source === null) {
        res.status(404).json({ error: 'Track not found' })
        return
      }
      const sidecar = loadSidecar(project.folderPath, safe)
      res.json({ filename: safe, source, sidecar })
    },
  )

  // DELETE /api/projects/:projectId/tracks/file/:filename
  router.delete(
    '/:projectId/tracks/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const safe = sanitizeTrackFilename(req.params.filename)
      if (!safe) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const ok = deleteTrack(project.folderPath, safe)
      log.info({ projectId: project.id, filename: safe, ok }, 'track deleted')
      res.json({ ok })
    },
  )

  return router
}
