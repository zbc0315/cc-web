# 版本发布流程

## 四文件版本同步

发版前必须同步更新：

1. `package.json` → `"version"`
2. `frontend/src/components/UpdateButton.tsx` → `currentVersion`
3. `README.md` → version 行
4. `CLAUDE.md` → `**当前版本**` 行

## 版本号方案（日期驱动 + semver 兼容）

- 格式：`YYYY.M.D-<letter>`，例如 `2026.4.19-a`、`2026.4.19-b`……
- 日期 `YYYY.M.D` 取**下一自然日**（今天发的版本号写明天的日期）。直到真实日期到达那天，也继续用该日期 + 新字母。
- 真实到达那日需要新日期时，日期部分变为当天的明天，字母重置为 `-a`。
- 字母顺序：`-a, -b, -c, … -z`；用光了（极罕见）再加位（`-aa` 等）。

## 🚫 绝对不发 bare 日期版本（如 `2026.4.19` 无后缀）

- 原因：bare 在 semver 中**大于**任何 `bare-X` pre-release。一旦发 bare，当天就无法再发任何 `YYYY.M.D-X` 补丁（小于 bare），也无法发 `YYYY.M.D+1` bare（真实日期还没到）→ **当天彻底断版**。
- 即便真实日期已经到达对应日子、即便字母用光了——**也不发 bare**。直接加位：`-aa`、`-ab`……
- npm 还有一个隐患：bare `YYYY.M.D` 一旦发过一次（即使后来 unpublish），**永久占用**，永远无法重发。

## 其他绝对规则

- 发版前先查当前真实日期（`date` 命令或系统提示），不得凭印象跳日期
- `git add` 必须指定具体文件，**禁止用 `git add -A` / `git add .`**（会扫入本地私有文件）
- **绝不把 token 写入 git 追踪的文件** —— 通过命令行参数传入
- 发布到默认 tag：`npm publish --tag latest`（不带 `--tag latest` 则 pre-release 不进 `latest`）
- **发版前必须用浏览器实测一次 Write 审批路径**（hook 形如黑盒，不验证就发等于盲飞）

## 发布命令

```bash
npm run build
git add <具体文件列表> && git commit && git push
npm publish --registry=https://registry.npmjs.org --access=public --tag latest --//registry.npmjs.org/:_authToken=<token>
```

## 不该进仓库的本地文件

`.memory-pool/*`、`research/*`、`CLAUDE-example.md`、`FEEDBACK_*.md` —— 均为本地私有，发布时必须 untracked 保持。

## 发版验证

```bash
# 直查 npm（绕开本地 npmrc）
curl -s https://registry.npmjs.org/@tom2012/cc-web | jq '.["dist-tags"]'
```

**不要信 `npm view`**（会经过本地 `~/.npmrc` 配置，如果 registry 被设为国内镜像会误判）。

## 本地 npmrc 配置

- `~/.npmrc` 当前为 `registry=https://registry.npmjs.org`（官方）
- 2026-04-18 从 `npmmirror.com` 切回；切换备份在 `~/.npmrc.bak`
- 镜像可能同步延迟，新发布立即从镜像安装会 `ETARGET No matching version`
