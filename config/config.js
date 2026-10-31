/**
 * Christian Prayer Live — configuration loader.
 *
 * Reads config/app.config.json and applies safe environment variable overrides.
 * Existing configuration files (piper voices, etc.) are left untouched.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_DIR = __dirname;

function readJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn(`[Config] Could not read ${path.basename(filePath)}: ${err.message}`);
  }
  return fallback;
}

function envString(name, fallback) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function loadConfig() {
  const base = readJson(path.join(CONFIG_DIR, 'app.config.json'), {});
  const tts = base.tts || {};
  const background = base.background || {};
  const prayer = base.prayer || {};
  const tiktok = base.tiktok || {};

  const config = {
    ...base,
    root: ROOT,
    brand: base.brand || {
      name: 'CHRISTIAN PRAYER LIVE',
      tagline: 'FAITH • HOPE • LOVE',
      secondaryTagline: 'Pray Together. Grow in Faith.'
    },
    theme: envString('CHRISTIAN_THEME', base.theme || 'christian'),
    port: envNumber('PORT', base.port || 3000),
    language: {
      default: envString('DEFAULT_LANGUAGE', (base.language && base.language.default) || 'en').toLowerCase(),
      fallback: 'en'
    },
    tts: {
      enabled: envBool('TTS_ENABLED', tts.enabled !== false),
      engine: 'piper',
      volume: clamp(envNumber('TTS_VOLUME', tts.volume), 0, 1, 0.95),
      rate: clamp(envNumber('TTS_RATE', tts.rate), 0.6, 1.6, 1.0),
      maxQueue: clamp(tts.maxQueue, 1, 20, 6),
      voices: {
        en: envString('DEFAULT_EN_VOICE', (tts.voices && tts.voices.en) || 'auto'),
        vi: envString('DEFAULT_VN_VOICE', (tts.voices && tts.voices.vi) || 'auto')
      }
    },
    background: {
      rotation: envBool('BACKGROUND_ROTATION', background.rotation !== false),
      intervalSeconds: clamp(
        envNumber('BACKGROUND_ROTATION_INTERVAL', background.intervalSeconds),
        10,
        3600,
        60
      ),
      category: envString('BACKGROUND_CATEGORY', background.category || 'all'),
      randomize: background.randomize !== false,
      transitionMs: clamp(background.transitionMs, 400, 6000, 1600)
    },
    prayer: {
      autoApprove: envBool('PRAYER_AUTO_APPROVE', prayer.autoApprove !== false),
      paused: Boolean(prayer.paused),
      maxQueue: clamp(prayer.maxQueue, 5, 200, 30),
      cooldownSeconds: clamp(prayer.cooldownSeconds, 5, 600, 30),
      maxLength: clamp(prayer.maxLength, 40, 300, 120),
      showAvatar: Boolean(prayer.showAvatar)
    },
    tiktok: {
      username: envString('TIKTOK_USER', tiktok.username || ''),
      autoConnect: tiktok.autoConnect !== false
    },
    giftTiers: {
      small: clamp(base.giftTiers && base.giftTiers.small, 1, 1000, 5),
      medium: clamp(base.giftTiers && base.giftTiers.medium, 2, 100000, 50),
      large: clamp(base.giftTiers && base.giftTiers.large, 3, 1000000, 200)
    },
    backgroundMusic: {
      enabled: base.backgroundMusic ? base.backgroundMusic.enabled !== false : false,
      volume: clamp(base.backgroundMusic && base.backgroundMusic.volume, 0, 1, 0.45),
      file: (base.backgroundMusic && base.backgroundMusic.file) || ''
    },
    moderation: base.moderation || { blockedWords: [], blockLinks: true }
  };

  return config;
}

function loadMessages() {
  return readJson(path.join(CONFIG_DIR, 'messages.en.json'), {
    meta: { language: 'en-US' },
    templates: {},
    commands: {},
    categories: {},
    bibleVerses: [],
    prayerRequestTriggers: ['pray for me', 'prayer request', 'please pray']
  });
}

module.exports = {
  ROOT,
  CONFIG_DIR,
  loadConfig,
  loadMessages,
  readJson,
  envBool,
  envNumber,
  clamp
};
