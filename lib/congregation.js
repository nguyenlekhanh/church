'use strict';

/**
 * Christian Prayer Live — session-only prayer congregation.
 *
 * TikTok Live Connector emits MEMBER (join) events but no viewer-leave event
 * (WebcastEvent has MEMBER, but no LEFT/EXIT equivalent). Participants are
 * therefore removed only by the configured inactivity timeout, never by a
 * fabricated "left" event. Nothing here is written to disk: the congregation is
 * live-session state only, and only the minimum fields are kept.
 */

const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  enabled: true,
  showNames: true,
  inactivityMinutes: 20,
  maxVisible: 50
};

const DEMO_NAMES = [
  'Sarah M.', 'Michael R.', 'Grace L.', 'David K.', 'Emily T.', 'James P.',
  'Anna B.', 'Daniel W.', 'Ruth C.', 'Noah S.', 'Mary H.', 'Joseph A.',
  'Hannah G.', 'Thomas B.', 'Rachel P.', 'Samuel L.'
];

const MAX_VISIBLE = 80;

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function cleanName(value) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return text || 'Friend';
}

function digest(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10);
}

class Congregation {
  constructor(options = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...(options.settings || {}) };
    this.participants = new Map();
    this.onChange = null;
    this.startedAt = Date.now();
    const interval = Number(options.pruneIntervalMs);
    this.pruneIntervalMs = Number.isFinite(interval) && interval > 0 ? interval : 30000;
    this.pruneTimer = setInterval(() => this.prune(), this.pruneIntervalMs);
    if (this.pruneTimer && typeof this.pruneTimer.unref === 'function') this.pruneTimer.unref();
  }

  stop() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  /** Validates and applies dashboard settings. */
  configure(patch = {}) {
    const next = { ...this.settings };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.showNames === 'boolean') next.showNames = patch.showNames;
    if (patch.inactivityMinutes !== undefined) {
      next.inactivityMinutes = clamp(patch.inactivityMinutes, 1, 180, next.inactivityMinutes);
    }
    if (patch.maxVisible !== undefined) {
      next.maxVisible = clamp(patch.maxVisible, 10, MAX_VISIBLE, next.maxVisible);
    }
    this.settings = next;
    this.reconcileCapacity();
    this.emit('settings');
    return this.getPayload();
  }

  /**
   * A real MEMBER event, or an explicitly labelled demo participant.
   * Duplicate joins for the same uniqueId update the existing seat instead of
   * creating a second participant, and are reported as `created: false`.
   */
  join({ uniqueId, name, source = 'tiktok' } = {}) {
    const rawKey = String(uniqueId || '').trim().slice(0, 64);
    const key = rawKey || `name:${cleanName(name).toLowerCase()}`;
    const participantSource = source === 'demo' ? 'demo' : 'tiktok';
    const now = Date.now();
    const existing = this.participants.get(key);
    if (existing) {
      existing.lastSeen = now;
      const nextName = cleanName(name);
      if (nextName && nextName !== existing.name) existing.name = nextName;
      this.emit('refresh', { id: existing.id });
      return { participant: this.publicParticipant(existing), created: false };
    }

    if (this.participants.size >= this.settings.maxVisible) {
      this.emit('full', { reason: 'capacity' });
      return { participant: null, created: false, full: true };
    }

    const participant = {
      id: `p_${digest(key)}`,
      key,
      name: cleanName(name),
      source: participantSource,
      seat: this.nextSeat(),
      joinedAt: now,
      lastSeen: now,
      marks: { amenAt: 0, prayerAt: 0, giftAt: 0, giftName: '' }
    };
    this.participants.set(key, participant);
    this.emit('join', { id: participant.id, source: participant.source });
    return { participant: this.publicParticipant(participant), created: true };
  }

  /** Presence from comments, likes, follows and shares; never creates a seat. */
  touch({ uniqueId } = {}) {
    const participant = this.find(uniqueId);
    if (!participant) return false;
    participant.lastSeen = Date.now();
    return true;
  }

  markAmen({ uniqueId, simulated = false } = {}) {
    return this.mark('amenAt', { uniqueId, simulated, reason: 'amen' });
  }

  markPrayer({ uniqueId, simulated = false } = {}) {
    return this.mark('prayerAt', { uniqueId, simulated, reason: 'prayer' });
  }

  markGift({ uniqueId, giftName, simulated = false } = {}) {
    const participant = this.eligible(uniqueId, simulated);
    if (!participant) return null;
    const now = Date.now();
    participant.marks.giftAt = now;
    participant.marks.giftName = String(giftName || 'a gift').slice(0, 40);
    participant.lastSeen = now;
    this.emit('gift', { id: participant.id, giftName: participant.marks.giftName });
    return this.publicParticipant(participant);
  }

  mark(field, { uniqueId, simulated = false, reason } = {}) {
    const participant = this.eligible(uniqueId, simulated);
    if (!participant) return null;
    const now = Date.now();
    participant.marks[field] = now;
    participant.lastSeen = now;
    this.emit(reason || field, { id: participant.id });
    return this.publicParticipant(participant);
  }

  additiveDemo(count = 8) {
    const total = clamp(count, 1, 20, 8);
    const demos = [...this.participants.values()].filter((p) => p.source === 'demo');
    let added = 0;
    for (let i = 0; i < total; i += 1) {
      if (this.participants.size >= this.settings.maxVisible) break;
      const uniqueId = `demo_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`;
      const name = DEMO_NAMES[(demos.length + i) % DEMO_NAMES.length];
      const result = this.join({ uniqueId, name, source: 'demo' });
      if (result.created) added += 1;
    }
    if (added === 0) this.emit('demo', { added: 0 });
    return { added, payload: this.getPayload() };
  }

  demoAction({ action = 'amen', index = 0, giftName = 'Prayer candle' } = {}) {
    const demos = [...this.participants.values()]
      .filter((p) => p.source === 'demo')
      .sort((a, b) => a.seat - b.seat);
    if (demos.length === 0) throw new Error('Add demo participants first.');
    const participant = demos[Math.abs(Math.floor(Number(index) || 0)) % demos.length];
    if (action === 'prayer') this.markPrayer({ uniqueId: participant.key, simulated: true });
    else if (action === 'gift') this.markGift({ uniqueId: participant.key, giftName, simulated: true });
    else this.markAmen({ uniqueId: participant.key, simulated: true });
    return { action, participant: this.publicParticipant(participant), payload: this.getPayload() };
  }

  clearDemo() {
    let removed = 0;
    for (const [key, participant] of this.participants) {
      if (participant.source === 'demo') {
        this.participants.delete(key);
        removed += 1;
      }
    }
    this.emit('demo', { removed });
    return { removed, payload: this.getPayload() };
  }

  reset(reason = 'reset') {
    const removed = this.participants.size;
    this.participants.clear();
    this.startedAt = Date.now();
    this.emit(reason, { removed });
    return { removed, payload: this.getPayload() };
  }

  /** Removes silent participants after the configured inactivity window. */
  prune(now = Date.now()) {
    const timeoutMs = this.settings.inactivityMinutes * 60 * 1000;
    let removed = 0;
    for (const [key, participant] of this.participants) {
      if (participant.source === 'demo') continue;
      if (now - participant.lastSeen > timeoutMs) {
        this.participants.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.emit('inactivity', { removed });
    return removed;
  }

  find(uniqueId) {
    const key = String(uniqueId || '').trim().slice(0, 64);
    return key ? this.participants.get(key) || null : null;
  }

  eligible(uniqueId, simulated) {
    const participant = this.find(uniqueId);
    if (!participant) return null;
    // Simulated activity must never animate a real viewer's participant.
    if (simulated && participant.source !== 'demo') return null;
    return participant;
  }

  nextSeat() {
    const used = new Set([...this.participants.values()].map((p) => p.seat));
    for (let seat = 0; seat < this.settings.maxVisible; seat += 1) {
      if (!used.has(seat)) return seat;
    }
    return null;
  }

  reconcileCapacity() {
    const max = this.settings.maxVisible;
    if (this.participants.size > max) {
      const ordered = [...this.participants.entries()].sort(
        (a, b) => a[1].joinedAt - b[1].joinedAt
      );
      const keep = new Set(ordered.slice(0, max).map(([key]) => key));
      for (const key of this.participants.keys()) {
        if (!keep.has(key)) this.participants.delete(key);
      }
    }
    const ordered = [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    ordered.forEach((participant, index) => {
      participant.seat = index;
    });
  }

  publicParticipant(participant) {
    return {
      id: participant.id,
      name: participant.name,
      source: participant.source,
      seat: participant.seat,
      joinedAt: participant.joinedAt,
      lastSeen: participant.lastSeen,
      marks: { ...participant.marks }
    };
  }

  getPayload() {
    const participants = [...this.participants.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((participant) => this.publicParticipant(participant));
    const real = participants.filter((p) => p.source === 'tiktok').length;
    const demo = participants.length - real;
    return {
      settings: { ...this.settings },
      counts: {
        real,
        demo,
        total: participants.length,
        seated: participants.length,
        capacity: this.settings.maxVisible
      },
      participants,
      startedAt: this.startedAt
    };
  }

  emit(reason, extra = {}) {
    if (typeof this.onChange !== 'function') return;
    this.onChange(this.getPayload(), { reason, ...extra });
  }
}

module.exports = {
  Congregation,
  DEFAULT_SETTINGS,
  DEMO_NAMES,
  MAX_VISIBLE
};
