# ✝ CHRISTIAN PRAYER LIVE

**FAITH • HOPE • LOVE**

> *"Pray Together. Grow in Faith."*

A peaceful, interactive **9:16 vertical livestream prayer room** for TikTok Live, built for viewers in the United States. The project keeps the original Bun.js + JSON-RPC 2.0 + WebSocket + OBS architecture and the working Windows/Piper installation, while replacing the Buddhist temple experience with a general Christian prayer community.

The room is intentionally **general Christian** — welcoming to viewers across traditions. It focuses on Jesus Christ, prayer, hope, love, forgiveness, gratitude, grace, Scripture-inspired encouragement and peace.

![Christian Prayer Live cathedral OBS stage](docs/screenshots/cathedral-stage-final.jpg)

---

## What is included

| Area | Implementation |
| --- | --- |
| Brand | Christian Prayer Live, deep navy / warm gold / ivory palette |
| Layout | 1080×1920 (9:16), auto-scaled for OBS browser source and desktop preview |
| Live connection | TikTok Live Connector: comments, likes, follows, shares, gifts |
| API | JSON-RPC 2.0 over HTTP (`/rpc`) and WebSocket (`/ws`) |
| Narration | Local Piper worker, American English + Vietnamese voices |
| Prayer requests | Moderated queue with approve / hide / remove / pause / clear |
| Backgrounds | 21 locally served licensed photographs + automatic fade rotation |
| Default scene | Licensed Gothic cathedral Mass with altar crucifix and praying congregation |
| Admin | English dashboard for connection, prayer queue, voices, backgrounds, messages |
| Compatibility | Original `temple.*` RPC methods and OBS URL preserved |

### Stage

- Full-frame cathedral scene: high Gothic arches, stained glass, altar crucifix and a gathered congregation.
- Warm golden grade, soft light aura, drifting particles and a gentle vignette.
- No floating hero cross and no baked-in text; the photograph itself is the main subject.
- Compact prayer request and “Verse of the Moment” cards above the lower panels.
- **Live Comments** and **Community Activity** in a single translucent bottom card.
- Counter strip for prayers, candles, amens, followers and gifts.
- Event overlays: AMEN, prayer invitation, gratitude, welcome and tiered gift celebrations.
- Optional quick-controls dock on desktop; `?obs=1` hides it for a clean broadcast.
- Small on-stream photo credit for CC BY / CC BY-SA backgrounds.

![Ministry dashboard](docs/screenshots/admin-dashboard.png)

---

## Windows quick start

The project is designed for the existing XAMPP-style Windows folder and the local `.venv`.

```bat
cd /d "C:\xampp\htdocs\ai\fbpage\banhang\tiktok y tuong marketing\1"

REM 1. JavaScript dependencies (only if node_modules is missing)
bun install

REM 2. Python environment (only if .venv is missing)
uv venv .venv
uv pip install --python .venv\Scripts\python.exe piper-tts pillow

REM 3. Start the app
bun run start
```

Open:

- **Livestream stage:** <http://localhost:3000>
- **OBS browser source:** <http://localhost:3000/?obs=1>
- **Admin dashboard:** <http://localhost:3000/admin>
- **Health check:** <http://localhost:3000/api/health>

The Piper worker is started automatically. The voice models are already installed under `config/piper/en` and `config/piper/vn`; the app does not download models.

> If `bun` is not on the PATH in Command Prompt, run `bun run start` from the Bun shell or add Bun to PATH. On this machine the app was started and tested with Bun 1.4 on Windows.

### OBS setup

1. Add a **Browser** source.
2. URL: `http://localhost:3000/?obs=1`
3. Width `1080`, Height `1920`.
4. Enable **Shutdown source when not visible** only if you also reload it when going live (the page reconnects automatically).
5. Use **Interact** once and press **Enable Audio** if OBS blocks autoplay. This unlocks the generated ambience, chimes and narration for the scene.
6. Keep the admin dashboard in a second browser window, not inside the OBS source.

---

## Connecting TikTok Live

1. Open `/admin`.
2. Enter the TikTok `@username` or a `https://www.tiktok.com/@username/live` link.
3. Press **Connect Live** while the account is actually live.
4. The header badge changes to **CONNECTED** and the room ID / viewer count appear.
5. Press **Disconnect** when the broadcast ends.

Auto-connect only happens when `TIKTOK_USER` (or `tiktok.username` in `config/app.config.json`) is set. It is empty by default so the app never connects to the old Buddhist channel.

No TikTok credentials or cookies are required for public LIVE rooms. A real LIVE session is required to test the event handlers end to end.

---

## Viewer interactions

| Event | On-screen behavior |
| --- | --- |
| Comment `AMEN` | Gold AMEN overlay + soft chime |
| `PRAY` | “Let us pray together.” invitation |
| `JESUS` | Jesus-centered encouragement |
| `FAITH` / `HOPE` / `LOVE` | Short encouragement in that theme |
| `PRAYER` | Invites the viewer to send a prayer request |
| `GOD` | Short inspirational message |
| `THANK YOU` | Gratitude animation and message |
| `PRAY FOR ME`, `PRAYER REQUEST`, `PLEASE PRAY`, `PRAY FOR MY FAMILY` | Creates a moderated prayer request |
| Like | Subtle golden particles over the altar, AMEN counter |
| Follow | “Welcome to our prayer community. God bless you!” |
| Share | “Thank you for sharing faith, hope and love!” |
| Small gift | Prayer candle acknowledgement |
| Medium gift | Warm golden-light and candlelight acknowledgement |
| Large gift | Golden light celebration and community gratitude |

Messages are selected from `config/messages.en.json`; the four most recently used messages in a category are avoided, and command replies are rate limited so narration never turns into spam.

Gifts are **never** presented as purchasing prayers, blessings, healing or salvation. Prayer is always free.

---

## Prayer request moderation

Viewer comments that ask for prayer are cleaned before display:

- Links, email addresses, long digit strings and HTML are removed.
- Profanity and blocked words are filtered.
- Requests are limited to 120 characters by default.
- Each TikTok viewer has a 30-second cooldown.
- Only the first name is shown on the broadcast; the full display name stays in the admin queue.

Admin actions:

- **Approve** a pending request.
- **Hide** it from the broadcast without deleting it.
- **Remove** it permanently.
- **Pause notifications** during a sensitive moment.
- **Clear queue** at the end of a session.
- Turn **auto-approve** on or off (on by default for a smooth live flow).

The pastor/host should still review requests and avoid repeating sensitive details. The app never promises healing, wealth, miracles or supernatural outcomes.

---

## Narration (Piper)

The original `tts_worker.py` was replaced with a language-aware Piper worker. It keeps the long-running process + newline-delimited JSON protocol used by the server.

| Language | Default voice | Other installed voices |
| --- | --- | --- |
| English (en-US) | `en_US-amy-medium` | `en_US-arctic-medium`, `en_US-hfc_female-medium` |
| Vietnamese (vi-VN) | `vi_VN-vais1000-medium` | 13 more Vietnamese voices in `config/piper/vn` |

- English events request `lang: "en"` and always use a US English voice.
- Vietnamese requests use `lang: "vi"`; text passed without a language is auto-detected.
- Models are loaded on demand and cached in the worker (LRU-style, two models kept warm).
- Generated WAV files are cached in `data/tts-cache` by text + voice + rate.
- The browser keeps a single narration queue: speech never overlaps, ambience ducks under speech, and repeated identical lines are suppressed for a short window.
- TTS can be disabled in the admin dashboard or with `TTS_ENABLED=false`.
- **Test English** and **Test Vietnamese** buttons in `/admin` exercise the real worker and play the result.

Piper is the active engine because the Windows checkout already contains the ONNX voice models. ZeroTTS was the previous engine, but this environment has no `zerotts` package and the old worker's local model path pointed to a macOS directory, so there was no working fallback to keep. The original worker remains in `backup/tts_worker.py.bak`.

---

## Backgrounds and licensing

All broadcast images are served locally from `public/assets/christian/`. No remote image is requested during the stream.

```
public/assets/christian/
├── asset-manifest.json
├── cathedral/     2  cathedral Mass / sanctuary service with congregation (default)
├── backgrounds/   3  sunrise / golden sky
├── church/        4  church interiors and naves
├── cross/         4  illuminated altar crosses
├── bible/         2  open Bible and communion table
├── candles/       4  prayer candles
├── jesus/         2  classical Christian artwork (public domain)
└── overlays/      3  generated light rays, gold bokeh, vignette
```

**21 photographs + 3 generated overlays.** Sources are Wikimedia Commons; every file was checked against its machine-readable license before download. Each manifest entry records the original file page, download URL, license, license URL, author/attribution, original dimensions and the local file size.

The default scene is `cathedral/cathedral-01-cathedral-mass.jpg` — a public-domain U.S. Customs and Border Protection photograph of a cathedral Mass, centre-cropped to 1080×1920 and colour-graded. The alternate `cathedral-02-sanctuary-service.jpg` is CC BY-SA 4.0 by Daniel G Rego. Both were cropped and graded from the original photographs; the originals remain available at the source pages in the manifest.

License summary:

| License | Count |
| --- | --- |
| CC BY-SA 3.0 | 9 |
| CC BY-SA 4.0 | 6 |
| CC BY 2.0 | 1 |
| CC BY 3.0 | 1 |
| CC0 / public domain | 7 (including 3 generated overlays) |

CC BY and CC BY-SA require credit and a license reference. The stage shows a small credit line for the current background, and the dashboard shows the full credit. **Keep [`asset-manifest.json`](public/assets/christian/asset-manifest.json) with the project** and include the photographer credits in the video description when required. If you redistribute modified images, follow the share-alike terms of the specific license.

Regenerate the collection (requires internet):

```bat
.venv\Scripts\python.exe scripts\fetch_christian_assets.py
```

The script rejects licenses outside its allowlist, deduplicates by file hash and writes the manifest.

---

## Automatic background rotation

Defaults: enabled, 60 seconds, 1600 ms cross-fade, `cathedral` category, random order. The two cathedral scenes rotate with each other; other Christian categories remain available from the dashboard.

Admin controls:

- Enable / disable rotation.
- Choose a category (`cathedral`, `church`, `cross`, `bible`, `candles`, `jesus`, `backgrounds`, or all).
- Choose a specific image immediately.
- Set the interval (10–3600 seconds via config; 10–300 seconds in the quick dock).
- Toggle random order.
- Preview every local background in a thumbnail grid.
- **Next Image** jumps immediately.

Rotation runs on the server and broadcasts `stage.background`, so every connected stage and OBS source stays in sync. A dark overlay and text shadows keep prayer text readable over bright photography.

---

## Configuration

`config/app.config.json` is the main configuration. Environment variables override it (`.env` is loaded automatically by Bun; `.env.example` lists the supported keys).

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | HTTP/WebSocket port | `3000` |
| `TIKTOK_USER` | Channel to auto-connect | empty |
| `DEFAULT_LANGUAGE` | Default narration language | `en` |
| `DEFAULT_EN_VOICE` | English Piper voice id | `en_US-amy-medium` |
| `DEFAULT_VN_VOICE` | Vietnamese Piper voice id | `vi_VN-vais1000-medium` |
| `TTS_ENABLED` | Enable spoken narration | `true` |
| `TTS_VOLUME` / `TTS_RATE` | Default volume / speed | `0.95` / `1.0` |
| `CHRISTIAN_THEME` | Brand theme marker | `christian` |
| `BACKGROUND_ROTATION` | Auto-rotate backgrounds | `true` |
| `BACKGROUND_ROTATION_INTERVAL` | Seconds between backgrounds | `60` |
| `BACKGROUND_CATEGORY` | Initial category | `all` |
| `PRAYER_AUTO_APPROVE` | Publish new requests immediately | `true` |

Settings changed in the dashboard are persisted in `data/prayer-state.json` and take precedence for the current installation. The legacy `data/merit-state.json` is still read as a migration fallback.

---

## API compatibility

All original RPC method names still work. User-facing labels changed; endpoint names did not.

| Group | Methods |
| --- | --- |
| State | `temple.getState`, `state.get`, `church.getState`, `prayer.getState` |
| Legacy rituals | `temple.burnIncense`, `temple.strikeWoodenFish`, `temple.ringBell`, `temple.sendPrayer`, `temple.offerGift`, `temple.drawFortune`, `temple.grandCeremony` |
| Settings | `temple.updateSettings`, `temple.resetMerit` |
| Chat | `temple.comment` |
| Narration | `temple.speak`, `temple.ttsStatus`, `tts.status`, `tts.voices`, `tts.test` |
| Prayer | `prayer.list`, `prayer.add`, `prayer.approve`, `prayer.hide`, `prayer.remove`, `prayer.clear`, `prayer.setPaused`, `prayer.setAutoApprove` |
| Backgrounds | `stage.listBackgrounds`, `stage.setBackground`, `stage.nextBackground`, `stage.updateBackgroundSettings` |
| Messages | `messages.get`, `messages.save` |
| TikTok | `live.connect`, `live.disconnect`, `live.status`, `live.setAutoSim` |
| Settings / health | `settings.get`, `settings.update`, `health.check` |

Internal ritual names (`burnIncense`, `strikeWoodenFish`, `drawFortune`) are retained only for wire compatibility. Every label, message and visual shown to viewers is Christian.

WebSocket notifications include `temple.state`, `temple.event`, `prayer.request`, `prayer.state`, `prayer.hide`, `live.chat`, `stage.background`, `tts.play`, `tts.status` and `temple.viewerCount`.

Legacy state fields (`totalIncense`, `woodenFishHits`, `fortuneCount`, `offerings.lotus`, …) are still present alongside the new Christian counters.

---

## Project structure

```
server.js                  Bun/Express HTTP + WebSocket + TikTok + RPC + rotation
tts_worker.py              Piper multilingual worker (stdin/stdout JSON lines)
config/
  app.config.json          Brand, TTS, backgrounds, moderation, gift tiers
  messages.en.json         Editable English message library + verified verses
  piper/en|vn/             Installed Piper voices (untouched)
lib/
  messages.js              Non-repeating message selection
  voices.js                Voice discovery + defaults
public/
  index.html               Livestream stage
  admin.html               Ministry dashboard
  css/live.css, admin.css
  js/live.js               Stage state, overlays, comments, rotation
  js/audio.js              Ambience, chimes, narration queue
  js/particles.js          Canvas light particles
  js/admin.js              Dashboard controls
  assets/christian/        Local imagery + manifest
data/
  prayer-state.json        Persisted state
  tts-cache/               Generated WAV narration (gitignored)
scripts/
  smoke-test.js            API / WebSocket / TTS smoke test
  fetch_christian_assets.py  Licensed image fetcher
backup/                    Pre-conversion copies of modified files
```

---

## Testing

Run against a live server:

```bat
node scripts\smoke-test.js
```

Last run on this machine: **51/51 checks passed**, including:

- Bun server startup, health endpoint and brand payload.
- `temple.getState` compatibility and new counters.
- Background catalog (21 images, all 7 categories including the new cathedral category), local asset serving, manual change.
- Prayer queue add / display / first-name privacy / pause / hide / remove.
- AMEN and PRAY comment commands, prayer-request detection and sanitization.
- English Piper synthesis (`en_US-amy-medium`) and WAV serving.
- Vietnamese Piper synthesis (`vi_VN-vais1000-medium`).
- Narration cache hit.
- English/Vietnamese voice discovery (3 EN, 14 VI).
- Settings update, editable message library, tiered gift messages, Bible references.
- All static pages/assets.
- WebSocket JSON-RPC result plus `prayer.request`, `temple.event`, `temple.state` notifications.
- TikTok connector initialization and graceful failure for a non-live handle (`Failed to retrieve Room ID from all sources.`) without crashing; `live.disconnect` clears the stale channel/error state.
- Browser rendering at 1080×1920 in headless Chromium, cathedral scene, background rotation within the cathedral category, AMEN overlay, prayer card, live comments/community, photo credit, footer placement and the admin dashboard.
- The final 1080×1920 capture is [cathedral-stage-final.jpg](docs/screenshots/cathedral-stage-final.jpg).
- Browser console had no JavaScript errors after a fresh OBS-mode reload.

Not tested here:

- A real TikTok LIVE room (no live account/session was available). Connector wiring, event names and payload extraction were reviewed, but comment/like/follow/share/gift events were not observed from TikTok itself.
- OBS Studio capture, audio autoplay policy and CEF performance (the page was verified in Chromium at the OBS aspect ratio, not inside OBS).
- Long-duration livestream stability/CPU over several hours.

The app starts cleanly and does not require a TikTok connection to render the stage or serve the dashboard.

---

## Operational notes

- Port `3000` is shared by the stage, admin and WebSocket. Change `PORT` if it is already in use.
- `backup/` contains the pre-conversion versions of the modified files.
- TTS cache and generated WAV files can be cleared safely; they are recreated on demand.
- `data/prayer-state.json` is the live state. Delete it to reset counters and the demo prayer queue.
- Demo activity is off by default. The **Simulate viewers** switch on the dashboard generates sample events for layout testing only.
- The stage reconnects its WebSocket automatically if the server restarts.
