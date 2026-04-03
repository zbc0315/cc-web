// backend/src/memory-pool/templates.ts

export function generateSpecMd(): string {
  return `# Memory Pool 规范文档 (SPEC.md)

> 本文档定义了记忆池系统的完整规范。AI 应在执行复杂记忆操作（分化、融合、架构调整）时参考本文档。
> 日常操作请使用 QUICK-REF.md。

## 一、核心模型：楔形容器与浮球系统

记忆池是一个**楔形容器**——上窄下深，深度无限。每条记忆是容器中的一个**浮球**，对应 \`.memory-pool/balls/\` 下的一个 \`.md\` 文件。

- **活跃层**：浮力最高的 Top-N 个球（N = \`state.json\` 中的 \`active_capacity\`），AI 每次对话应优先加载
- **深层**：其余球，不主动加载，但可通过查询或连线召回
- **永不消失**：浮力趋近于零但永远不为零，任何记忆都可被召回

## 二、浮力公式

\`\`\`
B(t) = (B₀ + α · H) · λ^(t - t_last)
\`\`\`

| 符号 | 含义 | 来源 |
|------|------|------|
| B₀ | 初始浮力 | 球文件 frontmatter \`B0\` |
| H | 累计命中次数 | 球文件 frontmatter \`H\` |
| α | 查询增益系数 | \`state.json\` → \`alpha\`（默认 1.0） |
| λ | 衰减率 | \`state.json\` → \`lambda\`（默认 0.97） |
| t | 当前全局轮次 | \`state.json\` → \`t\` |
| t_last | 上次访问轮次 | 球文件 frontmatter \`t_last\` |

**轮次规则**：每条用户消息算一轮。AI 在对话开始时读取 \`state.json\` 的 \`t\` 值，在对话过程中根据用户消息数量自增并写回。

## 三、球的五个属性

| 属性 | 字段 | 说明 |
|------|------|------|
| 体积 | （正文长度） | 信息的 token 数或字数，越长越大 |
| 浮力 | \`B0\`, \`H\`, \`t_last\` | 由公式计算，决定检索优先级 |
| 硬度 | \`hardness\` (0-10) | 抗拆解能力，硬度高的球抵抗分化 |
| 连线 | \`links[]\` | 与其他球的关联：\`strong\`（分化产生）或 \`weak\`（共现产生） |
| 融合潜力 | \`fusion_potential\` (0-1) | 多次共现检索时累积，超过阈值可触发融合 |

## 四、球的四种类型

| 类型 | B₀ 参考 | 用途 |
|------|---------|------|
| \`feedback\` | 8-10 | 用户纠正、行为反馈——直接影响行为正确性 |
| \`user\` | 5-7 | 用户身份、偏好、知识背景 |
| \`project\` | 4-6 | 项目上下文、技术决策、进度状态 |
| \`reference\` | 2-4 | 外部资源指针（URL、文档位置等） |

## 五、球文件格式

文件路径：\`.memory-pool/balls/ball_XXXX.md\`

\`\`\`yaml
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

（记忆正文内容）
\`\`\`

**字段规则：**
- \`id\`：与文件名一致，格式 \`ball_XXXX\`（从 \`state.json\` 的 \`next_id\` 获取，创建后自增）
- \`type\`：必须是 \`user\` / \`feedback\` / \`project\` / \`reference\` 之一
- \`B0\`：初始浮力，参考上方类型表
- \`H\`：初始为 0，每次被查询/使用时 +1
- \`t_last\`：初始为创建时的 \`t\` 值，每次被访问时重置为当前 \`t\`
- \`hardness\`：0-10，评估语义完整性（拆了就丧失意义的信息硬度高）
- \`fusion_potential\`：0-1，初始为 0，多次共现检索时累积
- \`links\`：数组，每项包含 \`target\`（目标球 ID）和 \`strength\`（\`strong\` 或 \`weak\`）
- \`created_at\`：ISO 8601 时间戳

## 六、state.json 格式

\`\`\`json
{
  "t": 0,
  "lambda": 0.97,
  "alpha": 1.0,
  "active_capacity": 20,
  "next_id": 1,
  "pool": "project",
  "initialized_at": "2026-04-03T10:00:00Z"
}
\`\`\`

## 七、index.json 格式

AI 每次修改球文件后必须同步更新 index.json。前端读取此文件渲染列表。

\`\`\`json
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
\`\`\`

**\`buoyancy\` 字段**：AI 在更新 index 时用公式计算并写入，前端直接读取显示。

## 八、操作流程

### 8.1 创建球

1. 读取 \`state.json\`，获取 \`next_id\` 和当前 \`t\`
2. 创建 \`balls/ball_XXXX.md\`，填写 frontmatter 和正文
3. \`state.json\` 的 \`next_id\` += 1
4. 更新 \`index.json\`：添加新球条目，重新计算所有球的 \`buoyancy\`，按浮力降序排列

### 8.2 查询/使用球（命中更新）

每次在对话中使用某个球的信息时：
1. 该球 \`H\` += 1
2. \`t_last\` = 当前 \`t\`
3. 更新球文件和 \`index.json\`

### 8.3 维护（衰减、分化、融合）

**衰减**：不需要显式操作——浮力公式中的 \`λ^(t - t_last)\` 自动完成衰减。每次更新 index.json 时重新计算即可。

**分化**（大球拆为多个小球）：
- 触发条件：活跃层空间不足，且存在体积大的球
- 判据：易裂度 = (z - x) / (y - x)，其中 x=原球浮力，y=子球最大浮力，z=子球最小浮力
- 硬度约束：硬度 ≥ 7 的球不拆
- 操作：删除原球文件，创建多个新球文件，新球之间建立 \`strong\` 连线

**融合**（多个小球合为一个）：
- 触发条件：\`fusion_potential\` > 0.7 的多个球
- 操作：合并源球内容为新球，重新评估 B₀ 和硬度，继承外部连线，删除源球文件

### 8.4 连线召回

查询命中活跃层某球时，检查其 \`links\`：
- \`strong\` 连线：直接拉出关联球（H+=1, t_last 重置）
- \`weak\` 连线：仅当该连线已被多次激活时触发

### 8.5 轮次自增

AI 在对话中应跟踪用户消息数量，在对话结束或执行记忆操作时将增量写入 \`state.json\` 的 \`t\`。

## 九、多容器架构（预留）

当前为项目级记忆池（\`pool: "project"\`）。未来可扩展全局池（\`~/.ccweb/memory-pool/\`，\`pool: "global"\`，\`lambda: 0.99\`）。球文件格式和操作流程保持一致。
`;
}

export function generateQuickRefMd(): string {
  return `# Memory Pool 快速参考 (QUICK-REF.md)

> AI 日常操作记忆池时读取此文档。完整规范见 SPEC.md。

## 创建球

\`\`\`bash
# 1. 读取 state.json 获取 next_id 和 t
# 2. 创建文件
\`\`\`

\`\`\`yaml
---
id: ball_{next_id 补零到4位}
type: feedback | user | project | reference
B0: {参考下方}
H: 0
t_last: {当前 t}
hardness: {0-10}
fusion_potential: 0
links: []
created_at: "{ISO时间}"
---

{记忆正文}
\`\`\`

\`\`\`
# 3. state.json next_id += 1
# 4. 更新 index.json（重算所有 buoyancy，降序排列）
\`\`\`

**B₀ 参考**：feedback=8-10 | user=5-7 | project=4-6 | reference=2-4

## 浮力计算

\`\`\`
B(t) = (B0 + alpha * H) * lambda^(t - t_last)
\`\`\`

默认参数在 state.json：lambda=0.97, alpha=1.0

## 命中更新

使用某球信息时：H += 1, t_last = 当前 t，更新球文件 + index.json

## 维护流程

1. 读取 state.json 和所有球文件
2. 对每个球计算当前 buoyancy
3. 按 buoyancy 降序排列
4. 前 active_capacity 个为活跃层，其余为深层
5. 检查是否需要分化（活跃层满 + 大球 + 硬度 < 7）
6. 检查是否需要融合（fusion_potential > 0.7 的共现球组）
7. 写回所有修改的球文件 + index.json

## 轮次管理

每条用户消息 = 1 轮。对话中跟踪消息数，操作记忆时将增量写入 state.json 的 t。

## index.json 更新

**每次修改球文件后必须更新 index.json**。每个球条目：

\`\`\`json
{ "id", "type", "summary"(正文首行或摘要), "B0", "H", "t_last", "buoyancy"(计算值), "hardness", "links"(ID数组) }
\`\`\`
`;
}

export function generateClaudeMdBlock(): string {
  return `
## 记忆池（Memory Pool）

本项目已启用记忆池系统。

**每次对话开始时：**
1. 读取 \`.memory-pool/QUICK-REF.md\` 了解操作规范
2. 读取 \`.memory-pool/state.json\` 获取当前轮次
3. 读取 \`.memory-pool/index.json\` 加载活跃层记忆
4. 将活跃层记忆纳入当前对话上下文

**对话过程中：**
- 遇到重要信息时主动提议存入记忆池
- 用户要求记忆操作时参照 QUICK-REF.md 执行
- 每次操作后更新 index.json

**完整规范：** \`.memory-pool/SPEC.md\`
`;
}
