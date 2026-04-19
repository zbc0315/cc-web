# 历史错误记录（不要重犯）

本文件汇总 ccweb 开发过程中遇到并已修复的 33 类典型问题，提炼为"必须规避的做法"。新人上手或准备发版前建议扫一遍。

## 架构/数据模型类

1. **信息系统 v1 用 ccweb session ID 作为对话标识**：错误。应该用 JSONL 文件名（Claude Code 的对话 UUID）。
4. **QUICK-REF.md 模板 projectId 写错**：写成 URL 编码路径，实际是 UUID。导致 GLOSS 项目 AI 调用失败。
5. **活动检测用客户端时钟比较**：`Date.now() - lastActivityAt < 2000` 在局域网有时钟偏差。改为服务端 `active` 布尔字段。
27. **两个 JSONL finder 返回不同文件 → 前端 id 去重失效**：chat-history 端点走 `findLatestJsonlForProject`（无 startedAt 过滤），hook 驱动的 `triggerRead` 走 `findJsonl`（`mtime >= startedAt-5000` 过滤）。race：stopped 项目打开的瞬间，HTTP 先 resolve 到老 JSONL A、之后 PTY 启动、hook 才 resolve 到新 JSONL B → 同一条逻辑消息前端拿到两个不同 `sha1(path+line)` id → 气泡重复。修复：**统一为单一 `findLatestJsonlForProject`**，`triggerRead` 每次调用都重新检测并在发现新文件时重置 `fileOffset=0`。教训：**凡"同一数据源有两条路径访问"，路径必须用同一个 resolver**。
32. **多个事件消费用"数组长度"做游标 = 父数组截断就永久失消费**：ProjectPage 曾维护 `approvalEvents`（`slice(-50)`），ChatOverlay 用 `prevApprovalCountRef + events.length > prev` 做增量消费。结果：父数组触顶 50 条后长度不再增长，子组件永远 `return`。正解：**给每个事件附带单调 `seq` 序号**，子组件用 `lastSeenSeq` ref 过滤。永远不用"数组长度"做增量游标。

## WebSocket / 消息投递类

8. **WebSocket sendInput 静默丢弃消息**：`wsRef.current?.readyState === OPEN` 不满足时直接 return 无队列。必须用消息队列 + connected 后 flushQueue。
9. **useEffect cleanup 清空消息队列导致跨重连丢失**：`enabled` 变化时 effect cleanup 清空了 `pendingQueueRef`。队列应仅在组件卸载时清空，不应在重连时清空。
10. **状态机分支遗漏 waking**：`sendToTerminal` 只处理 `live` 和 `stopped/error`，`waking` 状态下消息仅显示在 UI 但从未发送。所有可发送状态必须有分支覆盖。
16. **手机 WS 不在 projectClients 集合里**：`chat_subscribe` 分支（手机/监控）没把 ws 加入 `projectClients`，只有 `terminal_subscribe`（桌面终端）才加。修复：`chat_subscribe` 分支也要 `projectClients.get().add(ws)` 并推一次初始 `context_update`。
26. **`state='live'` 的同步快照与 WebSocket 的异步就绪不对齐**：ChatOverlay 挂载时从 `project.status === 'running'` 同步推断 `state='live'`，但 WS 还在 CONNECTING。用户秒点发送 → `rawSend` 的 `readyState === OPEN` 检查失败 → 静默丢弃。正解：`useProjectWebSocket` 补 `onDisconnected` 回调，parent 维护 `wsConnected: boolean`；flush effect 依赖 `[wsConnected, state]`，三者同时成立才 drain。教训：**凡"同步推断的 ready 状态"配合"异步就绪的底层通道"，发送路径都必须走队列 + 用底层通道真实状态（boolean）而非"事件计数"（tick）做 gate**。

## Retry / Echo 匹配类

19. **`clearSendRetry` 过度触发**：retry 被任何非空 chat_message 无差别清除。场景：msg1 延迟 echo / assistant 流式响应会误清 msg2 的 retry。正解：仅在自己的 user 回音（匹配 `recentSentRef`）时清 retry，不信任 assistant 响应。
20. **post-wake flush 无 retry 保护**：桌面 `wsReadyTick` flush、`state === live` 但 queue 非空、手机 stopped→live flush 三条路径都在 Claude TUI bootstrap 未完成时直接发送，Enter 可能被吞。所有 post-wake 首次发送必须 arm retry。
24. **固定次数 retry 面对慢 TUI 仍会丢消息**：4 × 2.5s 的 retry 链在 TUI 重的 bootstrap 期间可能全部被吞。改成**条件驱动**——每 3s 检查一次 `recentSentRef.includes(text)`，没 echo 就继续发 `\r`，20 次硬 cap 兜底。`appendUserMessage` 新消息也要 `.trim()` 对齐 `handleChatMessage.indexOf(content.trim())`。

## Hook / Approval 类

12. **Stop hook 触发时 JSONL 未完全 flush**：Claude Code 写完最后一条文本到 JSONL 前就触发 Stop hook。必须在 Stop hook 中做延时重读（300ms / 1500ms）。
17. **Claude Code hook `PermissionRequest` 输出格式易错**：正确格式是 `{hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow'|'deny'},message?}}`。常见误区：把 `message` 放进 `decision` 里（错）；用 `behavior: 'defer'`（`PreToolUse` 才有）。非 ccweb 项目/ccweb 未运行时应输出空 `{}` 让 Claude 回落到 TUI，**不要输出 `deny`**（否则卸载 ccweb 后所有权限请求被永久拒绝）。
18. **HMAC 签名脆弱：URL-匹配 raw body capture**：`express.json({ verify: req.url === '...' ? save : skip })` 只要路由挂载路径变化或代理改写 URL，raw body 就捕获不到。应对所有 POST 无条件 capture，缺失就 400。
22. **Node 16+ `IncomingMessage` body 读完后 auto-destroy，`req.on('close')` 误触发**：PermissionRequest hook 用 `req.on('close')` 检测 hook 客户端断连，但对小 POST body 读完即触发 → pending 几乎立刻被 cancel。修复：改用 `res.on('close')`，后检查用 `res.writableEnded || res.destroyed`。
25. **Claude Code v2.1.114+ PermissionRequest 不再带 `tool_use_id`**：新版 hook stdin payload 只有 `session_id / transcript_path / cwd / permission_mode / hook_event_name / tool_name / tool_input / permission_suggestions`，没有 `tool_use_id`。把 `tool_use_id` 作为必填字段会导致**所有 Write/Edit/Bash 被自动拒绝**。修复：缺失时用 `sha1(session_id + '|' + tool_name + '|' + JSON.stringify(tool_input))` 合成确定性 id。**发版前必须浏览器实测一次 Write 审批路径**，hook 形如黑盒不验证就发等于盲飞。

## 前端 UI 类

21. **Radix ScrollArea 的 display:table 包裹撑宽子元素**：`<ScrollAreaPrimitive.Viewport>` 自动注入一层 `<div style="min-width:100%; display:table">`，允许其随不可断的宽内容拉宽，子元素的 `max-w-[85%]` 变成"stretched-wrapper 的 85%"。要用 Tailwind `!important` 覆盖为 block + `w-full`（`viewportClassName="[&>div]:!block [&>div]:!w-full"`）。
33. **IME 合成期 Enter 直接提交 = 中日韩用户 100% 误发**：textarea 写成 `if (e.key === 'Enter') handleSend()`，没检测 `native.isComposing / keyCode === 229`。中文用户按 Enter 接受候选词 = 立即发送半截消息。**所有 Enter-to-submit 统一走 `useEnterToSubmit(onSubmit, mode)` hook**，禁止在 textarea/input 手写 Enter 判断。

## 安全 / 权限类

30. **凭据编译进 npm 包 + 拆字符串只能绕 secret scanner**：SkillHub 曾把 GitHub PAT 以 `_TP.join('')` 拆成三段硬编码。上线后任何装了 ccweb 的用户都能从 `backend/dist/` 拼回原 token。**任何凭据只允许从 env 读；缺 env 时端点 fail-fast**。"拆字符串"本身就是危险信号。**发布过的 tarball 永远在 npm 仓库里——凭据一旦编译进包必须立即 rotate**。
31. **权限校验手写在每个 handler 里**：`isAdminUser(req.user?.username)` 曾在 20+ 个路由各自 if 判断，漏一处就是越权（如 `/api/plugins/install` 曾允许任何登录用户装插件 → backend RCE）。**所有管理性路由走 `backend/src/middleware/authz.ts` 的 `requireAdmin` / `requireProjectOwner`**，禁止在 handler 里手写 admin 判断。

## 子进程 / 环境类

11. **Detached 子进程继承坏的 cwd**：远程自更新 agent spawn 时继承主进程的 cwd（可能是已删除的项目目录），导致 `npm`/`npx` 启动时 `process.cwd()` 抛 ENOENT。**任何 detached 子进程都必须显式 `cwd: os.homedir()`**，其内部 `execSync`/`spawnSync` 也要显式 `cwd`。
15. **CDN 解析本地 npm registry mirror**：`~/.npmrc` 曾设为 `registry=https://registry.npmmirror.com`，新发布若镜像未同步会导致 `ETARGET No matching version`，远程自更新受影响。**2026-04-18 起已切回 `https://registry.npmjs.org`**（官方）。发版验证始终直查 `curl -s https://registry.npmjs.org/@tom2012/cc-web`，不要信 `npm view`（会经过本地 npmrc）。
23. **测试 ccweb 若不做 HOME 沙箱会破坏生产**：ccweb 多处硬编码 `~/.ccweb/port`、`~/.claude/settings.json` 等，仅 `CCWEB_DATA_DIR` 不够。启动测试实例会覆盖生产 port 文件 + 移除生产 hooks。**安全方案**：`HOME=/tmp/ccweb-test-$$/home CCWEB_PORT=3099 node bin/ccweb.js start --local --daemon`。

## 发版 / 代码维护类

7. **新增适配器后遗漏路由验证数组**：`projects.ts` 的 `VALID_CLI_TOOLS` 未同步添加 `'gemini'`，创建项目 400。新增 CLI 工具时须检查所有硬编码工具列表。
13. **`git add -A` 扫入本地私有文件**：`research/`、`.memory-pool/balls/*`、`FEEDBACK_*` 等本地文件被意外提交到公开仓库。**必须严格用 `git add <具体文件列表>`**。
14. **版本号跳日期绕 semver**：日期版本方案下同日多次发布，semver 要求版本递增。误判 `2026.4.19-a` 不能用而跳到 bare `2026.4.19`，导致版本号领先真实日期。正解：bare 只在真实日期到达时发，同日后续用 pre-release `-a/-b/-c`。
28. **删除子系统时漏清下游死代码**：移除 `.ccweb/sessions/` + `.ccweb/information/` 时漏了两个**内部逻辑消费者**：(a) `routes/projects.ts:/todos` 端点仍从 `.ccweb/sessions/` 找 block；(b) `TodoPanel.tsx` 是**孤儿组件**但还在用 `getProjectTodos`。**移除子系统 = 移除目录 + 所有 reader + 所有 dead UI + grep 所有 query 路径**。发版前必跑一次 orphan 检测。
29. **publish bare 日期版本当天断版 + npm 永久占用**：(a) bare 在 semver 中 > 任何 pre-release，发了 bare 之后当天无法再发 `YYYY.M.D-<X>` 补丁；(b) `YYYY.M.(D+1)` bare 又不能发（真实日期没到）；(c) npm 把 bare 一旦占用（包括 unpublish 后）**永久保留**。正解：**永远用 `YYYY.M.D-<letter>` 格式，字母用光加位 `-aa/-ab`**，从不发 bare。

## 元认知类（开发流程）

2. **迭代缩减设计了但没实现**：写了详细方案和伪代码，编码时只写了单次 Haiku 调用 + 截取末尾。Performative Compliance —— 写 plan 不执行。
3. **缩减 prompt 过于保守**：告诉 Haiku "如果行为会不同就保留"导致什么都不删。应该明确列出要删的内容类型。
6. **每次"反思"只找 1-2 个问题**：应该系统性对照设计文档逐项检查。
