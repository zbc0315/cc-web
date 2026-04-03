# Memory Pool — 楔形容器与浮球系统

> **Date**: 2026-04-03
> **Status**: Approved
> **Scope**: 项目级记忆池（预留全局池扩展）

## 概述

在 ccweb 项目详情页左面板新增"记忆池"Tab，为每个项目提供基于"楔形容器与浮球系统"模型的 AI 记忆管理能力。记忆以"浮球"形式存储在项目目录的 `.memory-pool/` 中，浮力公式驱动优先级排序，ccweb 提供可视化和快捷操作入口，实际的记忆读写由终端中的 Claude CLI 按照生成的规范文档执行。

## 核心模型

### 浮力公式

```
B(t) = (B₀ + α · H) · λ^(t - t_last)
```

| 符号 | 含义 | 默认值 |
|------|------|--------|
| B₀ | 初始浮力 | 按类型 2-10 |
| H | 累计命中次数 | 0 |
| α | 查询增益系数 | 1.0 |
| λ | 衰减率 | 0.97（项目池） |
| t | 当前轮次 | 每条用户消息 +1 |
| t_last | 上次访问轮次 | 创建时=t |

### 球的五个属性

| 属性 | 含义 |
|------|------|
| 体积 | 信息长度（token 数） |
| 浮力 | 检索优先级，由公式计算 |
| 硬度 | 抗拆解能力（0-10） |
| 连线 | 与其他球的关联（strong/weak） |
| 融合潜力 | 共现累积的聚合倾向（0-1） |

### 三种动态过程

- **分化**：活跃层空间不足时，大球拆为多个小球，产生强连线
- **下沉**：低浮力球被排挤到深层（归档，非删除）
- **融合**：多次共现检索的小球合并为一个球

### 球的四种类型

| 类型 | B₀ 范围 | 用途 |
|------|---------|------|
| user | 5-7 | 用户身份、偏好、知识背景 |
| feedback | 8-10 | 用户纠正、行为反馈 |
| project | 4-6 | 项目上下文、技术决策 |
| reference | 2-4 | 外部资源指针 |

## 架构

三层架构，职责分离：

```
ccweb 前端（UI 层）          ccweb 后端（API 层）          Claude CLI（执行层）
├── 左面板 Tab：记忆池入口    ├── GET 读取 .memory-pool/    ├── 读取 SPEC.md 理解规范
├── 列表视图（浮力排序）      ├── POST 初始化记忆池         ├── 创建/修改记忆球文件
├── 浮球弹窗（全景概览）      ├── POST 快捷指令 → writeRaw  ├── 执行衰减/分化/融合
└── 快捷按钮 → 终端指令       └──（只读，不写球文件）        └── 更新 index.json
```

**关键原则**：后端只读不写。所有记忆的创建/修改/删除由 Claude CLI 在终端中完成。

## 文件结构

```
your-project/
├── .memory-pool/
│   ├── SPEC.md          ← 完整规范（浮力公式、文件格式、操作流程）
│   ├── QUICK-REF.md     ← 精简快速参考（AI 日常操作用）
│   ├── state.json       ← 全局状态（轮次计数器、参数配置）
│   ├── index.json       ← 所有球的索引（含预计算浮力，供前端读取）
│   └── balls/
│       ├── ball_0001.md ← 记忆球文件（YAML frontmatter + 正文）
│       ├── ball_0002.md
│       └── ...
├── CLAUDE.md            ← 追加记忆池入口指令
└── ...
```

### 球文件格式（balls/ball_XXXX.md）

```yaml
---
id: ball_0042
type: feedback
B0: 8
H: 3
t_last: 156
hardness: 7
fusion_potential: 0.3
links:
  - target: ball_0015
    strength: strong
  - target: ball_0038
    strength: weak
created_at: "2026-04-03T10:00:00Z"
---

不在代码中添加多余注释。用户明确表示不喜欢冗余的 JSDoc 和行内注释，
除非逻辑确实不直观。
```

### state.json

```json
{
  "t": 156,
  "lambda": 0.97,
  "alpha": 1.0,
  "active_capacity": 20,
  "next_id": 43,
  "pool": "project",
  "initialized_at": "2026-04-03T10:00:00Z"
}
```

### index.json

```json
{
  "t": 156,
  "updated_at": "2026-04-03T12:30:00Z",
  "balls": [
    {
      "id": "ball_0042",
      "type": "feedback",
      "summary": "不在代码中添加多余注释",
      "B0": 8,
      "H": 3,
      "t_last": 156,
      "buoyancy": 8.2,
      "hardness": 7,
      "links": ["ball_0015", "ball_0038"]
    }
  ]
}
```

## 后端 API

路由文件：`backend/src/routes/memory-pool.ts`

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/memory-pool/:projectId/init` | 初始化：创建 `.memory-pool/` 目录、生成 SPEC/QUICK-REF/state/index、追加 CLAUDE.md |
| GET | `/api/memory-pool/:projectId/status` | 返回 `{ initialized, state?, ballCount? }` |
| GET | `/api/memory-pool/:projectId/index` | 返回 index.json 内容 |
| GET | `/api/memory-pool/:projectId/ball/:ballId` | 返回单个球完整内容（YAML frontmatter + 正文） |
| POST | `/api/memory-pool/:projectId/command` | 快捷操作：`{ action }` → writeRaw 到终端 |

### 权限

复用项目权限模型：admin / owner / edit-share 可操作，view-share 只读。

### ballId 校验

正则 `/^ball_\d{1,6}$/`，防止路径穿越。

### init 端点逻辑

1. 校验项目存在且有写权限
2. 检查 `.memory-pool/` 是否已存在，已存在则返回 409
3. 创建目录结构：`.memory-pool/`、`.memory-pool/balls/`
4. 写入 SPEC.md（完整规范）
5. 写入 QUICK-REF.md（快速参考）
6. 写入 state.json（初始状态，t=0）
7. 写入 index.json（空列表）
8. 读取项目 CLAUDE.md，若不包含"记忆池"相关段落则追加指令块
9. 返回 `{ success: true }`

### command 端点逻辑

接收 `{ action: "maintain" | "load" | "save" | "general" }`，通过 `terminalManager.writeRaw(projectId, command)` 将预设指令发送到终端：

| action | 发送到终端的指令 |
|--------|--------------|
| maintain | `请执行记忆池维护：读取 .memory-pool/QUICK-REF.md，然后执行衰减计算、分化判定、融合检查，最后更新 index.json` |
| load | `请读取 .memory-pool/index.json 和活跃层记忆球，将重要记忆纳入当前上下文` |
| save | `请从我们当前的对话中提取值得记忆的信息，按照 .memory-pool/QUICK-REF.md 的规范存入记忆池` |
| general | `请读取 .memory-pool/QUICK-REF.md，对记忆池执行你认为合适的操作` |

## 前端组件

### LeftPanel 新增 Tab

在现有 Tab 栏（文件/Git/任务）下方新增"🧠"图标 Tab。

文件：修改 `frontend/src/components/LeftPanel.tsx`

### MemoryPoolPanel（新组件）

文件：`frontend/src/components/MemoryPoolPanel.tsx`

**未初始化状态**：空状态 + "初始化记忆池"按钮，点击调用 POST init API。

**已初始化状态**：
- 顶部：标题 + 统计信息（t=轮次 · N balls）
- 快捷按钮行：整理 / 读取 / 保存 / 通用，四个按钮
- 球列表：分"活跃层"和"深层"两区
  - 活跃层：浮力 Top-N（N = active_capacity），正常透明度
  - 深层：其余球，降低透明度
  - 每个球显示：类型标签（颜色编码）、摘要文本、浮力值、元数据（H/t_last/links 数）
  - 点击球 → 弹出浮球弹窗

**轮询**：每 5 秒 GET index，页面不可见时暂停（复用现有 RightPanel 的轮询模式）。

### MemoryPoolBubbleDialog（新组件）

文件：`frontend/src/components/MemoryPoolBubbleDialog.tsx`

浮球全景弹窗：
- 纵向布局：高浮力在上，低浮力在下
- 球大小 = 体积（摘要长度映射到直径）
- 球颜色 = 类型（feedback=#4a6cf7, user=#22c55e, project=#f59e0b, reference=#a78bfa）
- 虚线 = 连线（strong 实线，weak 虚线）
- 活跃层/深层分界线
- 底部信息栏：显示选中球的详情
- 支持拖拽平移和滚轮缩放（复用 GraphPreview 的 useRef 拖拽模式）

### 类型颜色映射

| 类型 | 颜色 | 用途 |
|------|------|------|
| feedback | `#4a6cf7`（蓝） | 行为反馈 |
| user | `#22c55e`（绿） | 用户信息 |
| project | `#f59e0b`（黄） | 项目上下文 |
| reference | `#a78bfa`（紫） | 外部引用 |

## 文档生成

初始化时后端生成三层文档：

### 1. CLAUDE.md 追加段落

```markdown
## 记忆池（Memory Pool）

本项目已启用记忆池系统。

**每次对话开始时：**
1. 读取 `.memory-pool/QUICK-REF.md` 了解操作规范
2. 读取 `.memory-pool/state.json` 获取当前轮次
3. 读取 `.memory-pool/index.json` 加载活跃层记忆
4. 将活跃层记忆纳入当前对话上下文

**对话过程中：**
- 遇到重要信息时主动提议存入记忆池
- 用户要求记忆操作时参照 QUICK-REF.md 执行
- 每次操作后更新 index.json

**完整规范：** `.memory-pool/SPEC.md`
```

### 2. SPEC.md

完整规范文档，包含：
- 模型概述（楔形容器隐喻）
- 浮力公式及所有参数说明
- 球的五个属性详细定义
- 球文件格式（YAML frontmatter 字段说明）
- state.json 字段说明
- index.json 格式与更新规则
- 四种操作流程：创建球、查询球（含命中更新）、维护（衰减/分化/融合）、删除球
- 分化判据公式与硬度约束
- 融合触发条件与结果
- 连线系统规则
- 召回机制（直接召回 + 连线召回）
- B₀ 参考值表
- 多容器架构预留说明

### 3. QUICK-REF.md

精简操作卡片，供 AI 日常使用：
- 创建球：文件命名、必填字段、B₀ 参考值
- 查询球：读 index.json → 找球 → H+=1, t_last=t → 更新球文件 + index
- 维护流程：遍历所有球 → 计算浮力 → 排序 → 分化/融合判定 → 更新 index
- state.json 轮次自增规则
- 常用命令速查

## 作用域与扩展

当前版本仅实现项目级记忆池（`.memory-pool/` 在项目目录下）。

**预留全局池扩展点**：
- state.json 的 `pool` 字段区分 `"project"` / `"global"`
- SPEC.md 中描述多容器架构概念
- 球文件格式的 `pool` 字段（当前省略，默认 project）
- 未来全局池路径：`~/.ccweb/memory-pool/`

## 不做的事

- 后端不实现球的写操作 API（由 Claude CLI 完成）
- 不实现实时浮力计算（前端读取 index.json 中 AI 预计算的值）
- 不实现跨项目记忆共享（留给全局池扩展）
- 不实现自动记忆提取（AI 主动提议，用户确认）
