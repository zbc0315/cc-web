# Memory Pool 快速参考 (QUICK-REF.md)

> AI 日常操作记忆池时读取此文档。完整规范见 SPEC.md。
> 所有操作通过 ccweb API 完成，**不要直接读写 pool.json**。

## API 端点

BASE: `/api/memory-pool/{projectId}`

## 对话开始

```
GET /surface → 获取活跃层记忆（按浮力排序，受楔形宽度限制）
```

按需读取具体球：
```
POST /balls/{ballId}/hit → 返回内容 + 关联球摘要（自动计数 H+=1）
```

如需查看全局记忆：
```
GET /api/memory-pool/global/surface → 全局活跃层
POST /api/memory-pool/global/balls/{ballId}/hit → 全局球命中查询
```

## 创建球

```
POST /balls
Body: { "type": "feedback", "summary": "简短摘要", "content": "markdown正文" }
可选: "links": ["ball_0004"], "b0_override": 8
```

type 决定默认 B₀：feedback=9 | user=6 | project=5 | reference=3

## 修改球

1. 用 Edit 工具修改 `.memory-pool/balls/ball_XXXX.md`
2. 调用：`PUT /balls/{ballId}` Body: `{ "summary": "新摘要" }`（summary 可选）

## 删除球

```
DELETE /balls/{ballId}
```

ccweb 自动清理其他球对该球的 links 引用。

## 管理连线

```
PATCH /balls/{ballId}/links
Body: { "add": ["ball_0007"], "remove": ["ball_0003"] }
```

## 纯读取（不增加命中计数）

```
GET /ball/{ballId} → 只返回内容，不影响 H 和 t_last
```

## 轮次管理

`t` 由 ccweb 在对话结束时自动递增（Stop hook）。无需手动操作。

## 维护

```
POST /maintenance → 返回分化建议 + 异常检测
```

分化执行：创建多个新球（POST /balls）→ 删除原球（DELETE /balls/{id}）。
