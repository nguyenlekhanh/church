/**
 * Christian Prayer Live — Smart Daily Schedule.
 *
 * Chooses one of four programming modes (Morning / Afternoon / Evening / Night)
 * from the wall clock of a US IANA timezone. All boundary maths uses the
 * timezone's own wall clock through Intl.DateTimeFormat, so daylight saving
 * changes and midnight wraparound never need a hardcoded UTC offset.
 *
 * The engine owns only the schedule and its persisted settings. Applying the
 * content of a program (prayers, quiz cadence, music, backgrounds) is delegated
 * to the server so the existing show / quiz / music / stage engines remain the
 * single source of truth.
 */
const fs = require('fs');
const path = require('path');

const TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern — New York' },
  { id: 'America/Chicago', label: 'Central — Chicago' },
  { id: 'America/Denver', label: 'Mountain — Denver' },
  { id: 'America/Phoenix', label: 'Arizona — Phoenix (no DST)' },
  { id: 'America/Los_Angeles', label: 'Pacific — Los Angeles' },
  { id: 'America/Anchorage', label: 'Alaska — Anchorage' },
  { id: 'Pacific/Honolulu', label: 'Hawaii — Honolulu' }
];

const DEFAULT_TIMEZONE = 'America/Chicago';
const OVERRIDE_MINUTES = { min: 5, max: 720, fallback: 30 };

const PROGRAM_DEFAULTS = {
  id: '',
  label: 'Prayer Program',
  start: '00:00',
  end: '00:00',
  atmosphere: '',
  theme: 'auto',
  prayerThemes: [],
  verseTags: [],
  quizFrequencyMinutes: 10,
  narrationPace: 1,
  musicCategories: [],
  backgroundCategories: [],
  welcomeEnabled: true,
  giftAnnounce: true,
  giftTts: true,
  communityEngagement: true
};

const formatterCache = new Map();

function formatterFor(timezone, options) {
  const key = `${timezone}|${options.key}`;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      ...options.format
    }));
  }
  return formatterCache.get(key);
}

function isValidTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
}

/** Wall-clock parts for a timestamp in a specific IANA timezone. */
function localParts(timestamp, timezone = DEFAULT_TIMEZONE) {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  const date = new Date(Number(timestamp) || Date.now());
  const parts = formatterFor(tz, {
    key: 'parts',
    format: {
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long'
    }
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  // Some ICU builds render midnight as 24; normalise without touching offsets.
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute) || 0;
  const second = Number(map.second) || 0;
  const secondsOfDay = hour * 3600 + minute * 60 + second;

  let offsetLabel = '';
  try {
    const offsetParts = formatterFor(tz, {
      key: 'offset',
      format: { timeZoneName: 'shortOffset' }
    }).formatToParts(date);
    offsetLabel = offsetParts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch (_) {
    offsetLabel = '';
  }

  return {
    timezone: tz,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute,
    second,
    weekday: map.weekday || '',
    minutesOfDay: hour * 60 + minute,
    secondsOfDay,
    clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
    clock12: new Date(2000, 0, 1, hour, minute, second).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }),
    dateLabel: `${map.weekday || ''}, ${map.month}/${map.day}/${map.year}`.replace(/^,\s*/, ''),
    offsetLabel
  };
}

/** "05:00" → 300. Returns null for anything that is not a valid clock time. */
function parseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatClock(minutes) {
  const value = ((Number(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function stringList(value, max = 12) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max);
}

function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

class ScheduleError extends Error {}

class SmartSchedule {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(__dirname, '..', 'config', 'schedule.json');
    this.backupPath = options.backupPath || path.join(__dirname, '..', 'config', 'schedule.backup.json');
    this.now = options.now || (() => Date.now());
    this.onChange = options.onChange || (() => {});
    this.onSaveError = options.onSaveError || ((err) => console.warn('[Schedule]', err.message));
    this.timer = null;
    this.intervalMs = clampNumber(options.intervalMs, 5000, 300000, 20000);
    this.appliedId = null;
    this.appliedSignature = null;
    this.appliedSource = null;
    this.lastTransitionAt = null;
    this.transitionCount = 0;
    this.lastError = null;
    this.config = this.load();
    this.validate(this.config);
  }

  /* ---------------------------------------------------------------- config */
  load() {
    const fallback = {
      version: 1,
      enabled: true,
      timezone: DEFAULT_TIMEZONE,
      override: { programId: null, until: null, startedAt: null, durationMinutes: null },
      programs: []
    };
    try {
      if (!fs.existsSync(this.filePath)) return fallback;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        ...fallback,
        ...raw,
        enabled: raw.enabled !== false,
        timezone: isValidTimezone(raw.timezone) ? raw.timezone : DEFAULT_TIMEZONE,
        override: { ...fallback.override, ...(raw.override || {}) },
        programs: (Array.isArray(raw.programs) ? raw.programs : []).map((program) => ({
          ...PROGRAM_DEFAULTS,
          ...program,
          start: formatClock(parseClock(program.start) ?? 0),
          end: formatClock(parseClock(program.end) ?? 0)
        }))
      };
    } catch (err) {
      this.lastError = `Could not read schedule.json: ${err.message}`;
      console.warn(`[Schedule] ${this.lastError}`);
      return fallback;
    }
  }

  validate(config = this.config) {
    if (!Array.isArray(config.programs) || config.programs.length < 2) {
      throw new ScheduleError('A schedule needs at least two programs.');
    }
    const ids = new Set();
    for (const program of config.programs) {
      if (!program.id) throw new ScheduleError('Every program needs an id.');
      if (ids.has(program.id)) throw new ScheduleError(`Duplicate program id: ${program.id}`);
      ids.add(program.id);
      if (parseClock(program.start) === null || parseClock(program.end) === null) {
        throw new ScheduleError(`Program ${program.id} has an invalid start or end time.`);
      }
      if (parseClock(program.start) === parseClock(program.end)) {
        throw new ScheduleError(`Program ${program.id} cannot start and end at the same time.`);
      }
    }
    const sorted = [...config.programs].sort((a, b) => parseClock(a.start) - parseClock(b.start));
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[(index + 1) % sorted.length];
      if (parseClock(current.end) !== parseClock(next.start)) {
        throw new ScheduleError(
          `Programs must cover the whole day without gaps or overlaps: ${current.id} ends at ${current.end} but ${next.id} starts at ${next.start}.`
        );
      }
    }
    return true;
  }

  save() {
    try {
      this.validate(this.config);
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
      atomicWriteJson(this.filePath, this.config);
      this.lastError = null;
      return true;
    } catch (err) {
      this.lastError = err.message;
      this.onSaveError(err);
      throw err;
    }
  }

  /* --------------------------------------------------------------- lookups */
  get programs() {
    return [...this.config.programs]
      .sort((a, b) => parseClock(a.start) - parseClock(b.start))
      .map((program) => ({
        ...program,
        startMinutes: parseClock(program.start),
        endMinutes: parseClock(program.end),
        wrapsMidnight: parseClock(program.end) < parseClock(program.start)
      }));
  }

  programById(id) {
    return this.programs.find((program) => program.id === id) || null;
  }

  programAtMinute(minute) {
    const value = ((Number(minute) % 1440) + 1440) % 1440;
    return this.programs.find((program) => {
      if (program.wrapsMidnight) return value >= program.startMinutes || value < program.endMinutes;
      return value >= program.startMinutes && value < program.endMinutes;
    }) || null;
  }

  activeOverride(now = this.now()) {
    const override = this.config.override || {};
    if (!override.programId || !override.until) return null;
    const until = new Date(override.until).getTime();
    if (!Number.isFinite(until) || until <= now) return null;
    const program = this.programById(override.programId);
    if (!program) return null;
    return { ...override, program, untilMs: until, remainingSeconds: Math.max(0, Math.round((until - now) / 1000)) };
  }

  /** The program that should be applied right now (override wins). */
  current(now = this.now()) {
    const override = this.activeOverride(now);
    const parts = localParts(now, this.config.timezone);
    const scheduled = this.programAtMinute(parts.minutesOfDay);
    return {
      now,
      parts,
      scheduled,
      override,
      program: override ? override.program : scheduled,
      mode: override ? 'manual' : 'auto'
    };
  }

  secondsUntilEnd(program, parts) {
    if (!program) return null;
    const endSeconds = program.endMinutes * 60;
    let delta = endSeconds - parts.secondsOfDay;
    if (delta <= 0) delta += 86400;
    const total = (program.wrapsMidnight
      ? (program.endMinutes + 1440 - program.startMinutes)
      : (program.endMinutes - program.startMinutes)) * 60;
    return { remaining: delta, totalSeconds: Math.max(60, total) };
  }

  /* ------------------------------------------------------------ operations */
  update(patch = {}, { persist = true } = {}) {
    if (typeof patch.enabled === 'boolean') this.config.enabled = patch.enabled;
    if (patch.timezone !== undefined) {
      if (!isValidTimezone(patch.timezone)) {
        throw new ScheduleError(`Unknown IANA timezone: ${patch.timezone}`);
      }
      this.config.timezone = patch.timezone;
    }
    if (persist) this.save();
    return this.payload();
  }

  updateProgram(id, patch = {}) {
    const index = this.config.programs.findIndex((program) => program.id === id);
    if (index === -1) throw new ScheduleError(`Unknown program: ${id}`);
    const program = { ...this.config.programs[index] };
    if (patch.start !== undefined) {
      const minutes = parseClock(patch.start);
      if (minutes === null) throw new ScheduleError('Start time must look like 05:00.');
      program.start = formatClock(minutes);
    }
    if (patch.end !== undefined) {
      const minutes = parseClock(patch.end);
      if (minutes === null) throw new ScheduleError('End time must look like 11:00.');
      program.end = formatClock(minutes);
    }
    if (typeof patch.label === 'string' && patch.label.trim()) program.label = patch.label.trim().slice(0, 80);
    if (typeof patch.atmosphere === 'string') program.atmosphere = patch.atmosphere.slice(0, 160);
    if (typeof patch.theme === 'string') program.theme = patch.theme.slice(0, 40);
    if (patch.prayerThemes !== undefined) program.prayerThemes = stringList(patch.prayerThemes);
    if (patch.verseTags !== undefined) program.verseTags = stringList(patch.verseTags, 16);
    if (patch.musicCategories !== undefined) program.musicCategories = stringList(patch.musicCategories);
    if (patch.backgroundCategories !== undefined) {
      program.backgroundCategories = stringList(patch.backgroundCategories);
    }
    if (patch.quizFrequencyMinutes !== undefined) {
      program.quizFrequencyMinutes = clampNumber(patch.quizFrequencyMinutes, 2, 120, program.quizFrequencyMinutes);
    }
    if (patch.narrationPace !== undefined) {
      program.narrationPace = clampNumber(patch.narrationPace, 0.5, 1.5, program.narrationPace);
    }
    if (typeof patch.welcomeEnabled === 'boolean') program.welcomeEnabled = patch.welcomeEnabled;
    if (typeof patch.giftAnnounce === 'boolean') program.giftAnnounce = patch.giftAnnounce;
    if (typeof patch.giftTts === 'boolean') program.giftTts = patch.giftTts;
    if (typeof patch.communityEngagement === 'boolean') program.communityEngagement = patch.communityEngagement;

    const nextPrograms = [...this.config.programs];
    nextPrograms[index] = program;

    // A day must stay continuous. Editing one boundary moves the shared edge of
    // the neighbouring program instead of forcing the admin to edit two cards.
    const ordered = nextPrograms
      .map((entry, position) => ({ entry, position, start: parseClock(entry.start) }))
      .sort((a, b) => a.start - b.start);
    const slot = ordered.findIndex((item) => item.position === index);
    if (slot !== -1 && patch.start !== undefined) {
      const previous = ordered[(slot - 1 + ordered.length) % ordered.length];
      previous.entry.end = program.start;
    }
    if (slot !== -1 && patch.end !== undefined) {
      const next = ordered[(slot + 1) % ordered.length];
      next.entry.start = program.end;
    }

    const candidate = { ...this.config, programs: nextPrograms };
    this.validate(candidate);
    this.config = candidate;
    this.save();
    return this.payload();
  }

  setOverride(programId, durationMinutes = OVERRIDE_MINUTES.fallback, now = this.now()) {
    const program = this.programById(programId);
    if (!program) throw new ScheduleError(`Unknown program: ${programId}`);
    const minutes = clampNumber(durationMinutes, OVERRIDE_MINUTES.min, OVERRIDE_MINUTES.max, OVERRIDE_MINUTES.fallback);
    this.config.override = {
      programId: program.id,
      startedAt: new Date(now).toISOString(),
      until: new Date(now + minutes * 60000).toISOString(),
      durationMinutes: minutes
    };
    this.save();
    return this.payload(now);
  }

  clearOverride() {
    this.config.override = { programId: null, until: null, startedAt: null, durationMinutes: null };
    this.save();
    return this.payload();
  }

  /* ------------------------------------------------------------- ticking */
  tick(now = this.now()) {
    const state = this.current(now);
    if (!state.program) return null;

    // An override that has elapsed is removed once, never twice.
    const staleOverride = this.config.override?.programId && !state.override;
    if (staleOverride) {
      this.config.override = { programId: null, until: null, startedAt: null, durationMinutes: null };
      try {
        this.save();
      } catch (_) {}
    }

    if (!this.config.enabled) {
      if (this.appliedSource !== 'disabled') {
        this.appliedId = null;
        this.appliedSignature = null;
        this.appliedSource = 'disabled';
        this.onChange(null, null, { reason: 'disabled', now });
      }
      return state;
    }

    const source = state.override ? 'override' : 'scheduled';
    const signature = `${state.program.id}:${source}:${state.override?.until || ''}`;
    if (signature !== this.appliedSignature) {
      const previousId = this.appliedId;
      this.appliedId = state.program.id;
      this.appliedSignature = signature;
      this.appliedSource = source;
      this.lastTransitionAt = new Date(now).toISOString();
      this.transitionCount += 1;
      this.onChange(state.program, previousId, {
        reason: staleOverride ? 'override-expired' : source,
        now,
        mode: state.mode
      });
    }
    return state;
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.lastError = err.message;
        console.warn('[Schedule] Tick failed:', err.message);
      }
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* -------------------------------------------------------------- payload */
  payload(now = this.now()) {
    const state = this.current(now);
    const parts = state.parts;
    const current = state.program;
    const timing = current ? this.secondsUntilEnd(current, parts) : null;
    const next = current ? this.programs.find((program) => program.startMinutes === current.endMinutes) : null;

    return {
      enabled: this.config.enabled,
      timezone: this.config.timezone,
      timezoneOptions: TIMEZONES,
      mode: !this.config.enabled ? 'disabled' : state.mode,
      automatic: this.config.enabled && !state.override,
      local: {
        ...parts,
        label: `${parts.clock12} · ${parts.offsetLabel || this.config.timezone}`,
        iso: new Date(now).toISOString()
      },
      current: current
        ? {
            id: current.id,
            label: current.label,
            title: current.label,
            atmosphere: current.atmosphere,
            start: current.start,
            end: current.end,
            wrapsMidnight: current.wrapsMidnight,
            dayProgress: timing
              ? Math.min(1, Math.max(0, 1 - timing.remaining / timing.totalSeconds))
              : null,
            elapsedSeconds: timing ? Math.max(0, timing.totalSeconds - timing.remaining) : null
          }
        : null,
      next: next
        ? { id: next.id, label: next.label, start: next.start }
        : null,
      remainingSeconds: timing ? timing.remaining : null,
      override: state.override
        ? {
            programId: state.override.program.id,
            programLabel: state.override.program.label,
            startedAt: state.override.startedAt,
            until: state.override.until,
            durationMinutes: state.override.durationMinutes,
            remainingSeconds: state.override.remainingSeconds
          }
        : null,
      programs: this.programs.map((program) => ({
        ...program,
        active: Boolean(current && program.id === current.id),
        scheduledNow: Boolean(state.scheduled && program.id === state.scheduled.id)
      })),
      transitions: {
        count: this.transitionCount,
        lastAt: this.lastTransitionAt,
        applied: this.appliedId,
        source: this.appliedSource
      },
      error: this.lastError
    };
  }

  /** Test helper: does the schedule agree with the wall clock it sees? */
  debug(now = this.now()) {
    return {
      timezone: this.config.timezone,
      local: localParts(now, this.config.timezone),
      scheduled: this.programAtMinute(localParts(now, this.config.timezone).minutesOfDay)?.id || null,
      effective: this.current(now).program?.id || null,
      enabled: this.config.enabled
    };
  }
}

module.exports = {
  SmartSchedule,
  ScheduleError,
  TIMEZONES,
  DEFAULT_TIMEZONE,
  PROGRAM_DEFAULTS,
  localParts,
  parseClock,
  formatClock,
  isValidTimezone
};
