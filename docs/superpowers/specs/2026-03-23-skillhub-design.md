# SkillHub Design Spec

## Overview

SkillHub is a GitHub-based community repository (`zbc0315/ccweb-skillhub`) where CC Web users can share and discover reusable shortcut commands. The app provides an in-app browsing/search page and one-click download to global shortcuts, plus a share button to submit commands via GitHub Issues.

## GitHub Repository Structure

```
ccweb-skillhub/
├── README.md
├── skills.json              ← Index file (all skill metadata, used by frontend)
└── skills/                  ← Individual skill files
    ├── code-review-zh.json
    └── ...
```

### Skill File Format

```json
{
  "id": "code-review-zh",
  "label": "代码审查",
  "command": "/review 请审查当前更改，关注安全性和性能",
  "description": "中文代码审查提示词，关注安全和性能",
  "author": "tom",
  "tags": ["代码审查", "中文"],
  "createdAt": "2026-03-23"
}
```

### Index File (`skills.json`)

Array of all skills with an additional `downloads` counter:

```json
[
  {
    "id": "code-review-zh",
    "label": "代码审查",
    "command": "/review ...",
    "description": "中文代码审查提示词",
    "author": "tom",
    "tags": ["代码审查", "中文"],
    "downloads": 0,
    "createdAt": "2026-03-23"
  }
]
```

## Submission Flow

1. User clicks share icon on a shortcut (global or project-level) in ShortcutPanel
2. Dialog opens: fill in `description`, `author`, `tags`
3. Frontend calls `POST /api/skillhub/submit`
4. Backend creates a GitHub Issue using a bot token:
   - Title: `[Skill] {label}`
   - Label: `new-skill`
   - Body: JSON content of the skill
5. Repo owner reviews and manually merges into `skills.json` + `skills/` directory

## Backend API

New route file: `backend/src/routes/skillhub.ts`, mounted at `/api/skillhub`.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/skillhub/skills` | Fetch skills.json index from GitHub Raw URL, cached 5 min in memory |
| `POST` | `/api/skillhub/submit` | Submit a skill — creates GitHub Issue with bot token |
| `POST` | `/api/skillhub/download/:id` | Download skill as global shortcut + increment download count in repo |

### Caching

Backend caches `skills.json` in memory with a 5-minute TTL. On cache miss or expiry, fetches from `https://raw.githubusercontent.com/zbc0315/ccweb-skillhub/main/skills.json`.

### GitHub Bot Token

Stored in environment variable `CCWEB_GITHUB_TOKEN` or in `~/.ccweb/config.json` under `githubToken` field. Used for:
- Creating Issues (`POST /api/skillhub/submit`)
- Updating `skills.json` download counts (`POST /api/skillhub/download/:id`)

## Frontend

### SkillHub Page (`/skillhub`)

- **Route**: `/skillhub`, new page `pages/SkillHubPage.tsx`
- **Entry**: Button in DashboardPage top navigation bar
- **Layout**:
  - Top: Search input + tag filter chips (click to toggle)
  - Body: Card grid of skills
  - Each card: label, description, author, tags (as badges), download count
  - Card click: expand to show full command text
  - Download button: one-click add to global shortcuts

### Tags

- Extracted from `skills.json` dynamically (collect all unique tags)
- Tag filter: click to filter, click again to deselect
- Skills with no tags shown under "无标签" category

### Share Dialog

- Added to ShortcutPanel: share icon button on hover for each shortcut
- Dialog fields: description (textarea), author (input), tags (comma-separated input)
- Submit calls `POST /api/skillhub/submit`

### API Client

New functions in `frontend/src/lib/api.ts`:

```typescript
interface SkillHubItem {
  id: string;
  label: string;
  command: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
  createdAt: string;
}

getSkillHubSkills(): Promise<SkillHubItem[]>
submitSkillToHub(data: { label, command, description, author, tags }): Promise<void>
downloadSkillFromHub(id: string): Promise<GlobalShortcut>
```

## Data Flow

```
[GitHub Repo: skills.json]
        │
        ▼ (HTTP GET, cached 5 min)
[Backend: GET /api/skillhub/skills]
        │
        ▼
[Frontend: SkillHubPage] ──search/filter──► display cards
        │
        ├── Download ──► POST /api/skillhub/download/:id
        │                 ├── Add to global-shortcuts.json
        │                 └── Update downloads count in GitHub repo
        │
        └── Share ──► POST /api/skillhub/submit
                       └── Create GitHub Issue with bot token
```

## Files to Create/Modify

### Create
- `backend/src/routes/skillhub.ts` — SkillHub API routes
- `frontend/src/pages/SkillHubPage.tsx` — SkillHub browse/search page

### Modify
- `backend/src/index.ts` — Mount skillhub routes
- `frontend/src/App.tsx` — Add `/skillhub` route
- `frontend/src/lib/api.ts` — Add SkillHub API functions
- `frontend/src/components/ShortcutPanel.tsx` — Add share button + dialog
- `frontend/src/pages/DashboardPage.tsx` — Add SkillHub navigation button
