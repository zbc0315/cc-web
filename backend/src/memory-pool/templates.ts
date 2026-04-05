// backend/src/memory-pool/templates.ts

export function generateSpecMd(): string {
  return `# Memory Pool 规范文档 (SPEC.md)

> 本文档定义了记忆池系统的完整规范。AI 应在执行复杂记忆操作时参考本文档。
> 日常操作请使用 QUICK-REF.md。

## 一、核心模型：楔形容器与浮球系统

记忆池是一个**楔形容器**——利用物理几何来施加计算层面的容量约束。每条记忆是容器中的一个**浮球**，对应 \`.memory-pool/balls/\` 下的一个 \`.md\` 文件。

- **活跃层**：浮力最高的 Top-N 个球（N = \`active_capacity\`），AI 每次对话应优先加载
- **表面层（Surface）**：浮力最高且总 token 直径不超过楔形顶部宽度（\`surface_width\`）的球
- **深层**：其余球，不主动加载，但可通过 hit 查询或连线召回
- **永不消失**：浮力趋近于零但永远不为零，任何记忆都可被召回

## 二、浮力公式

\`\`\`
B(t) = (B₀ + α · H) · λ^(t - t_last)
\`\`\`

| 符号 | 含义 | 来源 |
|------|------|------|
| B₀ | 初始浮力 | 由 ccweb 按类型自动分配 |
| H | 累计命中次数 | ccweb 通过 hit API 自动计数 |
| α | 查询增益系数 | pool.json → alpha（默认 1.0） |
| λ | 衰减率 | pool.json → lambda（默认 0.97） |
| t | 当前全局轮次 | ccweb 通过 hook 自动递增 |
| t_last | 上次访问轮次 | ccweb 通过 hit API 自动更新 |

**浮力动态计算**：buoyancy 不存储在文件中，每次读取时由后端根据公式实时计算。

**永久标记**：\`permanent: true\` 的球跳过衰减项。

## 三、球的属性

| 属性 | 字段 | 说明 |
|------|------|------|
| 直径 | \`diameter\` | 内容 token 数估算，由 ccweb 自动计算并缓存 |
| 浮力 | \`B0\`, \`H\`, \`t_last\` | 由公式计算，决定检索优先级 |
| 硬度 | \`hardness\` (0-10) | 抗拆解能力，硬度高的球抵抗分化 |
| 连线 | \`links[]\` | 与其他球的关联（ID 数组） |
| 永久 | \`permanent\` | true 时不参与衰减 |

## 四、球的四种类型与默认 B₀

| 类型 | 默认 B₀ | 用途 |
|------|---------|------|
| \`feedback\` | 9 | 用户纠正、行为反馈——直接影响行为正确性 |
| \`user\` | 6 | 用户身份、偏好、知识背景 |
| \`project\` | 5 | 项目上下文、技术决策、进度状态 |
| \`reference\` | 3 | 外部资源指针（URL、文档位置等） |

## 五、文件结构

\`\`\`
.memory-pool/
├── pool.json          ← ccweb 独占管理（AI 不直接读写）
├── surface.md         ← ccweb 自动生成（活跃层摘要）
├── balls/             # 球文件，纯 markdown 内容
│   ├── ball_0001.md
│   └── ...
├── QUICK-REF.md       # AI 操作参考（本文档）
└── SPEC.md            # 完整规范
\`\`\`

## 六、操作流程（通过 ccweb API）

所有操作通过 ccweb REST API 完成，AI 不再直接操作 pool.json。

### 6.1 创建球
调用 \`POST /api/memory-pool/{projectId}/balls\`，传入 type、summary、content。
ccweb 自动：分配 ID、设定 B₀、写入 ball.md、更新 pool.json、重建 surface.md。

### 6.2 命中查询
调用 \`POST /api/memory-pool/{projectId}/balls/{ballId}/hit\`。
ccweb 自动：H+=1、t_last=t、返回球内容和关联球摘要。

### 6.3 修改球内容
先 Edit \`balls/ball_XXXX.md\`，然后调用 \`PUT /api/memory-pool/{projectId}/balls/{ballId}\`。
ccweb 自动：重算 diameter、更新 pool.json、重建 surface.md。

### 6.4 删除球
调用 \`DELETE /api/memory-pool/{projectId}/balls/{ballId}\`。
ccweb 自动：删文件、清理 links、更新 pool.json、重建 surface.md。

### 6.5 轮次自增
\`t\` 由 ccweb 在 Claude Code Stop hook 事件时自动递增。AI 也可手动调用 \`POST /tick\`。

## 七、多容器架构

- **项目池**（\`pool: "project"\`）：\`.memory-pool/\`，\`lambda: 0.97\`
- **全局池**（\`pool: "global"\`）：\`~/.ccweb/memory-pool/\`，\`lambda: 0.99\`

全局池的 \`t\` 按日历天数递增。AI 通过 \`GET /api/memory-pool/global/surface\` 访问全局记忆，无需导入到项目池。
`;
}

export function generateQuickRefMd(): string {
  return `# Memory Pool 快速参考 (QUICK-REF.md)

> AI 日常操作记忆池时读取此文档。完整规范见 SPEC.md。
> 所有操作通过 ccweb API 完成，**不要直接读写 pool.json**。

## 连接发现

1. 读取 \`~/.ccweb/port\` 获取当前端口号（如 \`3001\`）
2. BASE URL: \`http://localhost:{port}/api/memory-pool/{projectId}\`
3. \`{projectId}\` = 当前项目目录的 URL-encoded 绝对路径（如 \`%2FUsers%2Ftom%2FProjects%2Fmy-app\`）

示例：若端口为 3001，项目路径为 \`/Users/tom/Projects/my-app\`：
\`\`\`
curl http://localhost:3001/api/memory-pool/%2FUsers%2Ftom%2FProjects%2Fmy-app/surface
\`\`\`

## 对话开始

\`\`\`
GET /surface → 获取活跃层记忆（按浮力排序，受楔形宽度限制）
\`\`\`

按需读取具体球：
\`\`\`
POST /balls/{ballId}/hit → 返回内容 + 关联球摘要（自动计数 H+=1）
\`\`\`

如需查看全局记忆：
\`\`\`
GET /api/memory-pool/global/surface → 全局活跃层
POST /api/memory-pool/global/balls/{ballId}/hit → 全局球命中查询
\`\`\`

## 创建球

\`\`\`
POST /balls
Body: { "type": "feedback", "summary": "简短摘要", "content": "markdown正文" }
可选: "links": ["ball_0004"], "b0_override": 8
\`\`\`

type 决定默认 B₀：feedback=9 | user=6 | project=5 | reference=3

## 修改球

1. 用 Edit 工具修改 \`.memory-pool/balls/ball_XXXX.md\`
2. 调用：\`PUT /balls/{ballId}\` Body: \`{ "summary": "新摘要" }\`（summary 可选）

## 删除球

\`\`\`
DELETE /balls/{ballId}
\`\`\`

ccweb 自动清理其他球对该球的 links 引用。

## 管理连线

\`\`\`
PATCH /balls/{ballId}/links
Body: { "add": ["ball_0007"], "remove": ["ball_0003"] }
\`\`\`

## 纯读取（不增加命中计数）

\`\`\`
GET /ball/{ballId} → 只返回内容，不影响 H 和 t_last
\`\`\`

## 轮次管理

\`t\` 由 ccweb 在对话结束时自动递增（Stop hook）。无需手动操作。

## 维护

\`\`\`
POST /maintenance → 返回分化建议 + 异常检测
\`\`\`

分化执行：创建多个新球（POST /balls）→ 删除原球（DELETE /balls/{id}）。
`;
}

export function generateClaudeMdBlock(): string {
  return `## 记忆池（Memory Pool）

本项目已启用记忆池系统，通过 ccweb API 管理。

**每次对话开始时：**
1. 读取 \`.memory-pool/QUICK-REF.md\` 了解 API 操作规范（含连接发现方式）
2. 读取 \`~/.ccweb/port\` 获取端口，拼接 \`http://localhost:{port}/api/memory-pool/{projectId}/surface\` 获取活跃层记忆
3. 按需调用 \`POST /balls/{ballId}/hit\` 获取具体球内容

**对话过程中：**
- 遇到重要信息时，通过 \`POST /balls\` 创建新球
- 使用球信息时，通过 \`POST /balls/{ballId}/hit\` 自动计数
- 不要直接读写 pool.json，所有元数据由 ccweb 管理

**完整规范：** \`.memory-pool/SPEC.md\`
`;
}
