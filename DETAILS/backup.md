# 云备份系统（Backup）

## 概述

支持 Google Drive / OneDrive / Dropbox 三种云存储，OAuth 授权 + 定时同步。

## 支持的提供商

| 提供商 | 实现文件 | OAuth |
|--------|----------|-------|
| Google Drive | `providers/google-drive.ts` | googleapis |
| OneDrive | `providers/onedrive.ts` | @azure/msal-node + MS Graph |
| Dropbox | `providers/dropbox.ts` | Dropbox SDK |

## 核心模块

| 文件 | 职责 |
|------|------|
| `engine.ts` | 备份编排：发现项目文件、应用排除规则、同步到云 |
| `scheduler.ts` | Cron 定时调度 |
| `config.ts` | OAuth 状态持久化 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/backup/providers` | 列出已配置的提供商 |
| POST | `/api/backup/providers` | 添加提供商 |
| DELETE | `/api/backup/providers/:id` | 删除提供商 |
| GET | `/api/backup/auth/:providerId/url` | 获取 OAuth 授权 URL |
| POST | `/api/backup/run/:projectId` | 手动触发备份 |
| GET/PUT | `/api/backup/schedule` | 定时配置 |
| GET/PUT | `/api/backup/excludes` | 排除规则 |

## 前端组件

- `BackupProviderCard.tsx` — 提供商卡片
- `BackupHistoryTable.tsx` — 备份历史
- `AddProviderDialog.tsx` — OAuth 设置流程

## 存储

- `~/.ccweb/backup-config.json` — 调度配置 + 提供商列表
