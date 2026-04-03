# P0 Features: Task Notifications + Terminal Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) 当 Claude Code 完成一轮对话（Stop hook）时发送浏览器通知和 Webhook；(B) 终端内支持 Ctrl+F 搜索（xterm SearchAddon）。

**Architecture:**
- A: 后端 `NotifyService` 在 Stop hook 时向 Dashboard WS 广播 `project_stopped` 消息，前端收到后调用 `Notification API`；同时 POST 到用户配置的 Webhook URL。Webhook 配置存在 `~/.ccweb/notify-config.json`，通过 `/api/notify/config` CRUD。
- B: WebTerminal 加载 `@xterm/addon-search`，通过 ref 暴露 `openSearch()`，TerminalView 监听 Ctrl/Cmd+F 打开搜索浮层。

**Tech Stack:** Node.js fetch (Node 18+ 内置), @xterm/addon-search, React state, shadcn/ui Input/Button

---

## 文件清单

| 动作 | 路径 | 说明 |
|------|------|------|
| 新建 | `backend/src/notify-service.ts` | Webhook 发送 + 通知事件发射 |
| 新建 | `backend/src/routes/notify.ts` | GET/PUT /api/notify/config |
| 修改 | `backend/src/routes/hooks.ts` | Stop 事件调用 notifyService |
| 修改 | `backend/src/index.ts` | 挂载 notifyRouter + broadcast project_stopped |
| 修改 | `frontend/src/pages/SettingsPage.tsx` | 添加 Webhook URL 输入 |
| 修改 | `frontend/src/lib/websocket.ts` | 处理 `project_stopped` WS 消息 |
| 修改 | `frontend/src/pages/DashboardPage.tsx` | 请求通知权限 + 显示通知 |
| 新建 | `frontend/src/components/TerminalSearch.tsx` | 搜索浮层 UI |
| 修改 | `frontend/src/components/WebTerminal.tsx` | 加载 SearchAddon，暴露搜索方法 |
| 修改 | `frontend/src/components/TerminalView.tsx` | Ctrl+F 打开搜索，传递搜索方法 |

---

## Task 1: NotifyService 后端实现

**Files:**
- Create: `backend/src/notify-service.ts`

- [ ] **Step 1.1: 创建 NotifyService**

```typescript
// backend/src/notify-service.ts
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './config';
import { EventEmitter } from 'events';

export interface NotifyConfig {
  webhookUrl?: string;
  webhookEnabled: boolean;
}

const NOTIFY_CONFIG_FILE = path.join(DATA_DIR, 'notify-config.json');

export function getNotifyConfig(): NotifyConfig {
  try {
    if (!fs.existsSync(NOTIFY_CONFIG_FILE)) return { webhookEnabled: false };
    return JSON.parse(fs.readFileSync(NOTIFY_CONFIG_FILE, 'utf-8')) as NotifyConfig;
  } catch {
    return { webhookEnabled: false };
  }
}

export function saveNotifyConfig(config: NotifyConfig): void {
  const tmpPath = NOTIFY_CONFIG_FILE + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmpPath, NOTIFY_CONFIG_FILE);
}

class NotifyService extends EventEmitter {
  /** Called when a Claude Code session completes (Stop hook). */
  async onProjectStopped(projectId: string, projectName: string): Promise<void> {
    // 1) Emit for WS broadcast (handled in index.ts)
    this.emit('stopped', { projectId, projectName });

    // 2) Fire webhook if configured
    const config = getNotifyConfig();
    if (!config.webhookEnabled || !config.webhookUrl) return;
    try {
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'project_stopped',
          projectId,
          projectName,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000), // 5s timeout
      });
    } catch (err) {
      console.warn('[NotifyService] Webhook delivery failed:', (err as Error).message);
    }
  }
}

export const notifyService = new NotifyService();
```

- [ ] **Step 1.2: 创建 /api/notify/config 路由**

```typescript
// backend/src/routes/notify.ts
import { Router, Response } from 'express';
import { AuthRequest } from '../auth';
import { getNotifyConfig, saveNotifyConfig, NotifyConfig } from '../notify-service';
import { isAdminUser } from '../config';

const router = Router();

router.get('/config', (req: AuthRequest, res: Response): void => {
  res.json(getNotifyConfig());
});

router.put('/config', (req: AuthRequest, res: Response): void => {
  // Only admin can configure notifications
  if (!isAdminUser(req.user?.username)) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  const { webhookUrl, webhookEnabled } = req.body as Partial<NotifyConfig>;
  const current = getNotifyConfig();
  const updated: NotifyConfig = {
    webhookEnabled: webhookEnabled ?? current.webhookEnabled,
    webhookUrl: webhookUrl !== undefined ? webhookUrl : current.webhookUrl,
  };
  saveNotifyConfig(updated);
  res.json(updated);
});

export default router;
```

- [ ] **Step 1.3: 修改 routes/hooks.ts — Stop 事件触发 notifyService**

在 `hooks.ts` 顶部添加 import，Stop case 末尾调用：

```typescript
// 顶部添加
import { notifyService } from '../notify-service';
import { getProject } from '../config';

// Stop case 末尾添加（在 sessionManager.triggerRead 之后）:
case 'Stop':
  sessionManager.clearSemanticStatus(projectId);
  sessionManager.triggerRead(projectId);
  // Notify after a short delay so JSONL has been read first
  setTimeout(() => {
    const p = getProject(projectId);
    if (p) void notifyService.onProjectStopped(projectId, p.name);
  }, 300);
  break;
```

- [ ] **Step 1.4: 挂载路由 + 广播 project_stopped (index.ts)**

找到 index.ts 中 router 挂载区域，添加：
```typescript
import notifyRouter from './routes/notify';
// 挂载
app.use('/api/notify', authMiddleware, notifyRouter);
```

找到 dashboard WS broadcast 区域（`broadcastDashboard*` 函数），在 `sessionManager.on('semantic', ...)` 旁边添加：
```typescript
notifyService.on('stopped', ({ projectId, projectName }: { projectId: string; projectName: string }) => {
  for (const ws of dashboardClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'project_stopped', projectId, projectName }));
    }
  }
});
```

- [ ] **Step 1.5: 验证后端编译**
```bash
cd backend && npx tsc --noEmit
```
期望：无报错

---

## Task 2: 前端通知 UI

**Files:**
- Modify: `frontend/src/lib/websocket.ts`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 2.1: 扩展 websocket.ts — 处理 project_stopped 消息**

在 `UseDashboardWebSocketOptions` 接口添加回调：
```typescript
interface UseDashboardWebSocketOptions {
  onActivityUpdate: (update: ActivityUpdate) => void;
  onProjectStopped?: (projectId: string, projectName: string) => void;
}
```

在 `ws.onmessage` 中添加：
```typescript
if (parsed.type === 'project_stopped') {
  optionsRef.current.onProjectStopped?.(parsed.projectId as string, parsed.projectName as string);
}
```

- [ ] **Step 2.2: DashboardPage — 请求权限 + 显示通知**

```typescript
// 在 useEffect 顶部（fetchProjects 之后）添加通知权限请求
useEffect(() => {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}, []);

// handleActivityUpdate 旁边添加：
const handleProjectStopped = useCallback((projectId: string, projectName: string) => {
  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Claude 已完成', {
      body: `项目「${projectName}」的任务已完成`,
      icon: '/terminal.svg',
    });
  }
}, []);

// useDashboardWebSocket 调用更新：
useDashboardWebSocket({ onActivityUpdate: handleActivityUpdate, onProjectStopped: handleProjectStopped });
```

- [ ] **Step 2.3: api.ts — 添加通知 API 函数**

```typescript
export interface NotifyConfig {
  webhookUrl?: string;
  webhookEnabled: boolean;
}

export async function getNotifyConfig(): Promise<NotifyConfig> {
  return request<NotifyConfig>('GET', '/api/notify/config');
}

export async function updateNotifyConfig(config: Partial<NotifyConfig>): Promise<NotifyConfig> {
  return request<NotifyConfig>('PUT', '/api/notify/config', config);
}
```

- [ ] **Step 2.4: SettingsPage — 添加 Webhook 配置**

在 SettingsPage.tsx 中找到合适位置，添加 Webhook 配置 section：

```tsx
// 在 SettingsPage 函数顶部添加 state
const [notifyConfig, setNotifyConfig] = useState<NotifyConfig>({ webhookEnabled: false });
const [webhookInput, setWebhookInput] = useState('');

useEffect(() => {
  getNotifyConfig().then((c) => {
    setNotifyConfig(c);
    setWebhookInput(c.webhookUrl ?? '');
  }).catch(() => {});
}, []);

const handleSaveWebhook = async () => {
  try {
    const updated = await updateNotifyConfig({
      webhookEnabled: webhookInput.length > 0,
      webhookUrl: webhookInput || undefined,
    });
    setNotifyConfig(updated);
    toast.success('Webhook 配置已保存');
  } catch (err) {
    toast.error('保存失败');
  }
};
```

JSX 中添加一个新 card section（参照现有 BackupProvider card 风格）：
```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-base">任务完成通知</CardTitle>
    <CardDescription>Claude Code 每次完成任务时触发浏览器通知和 Webhook</CardDescription>
  </CardHeader>
  <CardContent className="space-y-3">
    <div className="space-y-1.5">
      <Label>Webhook URL（可选）</Label>
      <div className="flex gap-2">
        <Input
          placeholder="https://hooks.slack.com/..."
          value={webhookInput}
          onChange={(e) => setWebhookInput(e.target.value)}
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={() => void handleSaveWebhook()}>保存</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        POST {`{ event, projectId, projectName, timestamp }`} to this URL when Claude finishes
      </p>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 2.5: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 3: 终端内搜索 (SearchAddon)

**Files:**
- Modify: `frontend/package.json` (add @xterm/addon-search)
- Modify: `frontend/src/components/WebTerminal.tsx`
- Create: `frontend/src/components/TerminalSearch.tsx`
- Modify: `frontend/src/components/TerminalView.tsx`

- [ ] **Step 3.1: 安装 @xterm/addon-search**
```bash
cd frontend && npm install @xterm/addon-search
```

- [ ] **Step 3.2: 修改 WebTerminal.tsx — 加载 SearchAddon，扩展 handle**

```typescript
// 顶部添加 import
import { SearchAddon } from '@xterm/addon-search';

// WebTerminalHandle 接口扩展
export interface WebTerminalHandle {
  write: (data: string) => void;
  search: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  searchNext: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  searchPrevious: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  clearSearch: () => void;
}

// forwardRef 内部，在 fitAddonRef 旁添加
const searchAddonRef = useRef<SearchAddon | null>(null);

// useImperativeHandle 扩展
useImperativeHandle(ref, () => ({
  write: (data: string) => { terminalRef.current?.write(data); },
  search: (term, options) => searchAddonRef.current?.findNext(term, options) ?? false,
  searchNext: (term, options) => searchAddonRef.current?.findNext(term, options) ?? false,
  searchPrevious: (term, options) => searchAddonRef.current?.findPrevious(term, options) ?? false,
  clearSearch: () => searchAddonRef.current?.clearDecorations(),
}));

// useEffect 内 loadAddon 区域，在 fitAddon 之后添加:
const searchAddon = new SearchAddon();
terminal.loadAddon(searchAddon);
searchAddonRef.current = searchAddon;

// cleanup 中添加:
searchAddonRef.current = null;
```

- [ ] **Step 3.3: 创建 TerminalSearch.tsx 搜索浮层**

```tsx
// frontend/src/components/TerminalSearch.tsx
import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TerminalSearchProps {
  onSearch: (term: string, options: { caseSensitive: boolean; regex: boolean }) => boolean;
  onSearchNext: (term: string, options: { caseSensitive: boolean; regex: boolean }) => boolean;
  onSearchPrev: (term: string, options: { caseSensitive: boolean; regex: boolean }) => boolean;
  onClear: () => void;
  onClose: () => void;
}

export function TerminalSearch({ onSearch, onSearchNext, onSearchPrev, onClear, onClose }: TerminalSearchProps) {
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const options = { caseSensitive, regex: useRegex };

  const handleChange = (value: string) => {
    setTerm(value);
    if (value) onSearch(value, options);
    else onClear();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.shiftKey ? onSearchPrev(term, options) : onSearchNext(term, options);
    }
    if (e.key === 'Escape') {
      onClear();
      onClose();
    }
  };

  return (
    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-background border border-border rounded-md shadow-lg px-2 py-1">
      <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <Input
        ref={inputRef}
        value={term}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索..."
        className="h-6 w-44 text-xs border-0 p-0 focus-visible:ring-0 bg-transparent"
      />
      <button
        title="区分大小写"
        onClick={() => { setCaseSensitive((v) => !v); if (term) onSearch(term, { ...options, caseSensitive: !caseSensitive }); }}
        className={cn('text-[10px] px-1 rounded font-mono transition-colors', caseSensitive ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground hover:text-foreground')}
      >Aa</button>
      <button
        title="正则表达式"
        onClick={() => { setUseRegex((v) => !v); if (term) onSearch(term, { ...options, regex: !useRegex }); }}
        className={cn('text-[10px] px-1 rounded font-mono transition-colors', useRegex ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground hover:text-foreground')}
      >.*</button>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onSearchPrev(term, options)} disabled={!term}>
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onSearchNext(term, options)} disabled={!term}>
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { onClear(); onClose(); }}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 3.4: 修改 TerminalView.tsx — 集成搜索**

找到 `TerminalView.tsx`，在 `webTerminalRef` 旁添加搜索相关 state：
```typescript
const [showSearch, setShowSearch] = useState(false);
```

在终端容器 div 添加键盘监听（在 useEffect 中添加到 document）：
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      // Only trigger when terminal tab is active
      if (viewMode === 'terminal') {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [viewMode]);
```

在渲染 `<WebTerminal>` 的容器 div 内添加（保证 `relative` className）：
```tsx
{showSearch && (
  <TerminalSearch
    onSearch={(t, o) => webTerminalRef.current?.search(t, o) ?? false}
    onSearchNext={(t, o) => webTerminalRef.current?.searchNext(t, o) ?? false}
    onSearchPrev={(t, o) => webTerminalRef.current?.searchPrevious(t, o) ?? false}
    onClear={() => webTerminalRef.current?.clearSearch()}
    onClose={() => setShowSearch(false)}
  />
)}
```

- [ ] **Step 3.5: 验证前端编译**
```bash
cd frontend && npx tsc --noEmit
```

---

## Task 4: 集成测试与提交

- [ ] **Step 4.1: 完整构建**
```bash
cd /Users/tom/Projects/cc-web && npm run build
```
期望：frontend + backend 均无错误

- [ ] **Step 4.2: 手动验证清单**
```
终端搜索:
  □ 打开项目，终端有内容
  □ 按 Ctrl+F / Cmd+F → 搜索框出现在终端右上角
  □ 输入关键词 → 终端高亮匹配
  □ 按 Enter / ↓ 按钮 → 跳到下一个
  □ Shift+Enter / ↑ 按钮 → 跳到上一个
  □ 点 X 或按 Escape → 搜索框关闭，高亮消失

通知:
  □ 打开 Settings → 看到"任务完成通知"卡片
  □ 输入 Webhook URL 并保存 → 成功提示
  □ 首次打开 Dashboard → 浏览器弹出通知权限请求
  □ Claude Code 完成一轮对话 → 浏览器通知弹出
  □ (可选) 验证 Webhook URL 收到 POST 请求
```

- [ ] **Step 4.3: 版本号 bump 到 v1.5.49，四文件同步**

修改：`package.json`, `frontend/src/components/UpdateButton.tsx`, `README.md`, `CLAUDE.md`

- [ ] **Step 4.4: 提交**
```bash
git add backend/src/notify-service.ts \
  backend/src/routes/notify.ts \
  backend/src/routes/hooks.ts \
  backend/src/index.ts \
  frontend/src/lib/websocket.ts \
  frontend/src/pages/DashboardPage.tsx \
  frontend/src/pages/SettingsPage.tsx \
  frontend/src/lib/api.ts \
  frontend/src/components/TerminalSearch.tsx \
  frontend/src/components/WebTerminal.tsx \
  frontend/src/components/TerminalView.tsx \
  frontend/package.json \
  package.json README.md CLAUDE.md

git commit -m "feat: task completion notifications + terminal search (v1.5.49)"
```
