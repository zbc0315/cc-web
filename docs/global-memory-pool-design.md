# 全局记忆池设计方案

> 版本: v2.0 | 日期: 2026-04-04 | 审查后修订

## 一、目标

跨项目提炼通用行为准则。单个项目的记忆池是"局部经验"，全局记忆池是从所有局部经验中浮现出来的"通用智慧"。利用已有的浮力物理模型，让跨项目的共性经验自动上浮。

## 二、存储结构

```
~/.ccweb/memory-pool/              ← 全局记忆池
├── pool.json                      ← pool: "global", lambda: 0.99
├── balls/
│   ├── ball_0001.md
│   └── ...
└── sources.json                   ← 记忆来源注册表

项目/.memory-pool/
├── pool.json                      ← 新增字段 global_pool_path
└── ...
```

> 全局池不需要 QUICK-REF.md / SPEC.md——它不被 LLM 直接读取，只被后端程序操作。

## 三、sources.json 格式

```json
{
  "version": 1,
  "sources": [
    {
      "project_id": "abc123",
      "project_name": "cc-web",
      "pool_path": "/Users/tom/Projects/cc-web/.memory-pool",
      "registered_at": "2026-04-04T10:00:00Z",
      "last_synced_at": null,
      "status": "active"
    }
  ]
}
```

`status` 取值：`"active"` | `"unreachable"`。连续 3 次 sync 路径不可达时自动标记为 `"unreachable"`，不再尝试读取。可通过 API 手动恢复或删除。

## 四、全局 pool.json 参数

| 参数 | 项目池 | 全局池 | 理由 |
|------|--------|--------|------|
| `lambda` | 0.97 | 0.99 | 通用经验时效更长 |
| `active_capacity` | 20 | 40 | 跨项目信息量更大 |
| `pool` | `"project"` | `"global"` | 区分层级 |

### 全局 t 按日历时间递增（P0 修正）

全局池的 `t` **不按 sync 次数递增**，而是按日历天数：

```
t = floor((now - epoch) / 86400000)   // epoch = pool.initialized_at
```

每次 sync 时，`t` 更新为当前日期对应的天数差值。这样 `λ=0.99` 对应"每天衰减 1%"，不受 sync 频率影响。

- 30 天未被触及：衰减因子 = 0.99^30 = 0.74（衰减 26%）
- 90 天未被触及：衰减因子 = 0.99^90 = 0.41（衰减 59%）
- 一年未被触及：衰减因子 = 0.99^365 = 0.03（几乎归零）

## 五、球的来源追踪

全局池的球需要追踪来源，用于增量更新和去重：

```typescript
interface GlobalBallOrigin {
  source_project: string;      // project_id
  source_ball_id: string;      // 原始球ID如 "ball_0003"
  synced_at: string;           // 导入时间
}
```

项目池的球可以引用全局球：

```typescript
// PoolBallMeta 新增可选字段（均为 optional，向后兼容旧 pool.json）
interface PoolBallMeta {
  // ...existing fields...
  origins?: GlobalBallOrigin[];  // 仅全局池使用，记录来自哪些项目
  global_ball_id?: string;       // 仅项目池使用，引用自全局池的球ID
}
```

> **去掉 global_links（P2 修正）**：不依赖 LLM 跨目录追寻全局池文件。引用时将球内容完整复制到项目池，links 只映射同时被引用的球。

## 六、核心流程

### 6.1 注册（Init/Upgrade 时自动执行）

```
项目 init/upgrade
  → 读取全局池路径 (~/.ccweb/memory-pool/)
  → 如果全局池不存在，初始化空的全局池
  → 将 global_pool_path 写入项目 pool.json
  → 将项目路径添加到全局 sources.json（去重，按 pool_path 判断）
```

### 6.2 汇总（"更新全局记忆池"按钮）

```
用户点击 → POST /api/memory-pool/global/sync

并发保护：模块级 syncInProgress 标志位。
  如果已有 sync 在执行 → 返回 409 Conflict "sync in progress"

Step 1: 收集
  读取 sources.json → 遍历所有 status="active" 的 source
  对每个项目池：
    → 路径可达：读取 pool.json + 球内容
    → 路径不可达：跳过，unreachable_count += 1
       连续 3 次不可达 → status 改为 "unreachable"
  收集结果中记录：成功项目列表、跳过项目列表

Step 2: 增量合并
  对每个项目球：
    在全局池中查找是否已有 origins 包含该 source_project + source_ball_id 的球
    → 已存在且内容未变：跳过（仅刷新 t_last = 当前全局 t）
    → 已存在但内容已变：更新球内容，保留全局 H
    → 不存在：创建新全局球
       B0 = 项目球的当前浮力值 computeBuoyancy(...)（携带项目内使用信号）
       H = 0（全局池内从零开始累计）
       origins = [{ source_project, source_ball_id, synced_at }]

Step 3: 孤儿检测（P1 修正）
  对全局池中每个球的 origins 数组：
    检查对应项目池中该球是否仍存在
    → 项目球已删除：从 origins 中移除该条目
    → origins 变为空数组：标记 orphaned = true，B0 减半
  sync 报告中提示清理数量

Step 4: 去重处理（保守策略）
  不做自动合并。理由：
  - 自动相似度判断有信息丢失风险
  - 物理模型会自然处理：真正通用的反馈来自多个项目，被触及频率更高
  - 冗余球只是占空间，不影响活跃层质量

  唯一的去重：同一项目同一球的重复导入（通过 origins 精确匹配）

Step 5: 浮力重算
  全局 t = floor((now - initialized_at) / 86400000)
  所有新导入/更新/命中的球 t_last = 当前全局 t
  未被触及的球自然按日历时间衰减

Step 6: 写回（P0 修正：门控写入）
  写入顺序保证一致性：
  1. 先写所有新增/更新的 balls/*.md 文件
  2. 最后写 pool.json（门控文件，只有它写入成功，本次 sync 才算生效）
  3. 更新 sources.json 中各项目的 last_synced_at

返回结果：
  { added: N, updated: N, skipped: N, orphaned: N, 
    unreachable_projects: [...], synced_projects: [...] }
```

### 6.3 引用（"引用全局记忆"按钮，两步流程）

**Step A: 预览**
```
GET /api/memory-pool/:projectId/import-preview

1. 读取全局池，按浮力排序，取 active_capacity 层的球
2. 排除已在本项目池中存在的球（通过 global_ball_id 判断）
3. 返回候选球列表（id, type, summary, buoyancy）供用户选择
```

**Step B: 确认导入**
```
POST /api/memory-pool/:projectId/import-from-global
Body: { ball_ids: ["ball_0001", "ball_0005", ...] }  // 用户选定的全局球ID

1. 读取全局池中选定的球

2. B0 归一化（P0 修正，防止活跃层霸占）：
   计算本项目池当前活跃层最低浮力值 lowest_active_B
   对每个导入球：
     B0 = min(全局球当前浮力, lowest_active_B * 1.5)
     下限保证：B0 >= 该球类型的默认 B0（feedback=8, user=5, project=4, reference=2）
   引用球的价值应通过 LLM 命中来证明，而不是靠初始高浮力强行占位

3. 创建本地球：
   - 新的本地 ball_id（使用本项目的 next_id）
   - H = 0（在本项目中尚未被命中）
   - global_ball_id = 全局球的 ID（用于去重和溯源）
   - links：仅映射同时被导入的球之间的连线
     建立 global_id → local_id 映射表，只保留映射表中存在的 links
     link 目标未被导入的 → 不写入 links（P1 修正，避免悬挂引用）

4. 复制球内容文件（完整复制，不依赖全局池路径）

5. 返回导入数量和清单
```

## 七、类型变更汇总

```typescript
// types.ts 扩展

interface GlobalBallOrigin {
  source_project: string;
  source_ball_id: string;
  synced_at: string;
}

interface PoolBallMeta {
  // ...existing fields...
  origins?: GlobalBallOrigin[];     // 全局池：来源追踪
  orphaned?: boolean;               // 全局池：所有来源已删除
  global_ball_id?: string;          // 项目池：引用自全局池的球ID
}

// 项目 pool.json 新增字段
interface PoolJson {
  // ...existing fields...
  global_pool_path?: string;        // 全局池路径（仅项目池使用）
}

interface SourceEntry {
  project_id: string;
  project_name: string;
  pool_path: string;
  registered_at: string;
  last_synced_at: string | null;
  status: 'active' | 'unreachable';
}

interface SourcesJson {
  version: number;
  sources: SourceEntry[];
}
```

> 所有新增字段均为 optional（`?`），旧版 pool.json 无需迁移即可兼容。

## 八、API 端点

### 全局池操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/memory-pool/global/status` | 全局池状态（是否初始化、球数量、来源数量） |
| GET | `/api/memory-pool/global/index` | 全局池球列表（含浮力） |
| GET | `/api/memory-pool/global/ball/:ballId` | 读取全局球内容 |
| POST | `/api/memory-pool/global/sync` | 汇总所有项目到全局池 |
| GET | `/api/memory-pool/global/sources` | 查看所有已注册项目来源 |
| DELETE | `/api/memory-pool/global/sources/:projectId` | 移除项目来源 |

### 项目池与全局池交互

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/memory-pool/:projectId/import-preview` | 预览可导入的全局球 |
| POST | `/api/memory-pool/:projectId/import-from-global` | 导入选定的全局球到项目 |

> **API 路径修正（P1）**：sync 是全局操作，路径为 `/global/sync` 而非 `/:projectId/sync-to-global`。权限校验要求用户拥有至少一个项目。

## 九、并发安全

```typescript
// 模块级锁，单进程 Node 应用足够
let syncInProgress = false;

async function handleSync(req, res) {
  if (syncInProgress) {
    return res.status(409).json({ error: 'Sync already in progress' });
  }
  syncInProgress = true;
  try {
    // ... sync logic ...
  } finally {
    syncInProgress = false;
  }
}
```

## 十、前端变更

### 10.1 MemoryPoolPanel 新增按钮

- **"更新全局记忆池"**：调用 `POST /global/sync`，显示同步结果（新增/更新/跳过/孤儿/不可达项目）
- **"引用全局记忆"**：先调用 `GET /import-preview` 展示候选列表，用户勾选后调用 `POST /import-from-global`

### 10.2 球卡片新增标识

- 引用自全局的球显示 "全局" 徽章（类似现有的 "permanent" 徽章）
- 孤儿球（orphaned）显示灰色 "孤儿" 徽章（仅在全局池视图中）

## 十一、物理模型为什么自然解决问题

**通用性上浮**：
- "不确定时询问用户" 出现在 5 个项目 → 全局池中有 5 个 origins → 每次 sync 都被触及 → t_last 持续刷新 → 衰减极小 → 浮力持续高位
- "项目A的OAuth配置细节" 只有 1 个 origin → 只在该项目 sync 时被触及 → 衰减正常进行 → 逐渐下沉

**冲突自解决**：
- "用TDD"被 3 个项目验证 vs "不用TDD"被 1 个项目提到 → 前者 origins 更多、被触及频率更高 → 浮力自然更高

**信息不丢失**：
- 不做内容合并，只做精确去重（同源同球）
- 所有球永远存在，只是浮力不同
- 孤儿球不直接删除，仅降低浮力，保留恢复可能

## 十二、实施顺序

1. **Phase 1 — 后端基础**：类型扩展（PoolBallMeta, PoolJson, SourcesJson）、全局池初始化、sources.json 管理
2. **Phase 2 — 汇总流程**：`POST /global/sync` 实现（含并发锁、门控写入、孤儿检测）
3. **Phase 3 — 引用流程**：`GET /import-preview` + `POST /import-from-global`（含 B0 归一化、links 映射）
4. **Phase 4 — 注册联动**：修改 init/upgrade 自动注册到全局 sources.json
5. **Phase 5 — 前端**：按钮、预览选择对话框、全局/孤儿徽章、sync 结果展示

## 附录：审查修正记录

| 级别 | 编号 | 问题 | 修正 |
|------|------|------|------|
| P0 | 2.1 | 全局 t 按 sync 次数递增导致衰减无效 | 改为按日历天数递增 |
| P0 | 1.1 | Sync 写回中途失败致不一致 | 门控写入：balls 先写，pool.json 最后写 |
| P0 | 2.3 | 引用回项目 B0 过高霸占活跃层 | B0 = min(全局浮力, 项目最低活跃浮力 * 1.5) |
| P1 | 1.2 | 多标签页并发 sync | 模块级 syncInProgress 锁 |
| P1 | 3.2 | 项目球删除后全局 origins 残留 | Sync 时检测并清理，origins 为空标记 orphaned |
| P1 | 4.1 | Links 悬挂引用 | 只映射同时被导入的球之间的 links |
| P1 | 5.1 | sync API 绑定 projectId 但执行全局操作 | 改为 /global/sync |
| P2 | 4.2 | global_links LLM 追寻不可靠 | 去掉 global_links，完整复制内容 |
| P2 | 8.2 | import 无选择性 | 改为 preview + 选择性导入两步 |
| P2 | 5.2 | 缺少运维 API | 补充 sources 管理 + global ball 读取 |
| P2 | 2.2 | 新导入球 B0 未明确 | B0 = 项目球当前浮力值 |
| P3 | 1.3 | 失效项目不自动清理 | 连续 3 次不可达自动标记 unreachable |
| P3 | 7.2 | 全局池 QUICK-REF/SPEC 无意义 | 去掉，全局池只被程序操作 |
