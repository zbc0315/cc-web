# 认证系统

## 概述

JWT 认证 + localhost 预认证 + 多用户工作空间隔离。

## 认证流程

```
Localhost (127.0.0.1 / ::1):
  └─ authMiddleware 跳过 token 检查
  └─ req.user = { username: config.username }
  └─ 无 config.json 时用 '__local_admin__' 兜底

Remote:
  └─ POST /api/auth/login（限速 5 次/15 分钟）
  └─ bcryptjs.compare(password, hash)
  └─ 返回 JWT（HS256，30 天过期）
  └─ 请求携带：Authorization: Bearer <token> 或 ?token=<token>
```

## 多用户

- **管理员**: `~/.ccweb/config.json` 中配置，工作空间 `~/Projects`
- **次级用户**: `~/.ccweb/users.json` 注册，工作空间 `~/Projects{username}`
- **项目共享**: owner 可授权 `view`（只读）或 `edit`（读写）

## 关键文件

- `backend/src/auth.ts` — 中间件、JWT 签发/验证
- `backend/src/config.ts` — 用户/项目配置管理
- `backend/src/routes/auth.ts` — 登录 API

## 存储

- `~/.ccweb/config.json` — 管理员用户名、密码 hash、JWT secret
- `~/.ccweb/users.json` — 次级用户列表
