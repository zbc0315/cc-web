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
import { flowRunRegistry, runFlow, submitUserInputForRun, type FlowV3 } from '../track-flow'
import { deriveInjector, deriveBroadcast, deriveTerminalRefGetter } from './_flow-injector'
import { newRunId } from '../track-flow/run-id'
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

      // v-h: body.createOnly=true 时拒绝覆盖已存在的 flow（避免 "新建工作轨"
      // UI 在 filename 撞名时静默覆盖用户数据）。upsert 是默认。
      const createOnly = (req.body as { createOnly?: boolean })?.createOnly === true
      const saveResult = saveFlow(project.folderPath, basename, flow, createOnly ? 'create' : 'upsert')
      if (!saveResult.ok) {
        if (saveResult.reason === 'exists') {
          res.status(409).json({ code: 'FLOW_FILE_EXISTS', error: `flow "${basename}" already exists` })
        } else {
          res.status(500).json({ error: 'failed to save flow' })
        }
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
      // v-h: 拒绝删除运行中的 flow（否则文件被删但后台 run 仍跑，audit log 沦
      // 为孤儿，且 list 拿不到给用户）。要求用户先 cancel 再删。
      const active = flowRunRegistry.findActive(project.id, basename)
      if (active) {
        res.status(409).json({
          code: 'FLOW_RUN_ACTIVE',
          runId: active.runId,
          error: `flow "${basename}" is running, cancel run first`,
        })
        return
      }
      const ok = deleteFlow(project.folderPath, basename)
      res.json({ ok })
    },
  )

  // POST /api/projects/:projectId/track-flows/file/:filename/run — body { quotaOverride? }
  router.post(
    '/:projectId/track-flows/file/:filename/run',
    requireProjectOwner('projectId'),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const project = getProject(req.params.projectId)
      if (!project) { res.status(404).json({ error: 'Project not found' }); return }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) { res.status(400).json({ error: 'invalid filename' }); return }
      const flowRaw = loadFlow(project.folderPath, basename)
      if (flowRaw === null || typeof flowRaw !== 'object') {
        res.status(404).json({ error: 'flow not found' }); return
      }
      const flow = flowRaw as FlowV3
      const trainJson = loadTrainJson(project.folderPath, basename) ?? {}

      const runId = newRunId()
      try {
        flowRunRegistry.start({
          runId,
          projectId: project.id,
          basename,
          quotaOverride: (req.body as { quotaOverride?: Record<string, number> })?.quotaOverride,
        })
      } catch (e) {
        const err = e as Error & { existingRunId?: string }
        if (err.message === 'FLOW_ALREADY_RUNNING') {
          res.status(409).json({
            code: 'FLOW_ALREADY_RUNNING',
            runId: err.existingRunId,
            error: '该工作轨已有运行中的实例',
          })
          return
        }
        throw e
      }

      res.json({ runId })

      const injector = deriveInjector(project.id)
      const broadcast = deriveBroadcast(project.id)
      const getTerminalRef = deriveTerminalRefGetter(project.id)
      void runFlow(flow, trainJson as Record<string, unknown>, {
        projectFolder: project.folderPath,
        basename,
        runId,
        injector,
        broadcast,
        getTerminalRef,
      }).catch((e) => {
        log.error({ runId, err: (e as Error).message }, 'runFlow threw')
      })
    },
  )

  // POST /api/projects/:projectId/track-flows/file/:filename/cancel — body { runId? }
  router.post(
    '/:projectId/track-flows/file/:filename/cancel',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const project = getProject(req.params.projectId)
      if (!project) { res.status(404).json({ error: 'Project not found' }); return }
      const basename = sanitizeFlowFilename(req.params.filename)
      if (!basename) { res.status(400).json({ error: 'invalid filename' }); return }
      const runId = (req.body as { runId?: string })?.runId
      if (typeof runId === 'string') {
        const ok = flowRunRegistry.cancel(runId)
        res.json({ ok })
        return
      }
      const active = flowRunRegistry.findActive(project.id, basename)
      if (!active) { res.json({ ok: false, message: 'no active run' }); return }
      flowRunRegistry.cancel(active.runId)
      res.json({ ok: true, runId: active.runId })
    },
  )

  // POST /api/projects/:projectId/track-flows/file/:filename/user_input — body { runId, values }
  router.post(
    '/:projectId/track-flows/file/:filename/user_input',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const body = req.body as { runId?: string; values?: Record<string, unknown> }
      const runId = body?.runId
      const values = body?.values
      if (typeof runId !== 'string' || typeof values !== 'object' || values === null) {
        res.status(400).json({ error: 'runId/values required' }); return
      }
      const ok = submitUserInputForRun(runId, values)
      res.json({ ok })
    },
  )

  // GET /api/projects/:projectId/track-flows/runs/active
  router.get(
    '/:projectId/track-flows/runs/active',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const list = flowRunRegistry.listActive(req.params.projectId)
      res.json({
        runs: list.map((r) => ({
          runId: r.runId,
          basename: r.basename,
          status: r.status,
          startedAt: r.startedAt,
          pendingUserInput: r.pendingUserInput,
        })),
      })
    },
  )

  // GET /api/projects/:projectId/track-flows/runs/:runId/state
  // 用于 WS 重连 / 浏览器刷新后前端 attach existing run → 拉回 snapshot +
  // nodeStates + currentNodeId，否则 useFlowRun 是空白，用户看不到进度。
  router.get(
    '/:projectId/track-flows/runs/:runId/state',
    requireProjectOwner('projectId'),
    (req: AuthRequest, res: Response): void => {
      const info = flowRunRegistry.get(req.params.runId)
      if (!info || info.projectId !== req.params.projectId) {
        res.status(404).json({ error: 'run not found' })
        return
      }
      res.json({
        runId: info.runId,
        basename: info.basename,
        status: info.status,
        startedAt: info.startedAt,
        snapshot: info.snapshot,
        currentNodeId: info.currentNodeId,
        nodeStates: Object.fromEntries(info.nodeStates),
        pendingUserInput: info.pendingUserInput,
        error: info.error,
        quota: flowRunRegistry.remainingQuota(info.runId, info.currentNodeId ?? undefined),
      })
    },
  )

  return router
}
