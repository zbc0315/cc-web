# Ambient Sound Design

## Problem

Users want ambient background sounds that play when the LLM is actively running in a project, providing audio feedback of activity and a pleasant working atmosphere.

## Solution

Add per-project ambient sound support with preset and custom sounds. Audio plays via Web Audio API in the frontend, triggered by terminal activity detection. Preset sounds are hosted on GitHub Release and cached locally on first use.

## Requirements

- **Sounds**: 6 presets (singing bowl, water drops, wind, rain, keyboard, stream) + user-uploaded custom sounds
- **Trigger**: Play when LLM is actively running (terminal activity < 2s), fade out when idle (> 3s)
- **Play modes**: Loop (seamless), Interval (random timing), Auto (determined by sound type) — user selectable, default Auto
- **Storage**: Presets cached in `~/.ccweb/sounds/presets/`, custom sounds in `~/.ccweb/sounds/` (global) or `.ccweb/sounds/` (per-project)
- **Preset hosting**: GitHub Release assets, downloaded on first use
- **Per-project config**: Each project independently selects sound, mode, volume

## Preset Sounds

| ID | Name | Type | Default Mode | Description |
|----|------|------|-------------|-------------|
| `singing-bowl` | 磬声 | strike | interval | Tibetan singing bowl |
| `water-drops` | 水滴 | strike | interval | Water drop sounds |
| `wind` | 风声 | ambient | loop | Gentle wind |
| `rain` | 雨声 | ambient | loop | Rain ambience |
| `keyboard` | 键盘敲击 | strike | interval | Mechanical keyboard |
| `stream` | 溪流 | ambient | loop | Flowing stream |

Files hosted at: `https://github.com/zbc0315/cc-web/releases/download/sounds/{id}.mp3`

Sound type determines Auto mode behavior:
- `ambient` → loop mode
- `strike` → interval mode

## LLM Activity Detection

Reuse existing `getProjectsActivity()` mechanism (polls terminal activity timestamps every 2s):

- Activity gap < 2s → LLM running → start playback (fade in 0.5s)
- Activity gap > 3s → LLM idle → stop playback (fade out 1s)
- Hysteresis prevents rapid on/off toggling

## Project Sound Config

Added to `.ccweb/project.json`:

```json
{
  "sound": {
    "enabled": true,
    "source": "preset:singing-bowl",
    "playMode": "auto",
    "volume": 0.5,
    "intervalRange": [3, 8]
  }
}
```

Source formats:
- `preset:{id}` — built-in preset
- `global:{filename}` — from `~/.ccweb/sounds/`
- `project:{filename}` — from `.ccweb/sounds/`

## Backend API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/sounds/presets` | List presets with download status |
| `POST` | `/api/sounds/download/:id` | Download preset from GitHub Release to local cache |
| `GET` | `/api/sounds/file/:name` | Stream global sound file |
| `GET` | `/api/sounds/project/:projectId/:name` | Stream project sound file |
| `POST` | `/api/sounds/upload` | Upload custom sound (multipart, `scope=global\|project`, `projectId` if project) |
| `GET` | `/api/sounds/list` | List all available sounds (presets + global + project) |

File streaming uses `res.sendFile()` or `fs.createReadStream().pipe(res)` with proper Content-Type headers.

## Frontend Components

### SoundPlayer.tsx

Invisible component (no UI), manages audio playback:
- Uses Web Audio API (`AudioContext`, `GainNode` for fade in/out)
- Polls activity status to determine play/pause
- Handles loop mode (HTMLAudioElement with `loop=true`) and interval mode (random setTimeout between plays)
- Preloads audio buffer on mount
- Cleans up on unmount

Props: `{ projectId, soundConfig, isActive }`

### SoundSelector.tsx

UI component for selecting and configuring sound:
- Dropdown to select sound source (presets, global customs, project customs)
- Preview/play button for each sound
- Play mode selector (循环/随机间隔/自动)
- Volume slider
- Interval range inputs (for interval mode)
- Upload button for custom sounds
- Enable/disable toggle

Props: `{ projectId, config, onChange }`

## New Files

| File | Purpose |
|------|---------|
| `backend/src/routes/sounds.ts` | Sound file API routes |
| `frontend/src/components/SoundPlayer.tsx` | Audio playback engine |
| `frontend/src/components/SoundSelector.tsx` | Sound selection UI |

## Modified Files

| File | Change |
|------|--------|
| `backend/src/index.ts` | Mount `/api/sounds` routes |
| `frontend/src/pages/ProjectPage.tsx` | Add SoundPlayer + SoundSelector |
| `frontend/src/lib/api.ts` | Add sounds API functions |

## Dependencies

No new npm dependencies. Uses native Web Audio API and HTMLAudioElement.

Backend uses `multer` for file upload (already available via Express, or install if needed).

## Audio Format

Accept MP3 and OGG uploads. Presets are MP3 (broad browser support). Max file size: 10MB per sound file.
