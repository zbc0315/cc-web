/**
 * /api/global/tracks/* routes — per-user global track templates (read/delete only).
 *
 * Write (PUT) removed in M0 cleanup.
 */

import { Router, Response } from 'express'
import { AuthRequest } from '../auth'
import {
  deleteGlobalTrack,
  listGlobalTracks,
  loadGlobalTrack,
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
