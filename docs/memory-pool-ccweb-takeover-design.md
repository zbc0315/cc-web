# Memory Pool: ccweb 接管元数据操作 — 设计文档

> **版本**: v2.0（合并评审修复 + 全局池简化）
> **日期**: 2026-04-04
> **状态**: Approved

## 1. 动机

当前记忆池中，LLM 直接读写 `pool.json` 和 `ball.md` 文件，承担了所有 CRUD 操作。这导致：

1. **LLM 操作复杂**：创建一个球需要 4-5 次工具调用
2. **元数据不一致风险**：LLM 可能忘记更新 pool.json、算错 B0、或遗漏 surface.md 重建
3. **命中计数不可靠**：依赖 LLM 自觉执行 H+=1，容易遗漏
4. **轮次 t 无自动递增**：SPEC.md 声称由 hook 自动递增，但实际未实现
5. **全局池 import 冗余**：复制全局球到项目池导致数据重复和同步负担

## 2. 核心原则

1. **LLM 只负责内容创作（写 ball.md），ccweb 管理一切元数据**
2. **全局池只读不复制**：LLM 通过 API 直接访问全局记忆，不再导入到项目池
3. **所有 pool.json 写操作经过 pool lock 串行化**（C-2 fix）

## 3. API 端点设计

### 3.1 项目池端点 — `/api/memory-pool/:projectId/`

#### POST /balls — 创建球

**LLM 操作**：调用 API 传入 content

**请求体**：
```json
{
  "type": "feedback",
  "summary": "不要在代码中添加多余注释",
  "content": "## 规则\n不要添加多余注释...",
  "links": ["ball_0004"],
  "b0_override": null
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| type | 是 | `feedback` / `user` / `project` / `reference` |
| summary | 是 | 球的一行摘要 |
| content | 是 | 球的 markdown 正文 |
| links | 否 | 关联球 ID 数组（需通过 BALL_ID_RE 校验） |
| b0_override | 否 | 覆盖默认 B0（1-10 范围） |

**ccweb 执行**：分配 ID → 写 ball.md → 按 type 分配 B0 → 更新 pool.json → 重建 surface.md

**响应**：`{ id, B0, diameter }`

#### PUT /balls/:ballId — 更新球元数据

**LLM 操作**：先 Edit ball.md，再调 API 同步

**请求体**：`{ "summary": "新摘要（可选）" }`

**ccweb 执行**：重算 diameter → 更新 pool.json → 重建 surface.md

#### POST /balls/:ballId/hit — 命中查询

**LLM 操作**：直接调用（不操作文件）

**ccweb 执行**：H+=1, t_last=t → 读内容+关联球 → 更新 pool.json → 重建 surface.md

**响应**：
```json
{
  "id": "ball_0015",
  "content": "球的完整 markdown 内容...",
  "buoyancy": 9.73,
  "linked_balls": [
    { "id": "ball_0004", "type": "project", "summary": "...", "buoyancy": 9.0 }
  ]
}
```

> **H-2 fix**：保留现有 `GET /ball/:ballId` 作为纯读取（无副作用），`POST /balls/:ballId/hit` 只在 LLM 确实"使用"了该球信息时才调用。

#### DELETE /balls/:ballId — 删除球

**ccweb 执行**：删 ball.md → 清理其他球的 links 引用 → 更新 pool.json → 重建 surface.md

#### PATCH /balls/:ballId/links — 管理连线

**请求体**：`{ "add": ["ball_0007"], "remove": ["ball_0003"] }`

> **M-4 fix**：add/remove 数组中的所有 ID 必须通过 BALL_ID_RE 校验

#### POST /tick — 轮次递增

**幂等保护**（M-1 fix）：pool.json 记录 `last_tick_session`，同一 session 的重复 tick 被忽略。

**请求体**：`{ "session": "session_id（可选）" }`

**自动触发**：ccweb 在收到 Claude Code 的 `Stop` hook 事件时自动调用。

#### GET /surface — 获取活跃层摘要

**M-2 fix**：返回前检查 `last_tick_at` 距今是否超过 10 分钟，如超过则自动补一次 tick。

**响应**：
```json
{
  "t": 20,
  "surface_width": 10000,
  "used_tokens": 1343,
  "balls": [
    { "id": "ball_0004", "type": "project", "summary": "...", "buoyancy": 9.0, "diameter": 64, "links": ["ball_0003"] }
  ]
}
```

#### POST /maintenance — 维护建议

返回分化建议列表。列出所有活跃层大球（不限 hardness），标注 `recommended` 字段。

**H-4 fix**：同时执行自愈检测：
- 孤立球文件（文件存在但 pool.json 无条目）
- 幽灵条目（pool.json 有条目但文件不存在）

### 3.2 全局池端点 — `/api/memory-pool/global/`

**设计简化**：全局池只读不复制。删除 import-preview 和 import-from-global。

| 端点 | 方法 | 说明 |
|------|------|------|
| /global/surface | GET | 全局活跃层摘要（与项目池 surface 格式相同） |
| /global/balls/:ballId/hit | POST | 命中查询全局球（返回内容+关联球，自动计数） |
| /global/status | GET | 保留 |
| /global/index | GET | 保留（前端可视化使用） |
| /global/ball/:ballId | GET | 保留（纯读取） |
| /global/sources | GET | 保留 |
| /global/sources/:projectId | DELETE | 保留 |
| /global/sync | POST | 保留 |

**删除**：`import-preview`、`import-from-global` 端点及相关代码。

## 4. B0 自动分配规则

| type | 默认 B0 | 全局池 defaultB0 |
|------|---------|-----------------|
| feedback | 9 | 8 |
| user | 6 | 5 |
| project | 5 | 4 |
| reference | 3 | 2 |

> **L-1 fix**：项目池和全局池使用不同的默认值表，在代码中分别定义。

## 5. 技术实现

### 5.1 Pool Lock（C-2 fix）

每个 poolDir 对应一个 Promise 链锁，所有写操作串行执行：

```typescript
// pool-lock.ts
const locks = new Map<string, Promise<void>>();
export function withPoolLock<T>(poolDir: string, fn: () => T): Promise<T> { ... }
```

所有新增的写操作路由（POST /balls, PUT, DELETE, PATCH, POST /tick）都通过 `withPoolLock` 包裹。

### 5.2 Diameter 缓存（H-3 fix）

`PoolBallMeta` 新增 `diameter?: number` 字段。球创建/更新时计算并缓存。`buildSurface` 优先使用缓存值，无需每次重读所有球文件。

### 5.3 轮次自增（Hook 集成）

hooks.ts 的 Stop 事件处理中新增：
```
Stop → clearSemanticStatus → triggerRead → tickProjectPool(projectId)
```

### 5.4 Surface 重建优化

- hit 操作只改 H/t_last，通常不影响排序，可跳过 surface 重建
- 使用 diameter 缓存避免逐球读文件

## 6. 清理项

### 6.1 删除的代码

- `global-pool-manager.ts`: `getImportPreview()`, `importFromGlobal()` 函数
- `routes/memory-pool.ts`: `import-preview`, `import-from-global` 路由
- `frontend/api.ts`: `getImportPreview()`, `importFromGlobal()`, `ImportPreviewBall` 类型
- `frontend/MemoryPoolPanel.tsx`: 导入预览面板、引用全局按钮、importPreview/importSelected 状态
- `types.ts`: `PoolBallMeta.global_ball_id`, `ImportPreviewBall` 接口

### 6.2 保留的代码

- `syncToGlobal()` — 仍然需要，将项目球聚合到全局池
- 全局池的 status/index/ball/sources/sync 路由 — 保留
- 前端「同步全局」按钮 — 保留
- `MemoryPoolBubbleDialog` — 保留（全局池可视化）

## 7. LLM 新工作流

```
对话开始:
  1. GET /:projectId/surface → 项目活跃层
  2. GET /global/surface → 全局活跃层（可选）
  3. POST /balls/:id/hit → 按需获取具体内容

创建记忆:
  1. POST /:projectId/balls → { type, summary, content }

使用记忆:
  1. POST /balls/:id/hit → 内容 + 关联球（自动计数）

对话结束:
  ccweb Hook 自动 tick
```
