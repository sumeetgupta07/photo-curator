# Photo Curator v3 — Phase 1 Setup

**Version: 3.0.0**
**Phase: 1 — Foundation (Backend + Extension Scaffold + World Bridge)**

---

## What's in Phase 1

- ✅ New SQLite schema (5 tables, all indexes)
- ✅ Backend Express server — extension scan endpoints + PWA auth/library/swipe routes
- ✅ Chrome Extension (Plasmo):
  - MAIN world GPTK bridge (`gptk-bridge.ts`)
  - ISOLATED world scan loop (`content.ts`)
  - Sidebar UI with Start/Pause/Resume + trash button (`sidebar.tsx`)
  - Options page with backend URL + secret config
- ✅ Docker Compose for backend

**Not in Phase 1:** Thumbnails, MediaPipe embeddings, PWA redesign, actual trash execution (deferred to Phase 2+)

---

## Prerequisites

- Docker + Docker Compose on your Proxmox LXC host
- Chrome on Mac or Chromebook (for extension)
- GPTK userscript installed via Tampermonkey:
  https://github.com/xob0t/Google-Photos-Toolkit

---

## Backend Setup

```bash
# 1. Copy env file and fill in values
cp .env.example .env
# Edit .env: set EXT_SECRET and CURATOR_PASSWORD

# 2. Start backend
docker-compose up -d

# 3. Verify
curl https://photo.sumeetg.duckdns.org/api/health
# Expected: {"ok":true,"version":"3.0.0"}
```

---

## Extension Setup

```bash
cd extension

# Install dependencies
npm install

# Development build (hot reload)
npm run dev

# Production build
npm run build
# Output: build/chrome-mv3-prod/
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `extension/build/chrome-mv3-dev/` (dev) or `chrome-mv3-prod/` (prod)
5. Options page opens automatically — enter your backend URL and EXT_SECRET
6. Open `photos.google.com` and **refresh the tab**
7. The 📷 sidebar should appear on the right

---

## Phase 1 Exit Criteria Checklist

Run these to verify Phase 1 is working before proceeding to Phase 2:

```bash
# 1. Backend health
curl https://photo.sumeetg.duckdns.org/api/health

# 2. Extension heartbeat (after opening photos.google.com with extension loaded)
curl -H "X-Ext-Secret: YOUR_SECRET" \
  https://photo.sumeetg.duckdns.org/api/extension/heartbeat

# 3. Scan progress (after clicking Start Scan)
curl -H "X-Ext-Secret: YOUR_SECRET" \
  https://photo.sumeetg.duckdns.org/api/scan/progress

# 4. Check SQLite directly
docker exec -it photo-curator-backend sqlite3 /app/data/photo-curator.db \
  "SELECT COUNT(*) FROM library_items;"
# Should be > 0 after scanning
```

---

## Generating EXT_SECRET

```bash
openssl rand -hex 16
# Copy output to .env EXT_SECRET= and extension options page
```

## Hashing CURATOR_PASSWORD (optional, more secure)

```bash
node -e "const b=require('bcrypt'); b.hash('yourpassword', 10).then(h => console.log(h))"
# Copy bcrypt hash to .env CURATOR_PASSWORD=
```

---

## File Structure

```
photo-curator-v3/
├── backend/
│   ├── index.js          All Express routes
│   ├── db.js             SQLite schema + all DB functions
│   ├── package.json
│   └── Dockerfile
├── extension/
│   ├── contents/
│   │   ├── gptk-bridge.ts  MAIN world — calls window.gptkApi
│   │   ├── content.ts      ISOLATED world — scan loop, bridge comms
│   │   └── sidebar.tsx     Injected sidebar UI
│   ├── options/
│   │   └── index.tsx       Settings page
│   ├── background/
│   │   └── index.ts        Service worker (install handler)
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```
