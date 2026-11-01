/**
 * CHRISTIAN PRAYER LIVE
 * Faith • Hope • Love — "Pray Together. Grow in Faith."
 *
 * Bun.js HTTP + WebSocket JSON-RPC 2.0 server, preserving the original
 * TikTok Live RPC architecture (same endpoints, same event pipeline) while
 * serving a general Christian prayer livestream for the United States market.
 *
 * Engines:
 *  - TikTok Live Connector (comments, likes, follows, shares, gifts)
 *  - Piper multilingual TTS (American English + Vietnamese)
 *  - Local licensed background imagery with scheduled rotation
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const { loadConfig, loadMessages } = require('./config/config');
const { MessageLibrary } = require('./lib/messages');
const { discoverVoices, resolveVoice, defaultVoiceId } = require('./lib/voices');
const { ShowProgram, PRAYER_THEMES } = require('./lib/show');
const { QuizEngine, QUESTIONS: QUIZ_QUESTIONS } = require('./lib/quiz');
const { MusicLibrary } = require('./lib/music-library');
const { Congregation } = require('./lib/congregation');

const CONFIG = loadConfig();
const PORT = CONFIG.port || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts-cache');
const STATE_FILE = path.join(DATA_DIR, 'prayer-state.json');
const LEGACY_STATE_FILE = path.join(DATA_DIR, 'merit-state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHRISTIAN_ASSETS_DIR = path.join(PUBLIC_DIR, 'assets', 'christian');
const ASSET_MANIFEST_FILE = path.join(CHRISTIAN_ASSETS_DIR, 'asset-manifest.json');

fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });

const messageLibrary = new MessageLibrary();
const VOICES = discoverVoices();

// ============================================================================
// 1. BRAND & IMMUTABLE CONFIG EXPOSED TO CLIENTS
// ============================================================================
const BRAND = {
  name: 'CHRISTIAN PRAYER LIVE',
  tagline: 'FAITH • HOPE • LOVE',
  secondaryTagline: 'Pray Together. Grow in Faith.',
  market: 'United States',
  tradition: 'General Christian'
};

// ============================================================================
// 2. PIPER TTS WORKER MANAGER (LANGUAGE AWARE: EN-US + VI-VN)
// ============================================================================
let ttsManager = null;
let showProgram = null;
let quizEngine = null;
// Set while a show narration is playing so two prayers never talk over each other.
let narrationBusyUntil = 0;
// Last cue of any kind (welcome included), replayed to a stage that reconnects.
let lastPublishedCue = null;
let lastPublishedAt = 0;

class PiperManager {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.status = 'starting';
    this.voices = VOICES;
    this.defaults = {
      en: defaultVoiceId(VOICES, CONFIG, 'en'),
      vi: defaultVoiceId(VOICES, CONFIG, 'vi')
    };
    this.pending = new Map();
    this.inflight = new Map();
    this.reqCounter = 0;
    this.buffer = '';
    this.error = null;
    this.loadSec = null;
    this.startWorker();
  }

  resolvePythonBin() {
    const candidates = [
      path.join(__dirname, '.venv', 'Scripts', 'python.exe'),
      path.join(__dirname, '.venv', 'bin', 'python'),
      'python',
      'python3'
    ];
    for (const candidate of candidates) {
      if (candidate.includes(path.sep) || candidate.includes('/')) {
        if (fs.existsSync(candidate)) return candidate;
      } else {
        return candidate;
      }
    }
    return 'python';
  }

  startWorker() {
    const pyBin = this.resolvePythonBin();
    const scriptPath = path.join(__dirname, 'tts_worker.py');
    console.log(`[Piper] Starting TTS worker: ${pyBin}`);
    this.status = 'loading';
    this.error = null;

    try {
      this.proc = spawn(pyBin, [scriptPath], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      console.error('[Piper] Could not spawn worker:', err.message);
      return;
    }

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleWorkerLine(line.trim());
      }
    });

    this.proc.stderr.on('data', (chunk) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) console.log(`[Piper] ${msg}`);
    });

    this.proc.on('error', (err) => {
      this.status = 'error';
      this.ready = false;
      this.error = `Piper worker failed: ${err.message}. Install it with: uv venv .venv && uv pip install piper-tts`;
      console.error(`[Piper] ${this.error}`);
      broadcastNotification('tts.status', this.getStatus());
    });

    this.proc.on('exit', (code) => {
      this.ready = false;
      this.status = code === 0 ? 'stopped' : 'error';
      if (code !== 0) this.error = `Piper worker exited with code ${code}`;
      console.warn(`[Piper] Worker exited (code ${code})`);
      for (const [, item] of this.pending) {
        clearTimeout(item.timer);
        item.resolve({ ok: false, error: 'Piper worker exited' });
      }
      this.pending.clear();
      broadcastNotification('tts.status', this.getStatus());
    });
  }

  handleWorkerLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      console.log('[Piper stdout]', line);
      return;
    }
    if (msg.type === 'status') {
      this.status = msg.status || 'loading';
      broadcastNotification('tts.status', this.getStatus());
    } else if (msg.type === 'ready') {
      this.ready = true;
      this.status = 'ready';
      this.error = msg.loadError || null;
      this.loadSec = msg.loadSec;
      if (Array.isArray(msg.voices) && msg.voices.length > 0) {
        this.voices = msg.voices;
      }
      if (msg.defaults) this.defaults = { ...this.defaults, ...msg.defaults };
      const labels = this.voices.map((v) => `${v.language}:${v.id}`).join(', ');
      console.log(`[Piper] Ready in ${msg.loadSec}s — voices: ${labels}`);
      broadcastNotification('tts.status', this.getStatus());
    } else if (msg.type === 'result' && msg.id != null) {
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);
        entry.resolve(msg);
      }
    } else if (msg.type === 'error') {
      this.error = msg.error || 'Unknown Piper error';
      if (msg.fatal) this.status = 'error';
      console.error('[Piper]', this.error);
      broadcastNotification('tts.status', this.getStatus());
    }
  }

  resolveVoiceFor(language, requested) {
    const voice = resolveVoice(this.voices, language, requested);
    return voice ? voice.id : null;
  }

  getStatus() {
    return {
      ready: this.ready,
      status: this.status,
      engine: 'Piper (local ONNX)',
      language: state.settings.ttsLanguage || CONFIG.language.default,
      voices: this.voices,
      enVoice: state.settings.enVoice,
      vnVoice: state.settings.vnVoice,
      languageVoices: {
        en: this.voices.filter((v) => v.language === 'en'),
        vi: this.voices.filter((v) => v.language === 'vi')
      },
      enabled: Boolean(state.settings.ttsEnabled),
      volume: state.settings.ttsVolume,
      rate: state.settings.ttsRate,
      loadSec: this.loadSec,
      error: this.error
    };
  }

  synthesize(text, options = {}) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return Promise.resolve({ ok: false, error: 'Empty text' });
    const language = options.lang === 'vi' ? 'vi' : options.lang === 'en' ? 'en' : detectLanguage(cleanText);
    const configuredVoice = language === 'vi' ? state.settings.vnVoice : state.settings.enVoice;
    const voice = this.resolveVoiceFor(language, options.voice || configuredVoice);
    if (!voice) {
      return Promise.resolve({ ok: false, error: `No ${language} Piper voice is installed` });
    }
    const rate = clampNumber(options.rate ?? state.settings.ttsRate, 0.6, 1.6, 1.0);
    const dedupKey = `${voice}::${rate.toFixed(2)}::${cleanText}`;
    if (this.inflight.has(dedupKey)) return this.inflight.get(dedupKey);

    const promise = new Promise((resolve) => {
      if (!this.proc || !this.ready) {
        return resolve({
          ok: false,
          error: this.status === 'error'
            ? this.error || 'Piper is not available'
            : `Piper is ${this.status}. Please wait a moment and try again.`
        });
      }
      const id = ++this.reqCounter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'Piper synthesis timed out' });
      }, 60000);
      this.pending.set(id, { resolve, timer });
      const payload = JSON.stringify({ id, text: cleanText, lang: language, voice, rate }) + '\n';
      try {
        this.proc.stdin.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, error: `Piper write failed: ${err.message}` });
      }
    }).finally(() => this.inflight.delete(dedupKey));

    this.inflight.set(dedupKey, promise);
    return promise;
  }
}

// ============================================================================
// 3. BACKGROUND IMAGE DISCOVERY (locally served licensed assets only)
// ============================================================================
function loadAssetManifest() {
  try {
    if (!fs.existsSync(ASSET_MANIFEST_FILE)) return new Map();
    const entries = JSON.parse(fs.readFileSync(ASSET_MANIFEST_FILE, 'utf8'));
    const map = new Map();
    for (const entry of entries) {
      map.set(entry.file.replace(/\\/g, '/'), entry);
    }
    return map;
  } catch (err) {
    console.warn('[Assets] Could not read asset-manifest.json:', err.message);
    return new Map();
  }
}

function walkImages(dir, baseDir, results) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'overlays') continue;
      walkImages(full, baseDir, results);
    } else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
      const relative = path.relative(baseDir, full).replace(/\\/g, '/');
      results.push({ full, relative });
    }
  }
}

function loadBackgroundImages() {
  const manifest = loadAssetManifest();
  const found = [];
  walkImages(CHRISTIAN_ASSETS_DIR, CHRISTIAN_ASSETS_DIR, found);
  const images = found.map(({ relative }) => {
    const meta = manifest.get(relative) || {};
    const folder = relative.includes('/') ? relative.split('/')[0] : 'backgrounds';
    return {
      url: `/assets/christian/${relative}`,
      path: relative,
      category: folder,
      title: String(meta.title || path.basename(relative, path.extname(relative)))
        .replace(/\.(jpe?g|png|webp)$/i, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      license: meta.license || 'See asset-manifest.json',
      attribution: meta.attribution || '',
      width: meta.width || null,
      height: meta.height || null
    };
  });
  images.sort((a, b) => a.path.localeCompare(b.path));
  const categories = [...new Set(images.map((img) => img.category))];
  return { images, categories };
}

const BACKGROUNDS = loadBackgroundImages();

// ============================================================================
// 3b. AMBIENT WORSHIP MUSIC CATALOG
// ============================================================================
const MUSIC_DIR = path.join(CHRISTIAN_ASSETS_DIR, 'audio');
const MUSIC_MANIFEST_FILE = path.join(MUSIC_DIR, 'music-manifest.json');

const MUSIC_LIBRARY = new MusicLibrary({
  dir: MUSIC_DIR,
  manifestPath: MUSIC_MANIFEST_FILE,
  backupPath: path.join(MUSIC_DIR, 'music-manifest.backup.json'),
  removedDir: path.join(__dirname, 'docs', 'backups', 'music-removed'),
  publicUrl: '/assets/christian/audio'
});

// Mutated in place by applyMusicCatalog so every reference below stays current.
const MUSIC = {
  tracks: [],
  allTracks: [],
  byId: new Map(),
  libraryById: new Map(),
  manifest: {},
  categories: [],
  defaultVolume: 0.1,
  duckedVolume: 0.035,
  totalDurationSeconds: 0,
  libraryMeta: { total: 0, enabled: 0, disabled: 0, totalDurationSeconds: 0, categories: [] }
};

function applyMusicCatalog(catalog) {
  if (!catalog) return MUSIC;
  MUSIC.tracks = catalog.tracks;
  MUSIC.allTracks = catalog.allTracks;
  MUSIC.byId = catalog.byId;
  MUSIC.libraryById = catalog.libraryById;
  MUSIC.manifest = catalog.manifest;
  MUSIC.categories = catalog.categories;
  MUSIC.defaultVolume = catalog.defaultVolume;
  MUSIC.duckedVolume = catalog.duckedVolume;
  MUSIC.totalDurationSeconds = catalog.totalDurationSeconds;
  MUSIC.libraryMeta = catalog.libraryMeta;
  return MUSIC;
}

applyMusicCatalog(MUSIC_LIBRARY.readCatalog());

const BACKGROUND_LAYER_FILES = ['golden-light-rays.png', 'gold-bokeh-particles.png', 'soft-vignette.png']
  .map((file) => `/assets/christian/overlays/${file}`)
  .filter((url) => fs.existsSync(path.join(PUBLIC_DIR, url.replace('/assets/', 'assets/'))));

// ============================================================================
// 4. STATE
// ============================================================================
function defaultSettings() {
  const firstBackground = BACKGROUNDS.images.find((img) => img.path.includes('cathedral-01'))
    || BACKGROUNDS.images.find((img) => img.category === 'cathedral')
    || BACKGROUNDS.images.find((img) => img.path.includes('church-02'))
    || BACKGROUNDS.images[0];
  return {
    ttsEnabled: CONFIG.tts.enabled,
    ttsLanguage: CONFIG.language.default,
    enVoice: defaultVoiceId(VOICES, CONFIG, 'en'),
    vnVoice: defaultVoiceId(VOICES, CONFIG, 'vi'),
    ttsVolume: CONFIG.tts.volume,
    ttsRate: CONFIG.tts.rate,
    sfxEnabled: true,
    music: {
      enabled: CONFIG.backgroundMusic.enabled,
      volume: CONFIG.backgroundMusic.volume,
      duckVolume: CONFIG.backgroundMusic.duckVolume,
      track: MUSIC.byId.has(CONFIG.backgroundMusic.track)
        ? CONFIG.backgroundMusic.track
        : (MUSIC.tracks[0]?.id || ''),
      autoplay: CONFIG.backgroundMusic.autoplay,
      shuffle: CONFIG.backgroundMusic.shuffle,
      repeat: CONFIG.backgroundMusic.repeat,
      paused: false
    },
    show: {
      enabled: CONFIG.show.enabled,
      paused: CONFIG.show.paused,
      welcomeEnabled: CONFIG.show.welcomeEnabled,
      narration: CONFIG.show.narration,
      theme: CONFIG.show.theme,
      pace: CONFIG.show.pace
    },
    quiz: {
      enabled: CONFIG.quiz.enabled,
      frequencyMinutes: CONFIG.quiz.frequencyMinutes,
      revealSeconds: CONFIG.quiz.revealSeconds,
      tts: CONFIG.quiz.tts
    },
    gifts: {
      announce: CONFIG.gifts.announce,
      tts: CONFIG.gifts.tts
    },
    autoSim: false,
    autoSimIntervalMs: 12000,
    background: {
      enabled: CONFIG.background.rotation,
      intervalSeconds: CONFIG.background.intervalSeconds,
      category: CONFIG.background.category,
      randomize: CONFIG.background.randomize,
      transitionMs: CONFIG.background.transitionMs,
      sceneMatch: CONFIG.background.sceneMatch,
      current: firstBackground ? firstBackground.url : ''
    },
    prayer: {
      autoApprove: CONFIG.prayer.autoApprove,
      paused: CONFIG.prayer.paused,
      maxQueue: CONFIG.prayer.maxQueue,
      cooldownSeconds: CONFIG.prayer.cooldownSeconds,
      interactionEnabled: CONFIG.prayer.interactionEnabled
    },
    congregation: {
      enabled: true,
      showNames: true,
      inactivityMinutes: 20,
      maxVisible: 50
    }
  };
}

const DEFAULT_STATE = {
  candlesLit: 12,
  prayerCount: 0,
  amenCount: 0,
  blessingsCount: 0,
  verseCount: 0,
  giftCount: 0,
  followCount: 0,
  shareCount: 0,
  likeCount: 0,
  totalMerit: 0,
  activeCandles: 6,
  community: {},
  prayerRequests: [],
  featuredVerse: messageLibrary.bibleVerse() || { text: 'The Lord is my shepherd; I shall not want.', reference: 'Psalm 23:1 (KJV)' },
  chatFeed: [],
  recentEvents: [],
  showHistory: [],
  quizRecent: [],
  settings: defaultSettings(),
  tiktok: {
    connected: false,
    connecting: false,
    username: CONFIG.tiktok.username || '',
    roomId: null,
    viewerCount: 0,
    lastError: null
  }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        ...JSON.parse(JSON.stringify(DEFAULT_STATE)),
        ...saved,
        community: saved.community || {},
        prayerRequests: Array.isArray(saved.prayerRequests) ? saved.prayerRequests : [],
        featuredVerse: saved.featuredVerse || DEFAULT_STATE.featuredVerse,
        chatFeed: Array.isArray(saved.chatFeed) ? saved.chatFeed : [],
        recentEvents: Array.isArray(saved.recentEvents) ? saved.recentEvents : [],
        showHistory: Array.isArray(saved.showHistory) ? saved.showHistory : [],
        quizRecent: Array.isArray(saved.quizRecent) ? saved.quizRecent : [],
        settings: {
          ...DEFAULT_STATE.settings,
          ...(saved.settings || {}),
          background: { ...DEFAULT_STATE.settings.background, ...((saved.settings || {}).background || {}) },
          prayer: { ...DEFAULT_STATE.settings.prayer, ...((saved.settings || {}).prayer || {}) },
          music: { ...DEFAULT_STATE.settings.music, ...((saved.settings || {}).music || {}) },
          show: { ...DEFAULT_STATE.settings.show, ...((saved.settings || {}).show || {}) },
          quiz: { ...DEFAULT_STATE.settings.quiz, ...((saved.settings || {}).quiz || {}) },
          gifts: { ...DEFAULT_STATE.settings.gifts, ...((saved.settings || {}).gifts || {}) },
          congregation: { ...DEFAULT_STATE.settings.congregation, ...((saved.settings || {}).congregation || {}) }
        },
        tiktok: { ...DEFAULT_STATE.tiktok }
      };
    }
  } catch (err) {
    console.warn(`[State] Could not read prayer-state.json (${err.message}); using defaults.`);
  }
  if (fs.existsSync(LEGACY_STATE_FILE)) {
    console.log('[State] Legacy merit-state.json found; starting a fresh Christian Prayer Live state (legacy file untouched).');
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

const state = loadState();

// Repair a saved background that no longer exists on disk.
if (BACKGROUNDS.images.length > 0 && !BACKGROUNDS.images.some((img) => img.url === state.settings.background.current)) {
  state.settings.background.current = BACKGROUNDS.images[0].url;
}
if (state.settings.background.category !== 'all' && !BACKGROUNDS.categories.includes(state.settings.background.category)) {
  state.settings.background.category = 'all';
}

// Repair a saved music track that is no longer in the manifest.
if (state.settings.music && !MUSIC.byId.has(state.settings.music.track) && MUSIC.tracks.length > 0) {
  state.settings.music.track = MUSIC.tracks[0].id;
}

// Prayer congregation is live-session state only: nothing is written to disk.
const congregation = new Congregation();
congregation.configure(state.settings.congregation);
state.settings.congregation = { ...congregation.getPayload().settings };
congregation.onChange = (payload, meta) => {
  broadcastNotification('congregation.state', {
    ...payload,
    reason: meta.reason,
    changedId: meta.id || null,
    changedSource: meta.source || null
  });
};

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const payload = {
      candlesLit: state.candlesLit,
      prayerCount: state.prayerCount,
      amenCount: state.amenCount,
      blessingsCount: state.blessingsCount,
      verseCount: state.verseCount,
      giftCount: state.giftCount,
      followCount: state.followCount,
      shareCount: state.shareCount,
      likeCount: state.likeCount,
      totalMerit: state.totalMerit,
      activeCandles: state.activeCandles,
      community: state.community,
      featuredVerse: state.featuredVerse,
      prayerRequests: state.prayerRequests.slice(0, 60),
      chatFeed: state.chatFeed.slice(0, 12),
      recentEvents: state.recentEvents.slice(0, 20),
      showHistory: (state.showHistory || []).slice(0, 20),
      quizRecent: (state.quizRecent || []).slice(0, 50),
      settings: state.settings
    };
    fs.promises.writeFile(STATE_FILE, JSON.stringify(payload, null, 2), 'utf8').catch((err) => {
      console.error('[State] Save failed:', err.message);
    });
  }, 1000);
}

// ============================================================================
// 5. TEXT SANITISERS & HELPERS
// ============================================================================
const WEIRD_SPAM_RE = /[\u{12000}-\u{1254F}\uFDFD\u2800-\u28FF\u2580-\u259F]|[\u0300-\u036F]{3,}/u;
const BRACKET_EMOTE_RE = /\[[^\]]{1,32}\]/g;
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;
const URL_RE = /(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)/gi;
const LONG_DIGITS_RE = /(?:\+?\d[\d\s().-]{5,}\d)/g;
const PROFANITY_RE = /\b(f+u+c+k+|sh[i1]t+|b[i1]tch|c+u+n+t+|a+s+s+h*o*l+e+|d[i1]ck|bastard|whore|slut|porn)\b/i;

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function stripHtml(input) {
  return String(input || '').replace(/<[^>]*>/g, ' ');
}

function baseClean(input, maxLength) {
  let text = String(input || '')
    .normalize('NFKC')
    .normalize('NFC')
    .replace(CONTROL_RE, ' ')
    .replace(BRACKET_EMOTE_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(LONG_DIGITS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

function isBlockedContent(raw) {
  if (!raw) return true;
  const text = String(raw);
  if (WEIRD_SPAM_RE.test(text)) return true;
  if (PROFANITY_RE.test(text)) return true;
  const configured = (CONFIG.moderation && CONFIG.moderation.blockedWords) || [];
  const lowered = text.toLowerCase();
  return configured.some((word) => word && lowered.includes(String(word).toLowerCase()));
}

function sanitizeDisplayName(rawName) {
  const cleaned = baseClean(stripHtml(rawName), 40)
    .replace(/[^\p{L}\p{N}\s._'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 26);
  const letters = cleaned.match(/[\p{L}]/gu) || [];
  if (letters.length < 1 || isBlockedContent(cleaned)) return 'Friend';
  return cleaned;
}

/** Short, privacy-conscious name used on screen ("Sarah J." -> "Sarah"). */
function firstNameForDisplay(name) {
  const cleaned = sanitizeDisplayName(name);
  const first = cleaned.split(/\s+/)[0].replace(/[._-]+$/, '');
  return (first || 'Friend').slice(0, 22);
}

const PRAYER_PREFIX_RE = /^(please\s+)?(pray\s+for(\s+(me|us))?|prayer\s+request(\s+please)?|prayers?\s+please|i\s+need\s+prayer)\b[\s,.:!-]*/i;

function sanitizePrayerText(rawText) {
  let text = baseClean(stripHtml(rawText), 300);
  // Remove only the leading request phrase, so "pray for my family" keeps "my family".
  text = text
    .replace(PRAYER_PREFIX_RE, '')
    .replace(/^(please\s+)?for\s+/i, '')
    .replace(/^(and|please)\s+/i, '')
    .replace(/[,.]?\s*please$/i, '')
    .replace(/([.,!?;:])\1+/g, '$1')
    .replace(/(.)\1{3,}/gi, '$1$1')
    .replace(/@\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.,!?;:\s-]+|[.,!?;:\s-]+$/g, '')
    .trim();
  if (text.length > CONFIG.prayer.maxLength) {
    text = `${text.slice(0, CONFIG.prayer.maxLength).trim()}…`;
  }
  const letters = text.match(/[\p{L}]/gu) || [];
  if (letters.length < 3 || isBlockedContent(text)) return '';
  return text;
}

function detectLanguage(text) {
  if (!text) return CONFIG.language.default;
  if (/[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/u.test(text)) {
    return 'vi';
  }
  return 'en';
}

function shortNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

// ============================================================================
// 6. COMMUNITY + PUBLIC STATE
// ============================================================================
function recordMember(user, uniqueId, avatar, meritDelta = 0, extras = {}) {
  const displayName = sanitizeDisplayName(user || uniqueId);
  const key = String(uniqueId || displayName).slice(0, 40);
  if (!state.community[key]) {
    state.community[key] = {
      name: displayName,
      uniqueId: uniqueId || '',
      avatar: avatar || '',
      merit: 0,
      prayers: 0,
      candles: 0,
      gifts: 0,
      lastWish: '',
      lastSeen: new Date().toISOString()
    };
  }
  const member = state.community[key];
  member.name = displayName;
  if (avatar) member.avatar = avatar;
  member.merit += meritDelta;
  member.prayers += Number(extras.prayers || 0);
  member.candles += Number(extras.candles || 0);
  member.gifts += Number(extras.gifts || 0);
  if (extras.wish) member.lastWish = extras.wish;
  member.lastSeen = new Date().toISOString();
  state.totalMerit += meritDelta;

  const keys = Object.keys(state.community);
  if (keys.length > 600) {
    keys
      .sort((a, b) => (state.community[a].merit || 0) - (state.community[b].merit || 0))
      .slice(0, 100)
      .forEach((stale) => delete state.community[stale]);
  }
  return member;
}

function getLeaderboard(limit = 6) {
  return Object.values(state.community)
    .sort((a, b) => b.merit - a.merit)
    .slice(0, limit)
    .map((member, index) => ({
      rank: index + 1,
      name: member.name,
      uniqueId: member.uniqueId,
      avatar: member.avatar || '',
      merit: member.merit || 0,
      prayers: member.prayers || 0,
      candles: member.candles || 0,
      lastWish: member.lastWish || '',
      // Legacy field kept for existing consumers.
      incense: member.candles || 0
    }));
}

function pushEventLog(event) {
  const entry = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...event
  };
  state.recentEvents.unshift(entry);
  if (state.recentEvents.length > 30) state.recentEvents.length = 30;
  return entry;
}

function publicPrayerRequests() {
  return state.prayerRequests
    .filter((req) => req.status !== 'removed')
    .slice(0, 40)
    .map((req) => ({
      id: req.id,
      name: req.name,
      displayName: req.displayName,
      text: req.text,
      status: req.status,
      source: req.source,
      createdAt: req.createdAt,
      approvedAt: req.approvedAt || null,
      uniqueId: req.uniqueId || ''
    }));
}

function currentPrayer() {
  const visible = state.prayerRequests.filter((req) => req.status === 'approved' && req.displayedAt);
  if (visible.length === 0) return null;
  const latest = visible[0];
  const payload = buildPrayerPayload(latest);
  return {
    id: latest.id,
    name: latest.displayName,
    text: latest.text,
    ask: payload.ask,
    community: payload.community,
    createdAt: latest.displayedAt
  };
}

function chatFeedForClient() {
  return state.chatFeed.slice(0, 8).map((item) => ({
    id: item.id,
    user: item.user,
    text: item.text,
    avatar: item.avatar || '',
    at: item.at
  }));
}

function getPublicState() {
  const leaderboard = getLeaderboard(8);
  return {
    brand: BRAND,
    theme: CONFIG.theme,
    candlesLit: state.candlesLit,
    prayerCount: state.prayerCount,
    amenCount: state.amenCount,
    blessingsCount: state.blessingsCount,
    verseCount: state.verseCount,
    giftCount: state.giftCount,
    followCount: state.followCount,
    shareCount: state.shareCount,
    likeCount: state.likeCount,
    totalMerit: state.totalMerit,
    activeCandles: state.activeCandles,
    communityCount: Object.keys(state.community).length,
    featuredVerse: state.featuredVerse,
    leaderboard,
    prayerRequests: publicPrayerRequests(),
    currentPrayer: currentPrayer(),
    chatFeed: chatFeedForClient(),
    recentEvents: state.recentEvents.slice(0, 12),
    settings: state.settings,
    show: showPayload(),
    quiz: quizPayload(),
    congregation: congregation.getPayload(),
    tiktok: state.tiktok,
    tts: ttsManager ? ttsManager.getStatus() : { ready: false, status: 'starting' },
    backgrounds: {
      current: state.settings.background.current,
      categories: BACKGROUNDS.categories,
      count: BACKGROUNDS.images.length
    },
    // ---- Legacy aliases (unchanged keys for existing RPC/OBS consumers) ----
    totalIncense: state.candlesLit,
    woodenFishHits: state.amenCount,
    bellRings: state.blessingsCount,
    lanternCount: state.prayerCount,
    fortuneCount: state.verseCount,
    activeIncenseSticks: state.activeCandles,
    offerings: {
      candle: state.candlesLit,
      cross: state.blessingsCount,
      bible: state.verseCount,
      celebration: state.giftCount,
      // Legacy keys retained for older consumers.
      lotus: state.candlesLit,
      fruit: state.prayerCount,
      lamp: state.verseCount,
      dragon: state.giftCount
    }
  };
}

// ============================================================================
// 7. PRAYER REQUEST QUEUE
// ============================================================================
const prayerCooldowns = new Map();

function prayerQueueCount() {
  return state.prayerRequests.filter((req) => req.status !== 'removed' && req.status !== 'hidden').length;
}

function trimPrayerQueue() {
  const max = state.settings.prayer.maxQueue || 30;
  if (state.prayerRequests.length > max) {
    state.prayerRequests = state.prayerRequests.slice(0, max);
  }
}

function buildPrayerPayload(request) {
  const vars = {
    name: request.displayName,
    text: request.text ? `“${request.text}”` : 'a personal need'
  };
  const displayPool = messageLibrary.templateList('prayerRequestDisplay');
  const matchingTemplates = displayPool.filter((template) => (
    request.text ? template.includes('{text}') : !template.includes('{text}')
  ));
  const askTemplate = (matchingTemplates.length > 0 ? matchingTemplates : displayPool)[
    Math.floor(Math.random() * (matchingTemplates.length > 0 ? matchingTemplates.length : displayPool.length))
  ];
  const ask = askTemplate
    ? messageLibrary.render(askTemplate, vars)
    : `${request.displayName} is asking for prayers.`;
  const community = messageLibrary.template('prayerRequestCommunity', vars)
    || `Let us keep ${request.displayName} in our prayers.`;
  const ttsText = messageLibrary.template('prayerRequestTts', vars)
    || `${request.displayName} is asking for prayers. Let us keep ${request.displayName} in our prayers.`;
  return { ask, community, ttsText };
}

function displayPrayerRequest(request) {
  if (!request || state.settings.prayer.paused) return null;
  request.status = 'approved';
  request.approvedAt = request.approvedAt || new Date().toISOString();
  request.displayedAt = new Date().toISOString();
  // An approved request places a small prayer symbol above the viewer's seat.
  congregation.markPrayer({
    uniqueId: request.uniqueId,
    // Only a genuine TikTok request may mark a real seat; admin/test entries stay visual-free.
    simulated: request.source !== 'tiktok'
  });

  const payload = buildPrayerPayload(request);
  const event = pushEventLog({
    type: 'sendPrayer',
    kind: 'prayerRequest',
    user: request.name,
    uniqueId: request.uniqueId || '',
    avatar: request.avatar || '',
    wish: request.text,
    prayerText: payload.ask,
    communityText: payload.community,
    simulated: request.source === 'simulation',
    ttsText: state.settings.ttsEnabled ? payload.ttsText.slice(0, 120) : '',
    ttsLang: 'en',
    merit: 2
  });

  saveState();
  broadcastNotification('prayer.request', {
    request: {
      id: request.id,
      name: request.displayName,
      text: request.text,
      at: request.displayedAt
    },
    ask: payload.ask,
    community: payload.community,
    event,
    state: getPublicState()
  });
  return event;
}

function addPrayerRequest(params = {}) {
  const rawName = params.name || params.user;
  const name = sanitizeDisplayName(rawName);
  const text = sanitizePrayerText(params.text || params.wish || params.prayer || '');
  if (!name && !text) return null;
  if (text && isBlockedContent(text)) return null;

  const uniqueId = String(params.uniqueId || '').slice(0, 60);
  const now = Date.now();
  const source = params.source || 'tiktok';

  if (source === 'tiktok' && uniqueId) {
    const last = prayerCooldowns.get(uniqueId) || 0;
    const cooldownMs = (state.settings.prayer.cooldownSeconds || 30) * 1000;
    if (now - last < cooldownMs) return null;
    prayerCooldowns.set(uniqueId, now);
    if (prayerCooldowns.size > 800) {
      prayerCooldowns.delete(prayerCooldowns.keys().next().value);
    }
  }

  const duplicate = state.prayerRequests.some(
    (req) => req.text && req.text.toLowerCase() === text.toLowerCase()
      && now - new Date(req.createdAt).getTime() < 5 * 60 * 1000
  );
  if (text && duplicate) return null;

  const request = {
    id: `prayer_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    displayName: firstNameForDisplay(name),
    uniqueId,
    avatar: state.settings.prayer.showAvatar ? params.avatar || '' : '',
    text,
    status: state.settings.prayer.autoApprove ? 'approved' : 'pending',
    source,
    createdAt: new Date(now).toISOString(),
    approvedAt: state.settings.prayer.autoApprove ? new Date(now).toISOString() : null,
    displayedAt: null
  };

  state.prayerRequests.unshift(request);
  trimPrayerQueue();
  state.prayerCount += 1;
  recordMember(name, uniqueId, params.avatar, 2, { prayers: 1, wish: text });

  if (request.status === 'approved' && !state.settings.prayer.paused) {
    displayPrayerRequest(request);
  } else {
    saveState();
    broadcastNotification('prayer.state', { requests: publicPrayerRequests(), state: getPublicState() });
  }
  return request;
}

function approvePrayerRequest(id) {
  const request = state.prayerRequests.find((req) => req.id === id);
  if (!request) throw new Error('Prayer request not found');
  request.status = 'pending';
  displayPrayerRequest(request);
  broadcastNotification('prayer.state', { requests: publicPrayerRequests(), state: getPublicState() });
  return { request, state: getPublicState() };
}

function hidePrayerRequest(id) {
  const request = state.prayerRequests.find((req) => req.id === id);
  if (!request) throw new Error('Prayer request not found');
  request.status = 'hidden';
  request.hiddenAt = new Date().toISOString();
  saveState();
  const payload = { requests: publicPrayerRequests(), state: getPublicState() };
  broadcastNotification('prayer.state', payload);
  broadcastNotification('prayer.hide', { id });
  return payload;
}

function removePrayerRequest(id) {
  const before = state.prayerRequests.length;
  state.prayerRequests = state.prayerRequests.filter((req) => req.id !== id);
  saveState();
  const payload = { requests: publicPrayerRequests(), state: getPublicState() };
  broadcastNotification('prayer.state', payload);
  broadcastNotification('prayer.hide', { id });
  return { removed: before !== state.prayerRequests.length, ...payload };
}

function clearPrayerRequests() {
  state.prayerRequests = [];
  state.prayerCount = Math.max(0, state.prayerCount);
  saveState();
  const payload = { requests: [], state: getPublicState() };
  broadcastNotification('prayer.state', payload);
  broadcastNotification('prayer.hide', { id: '*' });
  return payload;
}

// ============================================================================
// 8. INTERACTION RITUALS (legacy RPC names preserved)
// ============================================================================
const Rituals = {
  /** temple.burnIncense -> light prayer candles */
  burnIncense(params = {}) {
    const name = sanitizeDisplayName(params.user);
    const uniqueId = String(params.uniqueId || '');
    const count = clampNumber(params.count, 1, 9, 1);
    const wish = sanitizePrayerText(params.wish || '');
    const merit = count * 3;

    state.candlesLit += count;
    state.activeCandles = Math.min(24, state.activeCandles + count);
    const member = recordMember(name, uniqueId, params.avatar, merit, {
      candles: count,
      wish
    });

    const event = pushEventLog({
      type: 'burnIncense',
      kind: 'candle',
      user: member.name,
      uniqueId: member.uniqueId,
      avatar: member.avatar,
      count,
      merit,
      wish,
      simulated: Boolean(params.simulated),
      message: `${count} prayer ${count === 1 ? 'candle' : 'candles'} lit`,
      ttsText: ''
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  /** temple.strikeWoodenFish -> AMEN pulse (likes) */
  strikeWoodenFish(params = {}) {
    const name = sanitizeDisplayName(params.user);
    const uniqueId = String(params.uniqueId || '');
    const count = clampNumber(params.count, 1, 50, 1);
    const merit = count;

    state.amenCount += count;
    const member = recordMember(name, uniqueId, params.avatar, merit);

    const event = pushEventLog({
      type: 'strikeWoodenFish',
      kind: 'amen',
      user: member.name,
      uniqueId: member.uniqueId,
      avatar: member.avatar,
      count,
      merit,
      simulated: Boolean(params.simulated),
      message: 'Amen',
      ttsText: ''
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  /** temple.ringBell -> blessing / gratitude chime */
  ringBell(params = {}) {
    const name = sanitizeDisplayName(params.user);
    const uniqueId = String(params.uniqueId || '');
    const count = clampNumber(params.count, 1, 9, 1);
    const kind = params.kind || 'blessing';
    const wish = sanitizePrayerText(params.wish || '');
    const merit = count * 5;

    state.blessingsCount += count;
    const member = recordMember(name, uniqueId, params.avatar, merit, { wish });
    const message = params.message || messageLibrary.template('gratitude') || 'Thank you for being here.';

    const event = pushEventLog({
      type: 'ringBell',
      kind,
      user: member.name,
      uniqueId: member.uniqueId,
      avatar: member.avatar,
      count,
      merit,
      wish,
      simulated: Boolean(params.simulated),
      message,
      ttsText: params.readTts && state.settings.ttsEnabled ? message : '',
      ttsLang: 'en'
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  /** temple.sendPrayer -> submit a prayer request */
  sendPrayer(params = {}) {
    const request = addPrayerRequest({
      name: params.user || params.name,
      uniqueId: params.uniqueId,
      avatar: params.avatar,
      text: params.wish || params.text,
      source: params.source || 'rpc'
    });
    if (!request) {
      return { event: null, state: getPublicState(), skipped: true };
    }
    const event = state.recentEvents.find(
      (evt) => evt.kind === 'prayerRequest' && evt.wish === request.text
    ) || pushEventLog({
      type: 'sendPrayer',
      kind: 'prayerRequest',
      user: request.name,
      uniqueId: request.uniqueId,
      avatar: request.avatar,
      wish: request.text,
      prayerText: `${request.displayName} is asking for prayers.`,
      ttsText: '',
      merit: 2
    });
    return { event, request, state: getPublicState() };
  },

  /** temple.offerGift -> Christian tiered gift acknowledgement */
  offerGift(params = {}) {
    const name = sanitizeDisplayName(params.user);
    const uniqueId = String(params.uniqueId || '');
    const coins = clampNumber(params.coins, 1, 1000000, 1);
    const giftName = baseClean(stripHtml(params.giftName), 60) || 'a gift';
    const quantity = clampNumber(params.quantity, 1, 999, 1);
    const giftLabel = quantity > 1 ? `${quantity}x ${giftName}` : giftName;
    const tiers = CONFIG.giftTiers;
    const tier = coins >= tiers.large ? 'large' : coins >= tiers.medium ? 'medium' : 'small';
    const multiplier = tier === 'large' ? 12 : tier === 'medium' ? 6 : 3;
    const merit = Math.max(1, Math.round(coins * multiplier));
    const giftSettings = state.settings.gifts || {};
    const announce = giftSettings.announce !== false;
    const personalThanks = messageLibrary.pickFromList(
      messageLibrary.templateList('giftPersonal'),
      // Drop a trailing period so the thank-you reads as one natural sentence.
      { name: name === 'Friend' ? 'friend' : name.replace(/\.+$/, ''), gift: giftName, quantity }
    );
    const message = personalThanks
      || messageLibrary.template(`giftThanks.${tier}`)
      || 'Thank you for supporting our prayer community.';

    state.giftCount += 1;
    state.candlesLit += tier === 'small' ? 1 : 2;
    state.activeCandles = Math.min(24, state.activeCandles + 1);
    const member = recordMember(name, uniqueId, params.avatar, merit, { gifts: 1 });
    congregation.markGift({
      uniqueId: member.uniqueId,
      giftName,
      simulated: Boolean(params.simulated) || params.source !== 'tiktok'
    });

    const event = pushEventLog({
      type: tier === 'large' ? 'grandCeremony' : 'offerGift',
      kind: 'gift',
      tier,
      user: member.name,
      uniqueId: member.uniqueId,
      avatar: member.avatar,
      giftType: params.giftType || tier,
      giftName: giftLabel,
      giftBaseName: giftName,
      quantity,
      coins,
      merit,
      simulated: Boolean(params.simulated),
      announce,
      message,
      ttsText: announce && state.settings.ttsEnabled && giftSettings.tts !== false ? message : '',
      ttsLang: 'en'
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, tier, state: getPublicState() };
  },

  /** temple.grandCeremony -> large celebration (kept for compatibility) */
  grandCeremony(params = {}) {
    return this.offerGift({
      ...params,
      coins: Math.max(CONFIG.giftTiers.large, Number(params.coins) || CONFIG.giftTiers.large),
      giftName: params.giftName || 'A gift of encouragement'
    });
  },

  /** temple.drawFortune -> Scripture card (verified verses only) */
  drawFortune(params = {}) {
    const name = sanitizeDisplayName(params.user);
    const uniqueId = String(params.uniqueId || '');
    const verse = messageLibrary.bibleVerse();
    if (!verse) throw new Error('No Bible verses configured');
    const merit = 2;

    state.verseCount += 1;
    state.featuredVerse = verse;
    const member = recordMember(name, uniqueId, params.avatar, merit, { wish: verse.reference });
    const ttsText = state.settings.ttsEnabled
      ? `${verse.text} ${verse.reference.replace(/\(KJV\)/i, '').replace(':', ' verse ')}.`
      : '';

    const event = pushEventLog({
      type: 'drawFortune',
      kind: 'verse',
      user: member.name,
      uniqueId: member.uniqueId,
      avatar: member.avatar,
      verse: { text: verse.text, reference: verse.reference },
      // Legacy fortune shape retained so old consumers do not break.
      fortune: {
        number: state.verseCount,
        rank: 'Scripture',
        title: verse.reference,
        poem: verse.text,
        meaning: 'A word of encouragement from Scripture.'
      },
      merit,
      simulated: Boolean(params.simulated),
      message: `${verse.text} — ${verse.reference}`,
      ttsText,
      ttsLang: 'en'
    });

    saveState();
    broadcastNotification('temple.event', { event, state: getPublicState() });
    return { event, state: getPublicState() };
  },

  updateSettings(params = {}) {
    return applySettingsUpdate(params);
  },

  resetMerit() {
    state.candlesLit = 0;
    state.prayerCount = 0;
    state.amenCount = 0;
    state.blessingsCount = 0;
    state.verseCount = 0;
    state.giftCount = 0;
    state.followCount = 0;
    state.shareCount = 0;
    state.likeCount = 0;
    state.totalMerit = 0;
    state.activeCandles = 0;
    state.community = {};
    state.prayerRequests = [];
    state.chatFeed = [];
    state.recentEvents = [];
    saveState();
    broadcastNotification('temple.state', getPublicState());
    return getPublicState();
  }
};

// ============================================================================
// 9. SETTINGS / BACKGROUND ROTATION
// ============================================================================
function musicCatalogPayload() {
  return {
    tracks: MUSIC.tracks,
    library: MUSIC.allTracks,
    settings: state.settings.music,
    meta: MUSIC.libraryMeta
  };
}

/** If the selected track vanished or was disabled, move to the first playable one. */
function repairMusicSelection() {
  const music = state.settings.music;
  if (!music) return false;
  if (MUSIC.tracks.length === 0) {
    if (!music.track) return false;
    music.track = '';
    music.paused = true;
    return true;
  }
  if (MUSIC.byId.has(music.track)) return false;
  music.track = MUSIC.tracks[0].id;
  return true;
}

function musicRescanPayload(result) {
  return {
    ...musicCatalogPayload(),
    scan: {
      found: result.found,
      added: result.addedCount,
      removed: result.removedCount,
      updated: result.updatedCount,
      addedFiles: result.added,
      removedFiles: result.removed,
      updatedFiles: result.updated,
      errors: result.errors,
      scannedAt: result.scannedAt
    }
  };
}

function publishMusicLibrary(payload) {
  broadcastNotification('music.library.updated', payload);
}

function musicOrder() {
  return MUSIC.tracks.map((track) => track.id);
}

function pickAdjacentTrack(direction = 1) {
  const order = musicOrder();
  if (order.length === 0) return null;
  const current = state.settings.music.track;
  if (state.settings.music.shuffle && order.length > 1) {
    const pool = order.filter((id) => id !== current);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const index = order.indexOf(current);
  const next = (index + (direction > 0 ? 1 : -1) + order.length) % order.length;
  return order[next];
}

/** Mutates settings.music from a partial patch; returns true when anything changed. */
function patchMusicSettings(patch = {}) {
  const music = state.settings.music;
  if (!music || !patch || typeof patch !== 'object') return false;
  const before = JSON.stringify(music);

  if (patch.track !== undefined) {
    const id = String(patch.track || '');
    if (id && !MUSIC.byId.has(id)) {
      if (MUSIC.libraryById.has(id)) throw new Error('That track is disabled. Enable it in the music library first.');
      throw new Error(`Unknown music track: ${id}`);
    }
    if (id) {
      music.track = id;
      // Selecting a track is an explicit request to hear it.
      music.paused = false;
      if (!music.enabled) music.enabled = true;
    }
  }
  if (typeof patch.enabled === 'boolean') {
    music.enabled = patch.enabled;
    if (patch.enabled) music.paused = false;
  }
  if (typeof patch.paused === 'boolean') {
    music.paused = patch.paused;
    if (!patch.paused) music.enabled = true;
  }
  if (typeof patch.autoplay === 'boolean') music.autoplay = patch.autoplay;
  if (typeof patch.shuffle === 'boolean') music.shuffle = patch.shuffle;
  if (patch.repeat === 'off' || patch.repeat === 'one' || patch.repeat === 'all') {
    music.repeat = patch.repeat;
  }
  if (patch.volume !== undefined) music.volume = clampNumber(patch.volume, 0, 1, music.volume);
  if (patch.duckVolume !== undefined) {
    music.duckVolume = clampNumber(patch.duckVolume, 0, 0.5, music.duckVolume);
  }
  return JSON.stringify(music) !== before;
}

function applyMusicUpdate(params = {}) {
  patchMusicSettings(params);
  saveState();
  broadcastNotification('music.state', { settings: state.settings.music });
  broadcastNotification('temple.state', getPublicState());
  return musicCatalogPayload();
}

function applySettingsUpdate(params = {}) {
  const settings = state.settings;
  if (typeof params.ttsEnabled === 'boolean') settings.ttsEnabled = params.ttsEnabled;
  if (params.ttsLanguage === 'en' || params.ttsLanguage === 'vi') settings.ttsLanguage = params.ttsLanguage;
  if (typeof params.enVoice === 'string') {
    const voice = resolveVoice(VOICES, 'en', params.enVoice);
    if (voice) settings.enVoice = voice.id;
  }
  if (typeof params.vnVoice === 'string') {
    const voice = resolveVoice(VOICES, 'vi', params.vnVoice);
    if (voice) settings.vnVoice = voice.id;
  }
  if (params.ttsVolume !== undefined) settings.ttsVolume = clampNumber(params.ttsVolume, 0, 1, settings.ttsVolume);
  if (params.ttsRate !== undefined) settings.ttsRate = clampNumber(params.ttsRate, 0.6, 1.6, settings.ttsRate);
  // Background music: current object shape plus the legacy scalar aliases.
  if (params.music && typeof params.music === 'object') patchMusicSettings(params.music);
  if (params.musicVolume !== undefined) patchMusicSettings({ volume: params.musicVolume });
  if (typeof params.bgMusicEnabled === 'boolean') patchMusicSettings({ enabled: params.bgMusicEnabled });
  if (typeof params.sfxEnabled === 'boolean') settings.sfxEnabled = params.sfxEnabled;
  if (typeof params.autoSim === 'boolean') settings.autoSim = params.autoSim;
  if (params.autoSimIntervalMs !== undefined) {
    settings.autoSimIntervalMs = clampNumber(params.autoSimIntervalMs, 3000, 120000, settings.autoSimIntervalMs);
  }

  if (params.background && typeof params.background === 'object') {
    const bg = params.background;
    if (typeof bg.enabled === 'boolean') settings.background.enabled = bg.enabled;
    if (bg.intervalSeconds !== undefined) {
      settings.background.intervalSeconds = clampNumber(bg.intervalSeconds, 10, 3600, settings.background.intervalSeconds);
    }
    if (typeof bg.randomize === 'boolean') settings.background.randomize = bg.randomize;
    if (bg.transitionMs !== undefined) {
      settings.background.transitionMs = clampNumber(bg.transitionMs, 400, 6000, settings.background.transitionMs);
    }
    if (typeof bg.category === 'string') {
      const category = bg.category === 'all' || BACKGROUNDS.categories.includes(bg.category)
        ? bg.category
        : settings.background.category;
      settings.background.category = category;
    }
    if (typeof bg.sceneMatch === 'boolean') settings.background.sceneMatch = bg.sceneMatch;
  }

  if (params.prayer && typeof params.prayer === 'object') {
    if (typeof params.prayer.autoApprove === 'boolean') settings.prayer.autoApprove = params.prayer.autoApprove;
    if (typeof params.prayer.paused === 'boolean') settings.prayer.paused = params.prayer.paused;
    if (typeof params.prayer.interactionEnabled === 'boolean') {
      settings.prayer.interactionEnabled = params.prayer.interactionEnabled;
    }
    if (params.prayer.cooldownSeconds !== undefined) {
      settings.prayer.cooldownSeconds = clampNumber(params.prayer.cooldownSeconds, 5, 600, settings.prayer.cooldownSeconds);
    }
    if (params.prayer.maxQueue !== undefined) {
      settings.prayer.maxQueue = clampNumber(params.prayer.maxQueue, 5, 200, settings.prayer.maxQueue);
      trimPrayerQueue();
    }
  }

  configureAutoSim(settings.autoSim);
  configureBackgroundRotation();
  saveState();
  broadcastNotification('music.state', { settings: settings.music });
  broadcastNotification('temple.state', getPublicState());
  return getPublicState();
}

// ============================================================================
// 10. AUTOMATED LIVE SHOW (welcome, Scripture, prayer, community, gratitude)
// ============================================================================
function showPayload() {
  const status = showProgram ? showProgram.status() : null;
  const history = (state.showHistory || []).slice(0, 12);
  if (!status) {
    return {
      enabled: Boolean(state.settings.show && state.settings.show.enabled),
      paused: Boolean(state.settings.show && state.settings.show.paused),
      welcomeEnabled: Boolean(state.settings.show && state.settings.show.welcomeEnabled),
      narration: Boolean(state.settings.show && state.settings.show.narration),
      theme: (state.settings.show && state.settings.show.theme) || 'auto',
      pace: (state.settings.show && state.settings.show.pace) || 1,
      themes: PRAYER_THEMES.map((theme) => ({ id: theme.id, label: theme.label })),
      history
    };
  }
  return {
    ...status,
    history,
    narrationBusySeconds: Math.max(0, Math.ceil((narrationBusyUntil - Date.now()) / 1000))
  };
}

/** Sends a cue to the OBS stage, then narrates it through the shared TTS queue. */
async function publishShowCue(cue, { source = 'auto' } = {}) {
  if (!cue) return;
  if (cue.verse) state.featuredVerse = cue.verse;
  state.showHistory = [
    {
      id: cue.id,
      kind: cue.kind,
      eyebrow: cue.eyebrow || '',
      title: cue.title || '',
      body: String(cue.body || '').slice(0, 260),
      at: cue.at || new Date().toISOString(),
      source,
      simulated: Boolean(cue.simulated)
    },
    ...(state.showHistory || []).filter((entry) => entry.id !== cue.id)
  ].slice(0, 20);

  lastPublishedCue = cue;
  lastPublishedAt = Date.now();

  // Visual first: the overlay should never wait on speech synthesis.
  broadcastNotification('show.cue', { cue });
  broadcastNotification('show.state', { show: showPayload() });
  applySceneForCue(cue);
  saveState();

  const showSettings = state.settings.show || {};
  if (!state.settings.ttsEnabled || showSettings.narration === false || !cue.ttsText) return;
  if (Date.now() < narrationBusyUntil) {
    console.log('[Show] Narration skipped: previous prayer is still speaking.');
    return;
  }
  try {
    const result = await ttsManager.synthesize(cue.ttsText, { lang: 'en' });
    if (!result.ok) {
      console.warn(`[Show] Narration unavailable: ${result.error}`);
      return;
    }
    const durationSec = Math.max(2, Number(result.durationSec) || 8);
    // Leaves room for the client's fade-out and a natural pause afterwards.
    narrationBusyUntil = Date.now() + durationSec * 1000 + 2200;
    broadcastNotification('tts.play', {
      text: cue.ttsText,
      voice: result.voice,
      language: result.language,
      url: result.url,
      durationSec,
      source: 'show'
    });
  } catch (err) {
    console.warn('[Show] Narration failed:', err.message);
  }
}

function applyShowUpdate(params = {}) {
  const show = state.settings.show;
  if (typeof params.enabled === 'boolean') {
    show.enabled = params.enabled;
    if (params.enabled) show.paused = false;
  }
  if (typeof params.paused === 'boolean') show.paused = params.paused;
  if (typeof params.welcomeEnabled === 'boolean') show.welcomeEnabled = params.welcomeEnabled;
  if (typeof params.narration === 'boolean') show.narration = params.narration;
  if (params.pace !== undefined) show.pace = clampNumber(params.pace, 0.5, 1.5, show.pace);
  if (typeof params.theme === 'string') {
    const valid = params.theme === 'auto' || PRAYER_THEMES.some((theme) => theme.id === params.theme);
    if (valid) show.theme = params.theme;
  }
  showProgram?.sync();
  saveState();
  broadcastNotification('show.state', { show: showPayload() });
  broadcastNotification('temple.state', getPublicState());
  return showPayload();
}

// ============================================================================
// 10b. BIBLE QUIZ, GIFT EXPERIENCE, SCENE MATCHING
// ============================================================================
function quizPayload() {
  if (!quizEngine) {
    return {
      enabled: Boolean(state.settings.quiz && state.settings.quiz.enabled),
      frequencyMinutes: state.settings.quiz?.frequencyMinutes || 10,
      revealSeconds: state.settings.quiz?.revealSeconds || 25,
      tts: state.settings.quiz ? state.settings.quiz.tts !== false : true,
      totalQuestions: QUIZ_QUESTIONS.length,
      active: null
    };
  }
  const payload = quizEngine.status();
  payload.totalQuestions = QUIZ_QUESTIONS.length;
  return payload;
}

async function narrateQuizReveal(payload) {
  const quiz = state.settings.quiz || {};
  if (quiz.tts === false || !state.settings.ttsEnabled) return;
  if (Date.now() < narrationBusyUntil) {
    console.log('[Quiz] Narration skipped: another prayer is still speaking.');
    return;
  }
  const reference = String(payload.reference || '').replace(/\s*\(KJV\)\s*/i, '');
  const text = `The answer is ${payload.answer}. ${payload.explanation} ${reference}.`;
  try {
    const result = await ttsManager.synthesize(text, { lang: 'en' });
    if (!result.ok) {
      console.warn(`[Quiz] Narration unavailable: ${result.error}`);
      return;
    }
    const durationSec = Math.max(2, Number(result.durationSec) || 8);
    narrationBusyUntil = Date.now() + durationSec * 1000 + 2200;
    broadcastNotification('tts.play', {
      text,
      voice: result.voice,
      language: result.language,
      url: result.url,
      durationSec,
      source: 'quiz'
    });
  } catch (err) {
    console.warn('[Quiz] Narration failed:', err.message);
  }
}

function publishQuizEvent(type, payload) {
  broadcastNotification(`quiz.${type}`, { ...payload, quiz: quizPayload() });
  if (type === 'reveal') narrateQuizReveal(payload).catch(() => {});
  saveState();
}

function applyQuizUpdate(params = {}) {
  const quiz = state.settings.quiz;
  if (typeof params.enabled === 'boolean') quiz.enabled = params.enabled;
  if (params.frequencyMinutes !== undefined) {
    quiz.frequencyMinutes = clampNumber(params.frequencyMinutes, 2, 120, quiz.frequencyMinutes);
  }
  if (params.revealSeconds !== undefined) {
    quiz.revealSeconds = clampNumber(params.revealSeconds, 10, 90, quiz.revealSeconds);
  }
  if (typeof params.tts === 'boolean') quiz.tts = params.tts;

  quizEngine.sync();
  if (quiz.enabled && !quizEngine.active) quizEngine.scheduleNext(30000);
  saveState();
  broadcastNotification('quiz.state', { quiz: quizPayload() });
  broadcastNotification('temple.state', getPublicState());
  return quizPayload();
}

function applyGiftUpdate(params = {}) {
  const gifts = state.settings.gifts;
  if (typeof params.announce === 'boolean') gifts.announce = params.announce;
  if (typeof params.tts === 'boolean') gifts.tts = params.tts;
  saveState();
  broadcastNotification('temple.state', getPublicState());
  return gifts;
}

function applyCongregationUpdate(params = {}) {
  const payload = congregation.configure(params);
  state.settings.congregation = { ...payload.settings };
  saveState();
  broadcastNotification('temple.state', getPublicState());
  return payload;
}

/** Visual theme for each program cue, using only the locally stored categories. */
const SCENE_BY_THEME = {
  morning: 'backgrounds',
  healing: 'candles',
  family: 'church',
  anxiety: 'backgrounds',
  finances: 'church',
  strength: 'cross',
  night: 'candles',
  gratitude: 'bible'
};

function sceneCategoryForCue(cue) {
  if (!cue) return null;
  switch (cue.kind) {
    case 'welcome': return 'cathedral';
    case 'verse':
    case 'reflection': return 'bible';
    case 'community': return 'church';
    case 'gratitude': return 'bible';
    case 'prayer': return SCENE_BY_THEME[cue.theme] || 'cathedral';
    default: return null;
  }
}

function applySceneForCue(cue) {
  const background = state.settings.background;
  if (!background || background.sceneMatch === false) return;
  const category = sceneCategoryForCue(cue);
  if (!category || !BACKGROUNDS.categories.includes(category)) return;
  const pool = BACKGROUNDS.images.filter(
    (image) => image.category === category && image.url !== background.current
  );
  if (pool.length === 0) return;
  const next = pool[Math.floor(Math.random() * pool.length)];
  background.category = category;
  setCurrentBackground(next.url, { rotate: true });
  configureBackgroundRotation();
}

let backgroundTimer = null;

function backgroundPool() {
  const category = state.settings.background.category;
  const pool = category === 'all'
    ? BACKGROUNDS.images
    : BACKGROUNDS.images.filter((img) => img.category === category);
  return pool.length > 0 ? pool : BACKGROUNDS.images;
}

function pickNextBackground() {
  const pool = backgroundPool();
  if (pool.length === 0) return null;
  const current = state.settings.background.current;
  const candidates = pool.filter((img) => img.url !== current);
  const source = candidates.length > 0 ? candidates : pool;
  if (state.settings.background.randomize) {
    return source[Math.floor(Math.random() * source.length)];
  }
  const currentIndex = pool.findIndex((img) => img.url === current);
  return pool[(currentIndex + 1) % pool.length];
}

function setCurrentBackground(url, { rotate = false } = {}) {
  const image = BACKGROUNDS.images.find((img) => img.url === url);
  if (!image) throw new Error('Background image not found');
  state.settings.background.current = image.url;
  saveState();
  broadcastNotification('stage.background', {
    url: image.url,
    category: image.category,
    transitionMs: state.settings.background.transitionMs,
    source: rotate ? 'rotation' : 'manual',
    settings: state.settings.background
  });
  broadcastNotification('temple.state', getPublicState());
  return image;
}

function configureBackgroundRotation() {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
  }
  const bg = state.settings.background;
  if (!bg.enabled || BACKGROUNDS.images.length < 2) return;
  const intervalMs = clampNumber(bg.intervalSeconds, 10, 3600, 60) * 1000;
  backgroundTimer = setInterval(() => {
    try {
      const next = pickNextBackground();
      if (next) setCurrentBackground(next.url, { rotate: true });
    } catch (err) {
      console.warn('[Background] Rotation failed:', err.message);
    }
  }, intervalMs);
}

// ============================================================================
// 10. VIEWER COMMENTS, COMMANDS AND PRAYER DETECTION
// ============================================================================
const COMMAND_KEYS = ['amen', 'pray', 'jesus', 'faith', 'hope', 'love', 'prayer', 'god'];
const commandCooldowns = new Map();
const GLOBAL_COMMAND_COOLDOWN_MS = 2500;
let lastCommandAt = 0;

function normaliseComment(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCommand(rawText) {
  const norm = normaliseComment(rawText);
  if (!norm) return null;
  if (/\bthank\s*you\b/.test(norm)) return 'THANK YOU';
  for (const key of COMMAND_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(norm)) return key.toUpperCase();
  }
  return null;
}

function isPrayerRequestComment(rawText) {
  const lower = String(rawText || '').toLowerCase();
  return messageLibrary.triggers().some((trigger) => lower.includes(trigger));
}

function pushChatFeed(entry) {
  const text = baseClean(stripHtml(entry.text), 90);
  if (!text) return null;
  const item = {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    user: firstNameForDisplay(entry.user),
    text: isBlockedContent(text) ? '…' : text,
    avatar: entry.avatar || '',
    at: new Date().toISOString()
  };
  state.chatFeed.unshift(item);
  if (state.chatFeed.length > 8) state.chatFeed.length = 8;
  broadcastNotification('live.chat', { entry: item, chatFeed: chatFeedForList() });
  return item;
}

function chatFeedForList() {
  return state.chatFeed.map((item) => ({
    id: item.id,
    user: item.user,
    text: item.text,
    avatar: item.avatar || '',
    at: item.at
  }));
}

function handleCommand(command, { user, uniqueId, avatar, simulated = false, real = false }) {
  // AMEN glows on the viewer's congregation seat even while the spoken
  // acknowledgement is rate-limited. Only a real TikTok comment qualifies.
  if (command === 'AMEN' && real) {
    congregation.markAmen({ uniqueId, simulated });
  }

  const key = `${uniqueId || user}:${command}`;
  const now = Date.now();
  const last = commandCooldowns.get(key) || 0;
  if (now - last < 6000 || now - lastCommandAt < GLOBAL_COMMAND_COOLDOWN_MS) return null;
  commandCooldowns.set(key, now);
  lastCommandAt = now;
  if (commandCooldowns.size > 800) {
    commandCooldowns.delete(commandCooldowns.keys().next().value);
  }

  const message = messageLibrary.command(command);
  if (!message) return null;
  const member = recordMember(user, uniqueId, avatar, 1);
  if (command === 'AMEN') state.amenCount += 1;
  if (command === 'PRAY' || command === 'PRAYER') state.blessingsCount += 1;

  const event = pushEventLog({
    type: 'commentCommand',
    kind: 'command',
    command,
    user: member.name,
    uniqueId: member.uniqueId,
    avatar: member.avatar,
    message,
    simulated: Boolean(simulated),
    ttsText: state.settings.ttsEnabled ? message : '',
    ttsLang: 'en',
    merit: 1
  });

  saveState();
  broadcastNotification('temple.event', { event, state: getPublicState() });
  return event;
}

function handleViewerComment(commentText, user, uniqueId, avatar, options = {}) {
  const raw = String(commentText || '').trim();
  if (!raw || isBlockedContent(raw)) return null;

  if (options.source === 'tiktok') congregation.touch({ uniqueId });
  const memberName = sanitizeDisplayName(user || uniqueId);

  // Quiz answers are checked first so the correct answer is never printed in
  // the public chat feed before the reveal.
  if (quizEngine) {
    const answer = quizEngine.submitAnswer({ text: raw, name: memberName, uniqueId });
    if (answer?.correct) {
      pushChatFeed({ user: memberName, text: 'answered the Bible quiz', avatar });
      return { quizAnswer: true, already: answer.already, questionId: answer.question.id };
    }
  }

  pushChatFeed({ user: memberName, text: raw, avatar });

  // Prayer requests take priority: "pray for me" also contains the PRAY keyword.
  if (isPrayerRequestComment(raw)) {
    if (state.settings.prayer.interactionEnabled === false) {
      return { chat: true, prayerDisabled: true, member: recordMember(memberName, uniqueId, avatar, 0).name };
    }
    const request = addPrayerRequest({
      name: memberName,
      uniqueId,
      avatar,
      text: raw,
      source: options.source || 'tiktok'
    });
    return request || { skipped: true };
  }

  const command = detectCommand(raw);
  if (command) {
    const event = handleCommand(command, {
      user: memberName,
      uniqueId,
      avatar,
      simulated: options.source === 'simulation',
      real: options.source === 'tiktok'
    });
    return event || { skipped: true };
  }

  const member = recordMember(memberName, uniqueId, avatar, 0);
  return { chat: true, member: member.name };
}

// ============================================================================
// 11. TIKTOK LIVE CONNECTOR
// ============================================================================
let tiktokConn = null;

async function resolveTikTokUsername(rawInput) {
  let input = String(rawInput || '').trim();
  if (!input) throw new Error('Please enter a TikTok @username or Live link.');
  if (input.startsWith('http://') || input.startsWith('https://') || input.includes('tiktok.com/')) {
    const urlToFetch = input.startsWith('http') ? input : `https://${input}`;
    const directMatch = urlToFetch.match(/tiktok\.com\/@([^/?#]+)/i);
    if (directMatch && directMatch[1]) return directMatch[1];
    try {
      const resp = await fetch(urlToFetch, { redirect: 'follow' });
      const finalUrl = resp.url || '';
      const resolvedMatch = finalUrl.match(/tiktok\.com\/@([^/?#]+)/i);
      if (resolvedMatch && resolvedMatch[1]) return resolvedMatch[1];
    } catch (err) {
      console.warn('[TikTok URL Resolve]', err.message);
    }
  }
  return input.replace(/^@/, '').split(/[/?#]/)[0].trim();
}

function extractUserFromEvent(data) {
  const u = data?.user || data || {};
  const uniqueId = u.uniqueId || u.displayId || data?.uniqueId || '';
  const user = u.nickname || uniqueId || data?.nickname || 'Friend';
  const avatar =
    u.profilePictureUrl ||
    u.avatarLarge?.urlList?.[0] ||
    u.avatarThumb?.urlList?.[0] ||
    u.avatarMedium?.urlList?.[0] ||
    data?.profilePictureUrl ||
    '';
  return { user, uniqueId, avatar };
}

const giftComboTracker = new Map();

function formatConnectorError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err.slice(0, 300);
  const direct = err.message || err.info || err.msg || err.code;
  if (direct) return String(direct).slice(0, 300);
  try {
    const json = JSON.stringify(err);
    if (json && json !== '{}') return json.slice(0, 300);
  } catch (_) {}
  return String(err).slice(0, 300);
}

async function connectTikTokLive(usernameOrUrl) {
  const cleanUser = await resolveTikTokUsername(usernameOrUrl);
  if (!cleanUser) throw new Error('Could not find a valid TikTok username in that input.');

  if (tiktokConn) {
    try {
      await tiktokConn.disconnect();
    } catch (_) {}
    tiktokConn = null;
  }

  state.tiktok = {
    connected: false,
    connecting: true,
    username: cleanUser,
    roomId: null,
    viewerCount: 0,
    lastError: null
  };
  broadcastNotification('temple.state', getPublicState());

  tiktokConn = new TikTokLiveConnection(cleanUser, {
    processInitialData: true,
    fetchRoomInfoOnConnect: false,
    enableExtendedGiftInfo: false
  });

  tiktokConn.on(ControlEvent.CONNECTED, (roomState) => {
    state.tiktok.connected = true;
    state.tiktok.connecting = false;
    state.tiktok.roomId = roomState?.roomId || tiktokConn?.roomId || null;
    state.tiktok.lastError = null;
    console.log(`[TikTok Live] Connected to @${cleanUser} (roomId: ${state.tiktok.roomId})`);
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(ControlEvent.DISCONNECTED, () => {
    state.tiktok.connected = false;
    state.tiktok.connecting = false;
    console.log(`[TikTok Live] Disconnected from @${cleanUser}`);
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(ControlEvent.ERROR, (err) => {
    state.tiktok.lastError = formatConnectorError(err);
    console.warn('[TikTok Live Warning]', state.tiktok.lastError);
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(WebcastEvent.ROOM_USER, (data) => {
    const viewerCount = Number(data?.total ?? data?.viewerCount ?? 0);
    if (viewerCount > 0) {
      state.tiktok.viewerCount = viewerCount;
      broadcastNotification('temple.viewerCount', { viewerCount });
    }
  });

  tiktokConn.on(WebcastEvent.MEMBER, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    recordMember(user, uniqueId, avatar, 0);
    // One seat per uniqueId; duplicate MEMBER frames update the same viewer.
    // The connector has no leave event, so seats expire by inactivity only.
    const joined = congregation.join({ uniqueId, name: user, source: 'tiktok' });
    broadcastNotification('temple.state', getPublicState());
    // Real TikTok joins only. Simulation and test paths never reach this handler.
    if (joined.created) {
      showProgram?.welcome({ name: firstNameForDisplay(user), uniqueId }, 'tiktok');
    }
  });

  tiktokConn.on(WebcastEvent.CHAT, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    const commentText = data?.content || data?.comment || '';
    console.log(`[TikTok Chat] ${user}: ${commentText}`);
    handleViewerComment(commentText, user, uniqueId, avatar, { source: 'tiktok' });
  });

  tiktokConn.on(WebcastEvent.LIKE, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    congregation.touch({ uniqueId });
    const likeCount = clampNumber(data?.count ?? data?.likeCount, 1, 15, 1);
    state.likeCount += likeCount;
    Rituals.strikeWoodenFish({ user, uniqueId, avatar, count: likeCount });
  });

  tiktokConn.on(WebcastEvent.FOLLOW, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    congregation.touch({ uniqueId });
    state.followCount += 1;
    Rituals.ringBell({
      user,
      uniqueId,
      avatar,
      count: 1,
      kind: 'follow',
      message: messageLibrary.template('follow'),
      readTts: false
    });
  });

  tiktokConn.on(WebcastEvent.SHARE, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    congregation.touch({ uniqueId });
    state.shareCount += 1;
    Rituals.ringBell({
      user,
      uniqueId,
      avatar,
      count: 1,
      kind: 'share',
      message: messageLibrary.template('share'),
      readTts: false
    });
  });

  tiktokConn.on(WebcastEvent.SOCIAL, (data) => {
    const action = String(data?.action || '');
    const display = String(data?.common?.displayText?.displayType || data?.displayType || '').toLowerCase();
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    if (action === '3' || display.includes('follow')) {
      state.followCount += 1;
      Rituals.ringBell({
        user,
        uniqueId,
        avatar,
        kind: 'follow',
        message: messageLibrary.template('follow'),
        readTts: false
      });
    } else if (action === '1' || display.includes('share')) {
      state.shareCount += 1;
      Rituals.ringBell({
        user,
        uniqueId,
        avatar,
        kind: 'share',
        message: messageLibrary.template('share'),
        readTts: false
      });
    }
  });

  tiktokConn.on(WebcastEvent.STREAM_END, () => {
    // The LIVE session really ended: seats from that room are no longer live.
    console.log('[TikTok Live] Stream ended — clearing the prayer congregation.');
    congregation.reset('stream-ended');
    broadcastNotification('temple.state', getPublicState());
  });

  tiktokConn.on(WebcastEvent.GIFT, (data) => {
    const { user, uniqueId, avatar } = extractUserFromEvent(data);
    const giftObj = data?.gift || data?.giftDetails || {};
    const giftId = String(data?.giftId || giftObj?.id || 'gift');
    const groupId = String(data?.groupId || `${uniqueId}_${giftId}`);
    const repeatCount = Math.max(1, Number(data?.repeatCount || data?.comboCount || 1));

    const prevCount = giftComboTracker.get(groupId) || 0;
    if (repeatCount <= prevCount && data?.repeatEnd) {
      giftComboTracker.delete(groupId);
      return;
    }
    const deltaCount = Math.max(1, repeatCount - prevCount);
    giftComboTracker.set(groupId, repeatCount);
    if (giftComboTracker.size > 500) {
      giftComboTracker.delete(giftComboTracker.keys().next().value);
    }

    const diamondCount = Math.max(1, Number(giftObj?.diamondCount || data?.diamondCount || 1));
    const totalCoins = diamondCount * deltaCount;
    const rawGiftName = giftObj?.name || data?.giftName || 'a gift';
    const displayGiftName = deltaCount > 1 ? `${deltaCount}x ${rawGiftName}` : rawGiftName;

    console.log(`[TikTok Gift] ${user} sent ${displayGiftName} (${totalCoins} coins)`);
    Rituals.offerGift({
      user,
      uniqueId,
      avatar,
      coins: totalCoins,
      giftName: rawGiftName,
      quantity: deltaCount,
      source: 'tiktok'
    });
  });

  try {
    const roomState = await tiktokConn.connect();
    state.tiktok.connected = true;
    state.tiktok.connecting = false;
    state.tiktok.roomId = roomState?.roomId || tiktokConn?.roomId || null;
    broadcastNotification('temple.state', getPublicState());
    return state.tiktok;
  } catch (err) {
    state.tiktok.connected = false;
    state.tiktok.connecting = false;
    state.tiktok.lastError = formatConnectorError(err)
      || 'Could not connect to the Live room. Make sure the account is currently live.';
    broadcastNotification('temple.state', getPublicState());
    throw new Error(state.tiktok.lastError);
  }
}

function disconnectTikTokLive() {
  if (tiktokConn) {
    try {
      tiktokConn.disconnect();
    } catch (_) {}
    tiktokConn = null;
  }
  state.tiktok = {
    connected: false,
    connecting: false,
    username: '',
    roomId: null,
    viewerCount: 0,
    lastError: null
  };
  congregation.reset('live-disconnected');
  broadcastNotification('temple.state', getPublicState());
  return state.tiktok;
}

// ============================================================================
// 12. DEMO AUTO-SIMULATION (optional, off by default)
// ============================================================================
let autoSimTimer = null;
const SIM_VIEWERS = [
  { user: 'Sarah M.', uniqueId: 'sarah.m', wish: 'Please pray for my family and for peace this week.' },
  { user: 'Michael R.', uniqueId: 'michael.r', wish: 'pray for my mother as she recovers at home' },
  { user: 'Grace L.', uniqueId: 'grace.l', wish: 'pray for me, I have an important interview tomorrow' },
  { user: 'David K.', uniqueId: 'david.k', wish: 'Please pray for my children and for wisdom.' },
  { user: 'Emily T.', uniqueId: 'emily.t', wish: 'pray for my family, we are going through a difficult season' },
  { user: 'James P.', uniqueId: 'james.p', wish: 'thank you for this prayer stream, it brings me peace' }
];

function runSingleSimulationStep() {
  const pick = SIM_VIEWERS[Math.floor(Math.random() * SIM_VIEWERS.length)];
  const roll = Math.random();
  if (roll < 0.3) {
    handleViewerComment(pick.wish, pick.user, pick.uniqueId, '', { source: 'simulation' });
  } else if (roll < 0.55) {
    Rituals.burnIncense({ user: pick.user, uniqueId: pick.uniqueId, count: 1, simulated: true });
  } else if (roll < 0.72) {
    Rituals.strikeWoodenFish({ user: pick.user, uniqueId: pick.uniqueId, count: 3, simulated: true });
  } else if (roll < 0.86) {
    handleViewerComment('AMEN', pick.user, pick.uniqueId, '', { source: 'simulation' });
  } else {
    Rituals.offerGift({
      user: pick.user,
      uniqueId: pick.uniqueId,
      coins: 12,
      giftName: 'Prayer candle',
      simulated: true
    });
  }
}

function configureAutoSim(enabled) {
  state.settings.autoSim = Boolean(enabled);
  if (autoSimTimer) {
    clearInterval(autoSimTimer);
    autoSimTimer = null;
  }
  if (state.settings.autoSim) {
    runSingleSimulationStep();
    autoSimTimer = setInterval(runSingleSimulationStep, state.settings.autoSimIntervalMs || 12000);
  }
}

// ============================================================================
// 13. JSON-RPC 2.0 DISPATCHER (legacy temple.* / live.* methods preserved)
// ============================================================================
async function handleRpcCall(method, params = {}) {
  switch (method) {
    // ---- State ----
    case 'temple.getState':
    case 'church.getState':
    case 'prayer.getState':
      return getPublicState();
    case 'state.get':
      return getPublicState();

    // ---- Legacy ritual methods ----
    case 'temple.burnIncense':
      return Rituals.burnIncense(params);
    case 'temple.strikeWoodenFish':
      return Rituals.strikeWoodenFish(params);
    case 'temple.ringBell':
      return Rituals.ringBell(params);
    case 'temple.sendPrayer':
      return Rituals.sendPrayer(params);
    case 'temple.offerGift':
      return Rituals.offerGift(params);
    case 'temple.drawFortune':
      return Rituals.drawFortune(params);
    case 'temple.grandCeremony':
      return Rituals.grandCeremony(params);
    case 'temple.updateSettings':
      return Rituals.updateSettings(params);
    case 'temple.resetMerit':
      return Rituals.resetMerit();
    case 'temple.comment':
      return handleViewerComment(params.comment, params.user, params.uniqueId, params.avatar, {
        source: params.source || 'rpc'
      });

    // ---- TTS ----
    case 'temple.speak': {
      const lang = params.lang || (params.voice === 'vi' ? 'vi' : 'auto');
      const res = await ttsManager.synthesize(params.text, {
        lang,
        voice: params.voice,
        rate: params.rate
      });
      if (res.ok && params.broadcast !== false) {
        broadcastNotification('tts.play', {
          text: params.text,
          voice: res.voice,
          language: res.language,
          url: res.url
        });
      }
      return res;
    }
    case 'temple.ttsStatus':
    case 'tts.status':
      return ttsManager.getStatus();
    case 'tts.voices':
      return {
        voices: VOICES,
        en: VOICES.filter((v) => v.language === 'en'),
        vi: VOICES.filter((v) => v.language === 'vi'),
        defaults: { en: state.settings.enVoice, vi: state.settings.vnVoice }
      };
    case 'tts.test': {
      const lang = params.lang === 'vi' ? 'vi' : 'en';
      const text = params.text || (lang === 'vi'
        ? 'Xin chào quý vị. Chúng ta hãy cùng nhau cầu nguyện.'
        : 'Welcome to Christian Prayer Live. Faith, hope and love.');
      const res = await ttsManager.synthesize(text, {
        lang,
        voice: params.voice || (lang === 'vi' ? state.settings.vnVoice : state.settings.enVoice),
        rate: params.rate
      });
      if (res.ok && params.broadcast !== false) {
        broadcastNotification('tts.play', {
          text,
          voice: res.voice,
          language: res.language,
          url: res.url
        });
      }
      return res;
    }

    // ---- Prayer request moderation ----
    case 'prayer.list':
      return { requests: publicPrayerRequests(), settings: state.settings.prayer };
    case 'prayer.add': {
      const request = addPrayerRequest({ ...params, source: params.source || 'admin' });
      if (!request) throw new Error('Prayer request was empty or blocked by the moderation filter.');
      return { request, requests: publicPrayerRequests(), state: getPublicState() };
    }
    case 'prayer.approve':
      return approvePrayerRequest(String(params.id || ''));
    case 'prayer.hide':
      return hidePrayerRequest(String(params.id || ''));
    case 'prayer.remove':
      return removePrayerRequest(String(params.id || ''));
    case 'prayer.clear':
      return clearPrayerRequests();
    case 'prayer.setPaused': {
      state.settings.prayer.paused = Boolean(params.paused);
      if (!state.settings.prayer.paused) {
        const waiting = state.prayerRequests.find(
          (req) => req.status === 'approved' && !req.displayedAt
        );
        if (waiting) displayPrayerRequest(waiting);
      }
      saveState();
      broadcastNotification('prayer.state', { requests: publicPrayerRequests(), state: getPublicState() });
      return { settings: state.settings.prayer, state: getPublicState() };
    }
    case 'prayer.setAutoApprove': {
      state.settings.prayer.autoApprove = Boolean(params.enabled);
      saveState();
      return { settings: state.settings.prayer, state: getPublicState() };
    }

    // ---- Backgrounds ----
    case 'stage.listBackgrounds':
      return {
        backgrounds: BACKGROUNDS.images,
        categories: BACKGROUNDS.categories,
        overlays: BACKGROUND_LAYER_FILES,
        settings: state.settings.background
      };
    case 'stage.setBackground': {
      const image = setCurrentBackground(String(params.url || params.path || ''));
      return { image, settings: state.settings.background };
    }
    case 'stage.nextBackground': {
      const next = pickNextBackground();
      if (!next) throw new Error('No background images available');
      const image = setCurrentBackground(next.url, { rotate: true });
      return { image, settings: state.settings.background };
    }
    case 'stage.updateSettings':
      return applySettingsUpdate({ background: params });

    // ---- Ambient worship music ----
    case 'music.get':
      return musicCatalogPayload();
    case 'music.update':
      return applyMusicUpdate(params);
    case 'music.next':
      return applyMusicUpdate({ track: pickAdjacentTrack(1) });
    case 'music.previous':
      return applyMusicUpdate({ track: pickAdjacentTrack(-1) });
    case 'music.toggle':
      return applyMusicUpdate({ paused: !state.settings.music.paused });
    case 'music.rescan': {
      const result = await MUSIC_LIBRARY.scan({ probe: true });
      applyMusicCatalog(result.catalog);
      const repaired = repairMusicSelection();
      if (repaired) saveState();
      const payload = musicRescanPayload(result);
      publishMusicLibrary(payload);
      if (repaired) broadcastNotification('music.state', { settings: state.settings.music });
      broadcastNotification('temple.state', getPublicState());
      return payload;
    }
    case 'music.track.update': {
      applyMusicCatalog(MUSIC_LIBRARY.updateTrack(params.id, params));
      const repaired = repairMusicSelection();
      saveState();
      const payload = musicCatalogPayload();
      publishMusicLibrary(payload);
      if (repaired) broadcastNotification('music.state', { settings: state.settings.music });
      return { ...payload, repaired };
    }
    case 'music.track.remove': {
      const { catalog, ...removal } = MUSIC_LIBRARY.removeTrack(params.id);
      applyMusicCatalog(catalog);
      const repaired = repairMusicSelection();
      saveState();
      const payload = { ...musicCatalogPayload(), removed: removal };
      publishMusicLibrary(payload);
      if (repaired) broadcastNotification('music.state', { settings: state.settings.music });
      broadcastNotification('temple.state', getPublicState());
      return payload;
    }

    // ---- Automated live show ----
    case 'show.status':
      return showPayload();
    case 'show.update':
      return applyShowUpdate(params);
    case 'show.next':
      return { cue: showProgram.nextSegment('manual'), show: showPayload() };
    case 'show.nextVerse':
      return { cue: showProgram.nextVerse('manual'), show: showPayload() };
    case 'show.nextReflection':
      return { cue: showProgram.nextReflection('manual'), show: showPayload() };
    case 'show.nextPrayer':
      return {
        cue: showProgram.nextPrayer('manual', params.theme && params.theme !== 'auto' ? params.theme : null),
        show: showPayload()
      };
    case 'show.testWelcome':
      return { cue: showProgram.testWelcome(params.name), show: showPayload() };
    case 'show.restart':
      return { cue: showProgram.restart({ source: 'manual' }), show: showPayload() };

    // ---- Bible quiz ----
    case 'quiz.status':
      return quizPayload();
    case 'quiz.update':
      return applyQuizUpdate(params);
    case 'quiz.next':
      return {
        quiz: quizEngine.next({ source: params.source === 'test' ? 'test' : 'manual' }),
        active: quizPayload().active
      };
    case 'quiz.reveal':
      return { quiz: quizEngine.reveal(), active: quizPayload().active };
    case 'quiz.answer':
      return {
        result: quizEngine.submitAnswer({
          text: params.text,
          name: params.name || 'Test Viewer (demo)',
          uniqueId: params.uniqueId || 'test.quiz'
        }),
        quiz: quizPayload()
      };

    // ---- Gift announcements ----
    case 'gift.update':
      return applyGiftUpdate(params);

    // ---- Prayer congregation (live-session only, never persisted) ----
    case 'congregation.get':
      return congregation.getPayload();
    case 'congregation.update':
      return applyCongregationUpdate(params);
    case 'congregation.reset': {
      const result = congregation.reset('admin-reset');
      broadcastNotification('temple.state', getPublicState());
      return result;
    }
    case 'congregation.demo': {
      const result = congregation.additiveDemo(params.count);
      broadcastNotification('temple.state', getPublicState());
      return result;
    }
    case 'congregation.demoClear': {
      const result = congregation.clearDemo();
      broadcastNotification('temple.state', getPublicState());
      return result;
    }
    case 'congregation.demoEvent': {
      const result = congregation.demoAction(params);
      broadcastNotification('temple.state', getPublicState());
      return result;
    }

    // ---- Message library ----
    case 'messages.get':
      return messageLibrary.snapshot();
    case 'messages.save':
      return { saved: true, messages: messageLibrary.replace(params.messages || params) };

    // ---- TikTok Live ----
    case 'live.connect':
      return connectTikTokLive(params.username);
    case 'live.disconnect':
      return disconnectTikTokLive();
    case 'live.status':
      return state.tiktok;
    case 'live.setAutoSim':
      configureAutoSim(Boolean(params.enabled));
      saveState();
      broadcastNotification('temple.state', getPublicState());
      return getPublicState();

    default:
      throw new Error(`Unknown JSON-RPC method: ${method}`);
  }
}

// ============================================================================
// 14. EXPRESS + WEBSOCKET SERVER
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/tts-cache', express.static(TTS_CACHE_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js|json)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.post('/rpc', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (!method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC request: missing method' }
    });
  }
  try {
    const result = await handleRpcCall(method, params || {});
    res.json({ jsonrpc: jsonrpc || '2.0', id: id ?? null, result });
  } catch (err) {
    res.status(200).json({
      jsonrpc: jsonrpc || '2.0',
      id: id ?? null,
      error: { code: -32000, message: err.message || 'Server error' }
    });
  }
});

app.all('/api/tts', async (req, res) => {
  const text = String(req.body?.text || req.query?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Missing text to speak' });
  const requestedVoice = String(req.body?.voice || req.query?.voice || '').trim();
  const lang = req.body?.lang || req.query?.lang
    || (requestedVoice === 'vi' ? 'vi' : 'auto');
  const rate = req.body?.rate || req.query?.rate || state.settings.ttsRate;
  const result = await ttsManager.synthesize(text, {
    lang,
    voice: requestedVoice === 'maichi' ? undefined : requestedVoice,
    rate
  });
  res.json(result);
});

app.get('/api/state', (_req, res) => res.json(getPublicState()));
app.get('/api/backgrounds', (_req, res) => res.json({
  backgrounds: BACKGROUNDS.images,
  categories: BACKGROUNDS.categories,
  overlays: BACKGROUND_LAYER_FILES,
  settings: state.settings.background
}));
app.get('/api/messages', (_req, res) => res.json(messageLibrary.snapshot()));
app.get('/api/music', (_req, res) => res.json(musicCatalogPayload()));
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  brand: BRAND,
  tts: ttsManager.getStatus(),
  tiktok: state.tiktok,
  backgrounds: BACKGROUNDS.images.length,
  musicTracks: MUSIC.tracks.length,
  musicLibrary: MUSIC.libraryMeta,
  music: state.settings.music,
  congregation: congregation.getPayload().counts
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastNotification(method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'temple.state', params: getPublicState() }));
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'show.state', params: { show: showPayload() } }));
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'quiz.state', params: { quiz: quizPayload() } }));
  // Replay a cue that is still on screen so OBS can reload mid-prayer.
  if (lastPublishedCue) {
    const age = Date.now() - lastPublishedAt;
    if (age >= 0 && age < (Number(lastPublishedCue.displayMs) || 15000)) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'show.cue',
        params: { cue: lastPublishedCue, replay: true }
      }));
    }
  }
  if (state.settings.background.current) {
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'stage.background',
      params: {
        url: state.settings.background.current,
        transitionMs: 0,
        settings: state.settings.background
      }
    }));
  }

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch (_) {
      return;
    }
    if (!msg || !msg.method) return;
    try {
      const result = await handleRpcCall(msg.method, msg.params || {});
      if (msg.id !== undefined) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      }
    } catch (err) {
      if (msg.id !== undefined) {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: err.message || 'RPC error' }
        }));
      }
    }
  });
});

ttsManager = new PiperManager();

quizEngine = new QuizEngine({
  getSettings: () => state.settings.quiz,
  recent: state.quizRecent,
  publish: publishQuizEvent,
  onChange: () => {
    if (!quizEngine) return;
    state.quizRecent = quizEngine.recent.slice(0, 50);
    saveState();
    broadcastNotification('quiz.state', { quiz: quizPayload() });
  }
});

showProgram = new ShowProgram({
  getSettings: () => state.settings.show,
  getVerses: () => messageLibrary.data.bibleVerses || [],
  getApprovedPrayers: () => state.prayerRequests
    .filter((request) => request.status === 'approved' && request.source !== 'simulation')
    .map((request) => ({ name: request.displayName, text: request.text })),
  publish: publishShowCue,
  onChange: () => {
    saveState();
    broadcastNotification('show.state', { show: showPayload() });
  }
});

/** Waits briefly for Piper so the opening welcome cue is actually spoken. */
function startAutomatedShow() {
  if (!state.settings.show.enabled || state.settings.show.paused) {
    console.log('[Show] Automated program is off. Use the admin dashboard to start it.');
    return;
  }
  let attempts = 0;
  const begin = () => {
    if (ttsManager.ready || attempts >= 20) {
      showProgram.start({ immediate: true });
      console.log('[Show] Automated program started — welcome, Scripture, prayer, community, gratitude.');
      return;
    }
    attempts += 1;
    setTimeout(begin, 800);
  };
  begin();
}

server.listen(PORT, () => {
  const bgCount = BACKGROUNDS.images.length;
  console.log('============================================================');
  console.log('✝  CHRISTIAN PRAYER LIVE — Faith • Hope • Love');
  console.log('   "Pray Together. Grow in Faith."');
  console.log('------------------------------------------------------------');
  console.log(`📺 Livestream / OBS 9:16 : http://localhost:${PORT}`);
  console.log(`🎛️  Admin dashboard      : http://localhost:${PORT}/admin`);
  console.log(`🔌 JSON-RPC 2.0         : http://localhost:${PORT}/rpc (ws://localhost:${PORT}/ws)`);
  console.log(`🎨 Backgrounds          : ${bgCount} local images (rotation ${state.settings.background.enabled ? 'on' : 'off'})`);
  console.log(`🗣️  Piper voices         : EN ${state.settings.enVoice} | VI ${state.settings.vnVoice}`);
  console.log(`🪑 Prayer congregation   : ${state.settings.congregation.maxVisible} seats · names ${state.settings.congregation.showNames ? 'on' : 'off'} · inactivity ${state.settings.congregation.inactivityMinutes}m`);
  console.log('============================================================');

  // Pick up audio files added or removed while the server was stopped.
  MUSIC_LIBRARY.scan({ probe: false }).then((result) => {
    applyMusicCatalog(result.catalog);
    const repaired = repairMusicSelection();
    if (repaired) saveState();
    if (result.addedCount || result.removedCount) {
      console.log(`[Music] Library sync: ${result.found} tracks, ${result.addedCount} new, ${result.removedCount} missing.`);
      if (repaired) broadcastNotification('music.state', { settings: state.settings.music });
    }
  }).catch((err) => console.warn(`[Music] Startup library sync failed: ${err.message}`));

  configureBackgroundRotation();
  if (state.settings.autoSim) configureAutoSim(true);
  startAutomatedShow();
  if (state.settings.quiz.enabled) {
    quizEngine.sync({ firstRun: true });
    console.log('[Quiz] Bible quiz enabled — first question in about 45 seconds.');
  } else {
    console.log('[Quiz] Bible quiz is off. Enable it from the dashboard.');
  }

  const defaultChannel = CONFIG.tiktok.autoConnect ? (CONFIG.tiktok.username || '') : '';
  if (defaultChannel) {
    connectTikTokLive(defaultChannel).catch((err) => {
      console.warn(`[Auto-Connect @${defaultChannel}]`, err.message);
    });
  } else {
    console.log('[TikTok Live] No channel configured. Connect from the admin dashboard when you are live.');
  }
});

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  try {
    if (showProgram) showProgram.stop();
  } catch (_) {}
  try {
    if (quizEngine) quizEngine.stop();
  } catch (_) {}
  try {
    if (ttsManager && ttsManager.proc) ttsManager.proc.kill();
  } catch (_) {}
  try {
    congregation.stop();
  } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
});

