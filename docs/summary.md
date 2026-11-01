# CHRISTIAN PRAYER LIVE — Project Context & AI Handoff

**Document purpose:** let a new AI model (or developer) take over this project without the previous chat history.
**Project root:** repository root of this checkout (referred to below as `<root>`).
**Document version:** 1.0 — written 2026-11-01.
**Brand:** CHRISTIAN PRAYER LIVE · *FAITH • HOPE • LOVE* · “Pray Together. Grow in Faith.”
**Market:** United States · **Tradition:** general (non-denominational) Christian.

---

## How this document was produced (read this first)

- Every claim below was checked against the **current files on disk** (source, config, manifests, runtime probes) — not against README text alone.
- Items that could not be established from the repository are marked **UNKNOWN** or **NEEDS VERIFICATION**.
- No source file was modified while producing this document. The only file written is this one.
- Test suites were **not re-executed** during this analysis because both suites run against a **live server** and mutate its state (prayer wall, music selection, congregation demo, health incidents). Previously observed results are quoted as historical, not as a fresh pass.
- At the time of analysis **no process was listening on port 3000** (the last run ended around 2026-11-01 11:01 per `logs/server.log`). See §8.

---

## 1. Project Overview

### 1.1 What it is

A single-process live-streaming control application for a **24/7-style Christian prayer channel on TikTok Live**, designed for a **1080×1920 vertical (9:16) OBS Browser Source**.

It connects to a real TikTok LIVE room, reacts to real viewer events (member joins, comments, likes, follows, shares, gifts), and drives:

- a cinematic cathedral stage with an animated congregation,
- English (and Vietnamese) narration through a local **Piper** neural TTS worker,
- a licensed ambient-worship music bed with automatic ducking under narration,
- an automated prayer program (welcome → Scripture → prayer → community → gratitude),
- a Bible quiz answered through TikTok comments,
- a moderated prayer wall,
- a copyright-safe asset gate for every image and music track,
- a US-timezone-aware daily programming schedule,
- a health/auto-recovery subsystem with an incident log.

### 1.2 Origin and current stage

- Origin: a Vietnamese Buddhist TikTok “temple RPC” application (`https://github.com/zane-tv/tiktok-live-temple-rpc`).
- It was **converted in place** into a general Christian prayer platform. Legacy **`temple.*` RPC method names are intentionally preserved** as compatibility aliases, and the legacy state counter names (`totalIncense`, `woodenFishHits`, `fortuneCount`, …) are still emitted as aliases so existing tooling/OBS scenes keep working.
- Current stage: **feature-complete for the implemented roadmap and in day-to-day use from this machine** (real TikTok connections have been made); the remaining work is licensing review of 15 stock photos, missing AI artwork for two categories, admin security, and real-LIVE end-to-end verification of gifts/comments after the latest changes.

### 1.3 Architecture at a glance

```
                     ┌──────────────────────────────────────────────┐
  TikTok LIVE  ─────▶│ tiktok-live-connector (in server.js §11)      │
  (real events)      └───────────────┬──────────────────────────────┘
                                     │ WebcastEvent / ControlEvent
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ server.js  (Express + ws, ~4 100 lines, single process)                       │
│  • JSON-RPC 2.0 dispatcher  handleRpcCall(method, params)                     │
│  • state machine + persistence (data/prayer-state.json)                       │
│  • engines: ShowProgram · QuizEngine · SmartSchedule · HealthMonitor          │
│             MusicLibrary · MusicIntegrity · Congregation · CopyrightAudit     │
│             BroadcastSafety · ImageLibrary · MessageLibrary                  │
│  • PiperTtsManager ── spawns ─▶ .venv python  tts_worker.py (line-JSON)        │
└───────────────┬──────────────────────────────┬───────────────────────────────┘
                │ HTTP /rpc, /api/*, /assets     │ WebSocket /ws notifications
                ▼                                ▼
      ┌───────────────────┐            ┌───────────────────────┐
      │ OBS stage          │            │ Admin dashboard        │
      │ public/index.html  │            │ public/admin.html      │
      │ live.js · audio.js │            │ js/admin.js            │
      │ particles.js       │            │ css/admin.css          │
      └───────────────────┘            └───────────────────────┘
```

Key architectural rule enforced throughout: **the server is the single source of truth**. Browsers never decide copyright eligibility, quiz correctness, program scheduling, or viewer identity — they render what the server broadcasts.

---

## 2. Technology Stack

### 2.1 Languages & runtimes (verified on this machine)

| Component | Version / path | Notes |
| --- | --- | --- |
| Bun | `1.4.4` | Primary runtime (`bun run server.js`), `bun.lock` present |
| Node.js | `v20.18.3` | Used for test scripts and `node --check` syntax validation |
| Python | `3.12.2` | TTS worker only |
| Python venv | `.venv/Scripts/python.exe` (Windows) | Server probes `.venv/Scripts/python.exe`, `.venv/bin/python`, `python`, `python3` in that order |
| Piper TTS | `piper-tts` Python package inside the venv | Error text in code suggests `uv venv .venv && uv pip install piper-tts` |

### 2.2 Libraries (installed versions from `package-lock.json`)

| Package | Declared | Installed |
| --- | --- | --- |
| `express` | ^4.19.2 | 4.22.3 |
| `ws` | ^8.18.0 | 8.22.0 |
| `tiktok-live-connector` | ^2.1.0 | 2.5.0 |
| `cors` | ^2.8.5 | 2.8.6 |

No build step, no bundler, no TypeScript, no framework. Front end is plain HTML + CSS + classic `<script>` files (no modules): `audio.js`, `particles.js`, `live.js` on the stage; `admin.js` on the dashboard.

### 2.3 `package.json` scripts

```json
"start": "bun run server.js",
"dev":   "bun --watch server.js",
"test:smoke": "node scripts/smoke-test.js"
```

Note: `scripts/test-reliability.js` exists but is **not wired into `package.json`**; run it directly.

### 2.4 Browser APIs relied on (OBS Chromium)

- Web Audio API (`AudioContext`, `GainNode`, `DynamicsCompressorNode`, `AudioBufferSourceNode`) for music/TTS/chimes and ducking.
- `fetch` for RPC, WebSocket for push notifications.
- CSS backdrop filters/gradients and `<canvas>` (`particles.js`) for ambience.
- `localStorage` for a few client-side preferences (e.g. `prayer_tts_vol`).

---

## 3. Project Structure

```
<root>
├─ server.js                  HTTP + WS + JSON-RPC + all orchestration (~4 100 lines)
├─ tts_worker.py              Piper synthesis worker, line-delimited JSON over stdio
├─ package.json / bun.lock / package-lock.json
├─ .env / .env.example        optional env overrides (names only — see §6)
├─ README.md                  operator documentation (very detailed; see outline in §9)
│
├─ config/
│  ├─ config.js               config loader (app.config.json + env overrides + clamps)
│  ├─ app.config.json         default runtime configuration
│  ├─ messages.en.json        English copy library: templates, commands, categories,
│  │                          20 Bible verses with reflections, prayer triggers
│  ├─ schedule.json           smart daily schedule (4 programs, timezone, override)
│  ├─ schedule.backup.json    atomic-write backup of the schedule
│  ├─ copyright-manifest.json master copyright ledger (104 assets) + .backup.json
│  ├─ voices.json             legacy/empty (`{"voices": []}`) — not used by discovery
│  └─ piper/
│     ├─ en/  en_US-amy-medium, en_US-arctic-medium, en_US-hfc_female-medium (.onnx + .json)
│     └─ vn/  15 Vietnamese models (banmai, cuc, taian2, … vi_VN-vais1000-medium)
│
├─ lib/
│  ├─ show.js        (775)  automated program: sequence, verses, prayers, welcomes
│  ├─ quiz.js        (411)  150 verified KJV questions + QuizEngine
│  ├─ schedule.js    (563)  timezone-aware SmartSchedule
│  ├─ health.js      (675)  CPU/RAM/event-loop/audio monitoring + incident log
│  ├─ music-library.js (483) music manifest scan/edit/atomic save
│  ├─ music-integrity.js (216) manifest↔disk integrity report
│  ├─ congregation.js (303) viewer→participant seating, capacity, demo mode
│  ├─ copyright-audit.js (1015) asset discovery, licence evidence, reports
│  ├─ broadcast-safety.js (287) the single eligibility decision used everywhere
│  ├─ image-library.js (543) image scan/sync for the 7 category folders
│  ├─ messages.js    (148)  message library load/normalise/pick
│  └─ voices.js      (97)   Piper voice discovery from config/piper/*
│
├─ public/
│  ├─ index.html     (351)  OBS stage (1080×1920)
│  ├─ admin.html     (800)  admin dashboard (17 panels)
│  ├─ js/live.js     (1798) stage rendering, WS handling, congregation, quiz, gifts
│  ├─ js/audio.js    (766)  PrayerAudioEngine: two-deck music, TTS queue, ducking
│  ├─ js/particles.js(302)  ambient particles / light rays
│  ├─ js/admin.js    (2988) dashboard logic for every panel
│  ├─ css/live.css   (2151) stage styling (navy/gold/ivory palette)
│  ├─ css/admin.css  (1495) dashboard styling
│  ├─ copyright-audit.json  generated audit snapshot served to the dashboard
│  └─ assets/christian/
│     ├─ asset-manifest.json        34 registered stage images
│     ├─ asset-manifest.backup.json previous manifest (atomic write backup)
│     ├─ backgrounds/ bible/ candles/ cathedral/ church/ cross/ jesus/  (31 images)
│     ├─ overlays/  3 locally generated PNGs (bokeh, light rays, vignette)
│     └─ audio/     21 playable files + music-manifest.json (+ .backup)
│
├─ data/
│  ├─ prayer-state.json      live state (counters, prayer wall, feeds, settings)
│  ├─ health-state.json      incident log + recovery counters
│  ├─ image-library-state.json last image scan summary
│  ├─ merit-state.json       legacy 795 KB file from the Buddhist version
│  ├─ tts-cache/             synthesized WAV cache (served at /tts-cache, 7-day max-age)
│  └─ imagegen-test/         one throwaway generator test image
│
├─ scripts/
│  ├─ smoke-test.js          (585) HTTP/WS/RPC smoke suite
│  ├─ test-reliability.js    (400) schedule/health/integrity unit-level suite
│  ├─ generate_music.py      (418) local CC0 ambient track synthesiser
│  └─ fetch_christian_assets.py (443) stock-image downloader with licence recording
│
├─ docs/
│  ├─ COPYRIGHT_AUDIT.md     full audit report (regenerated by email scan)
│  ├─ ASSET_ATTRIBUTION.md   copy-ready credits
│  ├─ summary.md             ← this document
│  ├─ music-sources.md       every track, artist, source URL, licence
│  ├─ commons-license-evidence.json / mixkit-license-evidence.json
│  ├─ screenshots/           ~29 verification screenshots (stage/admin/congregation)
│  ├─ demo/                  original project demo screenshots (reference only)
│  ├─ backups/image-manifests/  timestamped manifest snapshots
│  ├─ backups/music-removed/    2 tracks removed on request (kept, not deleted)
│  └─ superpowers/specs/     original design spec (Buddhist-era, historical)
│
├─ backup/                   pre-change copies (server.js, admin.html, live.js, …,
│                            plus a full `pre-reliability-20261101-005133/` snapshot)
└─ logs/server.log, logs/server.pid
```

### 3.1 Module interactions (data flow)

1. **TikTok → server.** `conn.on(WebcastEvent.CHAT …)` etc. sanitize input, update state, push an event log entry, then call `broadcastNotification('temple.event', …)`.
2. **Server → clients.** `broadcastNotification(method, params)` sends `{jsonrpc:'2.0', method, params}` to every open WebSocket. New clients immediately receive a snapshot (`temple.state`, `show.state`, `quiz.state`, `schedule.state`, `health.state`, and a replayed `show.cue` if it is still on screen).
3. **Clients → server.** Any JSON-RPC call, over HTTP `POST /rpc` or over the WebSocket (same dispatcher).
4. **Narration.** Show/quiz/gift code calls the TTS manager → Python worker → WAV path under `data/tts-cache` → `broadcastNotification('tts.play', {url, …})` → `audio.js` plays it, ducking music.
5. **Assets.** `ImageLibrary` (disk scan) and `MusicLibrary` (manifest scan) feed `CopyrightAudit`; `BroadcastSafety` filters with `config/copyright-manifest.json`; only eligible assets reach `BACKGROUNDS` / `MUSIC` catalogs used by rotation and the stage.

---

## 4. Features and Implementation Status

Legend: **✅ implemented and wired** · **🟡 implemented with a caveat** · **⛔ not implemented / gap** · **❓ not verified**

### 4.1 Core platform

| Feature | Status | Evidence / notes |
| --- | --- | --- |
| Express HTTP server + static stage | ✅ | `app.use(express.static(PUBLIC_DIR))`, `GET /admin` |
| WebSocket JSON-RPC at `/ws` | ✅ | `WebSocketServer({server, path:'/ws'})`, per-message dispatch |
| HTTP JSON-RPC at `POST /rpc` | ✅ | Method dispatch with JSON-RPC 2.0 error envelope |
| Legacy `temple.*` methods preserved | ✅ | Aliased to Christian semantics (see §5.3) |
| State persistence | ✅ | `data/prayer-state.json`, debounced write, restored at boot |
| 1080×1920 OBS stage | ✅ | `#stage9x16`, fixed aspect wrapper, mobile-scale typography |
| `?obs=1` stage parameter | ✅ | Used for the WebSocket `isObs` flag and clean-stage behaviour |

### 4.2 TikTok integration

| Feature | Status | Notes |
| --- | --- | --- |
| Connect by username/URL | ✅ | `resolveTikTokUsername`, `connectTikTokLive` |
| Comments + command detection | ✅ | `COMMAND_KEYS`, message library commands |
| Likes / follows / shares / social | ✅ | Mapped to AMEN pulses, stats, toasts |
| Gifts with combo tracking | ✅ | `giftComboTracker`, tiered acknowledgement, optional TTS |
| Member join → congregation seat | ✅ | `WebcastEvent.MEMBER` → `congregation.join()` |
| Member **leave** event | ⛔ | The connector exposes no leave event; a configurable **inactivity timeout** (default 20 min) prunes participants. The code explicitly refuses to fake leaves. ❓ whether some payload variant carries leave data |
| Auto-reconnect with backoff | ✅ | Exponential up to 300 s, max attempts configurable, single in-flight guard; the previous connection is disposed (`removeAllListeners` + `disconnect`) before reconnecting, so a dead socket cannot keep feeding events. There is **no timestamp-based stale-event filter** — the connector does not replay history |
| Auth/CAPTCHA failures | 🟡 | Detected as errors and surfaced for manual intervention; never bypassed |
| Real LIVE verification after latest changes | ❓ | Not verifiable in this environment; last log shows successful connect to `@tinytails99` |

### 4.3 Narration (Piper)

| Feature | Status | Notes |
| --- | --- | --- |
| Voice discovery from disk | ✅ | 3 English + 15 Vietnamese models found at runtime |
| English default voice | ✅ | `en_US-amy-medium` (configured in `app.config.json`) |
| Vietnamese support | ✅ | `vi_VN-vais1000-medium` default; language selectable per narration |
| Streaming line-JSON protocol | ✅ | Worker emits `status`/`ready`/`result`/`error` |
| WAV cache + static serving | ✅ | `data/tts-cache`, `/tts-cache` with 7-day cache |
| Auto restart + backoff `[2,5,10,30,60] s` | ✅ | 8 restarts/hour cap, then suspended with an admin warning |
| 90 s readiness watchdog | ✅ | Kills a worker that never reports ready |
| No duplicate narration on restart | ✅ | In-flight requests rejected once with “not repeated” |
| Queue cap | ✅ | `CONFIG.tts.maxQueue` (default 6, clamp 1–20); stage queue 5 |
| Narration timeout behaviour | 🟡 | Log shows “Piper synthesis timed out” under load; retries are not automatic for a single line |

### 4.4 Background music

| Feature | Status | Notes |
| --- | --- | --- |
| Local library, 21 playable tracks | ✅ | 3 original CC0 `.ogg` + 18 Mixkit MP3 |
| Two-deck seamless crossfade | ✅ | Web Audio buffers, `loopSeamDelta` recorded per original track |
| Play/pause/next/prev/volume/mute/shuffle/repeat | ✅ | Stage dock + admin panel |
| Ducking under narration | ✅ | Music 10% → 3.5% (`duckVolume`), ramped back afterwards |
| Remember selected track & volume | ✅ | Server state + `localStorage` |
| Autoplay policy handling | ✅ | `#btnUnlockAudio` “Enable Audio” |
| Never restarts music on WS events | ✅ | Music state is applied idempotently |
| Rescan music folder (add/remove/update) | ✅ | `music.rescan`, atomic manifest write + backup, `music.library.updated` broadcast |
| Per-track enable/disable, rename, preview, remove | ✅ | `music.track.update`, `music.track.remove` |
| Integrity scan (missing/orphan/invalid) | ✅ | `lib/music-integrity.js`, `music.integrity` |
| Duplicate player prevention | ✅ | Single `PrayerAudioEngine`, single set of decks |

### 4.5 Visual stage

| Feature | Status | Notes |
| --- | --- | --- |
| Local-only image assets | ✅ | No remote URLs at runtime; `BroadcastSafety.normalizeImage` rejects `http(s)://` |
| Automatic background rotation | ✅ | Interval (default 60 s, clamp 10–3600), fade `transitionMs`, shuffle |
| Scene matching to program | ✅ | `sceneMatch` → program `backgroundCategories` |
| Cathedral-first default | 🟡 | Default pick prefers `cathedral-01`, else any cathedral image, else `church-02` |
| Congregation scene (up to 80 seats, default 50) | ✅ | CSS/DOM figures with deterministic variation, kneeling rows, gold AMEN glow, prayer/gift marks |
| Demo participants, clearly labelled | ✅ | `congregation.demo*`; demo users are excluded from real counters |
| Gift / AMEN / celebration overlays | ✅ | `giftCard`, `amenOverlay`, `celebrationBanner`, `eventToast` |
| Prayer wall | ✅ | Approved requests rotate on stage, moderation in admin |
| Bible verse card, quiz card, program line | ✅ | All server-driven cues |
| Text baked into images | ✅ (by policy) | Stock photos are plain photography; AI images generated without text — ❓ no automated OCR check exists |
| Particles / light-rays overlays | ✅ | `particles.js` + 3 local PNGs |

### 4.6 Automated program

| Feature | Status | Notes |
| --- | --- | --- |
| 12-segment looping show | ✅ | welcome → verse → prayer ×… → community → reflection → gratitude (~35 min nominal) |
| Daily Bible verses (20, KJV, with reflections) | ✅ | `config/messages.en.json` → `bibleVerses` |
| Prayer themes (8) | ✅ | morning, healing, family, anxiety, finances, strength, night, gratitude |
| Welcome greetings + TTS | ✅ | Minimum 20 s between welcomes and a cap of recent welcomes within 2 min; “previous prayer is still speaking” guard |
| Bible quiz (150 questions) | ✅ | Reveal window 10–90 s (default 25 s), case-insensitive answers, TTS reveal |
| Quiz anti-repetition | ✅ | `quizRecent` persisted in state |
| Gift acknowledgement | ✅ | Tiered by coin value; optional TTS |
| Prayer-request detection from comments | ✅ | 7 trigger phrases + `PRAY`/`PRAYER`/`AMEN` commands |
| No fabricated engagement in production | ✅ | Demo/auto-sim is off by default and events carry `simulated: true` |

### 4.7 Smart daily schedule (US timezones)

| Feature | Status | Notes |
| --- | --- | --- |
| Four programs | ✅ | Morning Prayer 05–11, Afternoon Bible Study 11–17, Evening Worship 17–21, Night Prayer 21–05 |
| IANA timezones + DST via `Intl` | ✅ | 7 zones: New_York, Chicago, Denver, Phoenix, Los_Angeles, Anchorage, Honolulu |
| Default timezone | ✅ | `America/Chicago` |
| Per-program content control | ✅ | prayer themes, verse tags, quiz frequency, narration pace, music/background categories, welcome/gift flags |
| Manual override with duration + auto-return | ✅ | `schedule.override`, `schedule.auto` |
| No TikTok restart on switch | ✅ | Program application never touches the connector |
| No duplicate transitions | ✅ | Applied signature (`id:source:until`) guards re-application |
| Persistence across restart | ✅ | `config/schedule.json` + backup; boot applies current program without announcing twice |
| Admin panel “Smart Daily Schedule” | ✅ | Local time, current/next program, countdown, enable, timezone, editable start/end, preview, 4 manual buttons, auto-return |
| Midnight / DST boundary correctness | 🟡 | Handled by `Intl` + minute math and covered by `scripts/test-reliability.js`; historical results passed, not re-run today |

### 4.8 Reliability & health

| Feature | Status | Notes |
| --- | --- | --- |
| Piper crash detection/restart | ✅ | See §4.3 |
| TikTok disconnect detection/reconnect | ✅ | Backoff, single connection, old listeners disposed, admin controls |
| CPU / RAM / event loop sampling | ✅ | Thresholds: CPU 80% (60 s) / 95% (30 s); RAM 80% / 90% of available; loop 200 ms / 1000 ms |
| Silent-audio detection from real RMS reports | ✅ | Needs 3 consecutive silent reports, ignores intentional pause/mute/idle |
| Music file integrity monitor | ✅ | Missing/unreadable/invalid/orphan, never auto-deletes |
| Central admin panel “System Health & Auto Recovery” | ✅ | 9 component statuses, metrics, incident log, RUN HEALTH CHECK, RETRY FAILED COMPONENT, CLEAR RESOLVED ALERTS, EXPORT DIAGNOSTIC REPORT |
| Diagnostic export scrubbing | ✅ | Smoke test asserts no `process.env` leakage; report built from a safe snapshot |

### 4.9 Copyright & licensing

| Feature | Status | Notes |
| --- | --- | --- |
| Master manifest (`config/copyright-manifest.json`) | ✅ | 104 assets: 23 music, 81 images |
| Status vocabulary | ✅ | VERIFIED / NEEDS_REVIEW / REJECTED / UNKNOWN |
| Copyright Safe Mode (ON by default) | ✅ | Runtime gate for image + music selection; blocking reason logged |
| Admin “Copyright & Licensing” panel | ✅ | Counts, filters, per-asset licence/author/source/permissions, Scan & Refresh, attribution preview |
| `docs/COPYRIGHT_AUDIT.md` + `docs/ASSET_ATTRIBUTION.md` | ✅ | Regenerated by the audit |
| Image library scan (7 folders) | ✅ | `AI_` prefix → AI_GENERATED/VERIFIED; other new files → NEEDS_REVIEW |
| Manifest backups (file + timestamped archive) | ✅ | `asset-manifest.backup.json`, `docs/backups/image-manifests/` |
| Overlay assets audited | 🟡 | They are in the manifests, but the scanner only walks the 7 categories |
| Legal clearance of CC BY-SA crops | ⛔ | Explicitly unresolved (see §7.4) |

### 4.10 Admin dashboard

17 panels (in `public/admin.html`): Live Overview · TikTok Live Connection · Smart Daily Schedule · Piper Narration · Live Show Automation · Community Engagement · Prayer Congregation · Background Music · Background Rotation · Prayer Request Queue · Live Comments · Community Activity · Message Library · System Health & Auto Recovery · Copyright & Licensing · Christian Image Library · JSON-RPC 2.0 Console.

| Feature | Status |
| --- | --- |
| Real-time updates over the shared WebSocket | ✅ |
| Music manager (tracks, preview, enable/disable, rescan, search/filter in UI) | ✅ |
| Image library scan + thumbnail grid with AI badges | ✅ |
| Smart schedule editor | ✅ |
| Health panel with incidents & recovery buttons | ✅ |
| Copyright panel with safe-mode toggle | ✅ |
| Admin authentication | ⛔ **None** |

---

## 5. Data, APIs and Business Logic

### 5.1 No database

There is **no SQL/NoSQL database and no migrations**. All persistence is JSON on disk. Manifests, the schedule and health state use atomic writes (`write tmp → rename`); the prayer state file is debounced and written directly:

| File | Written by | Contents |
| --- | --- | --- |
| `data/prayer-state.json` | `saveState()` (1 s debounce, plain `fs.promises.writeFile` — **not** atomic) | counters (`candlesLit`, `prayerCount`, `amenCount`, `blessingsCount`, `verseCount`, `giftCount`, `followCount`, `shareCount`, `likeCount`, `totalMerit`, `activeCandles`), `community`, `featuredVerse`, `prayerRequests`, `chatFeed`, `recentEvents`, `showHistory`, `quizRecent`, and the full `settings` object (tts, music, show, quiz, gifts, autoSim, background, prayer, congregation, tiktok, copyrightSafeMode) |
| `data/health-state.json` | `HealthMonitor.persist()` | `counters` (recoveries, failedRecoveries, checks, audioRecoveries), `lastRecovery`, `incidents[]` |
| `data/image-library-state.json` | `ImageLibrary.scan()` | last scan timestamp/duration and per-category counts |
| `data/merit-state.json` | legacy, **not loaded** | 795 KB pre-conversion state; `loadState()` only logs that it exists and starts fresh. Safe to keep for rollback; no code reads its values |
| `public/assets/christian/asset-manifest.json` | `ImageLibrary`, manual edits | array of 34 image entries |
| `public/assets/christian/audio/music-manifest.json` | `MusicLibrary` | 21 track entries + licence summary |
| `config/schedule.json` | `SmartSchedule.save()` | programs, timezone, override, enabled |
| `config/copyright-manifest.json` | `CopyrightAudit.scan()` | `counts`, `changes`, `unresolved[]`, `assets[]` |
| `config/messages.en.json` | admin “Message Library” | templates, commands, categories, 20 verses, triggers |
| `data/tts-cache/*.wav` | TTS manager | content-hash keyed speech cache |

### 5.2 HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | OBS stage (`public/index.html`); add `?obs=1` |
| GET | `/admin` | Admin dashboard (`public/admin.html`) |
| POST | `/rpc` | JSON-RPC 2.0 (`{jsonrpc,id,method,params}` → `{jsonrpc,id,result}` or `{error:{code,message}}`) |
| GET | `/api/state` | Public state snapshot |
| GET | `/api/backgrounds` | Background catalog + rotation settings |
| GET | `/api/messages` | Message library snapshot |
| GET | `/api/music` | Music catalog |
| GET | `/api/copyright` | Copyright audit summary |
| GET | `/api/health` | Brand, TTS readiness, voices, counters |
| GET | `/api/diagnostics` | Safe diagnostic payload |
| GET | `/tts-cache/<file>.wav` | Cached narration audio |
| WS | `/ws` | Snapshot on connect + notifications; also accepts JSON-RPC calls |

CORS is enabled globally (`app.use(cors())`) and JSON bodies are capped at 2 MB. No authentication or rate-limiting middleware was found on any of these routes.

Request/response shape (every RPC uses the same envelope):

```jsonc
// POST /rpc
{ "jsonrpc": "2.0", "id": 1, "method": "state.get", "params": {} }

// success
{ "jsonrpc": "2.0", "id": 1, "result": { "brand": { "name": "CHRISTIAN PRAYER LIVE", "tagline": "FAITH • HOPE • LOVE" }, "prayerCount": 72, "candlesLit": 37, "community": {}, "prayerRequests": [], "chatFeed": [], "settings": {}, "tiktok": {} } }

// failure
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32000, "message": "…" } }
```

`state.get`/`temple.state` always includes `brand`, the counters (plus legacy aliases `totalIncense`, `woodenFishHits`, `fortuneCount`), `community`, `featuredVerse`, `prayerRequests`, `chatFeed`, `recentEvents`, `settings` and `tiktok`. The HTTP methods `show.status`, `quiz.status`, `schedule.get` and `health.get` return their payload **unwrapped**, while the equivalent WebSocket notifications (`show.state`, `quiz.state`, `schedule.state`, `health.state`) wrap it under `show`, `quiz`, `schedule`, `health`.

### 5.3 JSON-RPC method catalog (all handled in `handleRpcCall`)

**Legacy `temple.*` (preserved names → new meaning)**

| Method | Christian meaning |
| --- | --- |
| `temple.getState` | Full public state (alias of `state.get`) |
| `temple.burnIncense` | Light prayer candles |
| `temple.strikeWoodenFish` | AMEN pulse (from likes) |
| `temple.ringBell` | Blessing / gratitude chime |
| `temple.sendPrayer` | Submit a prayer request |
| `temple.offerGift` | Tiered gift acknowledgement |
| `temple.grandCeremony` | Large celebration cue |
| `temple.drawFortune` | Draw a Scripture card (verified verses only) |
| `temple.comment` | Inject a comment (used by demo/test paths) |
| `temple.speak` / `temple.ttsStatus` | Narration control / status |
| `temple.updateSettings` / `temple.resetMerit` | Settings / counter reset |

**Current API groups**

| Group | Methods |
| --- | --- |
| State | `state.get`, `church.getState`, `community` |
| Prayer wall | `prayer.add`, `prayer.approve`, `prayer.hide`, `prayer.remove`, `prayer.clear`, `prayer.list`, `prayer.getState`, `prayer.setPaused`, `prayer.setAutoApprove` |
| Show | `show.status`, `show.update`, `show.next`, `show.nextVerse`, `show.nextReflection`, `show.nextPrayer`, `show.restart`, `show.testWelcome`, `verse`, `reflection`, `welcome`, `gratitude` |
| Quiz | `quiz.status`, `quiz.update`, `quiz.next`, `quiz.reveal`, `quiz.answer` |
| TTS | `tts.status`, `tts.test`, `tts.voices` |
| Music | `music.get`, `music.update`, `music.toggle`, `music.next`, `music.previous`, `music.rescan`, `music.track.update`, `music.track.remove`, `music.integrity`, `music.integrity.refresh` |
| Stage / backgrounds | `stage.listBackgrounds`, `stage.nextBackground`, `stage.setBackground`, `stage.updateSettings` |
| Congregation | `congregation.get`, `congregation.update`, `congregation.reset`, `congregation.demo`, `congregation.demoEvent`, `congregation.demoClear` |
| Copyright | `copyright.get`, `copyright.scan`, `copyright.safety`, `copyright.setSafeMode` |
| Image library | `images.scan`, `images.state` |
| TikTok / live | `live.connect`, `live.disconnect`, `live.status`, `live.setReconnect`, `live.retryNow`, `live.setAutoSim` |
| Schedule | `schedule.get`, `schedule.update`, `schedule.auto`, `schedule.override`, `schedule.preview`, `schedule.program.update`, `schedule.test` |
| Health | `health.get`, `health.check`, `health.audio`, `health.alerts.clear`, `health.retry`, `health.export` |
| Messages | `messages.get`, `messages.save` |
| Gifts | `gift.update` |

### 5.4 WebSocket notifications (server → client)

`temple.state` · `temple.event` · `temple.viewerCount` · `prayer.state` · `prayer.request` · `prayer.hide` · `show.state` · `show.cue` · `quiz.state` · `quiz.start` · `quiz.reveal` · `quiz.end` · `quiz.correct` · `stage.background` · `music.state` · `music.library.updated` · `music.integrity.updated` · `congregation.state` · `copyright.updated` · `images.updated` · `schedule.state` · `health.state` · `health.incident` · `tts.status` · `tts.play` · `live.chat` · `audio.recover`

Clients ignore unknown methods, so new notifications are backward compatible.

### 5.5 Important business logic

**Copyright gate (the most safety-critical rule).** `BroadcastSafety._evaluate()` blocks an asset unless: manifest exists → entry exists for the normalized path → `entry.kind` matches → `entry.usage === 'broadcast'` → `status === 'VERIFIED'` → `commercial`, `livestream`, `tiktok`, `obs` all start with “allowed” → the local file exists. A missing entry is **never** inferred from a filename. Safe mode ON by default; turning it off makes everything “selectable” but still reports `eligible: false`.

**Image registration.** `ImageLibrary.scan()` walks the seven folders, skips dotfiles/thumbnails/temp files/symlinks/unsupported extensions, computes dimensions (own JPEG/PNG/WebP parser) and SHA-256, preserves existing licence metadata, detects renames by hash, removes deleted files from the catalog without deleting disk files, assigns stable IDs, and writes atomically with a backup. `AI_` prefix (case-insensitive) ⇒ `provenance: AI_GENERATED`, `generated: true`, source “AI Generated”, commercial/social allowed, no attribution, `reviewRequired: false`. Everything else new ⇒ `NEEDS_REVIEW`.

**Schedule application.** `applyProgramContent()` updates prayer themes/verse tags/pace on `ShowProgram`, sets quiz cadence, gift flags, switches the background category and (only if needed) the background image, and picks a music track in a matching category — **without** restarting the show timer, the TikTok connection, or music playback.

**Quiz.** Questions never expose the answer before reveal; `quiz.answer` normalizes case/punctuation; recent question IDs are persisted to avoid repeats.

**Congregation.** Real `MEMBER` events (`not simulated`) create participants; demo participants are flagged and never counted as real viewers; capacity is 10–80 visible seats with automatic re-layout; inactivity prune runs every 30 s.

**Silent-audio detection.** The stage reports music RMS; the monitor needs 3 consecutive reports below `silentRms = 0.0006` while music *should* be playing, and explicitly ignores intentional pause/mute/idle/TTS-only states. Recovery asks the stage to reload the track (`audio.recover`) rather than spawning a player.

---

## 6. Configuration

### 6.1 Environment variables (names only — values intentionally omitted)

From `.env.example` (all optional; `config/app.config.json` holds defaults):
`PORT`, `TIKTOK_USER`, `DEFAULT_LANGUAGE`, `DEFAULT_EN_VOICE`, `DEFAULT_VN_VOICE`, `TTS_ENABLED`, `TTS_VOLUME`, `TTS_RATE`, `CHRISTIAN_THEME`, `BACKGROUND_ROTATION`, `BACKGROUND_ROTATION_INTERVAL`, `BACKGROUND_CATEGORY`, `MUSIC_ENABLED`, `MUSIC_VOLUME`, `MUSIC_DUCK_VOLUME`, `MUSIC_TRACK`, `MUSIC_AUTOPLAY`, `SHOW_ENABLED`, `SHOW_WELCOME`, `SHOW_NARRATION`, `SHOW_THEME`, `SHOW_PACE`, `PRAYER_AUTO_APPROVE`, `PRAYER_INTERACTION`, `QUIZ_ENABLED`, `QUIZ_FREQUENCY_MINUTES`, `QUIZ_REVEAL_SECONDS`, `QUIZ_TTS`, `GIFT_ANNOUNCE`, `GIFT_TTS`, `SCENE_MATCH`.

A local `.env` exists and currently defines a subset: `PORT`, `TIKTOK_USER`, `DEFAULT_LANGUAGE`, `DEFAULT_EN_VOICE`, `DEFAULT_VN_VOICE`, `TTS_ENABLED`, `TTS_VOLUME`, `TTS_RATE`, `CHRISTIAN_THEME`, `BACKGROUND_ROTATION`, `BACKGROUND_ROTATION_INTERVAL`, `BACKGROUND_CATEGORY`, `PRAYER_AUTO_APPROVE`. **Never print or commit those values** — `.env` is git-ignored.

Tests also read `BASE_URL` (default `http://localhost:3000`).

No TikTok cookies/session tokens are stored in config; the connector authenticates anonymously by room lookup for the configured username. **❓** whether an authenticated mode is needed for some regions/rooms.

### 6.2 Configuration files

| File | Role |
| --- | --- |
| `config/app.config.json` | Brand, port, TikTok username/autoConnect, language, TTS, background rotation, prayer moderation, gift tiers, background music, show, quiz, gifts, moderation |
| `config/schedule.json` | Smart schedule: `enabled`, `timezone`, `override`, 4 `programs[]` with content settings |
| `config/copyright-manifest.json` | Licensing source of truth (never hand-wave; regenerate via `copyright.scan`) |
| `config/messages.en.json` | All viewer-facing English copy + verses + triggers |
| `config/piper/*` | Voice models (`.onnx` + `.onnx.json`) |
| `public/assets/christian/audio/music-manifest.json` | Track metadata + licence |
| `public/assets/christian/asset-manifest.json` | Image registry |

`config/config.js` is the only reader of `app.config.json`; it clamps numeric values and applies env overrides. Editing the JSON requires a restart (env overrides too). Runtime settings changed from the dashboard are stored in `data/prayer-state.json` and **take precedence** over config defaults at boot.

### 6.3 External services & integrations

| Integration | Required? | Notes |
| --- | --- | --- |
| TikTok LIVE (via `tiktok-live-connector`) | Required for live events | Public room data; no API key in the repo |
| Piper TTS (`piper-tts` + local ONNX voices) | Required for narration | Fully offline |
| OBS Browser Source | Required for broadcast | `http://localhost:3000/?obs=1`, 1080×1920 |
| TikTok LIVE Studio / audio routing | Operator side | Music and narration arrive through OBS audio |
| Cloud services / paid APIs | **None** | No OpenAI, no analytics, no CDN, no database |
| Image/music sources | One-time downloads | Wikimedia Commons, Mixkit, locally synthesized |

### 6.4 Setup & deployment (Windows)

Verified from README + code paths:

```bat
:: 1) Node deps
bun install                :: or: npm install

:: 2) Python venv + Piper (once)
uv venv .venv
uv pip install piper-tts   :: must provide the `piper` module used by tts_worker.py

:: 3) Start
bun run server.js
:: open http://localhost:3000/?obs=1 in OBS, http://localhost:3000/admin in a browser
```

Python fallback order is `.venv/Scripts/python.exe` → `.venv/bin/python` → `python` → `python3`, so `python` on PATH also works if Piper is installed globally. There is no Docker requirement and no Linux-only command in the runtime path. Scripts use `path`/`fs`, so they are cross-platform; the only Windows-specific code is the venv path probe.

---

## 7. Development History & Technical Decisions

### 7.1 Chronology (git log, oldest → newest)

`97bb10f Initial commit` → `c35b991 add quiz, add layout` → `dcc9743 music library` → `e8b6c8a add 3d people` → `94e69f3 check right`.

Most of the recent work (reliability, smart schedule, image library, copyright audit) is **uncommitted** in the working tree — see §8.3.

### 7.2 Major technical decisions and why

| Decision | Reason |
| --- | --- |
| Keep the original **JSON-RPC + WebSocket architecture** and `temple.*` method names | Explicit project constraint: never break existing OBS scenes, RPC clients or the Windows install |
| **Single process**, no build step | Simple Windows operation; OBS points at one origin; `node --check` suffices for syntax checks |
| **Local assets only** (`BroadcastSafety` rejects `http(s)://`) | OBS reliability + commercial-broadcast licensing control |
| **Copyright manifest as the only truth** | Prevents “looks like a stock photo ⇒ must be fine” inference; auditable, per-asset verdicts |
| **Safe Mode ON by default** | A licensing mistake on a commercial livestream is expensive; fail closed |
| **Server-side state authority** | Both the stage and the dashboard are disposable clients; refresh/restart is always safe |
| **Piper via long-lived Python worker** | Model load takes ~12–13 s; restarting per sentence would be unusable |
| **Content-hash TTS cache** | Avoids re-synthesizing repeated greetings/verses; stable URLs for OBS |
| **Two-deck Web Audio crossfade** | No audible gap on track changes; seamless loops for the synthesized tracks |
| **RMS-based silence detection with a 3-report streak** | Prevents false alarms between narration lines and during intentional pauses |
| **`Intl.DateTimeFormat` for timezones** | Correct DST handling without a dependency or hardcoded offsets |
| **Program signature guard** | Prevents the same program being applied/announced twice (a real observed bug class) |
| **Backups on every destructive-ish write** | `backup/`, `docs/backups/`, `*.backup.json`, timestamped manifest archives |

### 7.3 Coding conventions & project rules

- CommonJS (`require`/`module.exports`) on the server; classic scripts in the browser (no ES modules, no bundler).
- Each engine in `lib/` is a class with a small public API, injectable `now`/paths, and no direct HTTP knowledge; `server.js` wires them.
- Manifest/schedule/health writes: temp file + `renameSync` (atomic), plus a `.backup.json` where relevant. The prayer state file is the exception (1 s debounced plain write).
- All user-visible text is **American English** and lives in `config/messages.en.json` where practical.
- IDs: meetings/events use `inc_<ms>_<rand>` / `cue_<ms>_<suffix>`; images use stable `img_<category>_<slug>-<hash8>`.
- No secrets in code; no remote asset URLs at runtime; no fabricated viewer engagement in production paths (`simulated: true` marks test events).
- Never claim a test passed unless executed; never claim a file exists without checking.

### 7.4 Known issues, gaps and unresolved questions

1. **No authentication on the admin dashboard, `/rpc`, `/api/*` or `/ws`.** Any device that can reach the port can control the broadcast (including `copyright.setSafeMode`, `images.scan`, `music.track.remove`, `live.connect`). `server.listen(PORT)` binds all interfaces. This is the highest-priority hardening item.
2. **15 broadcast images are `NEEDS_REVIEW`** — all CC BY-SA 3.0/4.0 photographs from Wikimedia Commons. Cropping to 9:16 and colour grading may create adapted material; ShareAlike obligations versus a commercial TikTok broadcast are **unresolved** (documented in `COPYRIGHT_AUDIT.md`/manifest `unresolved[]`). Safe Mode currently blocks them, so the stage runs on 19 verified images.
3. **CC BY attribution** is required for the eligible stock images; the stage shows `title — license · attribution` (`#stageCredit`/`#assetCredit`) and the full author/source/license records are in `docs/ASSET_ATTRIBUTION.md`. Whether a brief on-screen credit plus documentation meets each licence’s attribution clause is a policy decision, not something the code can prove.
4. **`AI_` images: generator provenance unrecorded.** The manifest says “AI Generated (project original)” with `licenseUrl: ""`. The exact provider/model is **NEEDS VERIFICATION** (a `data/imagegen-test/pollinations-test.jpg` file hints at Pollinations, but no record proves it). If a later licensing question arises, this needs a documented generation record.
5. **Image categories `church` and `jesus` have no AI-generated images** (0 of 10 AI files). An earlier generation attempt for those categories did not produce usable files.
6. **No automated “no text in image” check.** The requirement is satisfied by the generated/stock assets, but nothing enforces it for future additions.
7. **Overlay images are outside the image scanner.** They exist in both manifests but `images.scan` only walks the 7 category folders.
8. **TikTok leave events do not exist**; departures are inferred from inactivity. Do not fabricate leaves.
9. **Real gift handling after a reconnect** — the old connection is disposed and no event history is replayed by the connector, but there is no explicit timestamp filter; real-LIVE verification of gift combos and gift TTS is **❓**.
10. **Piper synthesis timeouts under load** appear in `logs/server.log`; narration is skipped rather than retried for that line. Acceptable by design, but it can leave a cue silent.
11. **`data/merit-state.json`** (795 KB) is legacy and never loaded (`loadState()` only logs its presence). It can stay as rollback data; deleting it would only remove that log line.
12. **`config/voices.json`** is an empty legacy file; voice discovery ignores it.
13. **No unit-test runner/framework** — the two scripts are bespoke `check()` harnesses that need a running server.
14. **`.gitignore` currently ignores `.env.example`**, so the documented template is not tracked. `backup/` is ignored too.

---

## 8. Current Development Status

### 8.1 Completed

Everything in §4 marked ✅ — i.e. the full conversion, stage redesign, music system (21 tracks + rescan), interactive show (welcome/verses/prayers/quiz/gifts/prayer wall), congregation, copyright audit + safe mode, image-library auto-scan, smart US-timezone schedule, and the health/auto-recovery subsystem.

### 8.2 In progress / partially done

- Licensing clearance for the 15 CC BY-SA images (§7.4 item 2).
- AI artwork for `church` and `jesus` categories.
- Real-LIVE verification of joins/comments/gifts after the latest changes.

### 8.3 Working tree state (at time of writing)

`git status` shows the current branch `main` with **modified**: `README.md`, `config/copyright-manifest.json` (+ backup), `config/messages.en.json`, `data/prayer-state.json`, `docs/ASSET_ATTRIBUTION.md`, `docs/COPYRIGHT_AUDIT.md`, `lib/copyright-audit.js`, `lib/show.js`, `public/admin.html`, `public/assets/christian/asset-manifest.json`, `public/copyright-audit.json`, `public/css/admin.css`, `public/index.html`, `public/js/admin.js`, `public/js/audio.js`, `public/js/live.js`, `scripts/smoke-test.js`, `server.js`;
**untracked**: `config/schedule.json`, `config/schedule.backup.json`, `lib/health.js`, `lib/image-library.js`, `lib/music-integrity.js`, `lib/schedule.js`, `scripts/test-reliability.js`, `data/health-state.json`, `data/image-library-state.json`, `public/assets/christian/asset-manifest.backup.json`, `docs/screenshots/admin-smart-schedule.png`, `docs/screenshots/admin-system-health.png`.

Nothing has been committed for the reliability/schedule/image-library work. Do not discard these files.

### 8.4 Runtime status

- **No listener on port 3000 at analysis time.** `logs/server.pid` exists (stale), `logs/server.log` ends with a TikTok reconnect after several disconnects and “Narration skipped / Piper synthesis timed out” lines.
- Last successful startup log showed: TikTok connected to `@tinytails99`, Piper ready in ~12.9 s with 18 voices, automated program started.
- Starting the server is a **one-command** operation (§6.4) and does not require a rebuild.

### 8.5 Blockers

- No live TikTok session is available to this environment, so real-event verification cannot be completed here.
- Every admin control is reachable without credentials; that is a **security gap** to fix, not an environment blocker (the dashboard is currently only usable locally/LAN).
- Legal judgement on ShareAlike is outside code scope.

### 8.6 Recommended next steps (priority order)

1. **Add admin authentication** (and ideally bind to loopback or a trusted reverse proxy) before exposing this host beyond the LAN. Keep the stage public; protect `/admin`, mutating RPCs and `/ws` control methods.
2. Resolve the 15 CC BY-SA images: either obtain a legal opinion and document the decision, or replace them with CC0/AI images, then set their status deliberately in the manifest (never by filename).
3. Generate 5–10 original images each for `church/` and `jesus/` using the `AI_` naming rule, then run `images.scan`.
4. Verify a real LIVE session: join, comment `AMEN`/`PRAY`, like, follow, share, gift, then disconnect/reconnect and confirm no duplicate listeners or replayed gifts.
5. Add lightweight ops: prevent `.env.example` from being ignored, commit the untracked reliability/schedule files, and (optionally) add a tiny test runner that starts its own server on a spare port so tests stop mutating production state.
6. Consider an OCR check on scanned images to enforce the “no text baked into images” rule automatically.

---

## 9. Important Files (read before changing anything)

| Priority | File | Why it matters |
| --- | --- | --- |
| 1 | `server.js` | Everything routes through it: RPC dispatcher, state, TTS manager, TikTok connector, schedule application, health wiring, HTTP/WS surface. Headings: §1 brand, §2 Piper manager, §3 background catalog, §3b music catalog, §4 state, §5 sanitizers, §6 community, §7 prayer queue, §8 rituals, §9 settings/rotation, §10 show, §10b quiz/gifts/scene, §10c schedule, §10 (mis-numbered) comments/commands, §11 connector, §12 demo simulation, §13 dispatcher, §14 Express/WS |
| 2 | `lib/broadcast-safety.js` | The single copyright gate. Change it and you change what can go on air |
| 3 | `config/copyright-manifest.json` | Licensing truth; hand-editing is dangerous — regenerate with `copyright.scan` |
| 4 | `lib/image-library.js` | Image scan/sync rules, `AI_` policy, manifest stability, backups |
| 5 | `lib/schedule.js` + `config/schedule.json` | Timezone math, override, transition guards |
| 6 | `lib/health.js` | Thresholds, incident logging, recovery counters, diagnostics export |
| 7 | `tts_worker.py` | Piper protocol, caching, WAV output, error semantics |
| 8 | `public/js/live.js` | Stage rendering; must stay resilient to unknown notifications and missing assets |
| 9 | `public/js/audio.js` | Music decks, ducking, TTS queue; the most timing-sensitive client code |
| 10 | `public/js/admin.js` + `public/admin.html` | All dashboard controls; every new RPC should get a UI |
| 11 | `lib/show.js`, `lib/quiz.js` | Program sequence, prayer/verse pools, quiz correctness |
| 12 | `lib/copyright-audit.js` | Licence evidence, report generation, attribution |
| 13 | `lib/music-library.js`, `lib/music-integrity.js` | Music manifest safety and rescan |
| 14 | `public/assets/christian/asset-manifest.json`, `audio/music-manifest.json` | Registries the runtime loads |
| 15 | `README.md` | Operator-facing truth for setup/OBS/admin usage (671 lines) |
| 16 | `scripts/smoke-test.js`, `scripts/test-reliability.js` | Regression safety net |
| 17 | `docs/COPYRIGHT_AUDIT.md`, `docs/ASSET_ATTRIBUTION.md`, `docs/music-sources.md` | Compliance paperwork |

---

## 10. AI Handoff Instructions

### 10.1 Read in this order

1. This document (§1–§5) for the mental model.
2. `README.md` for operator/UI details (it is accurate and detailed).
3. `server.js` top 80 lines → the RPC dispatcher (`handleRpcCall`) → the section relevant to your task.
4. `lib/broadcast-safety.js` before touching any asset, and `lib/image-library.js` before touching images.
5. `public/js/live.js` / `public/js/admin.js` only for the feature you are changing (each is ~1 800–3 000 lines).

### 10.2 How to work safely here

- **Verify before claiming.** Run `node --check` on edited server files; start the server; exercise the RPC you touched; check `/ws` notifications. Both test suites require a running server and mutate state — run them against a **separate instance** (`PORT=3120 bun run server.js`) and restore `data/prayer-state.json` afterwards.
- **Never edit `data/*.json` or the manifests by hand** to make something look right. Use the RPCs/scanners so backups and derived reports stay in sync.
- **Never upgrade a licence status** based on filename, folder, or “it’s probably fine”. Only `AI_` prefixed files receive the automatic VERIFIED path, and only via the scanner.
- **Respect the asset pipeline:** new images go into one of the seven `public/assets/christian/<category>/` folders, then `images.scan`; new music into `public/assets/christian/audio/`, then `music.rescan`.
- **Keep `temple.*` names and payload shapes** (including legacy counter aliases) unless you are certain nothing consumes them.
- **Preserve atomic writes + backups** for manifests, schedule and health state (the prayer state file uses a debounced write by design).
- **Don’t stop or restart a running broadcast server** to deploy a change unless explicitly asked; prefer testing on another port.
- **No fabricated events.** Demo paths must stay clearly labelled (`simulated: true`, demo participants) and off by default.
- Windows compatibility: use `path.join`, `fs`, and Node/Bun APIs; no shell pipelines in application code.

### 10.3 Parts that should not be modified unnecessarily

- `tts_worker.py` protocol and the TTS manager contract (restart/backoff/cache) — narration stability depends on it.
- `BroadcastSafety` decision order and the manifest schema — every consumer assumes them.
- `ShowProgram` sequence semantics and cue shape (`show.cue`) — the stage renders these directly.
- WebSocket notification names and `state.get`/`temple.state` shapes — OBS clients and tests depend on them.
- `config/piper/*` voice models and their `.onnx.json` sidecars.
- `docs/backups/**` and `backup/**` (rollback material).

### 10.4 Warnings

- **Security:** the admin surface is unauthenticated and bound to all interfaces. Do not assume “localhost only”.
- **Legal:** do not describe the project as “legally cleared”. 15 images are explicitly unresolved; CC BY-SA ShareAlike in a commercial livestream has not been adjudicated.
- **Copyright manifest counts drift:** the audit regenerates `counts` on every scan; compare against disk, not memory.
- **Test side effects:** `smoke-test.js` ends by clearing/re-seeding the prayer wall and resetting TTS volumes; `test-reliability.js` records health incidents.
- **Stale PIDs:** `logs/server.pid` may reference a dead process; check the listener before killing anything, and never kill by process-name pattern.
- **`.env` is secret-bearing and git-ignored**; do not print, copy, or commit its values.

---

## Appendix A — Verified inventory snapshot (2026-11-01)

**Images (31 files, 7 categories; 34 manifest entries including 3 overlays)**

| Category | Files | AI-generated |
| --- | --- | --- |
| backgrounds | 5 | 2 |
| bible | 4 | 2 |
| candles | 6 | 2 |
| cathedral | 4 | 2 |
| church | 4 | 0 |
| cross | 6 | 2 |
| jesus | 2 | 0 |
| overlays (registered, not scanned) | 3 | 0 |
| **Total** | **34** | **10** |

**Music (21 files on disk)**

- 3 original CC0 Ogg/Opus (synthesized by `scripts/generate_music.py`).
- 18 Mixkit MP3 (Mixkit Stock Music Free License, no attribution required, no redistribution as standalone files).
- Manifest: 21 tracks, 18 enabled, 3 disabled (`Rest Now`, `Tears of Joy`, `Skyline`).
- 2 tracks removed on request (`Quiet Hour`, `Cathedral Light`) are archived under `docs/backups/music-removed/`, not deleted.

**Copyright ledger totals** — 104 assets: music 23 (21 active, 18 enabled, 2 archived) · images 81 (34 broadcast, 12 legacy, 35 documentation).
Statuses: **VERIFIED 42 · NEEDS_REVIEW 46 · REJECTED 0 · UNKNOWN 16**.
Broadcast-scoped only: **19 images VERIFIED · 15 images NEEDS_REVIEW · 21 music tracks VERIFIED** ⇒ **40 assets currently eligible for the live broadcast** (19 images + 21 tracks) when Safe Mode is ON.

**Content inventory** — 150 quiz questions · 20 Bible verses with reflections · 8 prayer themes · 12 show segments · 4 schedule programs · 7 US timezones · 18 Piper voices (3 en, 15 vi) · 27 WebSocket notification types (`quiz.{start,reveal,end,correct}` included) · 94 RPC method cases.

**Runtime** — Bun 1.4.4 · Node 20.18.3 · Python 3.12.2 · port 3000 · OBS URL `http://localhost:3000/?obs=1` · admin `http://localhost:3000/admin`.

## Appendix B — Test suites (as written, not re-run today)

| Suite | Command | Assertion sites | Historical result |
| --- | --- | --- | --- |
| Smoke (HTTP/RPC/WS/stage) | `node scripts/smoke-test.js` (env `BASE_URL`) | 159 `check()` calls | 166/166 PASS on the previous run |
| Reliability (schedule/health/integrity/audio) | `node scripts/test-reliability.js` | 72 `check()` calls | 77/77 PASS on the previous run |

Both require a listening server and mutate its state. Until they are run again on the current tree, treat their status as **NEEDS VERIFICATION**.

## Appendix C — Glossary of project-specific terms

- **Cue** — a display object pushed as `show.cue` (kind, title, body, reference, `displayMs`, optional `ttsText`).
- **Program** — a scheduled daypart (`morning`, `afternoon`, `evening`, `night`) with content settings.
- **Override** — a timed manual program selection that auto-reverts.
- **Safe Mode** — the copyright gate state (`state.settings.copyrightSafeMode`, default ON).
- **Eligible** — asset may be selected while Safe Mode is ON (manifest VERIFIED + broadcast + permissions + file present).
- **Blocked** — failed the gate; the admin panel shows the exact reason.
- **Congregation participant** — a real TikTok member seated in the cathedral scene; demo participants are separate.
- **Segment** — one step of the 12-part show loop.
- **Tier** — gift size bucket (`small`/`medium`/`large` by coin value).
