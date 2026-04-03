# Memory Pool 快速参考 (QUICK-REF.md)

> AI 日常操作记忆池时读取此文档。完整规范见 SPEC.md。

## 创建球

```bash
# 1. 读取 state.json 获取 next_id 和 t
# 2. 创建文件
```

```yaml
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
```

```
# 3. state.json next_id += 1
# 4. 更新 index.json（重算所有 buoyancy，降序排列）
```

**B₀ 参考**：feedback=8-10 | user=5-7 | project=4-6 | reference=2-4

## 浮力计算

```
B(t) = (B0 + alpha * H) * lambda^(t - t_last)
```

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

```json
{ "id", "type", "summary"(正文首行或摘要), "B0", "H", "t_last", "buoyancy"(计算值), "hardness", "links"(ID数组) }
```
