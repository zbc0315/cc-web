/**
 * /api/projects/:projectId/track-flows/* routes — track-flow CRUD (M1).
 *
 * Endpoints:
 *   GET  /:projectId/track-flows              — list
 *   GET  /:projectId/track-flows/file/:filename — load flow + trainJson
 *   PUT  /:projectId/track-flows/file/:filename — save flow (+ optional trainJson)
 *   DELETE /:projectId/track-flows/file/:filename — delete flow + sidecar
 */

import { Router, Response } from 'express'
import { AuthRequest } from '../auth'
import { getProject } from '../config'
import { requireProjectOwner } from '../middleware/authz'
import {
  listFlows,
  loadFlow,
  saveFlow,
  deleteFlow,
  loadTrainJson,
  saveTrainJson,
  sanitizeFlowFilename,
} from '../track-flow/store'
import { modLogger } from '../logger'

const log = modLogger('track-flows-route')

export function buildTrackFlowsRouter(): Router {
  const router = Router()

  // GET /api/projects/:projectId/track-flows
  router.get(
    '/:projectId/track-flows',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.json({ files: listFlows(project.folderPath) })
    },
  )

  // GET /api/projects/:projectId/track-flows/file/:filename
  router.get(
    '/:projectId/track-flows/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const flow = loadFlow(project.folderPath, basename)
      if (flow === null) {
        res.status(404).json({ error: 'flow not found' })
        return
      }
      const trainJson = loadTrainJson(project.folderPath, basename)
      res.json({ filename: `${basename}.flow`, flow, trainJson })
    },
  )

  // PUT /api/projects/:projectId/track-flows/file/:filename
  // body: { flow: object, trainJson?: object }
  router.put(
    '/:projectId/track-flows/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }

      const { flow, trainJson } = req.body ?? {}

      // flow validation
      if (typeof flow !== 'object' || flow === null || Array.isArray(flow)) {
        res.status(400).json({ error: 'body.flow must be a non-null object' })
        return
      }
      const flowStr = JSON.stringify(flow)
      if (flowStr.length > 1_048_576) {
        res.status(413).json({ error: 'flow too large (>1MB)' })
        return
      }

      // trainJson validation (only when key is present)
      const hasTrainJson = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'trainJson')
      if (hasTrainJson && trainJson != null) {
        if (typeof trainJson !== 'object' || Array.isArray(trainJson)) {
          res.status(400).json({ error: 'body.trainJson must be an object' })
          return
        }
        if (JSON.stringify(trainJson).length > 524_288) {
          res.status(413).json({ error: 'trainJson too large (>512KB)' })
          return
        }
      }

      const ok = saveFlow(project.folderPath, basename, flow)
      if (!ok) {
        res.status(500).json({ error: 'failed to save flow' })
        return
      }

      if (hasTrainJson && trainJson != null) {
        const okT = saveTrainJson(
          project.folderPath,
          basename,
          trainJson as Record<string, unknown>,
        )
        if (!okT) {
          res.status(500).json({ error: 'failed to save trainJson' })
          return
        }
      }

      log.info(
        { projectId: project.id, basename, flowBytes: flowStr.length },
        'track-flow saved',
      )
      res.json({ ok: true })
    },
  )

  // DELETE /api/projects/:projectId/track-flows/file/:filename
  router.delete(
    '/:projectId/track-flows/file/:filename',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const ok = deleteFlow(project.folderPath, basename)
      res.json({ ok })
    },
  )

  return router
}
