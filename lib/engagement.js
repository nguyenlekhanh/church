/**
 * Automatic LIVE engagement reminders.
 *
 * Five categories (scripture, prayer request, gift/support, share, like) each
 * have their own interval and a small library of warm, Christian-themed
 * messages. The scheduler only decides *when* a reminder is due; narration goes
 * through the existing Piper manager and the existing stage TTS queue, so it
 * never overlaps a welcome, gift or prayer announcement.
 *
 * Nothing here promises blessings in exchange for gifts or donations.
 */

const CATEGORIES = ['scripture', 'prayer', 'gift', 'share', 'like'];

const CATEGORY_LABELS = {
  scripture: 'Scripture encouragement',
  prayer: 'Prayer request',
  gift: 'Gift / support',
  share: 'Share',
  like: 'Like'
};

const ENGAGEMENT_MESSAGES = {
  like: [
    'If this prayer brings you peace, tap the heart and share your love.',
    'If these words are a comfort to you today, a like helps more people find this prayer room.',
    'Tap the heart if you are praying with us. It is good to know you are here.',
    'If this moment of prayer helped you, leave a like so others can find us.'
  ],
  share: [
    'Share this prayer with someone who may need a little hope today.',
    'If someone you love is carrying a heavy heart, share this prayer room with them.',
    'Share this prayer with a friend who could use encouragement today.',
    'A simple share can bring someone into this prayer today. Thank you for spreading hope.'
  ],
  gift: [
    "If you'd like to support our prayer community, your gifts help us continue sharing God's Word. Thank you for your kindness.",
    'Some of you have asked how to support this prayer room. Gifts are always optional, and they help us keep sharing Scripture here. Thank you.',
    'Your kindness keeps this prayer ministry going. Gifts are never required, and every viewer is prayed for the same.',
    'If you would like to help this prayer community continue, a gift of any size is a blessing. Thank you for your generous heart.'
  ],
  prayer: [
    'If you need prayer today, leave your prayer request in the comments. We are here for you.',
    'Whatever you are carrying today, you do not have to carry it alone. Type your prayer request in the comments.',
    'If your heart is heavy, share it with us in the comments. We will pray with you.',
    'You can leave a prayer request in the comments at any time. We are praying for this community.'
  ],
  scriptureEncouragement: [
    'Hold on to that promise today. God is near to all who call on Him.',
    'Let that word settle in your heart. You are not walking through this day alone.',
    'May that Scripture steady you. Faith, hope and love remain, and the greatest of these is love.',
    'Take a quiet breath and carry that verse with you. The Lord is with you today.'
  ]
};

const DEFAULTS = {
  enabled: true,
  startupGraceSeconds: 120,
  minSpacingSeconds: 45,
  staleAfterSeconds: 300,
  like: { enabled: true, intervalSeconds: 120 },
  share: { enabled: true, intervalSeconds: 240 },
  gift: { enabled: true, intervalSeconds: 360 },
  prayer: { enabled: true, intervalSeconds: 480 },
  scripture: { enabled: true, intervalSeconds: 600 }
};

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

/** Merges a patch over the current settings, keeping every value in range. */
function mergeEngagementSettings(current = {}, patch = {}) {
  const base = { ...DEFAULTS, ...(current || {}) };
  const next = { ...base, ...(patch || {}) };
  const result = {
    enabled: next.enabled !== false,
    startupGraceSeconds: clampNumber(next.startupGraceSeconds, 0, 900, DEFAULTS.startupGraceSeconds),
    minSpacingSeconds: clampNumber(next.minSpacingSeconds, 10, 600, DEFAULTS.minSpacingSeconds),
    staleAfterSeconds: clampNumber(next.staleAfterSeconds, 60, 1800, DEFAULTS.staleAfterSeconds)
  };
  CATEGORIES.forEach((category) => {
    const incoming = { ...(base[category] || {}), ...((patch && patch[category]) || {}) };
    result[category] = {
      enabled: incoming.enabled !== false,
      intervalSeconds: clampNumber(incoming.intervalSeconds, 30, 3600, DEFAULTS[category].intervalSeconds)
    };
  });
  return result;
}

/** Message choice that never repeats the sentence used last time. */
class EngagementMessages {
  constructor(options = {}) {
    this.getVerses = options.getVerses || (() => []);
    this.random = options.random || Math.random;
    this.lastIndex = new Map();
  }

  pool(category) {
    if (category === 'scripture') return ENGAGEMENT_MESSAGES.scriptureEncouragement;
    return ENGAGEMENT_MESSAGES[category] || [];
  }

  pickLine(category) {
    const pool = this.pool(category);
    if (pool.length === 0) return '';
    const last = this.lastIndex.get(category);
    let index = Math.floor(this.random() * pool.length);
    if (pool.length > 1 && index === last) index = (index + 1) % pool.length;
    this.lastIndex.set(category, index);
    return pool[index];
  }

  pickScripture() {
    const verses = (this.getVerses() || []).filter((verse) => verse && verse.text && verse.reference);
    if (verses.length === 0) return this.pickLine('scripture');
    const verse = verses[Math.floor(this.random() * verses.length)];
    const spokenReference = String(verse.reference).replace(/\(KJV\)/i, '').replace(':', ' verse ');
    return `${verse.text} ${spokenReference}. ${this.pickLine('scripture')}`;
  }

  pick(category) {
    if (category === 'scripture') return this.pickScripture();
    return this.pickLine(category);
  }
}

/**
 * Decides when a reminder is due. All speech is delegated to `speak`, which is
 * the server's Piper + tts.play path — there is no second playback system.
 */
class EngagementScheduler {
  constructor(options = {}) {
    this.getSettings = options.getSettings || (() => DEFAULTS);
    this.canSpeak = options.canSpeak || (() => true);
    this.speak = options.speak || (async () => {});
    this.now = options.now || Date.now;
    this.tickMs = options.tickMs || 5000;
    this.log = options.log || (() => {});
    this.lastServedAt = {};
    this.lastSpokenAt = 0;
    this.lastCategory = null;
    this.blockedUntil = 0;
    this.startedAt = this.now();
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.startedAt = this.now();
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`[Engagement] Tick failed: ${err.message}`));
    }, this.tickMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Silences reminders while an announcement owns the room. */
  hold(ms) {
    const until = this.now() + Math.max(0, Number(ms) || 0);
    this.blockedUntil = Math.max(this.blockedUntil, until);
  }

  /** Intervals changed: restart the clocks instead of firing a backlog. */
  refresh() {
    const now = this.now();
    this.startedAt = now;
    this.lastServedAt = {};
    this.blockedUntil = Math.max(this.blockedUntil, now);
  }

  dueCategories(now) {
    const settings = this.getSettings();
    const due = [];
    CATEGORIES.forEach((category) => {
      const config = settings[category];
      if (!config || config.enabled === false) return;
      const last = this.lastServedAt[category] || this.startedAt;
      const waitMs = config.intervalSeconds * 1000;
      if (now - last >= waitMs) {
        due.push({ category, overdueMs: now - last - waitMs });
      }
    });
    return due;
  }

  async tick() {
    if (this.busy) return null;
    const now = this.now();
    const settings = this.getSettings();
    if (!settings || settings.enabled === false) return null;
    if (now < this.blockedUntil) return null;
    if (now - this.startedAt < (Number(settings.startupGraceSeconds) || 0) * 1000) return null;

    const due = this.dueCategories(now);
    if (due.length === 0) return null;

    // Stale reminders are dropped rather than stacked up back-to-back.
    const staleMs = (Number(settings.staleAfterSeconds) || 300) * 1000;
    const fresh = [];
    due.forEach((entry) => {
      if (entry.overdueMs > staleMs) {
        this.lastServedAt[entry.category] = now;
      } else {
        fresh.push(entry);
      }
    });
    if (fresh.length === 0) return null;

    if (now - this.lastSpokenAt < (Number(settings.minSpacingSeconds) || 0) * 1000) return null;
    if (!this.canSpeak()) return null;

    // Priority: Scripture and prayer first, then support, share and like.
    fresh.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
    const chosen = fresh[0];

    this.busy = true;
    try {
      const result = await this.speak(chosen.category);
      this.lastServedAt[chosen.category] = this.now();
      if (result && result.ok) {
        this.lastSpokenAt = this.now();
        this.lastCategory = chosen.category;
        this.log(`[Engagement] ${CATEGORY_LABELS[chosen.category]} reminder spoken.`);
      } else {
        // A failed or refused synthesis backs off instead of retrying every tick.
        this.hold(120000);
        this.log(`[Engagement] ${CATEGORY_LABELS[chosen.category]} reminder skipped: ${result?.skipped || result?.error || 'no speech'}.`);
      }
      return result || null;
    } finally {
      this.busy = false;
    }
  }

  status() {
    const settings = this.getSettings();
    const now = this.now();
    return {
      enabled: settings.enabled !== false,
      lastCategory: this.lastCategory,
      lastSpokenAt: this.lastSpokenAt ? new Date(this.lastSpokenAt).toISOString() : null,
      heldSeconds: Math.max(0, Math.ceil((this.blockedUntil - now) / 1000)),
      next: CATEGORIES.map((category) => {
        const config = settings[category] || DEFAULTS[category];
        const last = this.lastServedAt[category] || this.startedAt;
        const dueAt = last + config.intervalSeconds * 1000;
        return {
          category,
          label: CATEGORY_LABELS[category],
          enabled: config.enabled !== false,
          intervalSeconds: config.intervalSeconds,
          inSeconds: Math.max(0, Math.ceil((dueAt - now) / 1000))
        };
      })
    };
  }
}

module.exports = {
  CATEGORIES,
  CATEGORY_LABELS,
  ENGAGEMENT_MESSAGES,
  DEFAULTS,
  mergeEngagementSettings,
  EngagementMessages,
  EngagementScheduler
};
