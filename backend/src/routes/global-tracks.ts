/**
 * /api/global/tracks/* routes — per-user global track templates.
 *
 * Mirrors backend/src/routes/global-flows.ts shape but for .tr files
 * stored under ~/.ccweb/users/<username>/tracks/.
 *
 * Auth: requires authenticated user (any role); not project-scoped.
 */

import { Router, Response } from 'express'
import { AuthRequest } from '../auth'
import {
  deleteGlobalTrack,
  listGlobalTracks,
  loadGlobalTrack,
  saveGlobalTrack,
  sanitizeTrackFilename,
} from '../tracks/store'
import { modLogger } from '../logger'

const log = modLogger('global-tracks-route')

const router = Router()

function requireUser(req: AuthRequest, res: Response): string | null {
  const username = req.user?.username
  if (!username) {
    res.status(401).json({ error: 'auth required' })
    return null
  }
  return username
}

// GET /api/global/tracks
router.get('/', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res)
  if (!username) return
  res.json({ files: listGlobalTracks(username) })
})

// GET /api/global/tracks/file/:filename
router.get('/file/:filename', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res)
  if (!username) return
  const safe = sanitizeTrackFilename(req.params.filename)
  if (!safe) {
    res.status(400).json({ error: 'invalid filename' })
    return
  }
  const source = loadGlobalTrack(username, safe)
  if (source === null) {
    res.status(404).json({ error: 'Global track not found' })
    return
  }
  res.json({ filename: safe, source })
})

// PUT /api/global/tracks/file/:filename  body: { source }
router.put('/file/:filename', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res)
  if (!username) return
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
  if (source.length > 1_048_576) {
    res.status(413).json({ error: 'source too large (>1MB)' })
    return
  }
  const ok = saveGlobalTrack(username, safe, source)
  log.info({ username, filename: safe, bytes: source.length }, 'global track saved')
  res.json({ ok })
})

// DELETE /api/global/tracks/file/:filename
router.delete('/file/:filename', (req: AuthRequest, res: Response): void => {
  const username = requireUser(req, res)
  if (!username) return
  const safe = sanitizeTrackFilename(req.params.filename)
  if (!safe) {
    res.status(400).json({ error: 'invalid filename' })
    return
  }
  const ok = deleteGlobalTrack(username, safe)
  log.info({ username, filename: safe, ok }, 'global track deleted')
  res.json({ ok })
})

export default router
