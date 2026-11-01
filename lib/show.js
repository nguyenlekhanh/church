/**
 * Christian Prayer Live — automated live show.
 *
 * The program is a repeating schedule of short segments (welcome, Scripture,
 * prayer, community, gratitude). Each segment becomes a "cue" broadcast to the
 * OBS stage: an overlay the viewer sees plus optional Piper narration.
 *
 * Content is stored here rather than inline in the server so the wording can be
 * reviewed in one place. All prayers are original, compassionate prose. They do
 * not promise healing, wealth, miracles or any other guaranteed outcome.
 */

const DEFAULT_SHOW_SETTINGS = {
  enabled: true,
  paused: false,
  welcomeEnabled: true,
  narration: true,
  theme: 'auto'
};

/**
 * Repeating program. `seconds` is how long a segment holds before the next one.
 * A full cycle is roughly 30 minutes; the schedule then starts again without a
 * restart. Bible verses land roughly every 2–5 minutes through the cycle.
 */
const SHOW_SEQUENCE = [
  { kind: 'welcome', seconds: 120, label: 'Welcome & peaceful introduction' },
  { kind: 'verse', seconds: 150, label: 'Bible verse' },
  { kind: 'prayer', seconds: 180, label: 'Prayer session' },
  { kind: 'verse', seconds: 150, label: 'Bible verse' },
  { kind: 'prayer', seconds: 210, label: 'Prayer session' },
  { kind: 'community', seconds: 180, label: 'Community prayer' },
  { kind: 'verse', seconds: 150, label: 'Bible verse' },
  { kind: 'prayer', seconds: 210, label: 'Prayer session' },
  { kind: 'reflection', seconds: 180, label: 'Bible reflection' },
  { kind: 'verse', seconds: 150, label: 'Bible verse' },
  { kind: 'gratitude', seconds: 180, label: 'Prayer of gratitude' },
  { kind: 'prayer', seconds: 210, label: 'Prayer session' }
];

const PRAYER_THEMES = [
  {
    id: 'morning',
    label: 'Morning Prayer',
    prayers: [
      {
        title: 'A New Morning',
        body: 'Father, thank You for the gift of this morning and for the breath in our lungs. As the light returns, steady our hearts and set our thoughts on what is good and true. Walk with us through this day, and let our words carry Your kindness. Amen.'
      },
      {
        title: 'Before the Day Begins',
        body: 'Lord, before the day fills with noise, we quiet our hearts before You. Thank You for rest, for mercy that is new this morning, and for the people who love us. Guide our steps today, and help us notice the small graces along the way. Amen.'
      },
      {
        title: 'Morning Light',
        body: 'God of light, thank You for another day to begin again. Where we feel tired, give us gentleness with ourselves. Where we feel unsure, give us courage for the next small step. Amen.'
      }
    ]
  },
  {
    id: 'healing',
    label: 'Prayer for Healing',
    prayers: [
      {
        title: 'For Those Who Are Hurting',
        body: 'Lord, we lift up everyone watching who is hurting in body, mind, or spirit. Be near to them in this moment, and give them comfort, patient strength, and good care. Hold their families close, and let them know they are not alone. Amen.'
      },
      {
        title: 'Strength for Recovery',
        body: 'Father, we pray for those walking through illness and recovery. Grant them rest when rest is needed and courage for each new day. Guide the hands of those who care for them, and surround them with peace. Amen.'
      },
      {
        title: 'When the Body Is Weak',
        body: 'God of all comfort, You know the pain that words cannot carry. We ask for Your presence to be felt in hospital rooms, at home, and in quiet hours. Sustain the weary, and remind them that they are deeply loved. Amen.'
      }
    ]
  },
  {
    id: 'family',
    label: 'Prayer for Family',
    prayers: [
      {
        title: 'For Our Families',
        body: 'Father, thank You for the families You have placed in our lives, both near and far. Where there is distance, bring connection. Where there is tension, bring patience and honest words spoken with love. Bless every home represented here today. Amen.'
      },
      {
        title: 'For Parents and Children',
        body: 'Lord, we pray for parents carrying heavy responsibilities and for children trying to find their way. Give wisdom where words are hard, and gentleness where hearts are tender. Let our homes be places of safety and grace. Amen.'
      },
      {
        title: 'For Those Missing Someone',
        body: 'God, You see the empty chair and the unanswered message. We pray for everyone grieving a separation within their family. Comfort them in the quiet, and give them strength to take the next step. Amen.'
      }
    ]
  },
  {
    id: 'anxiety',
    label: 'Prayer for Anxiety & Peace',
    prayers: [
      {
        title: 'Peace for Anxious Hearts',
        body: 'Lord, You know the thoughts that keep us awake. We bring them to You now, one by one. Replace the spiral of worry with the steady rhythm of Your presence, and teach us to breathe again. Amen.'
      },
      {
        title: 'When the Mind Will Not Rest',
        body: 'Father, be near to everyone watching whose mind is racing tonight. Help them set down what they cannot control and hold on to what is true. Give them a quiet hour and a softer heart. Amen.'
      },
      {
        title: 'Let Us Be Still',
        body: 'God of peace, we stop for a moment and remember that You are here. Quiet the noise around us and within us. Where fear has taken up space, make room for trust. Amen.'
      }
    ]
  },
  {
    id: 'finances',
    label: 'Prayer for Financial Hardship',
    prayers: [
      {
        title: 'For Those Carrying Financial Weight',
        body: 'Lord, You see every bill, every worry, and every sleepless night about money. Provide what is needed, one day at a time, and give wisdom for the decisions ahead. Remind us that our worth is not measured by what we have. Amen.'
      },
      {
        title: 'Provision and Peace',
        body: 'Father, we pray for everyone stretched thin this month. Open doors of honest work, surround them with people who can help, and guard them from shame. Give them enough for today and hope for tomorrow. Amen.'
      },
      {
        title: 'When Work Is Uncertain',
        body: 'God, we lift up those waiting to hear back, those between jobs, and those working too many hours. Grant them patience, favor, and a community that shares the load. Let them know they are not alone in this season. Amen.'
      }
    ]
  },
  {
    id: 'strength',
    label: 'Prayer for Strength',
    prayers: [
      {
        title: 'Strength for the Weary',
        body: 'Lord, we pray for everyone who is tired in a way that sleep does not fix. Renew their strength from the inside out. Give them one clear step for today and the grace to keep going. Amen.'
      },
      {
        title: 'When We Feel Weak',
        body: 'Father, thank You that we do not have to be strong all the time. Meet us in our weakness and be our strength. Hold us up when our own hands are tired. Amen.'
      },
      {
        title: 'Courage to Continue',
        body: 'God, You have carried us this far. Give us courage to continue, patience to wait well, and people beside us who will not let us walk alone. Amen.'
      }
    ]
  },
  {
    id: 'night',
    label: 'Night Prayer',
    prayers: [
      {
        title: 'Before We Sleep',
        body: 'Father, thank You for bringing us to the end of this day. We release what went wrong and hold on to what was good. Watch over our homes tonight, and give us rest. Amen.'
      },
      {
        title: 'Into Your Hands',
        body: 'Lord, we place tonight into Your hands. Quiet the replay of today\u2019s worries, and give rest to every anxious thought. Keep watch over those we love while we sleep. Amen.'
      },
      {
        title: 'For Those Awake Tonight',
        body: 'God, be with everyone working through the night, driving, caring, or waiting. Give them safety and strength. And for those who cannot sleep, be a gentle presence in the dark. Amen.'
      }
    ]
  },
  {
    id: 'gratitude',
    label: 'Prayer of Gratitude',
    prayers: [
      {
        title: 'A Thankful Heart',
        body: 'Father, thank You for the small things we often forget to notice: a meal, a friend\u2019s voice, a moment of quiet. Teach us to receive today with open hands. Let gratitude shape the way we speak to one another. Amen.'
      },
      {
        title: 'Counting Gifts',
        body: 'Lord, we stop to name what is good in this day, even if it is only one thing. Thank You for kindness shown to us and for the chance to show kindness to someone else. Amen.'
      },
      {
        title: 'Thank You for This Community',
        body: 'God, thank You for every person watching right now, and for the faith, hope, and love they bring here. Bless them as they have blessed this community. Amen.'
      }
    ]
  }
];

const COMMUNITY_PRAYERS = [
  {
    title: 'Our Community in Prayer',
    body: 'As we pray together, let us remember that we are not alone. If you are praying for someone today, you are part of something larger than this screen. Let us hold one another with hope.',
    note: 'Type PRAY FOR ME in the comments and our community will pray with you.'
  },
  {
    title: 'Carrying Each Other',
    body: 'Faith grows when it is shared. Let us carry one another\u2019s burdens in prayer today, gently and without judgment. Nothing brought here is too small to matter.',
    note: 'Share your prayer request in the comments. We will pray with you.'
  },
  {
    title: 'A Place to Belong',
    body: 'Wherever you are watching from, you are welcome here. Let us pray for the names we hold in our hearts and for the people beside us in this chat.',
    note: 'Type PRAY FOR ME and let this community stand with you.'
  }
];

const WELCOME_GREETINGS = [
  'Welcome, {name}! We are so glad you are here. May God\u2019s peace be with you today.',
  'Welcome, {name}. Thank you for joining us in prayer. You are not alone here.',
  'Welcome, {name}! Faith, hope and love are stronger when we gather. God bless you.',
  'It is good to see you, {name}. Take a breath, and let us pray together.',
  'Welcome to the prayer community, {name}. May you find peace in this moment.'
];

const GENERIC_REFLECTIONS = [
  'Let this word settle in your heart today. You do not have to carry everything at once.',
  'Read it slowly. Let one phrase stay with you through the rest of your day.',
  'Scripture meets us where we are. Take what you need from these words today.'
];

const DISPLAY_MS = {
  welcome: 9000,
  verse: 15000,
  reflection: 15000,
  prayer: 17000,
  community: 15000,
  gratitude: 15000
};

/** Church references read better aloud as "Psalm 23, verse 1". */
function speakableReference(reference) {
  return String(reference || '')
    .replace(/\s*\((KJV|NIV|ESV|NKJV)\)\s*/i, '')
    .replace(/:(\d+)/, ', verse $1')
    .trim();
}

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Pace multiplies how long each segment holds (Gentle 1.3 → Frequent 0.75). */
function paceScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(0.5, Math.min(1.5, num));
}

function themeById(id) {
  return PRAYER_THEMES.find((theme) => theme.id === id) || null;
}

function sequenceLabel(kind) {
  const item = SHOW_SEQUENCE.find((entry) => entry.kind === kind);
  return item ? item.label : 'Live program';
}

class ShowProgram {
  constructor(options = {}) {
    this.getSettings = options.getSettings || (() => DEFAULT_SHOW_SETTINGS);
    this.getVerses = options.getVerses || (() => []);
    this.getApprovedPrayers = options.getApprovedPrayers || (() => []);
    this.publish = options.publish || (async () => {});
    this.onChange = options.onChange || (() => {});

    this.index = -1;
    this.timer = null;
    this.nextAt = null;
    this.remainingMs = null;
    this.currentCue = null;
    this.recentVerses = [];
    this.recentThemes = [];
    this.recentPrayers = [];
    this.recentGreetings = [];
    this.recentWelcomes = [];
    this.welcomed = new Map();
    this.lastWelcomeAt = 0;
  }

  get settings() {
    return { ...DEFAULT_SHOW_SETTINGS, ...(this.getSettings() || {}) };
  }

  /* ---------------------------------------------------------------------
     Public status
     --------------------------------------------------------------------- */
  status() {
    const settings = this.settings;
    const total = SHOW_SEQUENCE.length;
    const safeIndex = this.index >= 0 ? this.index % total : -1;
    const currentItem = safeIndex >= 0 ? SHOW_SEQUENCE[safeIndex] : null;
    const nextItem = SHOW_SEQUENCE[(safeIndex + 1 + total) % total];
    const current = currentItem
      ? {
          index: safeIndex + 1,
          kind: currentItem.kind,
          label: currentItem.label,
          seconds: currentItem.seconds,
          title: this.currentCue?.title || '',
          eyebrow: this.currentCue?.eyebrow || '',
          startedAt: this.currentCue?.at || null
        }
      : null;
    return {
      enabled: settings.enabled,
      paused: settings.paused,
      welcomeEnabled: settings.welcomeEnabled,
      narration: settings.narration,
      theme: settings.theme,
      pace: paceScale(settings.pace),
      running: Boolean(this.timer),
      index: safeIndex,
      total,
      current,
      next: {
        index: ((safeIndex + 1 + total) % total) + 1,
        kind: nextItem.kind,
        label: nextItem.label,
        seconds: nextItem.seconds
      },
      nextAt: this.nextAt ? new Date(this.nextAt).toISOString() : null,
      remainingSeconds: this.nextAt ? Math.max(0, Math.round((this.nextAt - Date.now()) / 1000)) : null,
      themes: PRAYER_THEMES.map((theme) => ({ id: theme.id, label: theme.label })),
      sequence: SHOW_SEQUENCE.map((item, position) => ({
        position: position + 1,
        kind: item.kind,
        label: item.label,
        seconds: item.seconds
      })),
      recentVerses: this.recentVerses.slice(),
      welcomesSent: this.welcomed.size
    };
  }

  /* ---------------------------------------------------------------------
     Timer
     --------------------------------------------------------------------- */
  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(ms) {
    this.clearTimer();
    const settings = this.settings;
    if (!settings.enabled || settings.paused) {
      this.nextAt = null;
      this.remainingMs = null;
      return;
    }
    const delay = Math.max(5000, Number(ms) || 0);
    this.nextAt = Date.now() + delay;
    this.remainingMs = null;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance({ source: 'auto' });
    }, delay);
  }

  /** Starts the program: emits the first segment immediately, then cycles. */
  start({ immediate = true } = {}) {
    const settings = this.settings;
    if (!settings.enabled || settings.paused) {
      this.stop();
      return this.status();
    }
    if (immediate && this.index < 0) {
      this.emitAt(0, { source: 'auto' });
      return this.status();
    }
    if (!this.timer) {
      const restore = this.remainingMs && this.remainingMs > 5000
        ? this.remainingMs
        : SHOW_SEQUENCE[(this.index + 1) % SHOW_SEQUENCE.length].seconds * 1000 * paceScale(settings.pace);
      this.schedule(restore);
    }
    return this.status();
  }

  stop() {
    this.clearTimer();
    this.nextAt = null;
    return this.status();
  }

  restart({ source = 'manual' } = {}) {
    this.index = -1;
    this.currentCue = null;
    this.stop();
    if (!this.settings.enabled || this.settings.paused) return this.status();
    this.emitAt(0, { source });
    return this.status();
  }

  /** Applies a settings patch after the server mutates state.settings.show. */
  sync() {
    const settings = this.settings;
    if (!settings.enabled || settings.paused) {
      this.stop();
    } else if (!this.timer) {
      if (this.index < 0) this.start({ immediate: true });
      else this.schedule(this.remainingMs && this.remainingMs > 5000
        ? this.remainingMs
        : SHOW_SEQUENCE[(this.index + 1) % SHOW_SEQUENCE.length].seconds * 1000 * paceScale(settings.pace));
    }
    this.onChange();
    return this.status();
  }

  advance({ source = 'auto' } = {}) {
    const nextIndex = (this.index + 1) % SHOW_SEQUENCE.length;
    return this.emitAt(nextIndex, { source });
  }

  emitAt(index, { source = 'auto', overrideCue = null } = {}) {
    const item = SHOW_SEQUENCE[index];
    if (!item) return null;
    const cue = overrideCue || this.buildCue(item);
    if (!cue) return null;
    this.index = index;
    this.currentCue = cue;
    Promise.resolve(this.publish(cue, { source })).catch((err) => {
      console.warn('[Show] Cue publish failed:', err.message);
    });
    this.schedule(item.seconds * 1000 * paceScale(this.settings.pace));
    this.onChange();
    return cue;
  }

  /* ---------------------------------------------------------------------
     Manual controls
     --------------------------------------------------------------------- */
  nextSegment(source = 'manual') {
    return this.advance({ source });
  }

  nextVerse(source = 'manual') {
    const cue = this.buildVerseCue('verse');
    if (!cue) return null;
    return this.emitManual(cue, source, 75000);
  }

  nextReflection(source = 'manual') {
    const cue = this.buildVerseCue('reflection');
    if (!cue) return null;
    return this.emitManual(cue, source, 90000);
  }

  nextPrayer(source = 'manual', themeId = null) {
    const theme = themeId ? themeById(themeId) : this.pickTheme();
    if (!theme) return null;
    const cue = this.buildPrayerCue(theme);
    return this.emitManual(cue, source, 120000);
  }

  nextGratitude(source = 'manual') {
    const theme = themeById('gratitude');
    const cue = this.buildPrayerCue(theme, 'gratitude');
    return this.emitManual(cue, source, 90000);
  }

  /** Emits a one-off cue without disturbing the running program for long. */
  emitManual(cue, source, holdMs) {
    if (!cue) return null;
    this.currentCue = cue;
    Promise.resolve(this.publish(cue, { source })).catch((err) => {
      console.warn('[Show] Cue publish failed:', err.message);
    });
    const settings = this.settings;
    if (settings.enabled && !settings.paused) {
      // Give manual cues breathing room, then resume the normal schedule.
      const scheduled = this.nextAt ? Math.max(0, this.nextAt - Date.now()) : 0;
      this.schedule(Math.max(scheduled, holdMs));
    }
    this.onChange();
    return cue;
  }

  /* ---------------------------------------------------------------------
     Welcomes (real TikTok joins only)
     --------------------------------------------------------------------- */
  welcome({ name, uniqueId } = {}, source = 'tiktok') {
    if (source !== 'tiktok') return null;
    const settings = this.settings;
    if (!settings.welcomeEnabled) return null;
    const displayName = String(name || '').trim();
    if (!displayName || displayName === 'Friend') return null;

    const key = String(uniqueId || displayName).toLowerCase();
    const now = Date.now();
    const last = this.welcomed.get(key) || 0;
    if (now - last < 45 * 60 * 1000) return null;
    if (now - this.lastWelcomeAt < 20000) return null;
    const recentCount = this.recentWelcomes.filter((at) => now - at < 120000).length;
    if (recentCount >= 3) return null;
    if (this.welcomed.size > 4000) this.welcomed.clear();

    this.welcomed.set(key, now);
    this.lastWelcomeAt = now;
    this.recentWelcomes = [...this.recentWelcomes.filter((at) => now - at < 600000), now];

    const greeting = this.renderGreeting(displayName);
    // The card title already greets the viewer; avoid repeating the name in the
    // body while keeping the full sentence for narration.
    const prefix = `Welcome, ${displayName}`;
    const displayBody = greeting.startsWith(prefix)
      ? greeting.slice(prefix.length).replace(/^[!.,\s]+/, '')
      : greeting;
    const cue = {
      id: `cue_${now}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'welcome',
      eyebrow: 'WELCOME',
      title: `Welcome, ${displayName}`,
      body: displayBody || greeting,
      name: displayName,
      note: 'God bless you for joining us in prayer.',
      displayMs: DISPLAY_MS.welcome,
      ttsText: greeting,
      at: new Date(now).toISOString()
    };
    Promise.resolve(this.publish(cue, { source })).catch((err) => {
      console.warn('[Show] Welcome publish failed:', err.message);
    });
    this.onChange();
    return cue;
  }

  /** Test welcomes are clearly labelled and never counted as real viewers. */
  testWelcome(name = 'Test Viewer (demo)') {
    const safeName = String(name || 'Test Viewer').slice(0, 40);
    const greeting = this.renderGreeting(safeName);
    const prefix = `Welcome, ${safeName}`;
    const displayBody = greeting.startsWith(prefix)
      ? greeting.slice(prefix.length).replace(/^[!.,\s]+/, '')
      : greeting;
    const cue = {
      id: `cue_${Date.now()}_test`,
      kind: 'welcome',
      eyebrow: 'WELCOME · TEST',
      title: `Welcome, ${safeName}`,
      body: displayBody || greeting,
      name: safeName,
      note: 'Sample welcome — no real viewer joined.',
      displayMs: DISPLAY_MS.welcome,
      ttsText: greeting,
      simulated: true,
      at: new Date().toISOString()
    };
    Promise.resolve(this.publish(cue, { source: 'test' })).catch((err) => {
      console.warn('[Show] Test welcome failed:', err.message);
    });
    this.onChange();
    return cue;
  }

  renderGreeting(name) {
    const pool = WELCOME_GREETINGS.filter((template) => !this.recentGreetings.includes(template));
    const template = pickRandom(pool.length > 0 ? pool : WELCOME_GREETINGS) || WELCOME_GREETINGS[0];
    this.recentGreetings.push(template);
    if (this.recentGreetings.length > 12) this.recentGreetings.shift();
    return template.replace(/\{name\}/g, name);
  }

  /* ---------------------------------------------------------------------
     Cue builders
     --------------------------------------------------------------------- */
  buildCue(item) {
    switch (item.kind) {
      case 'welcome':
        return this.buildOpeningCue();
      case 'verse':
      case 'reflection':
        return this.buildVerseCue(item.kind);
      case 'prayer':
        return this.buildPrayerCue(this.pickTheme());
      case 'gratitude':
        return this.buildPrayerCue(themeById('gratitude'), 'gratitude');
      case 'community':
        return this.buildCommunityCue();
      default:
        return null;
    }
  }

  buildOpeningCue() {
    const verses = this.getVerses() || [];
    const verse = this.pickVerse(verses);
    const body = 'Welcome to Christian Prayer Live. Thank you for pausing here. '
      + 'Wherever this day has taken you, you are welcome in this moment of prayer. '
      + 'Let us begin together.';
    return {
      id: `cue_${Date.now()}`,
      kind: 'welcome',
      eyebrow: 'WELCOME',
      title: 'Peace Be With You',
      body,
      note: verse ? `${verse.reference}` : 'Faith \u2022 Hope \u2022 Love',
      reference: verse ? verse.reference : '',
      displayMs: DISPLAY_MS.welcome,
      ttsText: body,
      at: new Date().toISOString()
    };
  }

  pickVerse(pool = this.getVerses()) {
    const verses = (pool || []).filter((verse) => verse && verse.text && verse.reference);
    if (verses.length === 0) return null;
    const fresh = verses.filter((verse) => !this.recentVerses.includes(verse.reference));
    const chosen = pickRandom(fresh.length > 0 ? fresh : verses) || verses[0];
    this.recentVerses = [chosen.reference, ...this.recentVerses.filter((ref) => ref !== chosen.reference)].slice(0, 5);
    return chosen;
  }

  buildVerseCue(kind) {
    const verse = this.pickVerse();
    if (!verse) return null;
    const reflection = String(verse.reflection || pickRandom(GENERIC_REFLECTIONS) || '').trim();
    const spokenRef = speakableReference(verse.reference);

    if (kind === 'reflection') {
      return {
        id: `cue_${Date.now()}`,
        kind: 'reflection',
        eyebrow: 'BIBLE REFLECTION',
        title: verse.reference,
        body: reflection,
        note: `\u201c${verse.text}\u201d`,
        reference: verse.reference,
        verse: { text: verse.text, reference: verse.reference },
        displayMs: DISPLAY_MS.reflection,
        ttsText: `${reflection} This is from ${spokenRef}.`,
        at: new Date().toISOString()
      };
    }

    return {
      id: `cue_${Date.now()}`,
      kind: 'verse',
      eyebrow: 'VERSE OF THE MOMENT',
      title: 'A Word for Today',
      body: verse.text,
      note: reflection,
      reference: verse.reference,
      verse: { text: verse.text, reference: verse.reference },
      displayMs: DISPLAY_MS.verse,
      ttsText: `${verse.text} ${spokenRef}. ${reflection}`,
      at: new Date().toISOString()
    };
  }

  pickTheme() {
    const settings = this.settings;
    if (settings.theme && settings.theme !== 'auto') {
      const pinned = themeById(settings.theme);
      if (pinned) return pinned;
    }
    const fresh = PRAYER_THEMES.filter((theme) => !this.recentThemes.includes(theme.id));
    const chosen = pickRandom(fresh.length > 0 ? fresh : PRAYER_THEMES);
    if (!chosen) return null;
    this.recentThemes = [chosen.id, ...this.recentThemes.filter((id) => id !== chosen.id)].slice(0, 4);
    return chosen;
  }

  pickPrayer(theme) {
    const pool = (theme && Array.isArray(theme.prayers)) ? theme.prayers : [];
    if (pool.length === 0) return null;
    const fresh = pool.filter((prayer) => !this.recentPrayers.includes(prayer.title));
    const chosen = pickRandom(fresh.length > 0 ? fresh : pool) || pool[0];
    this.recentPrayers = [chosen.title, ...this.recentPrayers.filter((title) => title !== chosen.title)].slice(0, 6);
    return chosen;
  }

  buildPrayerCue(theme, kind = 'prayer') {
    if (!theme) return null;
    const prayer = this.pickPrayer(theme);
    if (!prayer) return null;
    return {
      id: `cue_${Date.now()}`,
      kind,
      theme: theme.id,
      eyebrow: theme.label.toUpperCase(),
      title: prayer.title,
      body: prayer.body,
      note: '',
      displayMs: DISPLAY_MS[kind] || DISPLAY_MS.prayer,
      ttsText: kind === 'gratitude' ? prayer.body : `Let us pray together. ${prayer.body}`,
      at: new Date().toISOString()
    };
  }

  buildCommunityCue() {
    const base = pickRandom(COMMUNITY_PRAYERS) || COMMUNITY_PRAYERS[0];
    const requests = (this.getApprovedPrayers() || []).filter((request) => request && request.name);
    const request = requests.length > 0
      ? requests[Math.floor(Math.random() * requests.length)]
      : null;

    if (!request) {
      return {
        id: `cue_${Date.now()}`,
        kind: 'community',
        eyebrow: 'COMMUNITY PRAYER',
        title: base.title,
        body: base.body,
        note: base.note,
        displayMs: DISPLAY_MS.community,
        ttsText: `${base.body} ${base.note}`,
        at: new Date().toISOString()
      };
    }

    const displayName = String(request.name).slice(0, 30);
    return {
      id: `cue_${Date.now()}`,
      kind: 'community',
      eyebrow: 'PRAYER WALL',
      title: base.title,
      body: `${displayName} has asked for prayer${request.text ? `: \u201c${String(request.text).slice(0, 110)}\u201d` : '.'}`,
      note: base.note,
      name: displayName,
      displayMs: DISPLAY_MS.community,
      // The submitted text is shown on the wall, but narration uses only the
      // first name so personal details are never read aloud.
      ttsText: `${base.body} Let us pray for ${displayName}, who has asked for prayer today. ${base.note}`,
      at: new Date().toISOString()
    };
  }
}

module.exports = {
  ShowProgram,
  SHOW_SEQUENCE,
  PRAYER_THEMES,
  WELCOME_GREETINGS,
  DEFAULT_SHOW_SETTINGS,
  DISPLAY_MS,
  speakableReference,
  sequenceLabel
};
