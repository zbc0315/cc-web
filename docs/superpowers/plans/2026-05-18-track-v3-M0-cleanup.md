# Track Flow Engine v3 — M0（清理 + 删 train-core）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 v1（visual/）、v2（graph/）、写代码模式（TrackEditor）以及 train-lang vendor（@tom2012/train-core），为 M1 v3 编辑器骨架腾出空间。保留 train-adapter-spec + ccweb-train-adapter + workflow-data-watcher（v3 LLM 调用仍走这套 PTY 注入机制）。

**Architecture:** 纯删除性 milestone，不引入新功能。删完后 ccweb 仍能正常启动，但工作轨子系统进入"过渡期"——TracksListDialog 显示占位"v3 即将到来"，老 `.tr` 文件保留在磁盘但 UI 不再列出。M0 完成 = 工作轨入口被冻结，等待 M1 引入 .flow。

**Tech Stack:** TypeScript / git rm / npm（删除 file: vendored 依赖）/ vitest（验证现有单测不被破坏）/ frontend tsc + backend tsc（验证编译通过）

---

## 前置数据（依赖侦查结果，写入 plan 供 subagent 参考）

### A. train-core 引用清单（必须删的代码）

```
backend/src/tracks/train-loader.ts                          — dynamic import('@tom2012/train-core')
backend/src/tracks/types-train.ts                           — type import from '@tom2012/train-core'
backend/src/tracks/__tests__/verify-starter-templates.ts    — dynamic import train-core/parser
frontend/src/components/tracks/parse-train.ts               — import parse from '@tom2012/train-core/parser'
frontend/src/components/tracks/TrackOutline.tsx             — local mirror of train-core AST shapes (comment-only ref)
frontend/src/components/tracks/train-monaco-lang.ts         — comment refers to train-core
frontend/src/components/tracks/TrackEditor.tsx              — comment refers to train-core (uses parse-train)
frontend/src/components/tracks/graph/__tests__/verify-graph-v2.ts  — dynamic import train-core vendor
frontend/src/components/tracks/visual/__tests__/verify-codegen.ts  — dynamic import train-core vendor
```

### B. backend/src/tracks/ 分类（11 个文件）

**保留**（v3 复用）：
- `store.ts` — 文件 CRUD（v3 改为 .flow CRUD 也基于此）
- `cross-lock.ts` — run 锁（v3 复用，仅文件名换成 .flow.lock）
- `ccweb-train-adapter.ts` — LLMAdapter 实现（PTY 注入 + writeProtocolHint）
- `workflow-data-watcher.ts` — `.ccweb/workflow_data.json` 文件监听（v3 复用为 train.json 监听）
- `ask-user-bridge.ts` — 用户输入弹窗 WS 协议（v3 user_input 节点可借鉴）
- `types.ts` — ccweb 侧类型（M0 仅删 v1/v2/track-runner 相关类型，保留底层）
- `index.ts` — 模块 export barrel（M0 调整 exports，去掉 deleted 文件）

**删除**（train-lang 强耦合）：
- `track-runner.ts` — train-lang interpreter wrapper
- `train-loader.ts` — load .tr file + dynamic import train-core
- `types-train.ts` — train-core type re-export
- `registry.ts` — train 工作轨 run 注册表（v3 自己写 FlowRuntimeRegistry）

### C. backend/src/routes 依赖

- `routes/tracks.ts` — 8 个端点 (GET list/GET file/PUT/DELETE/POST run/POST start/POST stop/GET status)。M0 保留 GET list + GET file + DELETE file；删 PUT、POST run / POST start / POST stop / GET status
- `routes/flows.ts` — 旧 v1 任务流路由（不是 v3 工作轨），依赖 `tracks/registry`。M0 不动 flows.ts（它是 v1 任务流系统，与本 plan 无关）。但 flows.ts import 的 `tracks/registry` 被删，所以 M0 要么删 flows.ts，要么注释掉它对 registry 的依赖
- `routes/global-tracks.ts` — 类似 routes/tracks.ts 的全局工作轨版本，依赖 `tracks/cross-lock`。M0 保留 GET list/file + DELETE，删其他

实际侦查发现 routes/flows.ts 是另一个系统（v1 流），跟我们的工作轨流程不直接耦合。Task 5 / 6 谨慎处理。

### D. frontend train-core 依赖文件清单

```
frontend/src/components/tracks/visual/                       — 整目录 (M1 v1)
frontend/src/components/tracks/graph/                        — 整目录 (M1 v2)
frontend/src/components/tracks/TrackEditor.tsx               — 写代码 .tr 入口
frontend/src/components/tracks/TrackOutline.tsx              — .tr outline panel
frontend/src/components/tracks/parse-train.ts                — train-core parser facade
frontend/src/components/tracks/train-monaco-lang.ts          — Monaco grammar
frontend/src/components/tracks/api.ts                        — saveTrack/getTrack/runTrack 等（保留接口骨架供 v3 改造）
frontend/src/components/tracks/TracksListDialog.tsx          — 改造为 v3 占位
frontend/src/components/tracks/TrackStatusBar.tsx            — 工作轨运行状态条（保留，v3 复用）
frontend/src/components/tracks/TrackUserInputDialog.tsx      — 用户输入对话框（保留，v3 user_input 复用）
frontend/src/components/tracks/types.ts                      — 类型（保留，M0 不动）
frontend/src/components/tracks/useTrackState.ts              — WS state hook（保留，v3 改造）
```

---

## File Structure

**M0 删除**（git rm 而不是注释）：

```
backend/src/tracks/track-runner.ts
backend/src/tracks/train-loader.ts
backend/src/tracks/types-train.ts
backend/src/tracks/registry.ts
backend/src/tracks/__tests__/verify-starter-templates.ts
backend/src/tracks/__tests__/verify-track.ts             (若依赖 track-runner)
backend/src/tracks/__tests__/verify-track-t1.ts          (若依赖 track-runner)
backend/src/tracks/__tests__/verify-track-cancel.ts      (若依赖 track-runner)
backend/vendor/@tom2012/train-core/                       (整目录)
frontend/src/components/tracks/visual/                    (整目录)
frontend/src/components/tracks/graph/                     (整目录)
frontend/src/components/tracks/TrackEditor.tsx
frontend/src/components/tracks/TrackOutline.tsx
frontend/src/components/tracks/parse-train.ts
frontend/src/components/tracks/train-monaco-lang.ts
```

**M0 修改**：

```
backend/src/tracks/index.ts            — 移除 deleted exports
backend/src/tracks/types.ts            — 删 train-core 相关 type re-export，保留 ccweb 侧
backend/src/routes/tracks.ts           — 删 PUT/POST run/POST start/POST stop/GET status 端点
backend/src/routes/global-tracks.ts    — 类似 routes/tracks.ts
backend/src/routes/flows.ts            — 改注释或注掉 registry 依赖（最小改）
backend/src/index.ts                   — 移除被删 routes 的 mount（如有）
backend/package.json                   — 删 "@tom2012/train-core": "file:..."
backend/package.json                   — 删 verify:tracks scripts（已删测试文件）
frontend/src/components/tracks/api.ts                          — 简化函数（删 runTrack 等 v1/v2 路由 API；保留 listTracks/getTrack/deleteTrack 骨架）
frontend/src/components/tracks/TracksListDialog.tsx            — 改为 v3 占位
frontend/package.json                                          — 删 verify:graph-v2 script
```

**M0 不动**（保留给 M1+）：

```
backend/src/tracks/store.ts / cross-lock.ts / ccweb-train-adapter.ts
backend/src/tracks/workflow-data-watcher.ts / ask-user-bridge.ts
backend/vendor/@tom2012/train-adapter-spec/                  (adapter spec 是协议接口，独立无依赖)
frontend/src/components/tracks/TrackStatusBar.tsx
frontend/src/components/tracks/TrackUserInputDialog.tsx
frontend/src/components/tracks/types.ts / useTrackState.ts
```

---

## Task 1：删除 frontend visual/ 目录（v1 嵌套块）

**Files:**
- Delete: `frontend/src/components/tracks/visual/` (entire directory)

- [ ] **Step 1：确认现有目录内容**

```bash
ls /Users/tom/Projects/cc-web/frontend/src/components/tracks/visual/
```

预期：18 个 .tsx/.ts 文件 + `__tests__/` + `forms/` 子目录。

- [ ] **Step 2：grep 外部引用，找 importer**

```bash
grep -rn "from '.*tracks/visual\|from \"\\.\\./visual" /Users/tom/Projects/cc-web/frontend/src 2>/dev/null | grep -v "/visual/"
```

预期：可能只有 `TracksListDialog.tsx` 引用（Task 4 会处理）。

如果其他文件引用 → 记录到本 task 的"concern"，BLOCKED 等待澄清。

- [ ] **Step 3：删除目录**

```bash
cd /Users/tom/Projects/cc-web
git rm -r frontend/src/components/tracks/visual/
```

- [ ] **Step 4：跑 frontend tsc 看哪里报错**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit 2>&1 | tail -30
```

预期：TracksListDialog 报"找不到 visual/..."—— 留给 Task 4 修。M0 阶段单 task 暂时编译失败 OK，整体编译在 Task 9 验证。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git commit -m "chore(tracks): remove v1 visual/ directory (nested-block editor)"
```

---

## Task 2：删除 frontend graph/ 目录（v2 ReactFlow）

**Files:**
- Delete: `frontend/src/components/tracks/graph/` (entire directory)
- Modify: `frontend/package.json` — 删 `verify:graph-v2` script

- [ ] **Step 1：grep 外部引用**

```bash
grep -rn "from '.*tracks/graph\|from \"\\.\\./graph" /Users/tom/Projects/cc-web/frontend/src 2>/dev/null | grep -v "/graph/"
```

预期：`TracksListDialog.tsx` 引用 `./graph/TrackGraphEditor` 和 `./graph/marker-v2`（Task 4 处理）。

- [ ] **Step 2：删除目录**

```bash
cd /Users/tom/Projects/cc-web
git rm -r frontend/src/components/tracks/graph/
```

- [ ] **Step 3：删 verify:graph-v2 script**

读 `frontend/package.json` 现有内容，删除以下行（如果存在）：

```json
"verify:graph-v2": "tsx src/components/tracks/graph/__tests__/verify-graph-v2.ts"
```

也可以保留 vitest / test / test:run 三条（M1 v3 会复用 vitest）。tsx / vitest devDependencies 也保留（M1 用）。

- [ ] **Step 4：跑 frontend tsc**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit 2>&1 | tail -20
```

预期：TracksListDialog 报错累积，留给 Task 4 处理。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/package.json
git commit -m "chore(tracks): remove v2 graph/ directory (reactflow + train-lang codegen)"
```

---

## Task 3：删除 frontend 写代码 .tr 模式（TrackEditor 系列）

**Files:**
- Delete: `frontend/src/components/tracks/TrackEditor.tsx`
- Delete: `frontend/src/components/tracks/TrackOutline.tsx`
- Delete: `frontend/src/components/tracks/parse-train.ts`
- Delete: `frontend/src/components/tracks/train-monaco-lang.ts`

- [ ] **Step 1：grep 外部引用**

```bash
cd /Users/tom/Projects/cc-web/frontend
grep -rn "TrackEditor\|TrackOutline\|from '.*parse-train\|from '.*train-monaco-lang" src/ | grep -v "components/tracks/TrackEditor\|components/tracks/TrackOutline\|components/tracks/parse-train\|components/tracks/train-monaco-lang"
```

预期：可能 `TracksListDialog.tsx` import TrackEditor。

如果其他 React 路由 / 主入口 import → 记录 BLOCKED。

- [ ] **Step 2：删除 4 个文件**

```bash
cd /Users/tom/Projects/cc-web
git rm frontend/src/components/tracks/TrackEditor.tsx
git rm frontend/src/components/tracks/TrackOutline.tsx
git rm frontend/src/components/tracks/parse-train.ts
git rm frontend/src/components/tracks/train-monaco-lang.ts
```

- [ ] **Step 3：tsc 检查**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit 2>&1 | tail -20
```

预期：TracksListDialog 累积错误，Task 4 处理。

- [ ] **Step 4：Commit**

```bash
cd /Users/tom/Projects/cc-web
git commit -m "chore(tracks): remove TrackEditor / TrackOutline / parse-train / train-monaco-lang (write-code .tr mode)"
```

---

## Task 4：TracksListDialog 改为 v3 占位 + 修复 api.ts

**Files:**
- Modify: `frontend/src/components/tracks/TracksListDialog.tsx`
- Modify: `frontend/src/components/tracks/api.ts`

- [ ] **Step 1：读现有 TracksListDialog**

```bash
wc -l /Users/tom/Projects/cc-web/frontend/src/components/tracks/TracksListDialog.tsx
head -80 /Users/tom/Projects/cc-web/frontend/src/components/tracks/TracksListDialog.tsx
```

记录 Dialog 现有 props（projectId、open、onOpenChange 等），以便占位版本继续兼容外部调用。

- [ ] **Step 2：备份现有签名 + 写占位版本**

完全重写 `frontend/src/components/tracks/TracksListDialog.tsx` 为最简占位（保留 Dialog 外壳 + 现有 props 签名 + 占位文案）：

```tsx
// frontend/src/components/tracks/TracksListDialog.tsx
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * v3 placeholder — M0 cleanup milestone removed v1 (visual/) and v2 (graph/)
 * editors. v3 .flow editor lands in M1. This component is intentionally
 * stubbed so the project page mount point keeps working.
 */
export function TracksListDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[480px] bg-white rounded-lg z-50 p-6"
        >
          <Dialog.Title className="text-lg font-semibold mb-2">工作轨</Dialog.Title>
          <div className="text-sm text-gray-600 space-y-2">
            <p>工作轨子系统正在重构为 v3（流程图工作流引擎）。</p>
            <p>v1（嵌套块）与 v2（ReactFlow + train-lang）已下线。</p>
            <p>新版本 v3 即将上线，敬请期待。</p>
            <p className="text-xs text-gray-400 mt-4">
              如果您有项目里有旧版 .tr 文件，它们保留在磁盘但暂不可编辑/运行。
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Dialog.Close className="px-3 py-1 text-sm rounded border hover:bg-gray-50">
              关闭
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 3：简化 `api.ts`（删 v1/v2 路由 API）**

读现有 `frontend/src/components/tracks/api.ts`，保留 `listTracks` / `getTrack` / `deleteTrack` 三个端点函数（v3 M1 会扩展 .flow 端点），删除以下函数（如果存在）：

- `saveTrack`（PUT 端点 M0 已删，前端 API 跟着删）
- `runTrack` / `startTrack` / `stopTrack` / `getTrackStatus`（POST 端点 M0 已删）

修改后 api.ts 完整内容（示例）：

```typescript
// frontend/src/components/tracks/api.ts
import { getToken } from '@/lib/api'
import type { TrackFileInfo } from './types'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ── Project tracks (read-only after M0; v3 flows API lands in M1) ────────

export function listTracks(projectId: string): Promise<{ files: TrackFileInfo[] }> {
  return req('GET', `/api/projects/${projectId}/tracks`)
}

export function getTrack(
  projectId: string,
  filename: string,
): Promise<{ filename: string; source: string }> {
  return req(
    'GET',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
  )
}

export function deleteTrack(
  projectId: string,
  filename: string,
): Promise<{ ok: boolean }> {
  return req(
    'DELETE',
    `/api/projects/${projectId}/tracks/file/${encodeURIComponent(filename)}`,
  )
}
```

- [ ] **Step 4：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit
```

预期：通过（前端 visual/graph/TrackEditor 已删，TracksListDialog 不再 import 它们）。

如果仍有错误（如 `useTrackState` / `TrackUserInputDialog` / `TrackStatusBar` 因为 api.ts 删了 runTrack 等而报错）→ 在本 task 内最小修复（注释掉运行相关代码 + 加 TODO 注释指向 M1）。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add frontend/src/components/tracks/TracksListDialog.tsx \
  frontend/src/components/tracks/api.ts
git commit -m "feat(tracks): TracksListDialog v3 placeholder + simplify api.ts to read-only"
```

---

## Task 5：backend tracks routes 简化

**Files:**
- Modify: `backend/src/routes/tracks.ts`
- Modify: `backend/src/routes/global-tracks.ts`

- [ ] **Step 1：读现有 routes/tracks.ts 端点清单**

```bash
grep -nE "router\\.(get|post|put|delete)" /Users/tom/Projects/cc-web/backend/src/routes/tracks.ts
```

预期：
```
43:  router.get('/:projectId/tracks',
57:  router.get('/:projectId/tracks/file/:filename',
82:  router.put('/:projectId/tracks/file/:filename',
147:  router.delete('/:projectId/tracks/file/:filename',
171:  router.post('/:projectId/tracks/run',
229:  router.post('/:projectId/tracks/:runId/start',
240:  router.post('/:projectId/tracks/:runId/stop',
272:  router.get('/:projectId/tracks/:runId/status',
```

M0 保留：GET list (43), GET file (57), DELETE file (147)
M0 删除：PUT file (82), POST run (171), POST start (229), POST stop (240), GET status (272)

- [ ] **Step 2：删除 5 个端点 handler + 相关 imports**

打开 `backend/src/routes/tracks.ts`，删除 5 个 handler block。删除后 imports 段可能有未使用的 import（如 `import { trackRegistry }` / `import { ... } from '../tracks/registry'`）也一并删除。

具体改法：保留 GET list / GET file / DELETE file handler；其他 router.put / router.post / 第二个 router.get 全部删除。

- [ ] **Step 3：global-tracks.ts 同样简化**

读 `backend/src/routes/global-tracks.ts`，按相同原则删除 run/start/stop/status 等 handler，保留 GET list/file + DELETE。

- [ ] **Step 4：backend tsc 检查**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit 2>&1 | tail -30
```

预期：可能仍有错误（因为 `tracks/registry`、`tracks/track-runner` 还存在但 routes 不再 import；Task 6 / Task 7 会删它们）。**累积错误 OK**，Task 9 验证整体编译。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/routes/tracks.ts backend/src/routes/global-tracks.ts
git commit -m "chore(tracks): backend routes — keep list/get/delete only (M0)"
```

---

## Task 6：backend/src/tracks 内部清理

**Files:**
- Delete: `backend/src/tracks/track-runner.ts`
- Delete: `backend/src/tracks/train-loader.ts`
- Delete: `backend/src/tracks/types-train.ts`
- Delete: `backend/src/tracks/registry.ts`
- Delete: `backend/src/tracks/__tests__/verify-starter-templates.ts`
- Delete: `backend/src/tracks/__tests__/verify-track.ts`（如果依赖 track-runner）
- Delete: `backend/src/tracks/__tests__/verify-track-t1.ts`（如果依赖 track-runner）
- Delete: `backend/src/tracks/__tests__/verify-track-cancel.ts`（如果依赖 track-runner）
- Modify: `backend/src/tracks/index.ts` — 移除 deleted exports
- Modify: `backend/src/tracks/types.ts` — 删 train-core 相关 re-export

- [ ] **Step 1：grep 外部引用各文件**

```bash
cd /Users/tom/Projects/cc-web/backend
grep -rn "from '.*tracks/track-runner\|from '.*tracks/train-loader\|from '.*tracks/types-train\|from '.*tracks/registry" src/ | grep -v "tracks/track-runner\|tracks/train-loader\|tracks/types-train\|tracks/registry"
```

预期：Task 5 已删 routes 端点中的引用。如果仍有外部引用 → 记录到本 task notes，处理或 BLOCKED。

- [ ] **Step 2：检查 verify-track* 测试是否依赖 track-runner**

```bash
for f in /Users/tom/Projects/cc-web/backend/src/tracks/__tests__/verify-track*.ts; do
  echo "--- $f ---"
  head -20 "$f" | grep -E "from\|import"
done
```

如果 verify-track / verify-track-t1 / verify-track-cancel 依赖 `../track-runner` 或 `@tom2012/train-core` → 删；如果是独立 train-lang adapter 测试（极少数）→ 保留。

- [ ] **Step 3：删除 4 个核心文件 + 依赖测试**

```bash
cd /Users/tom/Projects/cc-web
git rm backend/src/tracks/track-runner.ts
git rm backend/src/tracks/train-loader.ts
git rm backend/src/tracks/types-train.ts
git rm backend/src/tracks/registry.ts
git rm backend/src/tracks/__tests__/verify-starter-templates.ts
# 按 Step 2 结果，删除依赖 track-runner 的 verify-track*
git rm backend/src/tracks/__tests__/verify-track.ts        # 如果依赖
git rm backend/src/tracks/__tests__/verify-track-t1.ts     # 如果依赖
git rm backend/src/tracks/__tests__/verify-track-cancel.ts # 如果依赖
```

- [ ] **Step 4：修 `backend/src/tracks/index.ts` 删 deleted exports**

读 `backend/src/tracks/index.ts`，删除以下行（如果存在）：

```ts
export * from './track-runner'
export * from './train-loader'
export * from './types-train'
export * from './registry'
// 或 named export 如 export { startTrack } from './track-runner' 也都删
```

保留：

```ts
export * from './store'
export * from './cross-lock'
export * from './ccweb-train-adapter'
export * from './workflow-data-watcher'
export * from './ask-user-bridge'
export * from './types'
```

- [ ] **Step 5：修 `backend/src/tracks/types.ts`**

读 types.ts，删除任何 `from '@tom2012/train-core'` 的 import / type re-export。保留 ccweb 侧自定义类型（如 `TrackFileInfo`、`TrackRunState`、`AskUserRequest` 等）。

如果 types.ts 内某类型严重依赖 train-core 类型（如 `TrainValue`）→ 内联定义为 `unknown` 或简化 ccweb 自用版本。

- [ ] **Step 6：删 backend `verify:tracks` scripts**

读 `backend/package.json`，删除以下 scripts（已无测试文件）：

```json
"verify:tracks:t0": "ts-node src/tracks/__tests__/verify-track.ts",
"verify:tracks:t1": "ts-node src/tracks/__tests__/verify-track-t1.ts",
"verify:tracks": "npm run verify:tracks:t0 && npm run verify:tracks:t1"
```

- [ ] **Step 7：backend tsc 检查**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit 2>&1 | tail -30
```

预期：仍可能报错（train-core 还在 vendor，依赖 it 的代码已删但 `tsconfig` 可能仍要 resolve）。Task 7 删 vendor 后再验证。累积错误 OK。

- [ ] **Step 8：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/src/tracks/index.ts \
  backend/src/tracks/types.ts \
  backend/package.json
git commit -m "chore(tracks): backend — remove track-runner / registry / train-loader / types-train + verify-* tests"
```

---

## Task 7：删除 backend/vendor/@tom2012/train-core + 调整 backend/package.json

**Files:**
- Delete: `backend/vendor/@tom2012/train-core/` (entire vendored package directory)
- Modify: `backend/package.json` — 删 `@tom2012/train-core` 依赖
- Modify: `frontend/package.json` — 删 `@tom2012/train-core` 依赖（如果有）

- [ ] **Step 1：grep 最终确认无残留引用**

```bash
grep -rn "@tom2012/train-core" /Users/tom/Projects/cc-web/backend/src /Users/tom/Projects/cc-web/frontend/src 2>/dev/null | grep -v node_modules
```

预期：**0 个引用**（Task 1-6 应该删完）。如果还有→修完再删 vendor。

- [ ] **Step 2：删除 vendor 目录**

```bash
cd /Users/tom/Projects/cc-web
git rm -r backend/vendor/@tom2012/train-core/
```

- [ ] **Step 3：删 backend/package.json train-core 依赖**

读 `backend/package.json`，找到：

```json
"@tom2012/train-core": "file:./vendor/@tom2012/train-core",
```

删除这一行。保留 `"@tom2012/train-adapter-spec"` 行（M0 保留）。

- [ ] **Step 4：检查 frontend/package.json**

```bash
grep "@tom2012/train-core" /Users/tom/Projects/cc-web/frontend/package.json
```

如果有 `"@tom2012/train-core": "file:../backend/vendor/..."` → 删该行。

- [ ] **Step 5：跑 npm install 让 lock 文件更新**

```bash
cd /Users/tom/Projects/cc-web/backend
npm install --include=dev 2>&1 | tail -10

cd /Users/tom/Projects/cc-web/frontend
npm install --include=dev 2>&1 | tail -10
```

预期：两边都 OK，无 ERR ENOENT 或 file: not found 之类错误。

- [ ] **Step 6：backend + frontend tsc 整体验证**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit 2>&1 | tail -30
```

预期：通过（所有 train-core 引用已删 + vendor 已删 + 依赖也删）。如果仍有错误→ 看错误位置在 frontend / backend 哪个文件，定位 grep 漏的引用并修。

```bash
cd /Users/tom/Projects/cc-web/frontend
npx tsc --noEmit 2>&1 | tail -30
```

预期：通过。

**Step 6 必须真过**——这是 M0 的硬验收门槛。

- [ ] **Step 7：Commit**

```bash
cd /Users/tom/Projects/cc-web
git add backend/vendor/@tom2012/ \
  backend/package.json backend/package-lock.json \
  frontend/package.json frontend/package-lock.json
git commit -m "chore(tracks): remove @tom2012/train-core vendor (DSL fully cut)"
```

---

## Task 8：routes/flows.ts + index.ts 修复（连锁清理）

**Files:**
- Modify: `backend/src/routes/flows.ts`（如果 import 已删类型/函数）
- Modify: `backend/src/index.ts`（如果 mount 了已删 route）

- [ ] **Step 1：跑 backend tsc 看剩余错误**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit 2>&1 | head -40
```

如果 Task 7 已通过 tsc，本 task **跳过**（Step 5 直接 commit "nothing to do"）。

如果有错误：

- 错误在 `routes/flows.ts` → Step 2
- 错误在 `index.ts` → Step 3

- [ ] **Step 2：修 routes/flows.ts**

读 `backend/src/routes/flows.ts`。如果 import 了已删的 `tracks/registry` 或类似 → 注释掉相关 import + handler。最小改动；不要重构 flows.ts 整体。

如果 flows.ts 整体就是 v1 任务流系统（与本 plan 工作轨子系统正交）且不再用 → 与用户确认是否一起删（写到 task report 作为 concern，**不要自行 BLOCKED**——继续最小化修 flows.ts 让 tsc 通过）。

- [ ] **Step 3：修 backend/src/index.ts**

读 `backend/src/index.ts`，找 `app.use(...)` 段。如果 mount 了已删的 route 模块 → 注释掉。

- [ ] **Step 4：tsc 通过**

```bash
cd /Users/tom/Projects/cc-web/backend
npx tsc --noEmit
```

预期：通过。

- [ ] **Step 5：Commit**

```bash
cd /Users/tom/Projects/cc-web
# 按实际改动 stage 文件
git add backend/src/routes/flows.ts backend/src/index.ts 2>/dev/null
git diff --cached --quiet && echo "nothing to commit" || git commit -m "chore(tracks): backend — patch routes/flows.ts + index.ts for removed deps"
```

---

## Task 9：跑测试 + 集成验证

**Files:** （无新文件，验证既有）

- [ ] **Step 1：跑 frontend vitest**

```bash
cd /Users/tom/Projects/cc-web/frontend
npx vitest run 2>&1 | tail -15
```

预期：**0 tests**（M0 删了所有节点图测试）或剩下若干非工作轨相关测试通过。如果有失败 → 检查是不是 M0 误删了某个共享 module。

- [ ] **Step 2：跑 frontend build**

```bash
cd /Users/tom/Projects/cc-web/frontend
npm run build 2>&1 | tail -10
```

预期：build 成功，`dist/` 生成。chunks 列表里**不再有** `TrackEditor` / `TrackGraphEditor` 之类的 chunk。

- [ ] **Step 3：跑 backend build**

```bash
cd /Users/tom/Projects/cc-web/backend
npm run build 2>&1 | tail -10
```

预期：build 成功，`dist/` 生成。

- [ ] **Step 4：启动 ccweb 验证不 crash（M0 hard verification）**

由于 daemon 启动属于 user action（用户偏好），本 step 仅做静态 smoke：

```bash
cd /Users/tom/Projects/cc-web
node -e "require('./backend/dist/index.js')" 2>&1 | head -10 &
sleep 2
kill %1 2>/dev/null
```

预期：脚本运行 2 秒无 crash 后被 kill；没有 "Cannot find module" 或 "TypeError" 类错误。

如果有 require error → 修对应的 backend/src/index.ts 或 routes mount。

- [ ] **Step 5：Commit**

无改动 commit。如果 Step 1-4 暴露问题 → 修后 commit "fix: M0 integration smoke" 之类。

---

## Task 10：版本 bump + release v-19-a

**Files:**
- Modify: `package.json` (root) — version → `2026.5.18-c`（或当天日期+下一字母）
- Modify: `README.md` — version 行
- Modify: `CLAUDE.md` — `**当前版本**` 行

- [ ] **Step 1：确认当前日期 + 上次版本号**

```bash
date "+%Y.%-m.%-d"
grep '"version"' /Users/tom/Projects/cc-web/package.json
```

如果当前日期是 2026-05-18，上一版是 `2026.5.18-b` → 新版 `2026.5.18-c`。
如果当前日期是 2026-05-19+ → 新版 `2026.5.19-a`（当天首发就 -a）。

**禁止发 bare 日期版本**（无字母后缀）。

- [ ] **Step 2：bump 3 文件**

按 Step 1 算出的版本号 `<NEW_VERSION>`：

- `/Users/tom/Projects/cc-web/package.json` — `"version": "<NEW_VERSION>"`
- `/Users/tom/Projects/cc-web/README.md` 顶部 — `**Current version**: v<NEW_VERSION>` 行
- `/Users/tom/Projects/cc-web/CLAUDE.md` 顶部 — `**当前版本**: v<NEW_VERSION>` 行

- [ ] **Step 3：build 一次确保发版前是干净状态**

```bash
cd /Users/tom/Projects/cc-web/backend && npm run build 2>&1 | tail -3
cd /Users/tom/Projects/cc-web/frontend && npm run build 2>&1 | tail -3
```

预期：两边 build OK。

- [ ] **Step 4：Commit + push**

```bash
cd /Users/tom/Projects/cc-web
git add package.json README.md CLAUDE.md \
  docs/superpowers/specs/2026-05-18-track-v3-flow-design.md \
  docs/superpowers/plans/2026-05-18-track-v3-M0-cleanup.md
git commit -m "release: v<NEW_VERSION> — M0 cleanup（删 train-core + v1 visual + v2 graph + 写代码模式）

完整抛弃 train-lang DSL，工作轨子系统进入 v3 过渡期：
- 删 backend/vendor/@tom2012/train-core
- 删 frontend/src/components/tracks/visual/ (v1 嵌套块)
- 删 frontend/src/components/tracks/graph/ (v2 ReactFlow + train-lang codegen)
- 删 frontend TrackEditor / TrackOutline / parse-train / train-monaco-lang (写代码 .tr 模式)
- 删 backend/src/tracks/track-runner / train-loader / types-train / registry
- 删 backend verify-tracks + frontend verify-graph-v2 scripts
- backend tracks routes 简化为 GET list / GET file / DELETE file
- TracksListDialog 改为 v3 占位（'v3 即将到来'）
- 保留 backend/vendor/@tom2012/train-adapter-spec + ccweb-train-adapter + workflow-data-watcher

设计文档：docs/superpowers/specs/2026-05-18-track-v3-flow-design.md
M0 实施计划：docs/superpowers/plans/2026-05-18-track-v3-M0-cleanup.md

下一步：M1 编辑器骨架（v3 .flow 数据模型 + 编辑器 + 保存）。"
git push origin main
```

- [ ] **Step 5：npm publish（必须用户当前消息授权 + token）**

**重要**：本 step 实施 subagent 不自行 publish。把 commit + push 后状态返回给 controller，让 controller 提示用户授权 publish + 提供 npm token。

实际命令格式（仅供 controller 调用，不在 subagent 内执行）：

```bash
npm publish --registry=https://registry.npmjs.org --access=public --tag latest --//registry.npmjs.org/:_authToken=<token>
```

- [ ] **Step 6：验证 registry**

publish 完成后：

```bash
npm view @tom2012/cc-web version
```

预期：返回 `<NEW_VERSION>`。

---

## Self-Review

**Spec coverage**：spec §13 "v1/v2/.tr 废弃与清理" 是 M0 的全部范围：

- §13.1 直接删除 ✓ Tasks 1-3 + Task 6 + Task 7
- §13.2 保留 ✓ 在 plan File Structure 段明示
- §13.3 TracksListDialog 改造 ✓ Task 4
- §13.4 旧 .tr 不自动删 ✓ TracksListDialog 占位文案说明
- §13.5 backend/vendor/@tom2012/train-core 删除 + 依赖检查 ✓ Task 7 + Task 1/2/3/6/7 Step 1 都 grep 验证

**Placeholder scan**：
- Task 6 / Task 8 有 "如果依赖" / "如果存在" 条件描述——这是必要的真实条件分支（侦查不能 100% 预先确定），subagent 跑 grep 后按结果决定，不是占位
- 无 TBD / TODO / "implement later" / "handle edge cases"
- 每 step 都给具体命令 / 完整代码（TracksListDialog 占位 + api.ts 完整内容）

**Type consistency**：
- `TracksListDialog` props（projectId / open / onOpenChange）在 Task 4 占位版本与外部调用方一致
- `TrackFileInfo` 在 api.ts 复用（保留 types.ts）
- 无方法签名变化

**已知简化**：
- Task 8 是"可能跳过"任务（如果 Task 7 后已 tsc 通过）——subagent 跑 Step 1 决定
- Task 9 Step 4 静态 require smoke 不是完整 daemon 启动测试；完整 e2e 需要用户在浏览器手测
- 浏览器手测 + npm publish 在 Task 10 Step 4-5 留给 controller 触发，不在 subagent 自动跑
