# Memory Pool 快速参考 (QUICK-REF.md)

> AI 日常操作记忆池时读取此文档。完整规范见 SPEC.md。

## 创建球

1. 读取 `pool.json`，获取 `next_id` 和 `t`
2. 创建 `balls/ball_XXXX.md`（纯 markdown，无 frontmatter）
3. 在 `pool.json` 的 `balls` 数组中添加条目：

```json
{
  "id": "ball_XXXX",
  "type": "feedback",
  "summary": "简短摘要",
  "B0": 8,
  "H": 0,
  "t_last": 当前t,
  "hardness": 7,
  "permanent": false,
  "links": [],
  "created_at": "ISO时间"
}
```

4. `next_id` += 1，写回 `pool.json`

**B₀ 参考**：feedback=8-10 | user=5-7 | project=4-6 | reference=2-4

## 浮力计算

```
B(t) = (B0 + alpha * H) * lambda^(t - t_last)
```

默认参数在 pool.json：lambda=0.97, alpha=1.0
永久球（permanent=true）不乘衰减项。
buoyancy 由后端动态计算，不存储在文件中。

## 命中更新

使用某球信息时：在 pool.json 中找到该球，H += 1, t_last = 当前 t，写回 pool.json

## 维护流程

1. 读取 pool.json
2. 浮力由后端动态计算，无需手动重算
3. 检查是否需要分化（活跃层满 + 大球 + 硬度 < 7）
4. 写回 pool.json

## 轮次管理

`t` 由系统 hook 自动递增，AI 无需手动管理。

## pool.json 更新

每次修改球信息后写回 pool.json。只需操作这一个文件（+ 球的 markdown 文件）。
