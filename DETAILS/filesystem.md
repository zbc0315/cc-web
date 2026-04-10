# 文件系统

## 概述

文件浏览、上传、下载、创建文件夹、删除。带路径安全校验和权限控制。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/filesystem?path=` | 列出目录内容 |
| GET | `/api/filesystem/file?path=` | 读取文件内容（限 1MB） |
| GET | `/api/filesystem/raw?path=` | 原始文件流（限 20MB） |
| PUT | `/api/filesystem/file` | 写入文件（限 10MB） |
| POST | `/api/filesystem/mkdir` | 创建文件夹 |
| POST | `/api/filesystem/upload` | 上传文件（限 50MB/文件，最多 20 个） |
| DELETE | `/api/filesystem?path=` | 删除文件或文件夹（递归） |

## 安全机制

- **路径限制**: `isPathAllowed()` 检查路径在用户工作空间或已注册项目目录内
- **符号链接**: lstat + realpath 双重校验，防止符号链接逃逸
- **文件名校验**: 拒绝 `..`、路径分隔符、Windows 非法字符
- **原子写入**: 临时文件 + rename 防止崩溃损坏

## 前端组件

- `FileTree.tsx` — 左侧文件树，支持：
  - 懒加载子目录
  - 右键菜单：复制相对路径、复制绝对路径、文件（下载 + 删除）、文件夹（删除）
  - 删除前 confirm 确认弹窗
  - 拖放上传
  - 隐藏文件半透明显示
- `FilePreviewDialog.tsx` — 文件预览：代码高亮、Markdown 渲染、图片、Office、PDF
- `FileBrowser.tsx` — 目录列表导航

## 关键文件

- `backend/src/routes/filesystem.ts`
- `frontend/src/components/FileTree.tsx`
- `frontend/src/components/FilePreviewDialog.tsx`
- `frontend/src/lib/api.ts` — `browseFilesystem()`, `readFile()`, `writeFile()`, `uploadFiles()`, `deletePath()`, `createFolder()`, `getRawFileUrl()`
