/**
 * /api/projects/:projectId/tracks/* routes — track CRUD + runtime.
 *
 * Mirrors backend/src/routes/flows.ts shape, adapted for .tr source
 * files instead of FlowDef JSON. Routes are read/write of UTF-8 text,
 * no per-node schema validation (parse errors surface at run time).
 */

import { Router, Response } from 'express'
import { AuthRequest } from '../auth'
import { getProject } from '../config'
import { requireProjectOwner } from '../middleware/authz'
import {
  deleteTrack,
  listTracks,
  loadTrack,
  saveTrack,
  resolveTrackPath,
  sanitizeTrackFilename,
  loadGlobalTrack,
  resolveGlobalTrackPath,
  saveSidecar,
  loadSidecar,
  deleteSidecar,
} from '../tracks/store'
import type { TrackRegistry } from '../tracks/registry'
import { flowRunner } from '../flows/runner'
import { modLogger } from '../logger'

const log = modLogger('tracks-route')

export interface TracksRouteDeps {
  registry: TrackRegistry
}

export function buildTracksRouter(deps: TracksRouteDeps): Router {
  const router = Router()
  const { registry } = deps

  // ── CRUD ────────────────────────────────────────────────────────────────

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

  // PUT /api/projects/:projectId/tracks/file/:filename  body: { source }
  router.put(
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
      const source = req.body?.source
      if (typeof source !== 'string') {
        res.status(400).json({ error: 'body.source must be a string' })
        return
      }
      // Soft size cap to prevent abuse; ~1MB is way more than any sane .tr.
      if (source.length > 1_048_576) {
        res.status(413).json({ error: 'source too large (>1MB)' })
        return
      }

      // sidecar field semantics:
      //   - absent (undefined): keep existing sidecar unchanged (backward-compat)
      //   - null: explicitly delete sidecar (user switched to code mode)
      //   - object: save new sidecar
      const sidecar = req.body?.sidecar
      const hasSidecarField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'sidecar')
      if (hasSidecarField && sidecar !== null) {
        if (typeof sidecar !== 'object' || Array.isArray(sidecar)) {
          res.status(400).json({ error: 'body.sidecar must be an object or null' })
          return
        }
        const sizeCheck = JSON.stringify(sidecar).length
        if (sizeCheck > 524_288) {
          res.status(413).json({ error: 'sidecar too large (>512KB)' })
          return
        }
      }

      const ok = saveTrack(project.folderPath, safe, source)
      if (ok && hasSidecarField) {
        if (sidecar === null) {
          deleteSidecar(project.folderPath, safe)
        } else {
          const okSidecar = saveSidecar(project.folderPath, safe, sidecar)
          if (!okSidecar) {
            res.status(500).json({ error: 'failed to save sidecar' })
            return
          }
        }
      }

      log.info(
        { projectId: project.id, filename: safe, bytes: source.length },
        'track saved',
      )
      res.json({ ok })
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

  // ── Runtime ─────────────────────────────────────────────────────────────

  // POST /api/projects/:projectId/tracks/run
  //   body: { filename, source?: 'project' | 'global', args?: any[] }
  router.post(
    '/:projectId/tracks/run',
    requireProjectOwner('projectId'),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const project = getProject(req.params.projectId)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      const filename = typeof req.body?.filename === 'string' ? req.body.filename : ''
      const safe = sanitizeTrackFilename(filename)
      if (!safe) {
        res.status(400).json({ error: 'invalid filename' })
        return
      }
      const source = req.body?.source === 'global' ? 'global' : 'project'
      let absPath: string
      if (source === 'global') {
        const username = req.user?.username
        if (!username) {
          res.status(401).json({ error: 'auth required' })
          return
        }
        if (!loadGlobalTrack(username, safe)) {
          res.status(404).json({ error: 'Global track not found' })
          return
        }
        absPath = resolveGlobalTrackPath(username, safe)
      } else {
        if (!loadTrack(project.folderPath, safe)) {
          res.status(404).json({ error: 'Track not found' })
          return
        }
        absPath = resolveTrackPath(project.folderPath, safe)
      }
      // Cross-subsystem lock: refuse to start a track if a flow is
      // currently running on the same project. Both subsystems write
      // <project>/.ccweb/workflow_data.json; concurrent writes would
      // corrupt state. The opposite check (flows refusing track) is in
      // routes/flows.ts.
      if (flowRunner.isRunning(project.id)) {
        res.status(409).json({
          error: 'a flow is currently running on this project; abort it first',
        })
        return
      }
      const args = Array.isArray(req.body?.args) ? req.body.args : []
      const result = await registry.start(project.id, absPath, safe, args)
      if (!result.ok) {
        res.status(409).json({ error: result.reason })
        return
      }
      log.info({ projectId: project.id, track: safe, source, runId: result.runId }, 'track started')
      res.json({ ok: true, runId: result.runId })
    },
  )

  // POST /api/projects/:projectId/tracks/abort
  router.post(
    '/:projectId/tracks/abort',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const ok = registry.abort(req.params.projectId)
      log.info({ projectId: req.params.projectId, ok }, 'track abort requested')
      res.json({ ok })
    },
  )

  // POST /api/projects/:projectId/tracks/input  body: { requestId, data }
  router.post(
    '/:projectId/tracks/input',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const requestId = req.body?.requestId
      const data = req.body?.data
      if (typeof requestId !== 'string') {
        res.status(400).json({ error: 'requestId is required' })
        return
      }
      if (!data || typeof data !== 'object') {
        res.status(400).json({ error: 'data is required' })
        return
      }
      const result = registry.submitInput(
        req.params.projectId,
        requestId,
        data as Record<string, unknown>,
      )
      if (!result.ok) {
        res.status(409).json({ error: result.message ?? 'submit failed' })
        return
      }
      log.info(
        { projectId: req.params.projectId, requestId, keys: Object.keys(data).length },
        'track ask_user submitted',
      )
      res.json({ ok: true })
    },
  )

  // GET /api/projects/:projectId/tracks/state
  router.get(
    '/:projectId/tracks/state',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      res.json({
        running: registry.isRunning(req.params.projectId),
        state: registry.getState(req.params.projectId),
        pendingAskUser: registry.getPendingAskUser(req.params.projectId),
      })
    },
  )

  return router
}
