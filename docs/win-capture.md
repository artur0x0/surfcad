# Win capture (Slice 04)

When a player matches a puzzle target, SurfCAD records a labeled win:

| Field | Source |
|---|---|
| `puzzleId` | Active puzzle id |
| `script` | Winning Monaco script text |
| `timeMs` | Elapsed ms from enter / last reset to match |
| `timestamp` | ISO-8601 client time |
| `clientId` | Stable anonymous id in `localStorage` (`surfcad.game.clientId`) |
| `buildId` | `import.meta.env.MODE` (or `VITE_BUILD_ID` if set) |

## Destinations

1. **Backend (preferred)** — `POST /api/wins`  
   Appends one JSON object per line to:

   ```
   backend/data/wins.jsonl
   ```

   Route: `backend/routes/wins.js` (mounted in `backend/server.js`).  
   Failures are non-blocking: match UX still clears/restarts; errors go to the console.

2. **localStorage mirror** — key `surfcad.game.winsMirror` (last ~50 wins).  
   Used when the API is down (typical Vite-only dev).

## Best times

Per-puzzle best times live in `localStorage` key `surfcad.game.bestTimes`  
(`{ [puzzleId]: timeMs }`). Updated on each win if the new time is lower.  
Shown in the game chrome and puzzle picker.

## Dev notes

- Vite proxies `/api` → `http://localhost:3000` (`vite.config.js`).
- `wins.jsonl` is gitignored; `backend/data/.gitkeep` keeps the folder.
- No accounts required; this is capture for training/analysis, not a leaderboard.
