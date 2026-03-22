# Network Access Modes Design

## Problem

ccweb server currently binds to `0.0.0.0` (all interfaces) by default, relying solely on CORS and Origin validation to restrict access. Users need explicit control over who can access the server: local only, LAN, or public.

## Solution

Add three access modes selectable via CLI flags or interactive prompt:

| Mode | listen host | CORS/Origin | Auth | IP Filter |
|------|------------|-------------|------|-----------|
| `local` | `127.0.0.1` | localhost only | auto-login | None (OS-level isolation) |
| `lan` | `0.0.0.0` | allow all | local auto-login, others require login | Private IPs only |
| `public` | `0.0.0.0` | allow all | local auto-login, others require login | None |

Private IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `::1`, `fe80::/10`.

## Changes

### 1. CLI (`bin/ccweb.js`)

**New flags**: `--local`, `--lan`, `--public`

**Interactive prompt** (before the "run in background?" question):
```
? 选择访问模式 (Select access mode):
  1) 仅本地访问 (Local only) — 默认
  2) 允许局域网访问 (LAN)
  3) 允许外部网络访问 (Public)
```

**Mode propagation**: Pass `CCWEB_ACCESS_MODE=local|lan|public` as environment variable to the backend child process.

**Priority**: CLI flag > interactive selection. Default: `local`.

### 2. Backend (`backend/src/index.ts`)

**Read mode**: `const accessMode = process.env.CCWEB_ACCESS_MODE || 'local'`

**Server listen**: Change `server.listen(port)` to `server.listen(port, host)` where host is `'127.0.0.1'` for local mode, `'0.0.0.0'` for lan/public.

**CORS policy**:
- `local`: current behavior (localhost origins only)
- `lan` / `public`: allow all origins

**WebSocket Origin validation**:
- `local`: current behavior (reject non-localhost origins)
- `lan` / `public`: allow all origins

**Startup log**: Display access mode and reachable address(es).

### 3. IP Filter Middleware (new)

Add middleware in `backend/src/index.ts` (or a new file if cleaner):

- Only active in `lan` mode
- Checks `req.ip` / `req.socket.remoteAddress` against private IP ranges
- Returns 403 for non-private IPs
- Also applied to WebSocket upgrade requests

**Private IP check function**:
```typescript
function isPrivateIP(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (::ffff:x.x.x.x)
  // Check against: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, ::1, fe80::/10
}
```

### 4. Frontend

No changes needed. Auth flow (auto-login for localhost, login form for remote) remains unchanged.

## Files to Modify

1. `bin/ccweb.js` — CLI flag parsing, interactive prompt, env var passing
2. `backend/src/index.ts` — listen host, CORS, WS origin, IP filter middleware, startup log

## Default Behavior

Default mode is `local` (most secure). This is a behavior change from current state where the server binds to all interfaces. This is intentional — users who need remote access should explicitly opt in.
