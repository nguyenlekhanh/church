/**
 * Christian Prayer Live — system health, incidents and auto-recovery bookkeeping.
 *
 * Lightweight by design: a CPU/RAM sample every few seconds, an event-loop lag
 * probe, and reports from the OBS stage about what it is actually playing. All
 * status decisions are evidence based. Sustained thresholds prevent a single
 * spike from raising a critical alert, and no component is ever killed because
 * of a CPU reading.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_THRESHOLDS = {
  cpu: {
    warning: 80,
    critical: 95,
    warningHoldMs: 60000,
    criticalHoldMs: 30000
  },
  ram: {
    warning: 80,
    critical: 90,
    warningHoldMs: 60000,
    criticalHoldMs: 30000
  },
  eventLoop: {
    warning: 200,
    critical: 1000,
    warningHoldMs: 10000,
    criticalHoldMs: 5000
  },
  // Music is intentionally quiet (8-12%), so the silent floor is very low.
  silentRms: 0.0006,
  silentReports: 3,
  audioReportMaxAgeMs: 90000
};

const SEVERITY_ORDER = { info: 0, warning: 1, error: 2 };

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function iso(ms) {
  const date = new Date(Number(ms) || Date.now());
  return date.toISOString();
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * Reads a 16-bit PCM WAV and returns peak/RMS. Used to catch a synthesis run
 * that produced an empty (silent) file instead of speech. Returns null when the
 * format is not readable rather than guessing.
 */
function wavStats(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      return null;
    }
    let offset = 12;
    let fmt = null;
    let dataStart = -1;
    let dataLength = 0;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      if (id === 'fmt ') {
        fmt = {
          audioFormat: buffer.readUInt16LE(offset + 8),
          channels: buffer.readUInt16LE(offset + 10),
          sampleRate: buffer.readUInt32LE(offset + 12),
          bitsPerSample: buffer.readUInt16LE(offset + 22)
        };
      } else if (id === 'data') {
        dataStart = offset + 8;
        dataLength = Math.min(size, buffer.length - dataStart);
      }
      offset += 8 + size + (size % 2);
      if (dataStart >= 0 && fmt) break;
    }
    if (!fmt || dataStart < 0 || dataLength <= 0) return null;
    if (fmt.bitsPerSample !== 16) return { ...fmt, samples: 0, peak: null, rms: null, silent: null };
    const sampleCount = Math.floor(dataLength / 2);
    let peak = 0;
    let sum = 0;
    // Sample at most ~400k frames; enough to detect silence without heavy I/O.
    const stride = Math.max(1, Math.floor(sampleCount / 400000));
    let counted = 0;
    for (let index = 0; index < sampleCount; index += stride) {
      const value = buffer.readInt16LE(dataStart + index * 2) / 32768;
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
      sum += value * value;
      counted += 1;
    }
    const rms = counted > 0 ? Math.sqrt(sum / counted) : 0;
    return {
      ...fmt,
      samples: sampleCount,
      peak: Number(peak.toFixed(5)),
      rms: Number(rms.toFixed(5)),
      silent: counted > 0 ? rms < 0.0005 && peak < 0.003 : null
    };
  } catch (_) {
    return null;
  }
}

class HealthMonitor {
  constructor(options = {}) {
    this.root = options.root || path.join(__dirname, '..');
    this.dataDir = options.dataDir || path.join(this.root, 'data');
    this.stateFile = options.stateFile || path.join(this.dataDir, 'health-state.json');
    this.now = options.now || (() => Date.now());
    this.getSnapshot = options.getSnapshot || (() => ({}));
    this.onIncident = options.onIncident || (() => {});
    this.broadcast = options.broadcast || (() => {});
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(options.thresholds || {}),
      cpu: { ...DEFAULT_THRESHOLDS.cpu, ...(options.thresholds?.cpu || {}) },
      ram: { ...DEFAULT_THRESHOLDS.ram, ...(options.thresholds?.ram || {}) },
      eventLoop: { ...DEFAULT_THRESHOLDS.eventLoop, ...(options.thresholds?.eventLoop || {}) }
    };
    this.sampleMs = clamp(options.sampleMs, 1000, 60000, 5000);
    this.persistDisabled = options.persist === false;
    this.startedAt = this.now();
    this.cpuSnapshot = null;
    this.loop = { lastTickAt: this.now(), lagMs: 0, maxLagMs: 0, samples: 0 };
    this.levelCandidates = {};
    this.levels = { cpu: 'normal', ram: 'normal', eventLoop: 'normal' };
    this.audio = {
      report: null,
      receivedAt: null,
      silentStreak: 0,
      silent: false,
      recoveryRequestedAt: null,
      recoverySucceededAt: null,
      lastError: null
    };
    this.incidents = [];
    this.counters = {
      recoveries: 0,
      failedRecoveries: 0,
      checks: 0,
      audioRecoveries: 0
    };
    this.lastHealthCheckAt = null;
    this.lastError = null;
    this.lastRecovery = null;
    this.timer = null;
    this.loopTimer = null;
    this.persistTimer = null;
    this.load();
  }

  /* ------------------------------------------------------------ persistence */
  load() {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (Array.isArray(saved.incidents)) this.incidents = saved.incidents.slice(0, 200);
      if (saved.counters) this.counters = { ...this.counters, ...saved.counters };
      this.lastRecovery = saved.lastRecovery || null;
    } catch (err) {
      console.warn('[Health] Could not read health-state.json:', err.message);
    }
  }

  persist() {
    if (this.persistDisabled) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        atomicWrite(this.stateFile, {
          savedAt: iso(this.now()),
          counters: this.counters,
          lastRecovery: this.lastRecovery,
          incidents: this.incidents.slice(0, 200)
        });
      } catch (err) {
        console.warn('[Health] Could not save health-state.json:', err.message);
      }
    }, 800);
    if (typeof this.persistTimer.unref === 'function') this.persistTimer.unref();
  }

  /* -------------------------------------------------------------- incidents */
  addIncident({ component, severity = 'warning', message, action = '', result = '', detail = null }) {
    const incident = {
      id: `inc_${this.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: iso(this.now()),
      component: String(component || 'system'),
      severity: SEVERITY_ORDER[severity] === undefined ? 'warning' : severity,
      message: String(message || '').slice(0, 400),
      action: String(action || '').slice(0, 200),
      result: String(result || '').slice(0, 200),
      detail: detail ? String(detail).slice(0, 400) : null,
      resolved: false,
      resolvedAt: null
    };
    this.incidents.unshift(incident);
    if (this.incidents.length > 200) this.incidents.length = 200;
    if (incident.severity !== 'info') this.lastError = incident;
    this.persist();
    try {
      this.onIncident(incident);
    } catch (_) {}
    try {
      this.broadcast('health.incident', { incident, health: this.payload() });
    } catch (_) {}
    return incident;
  }

  resolveIncidents(component, messagePart = null) {
    let changed = 0;
    for (const incident of this.incidents) {
      if (incident.resolved) continue;
      if (component && incident.component !== component) continue;
      if (messagePart && !incident.message.includes(messagePart)) continue;
      incident.resolved = true;
      incident.resolvedAt = iso(this.now());
      changed += 1;
    }
    if (changed) this.persist();
    return changed;
  }

  recordRecovery(component, action, result, { ok = true, message = '', detail = null } = {}) {
    if (ok) this.counters.recoveries += 1;
    else this.counters.failedRecoveries += 1;
    this.lastRecovery = {
      at: iso(this.now()),
      component,
      action,
      result,
      ok: Boolean(ok)
    };
    this.addIncident({
      component,
      severity: ok ? 'info' : 'error',
      message: message || `${component}: ${action}`,
      action,
      result,
      detail
    });
    this.persist();
    return this.lastRecovery;
  }

  clearResolved() {
    const before = this.incidents.length;
    this.incidents = this.incidents.filter((incident) => !incident.resolved);
    this.persist();
    return { removed: before - this.incidents.length, remaining: this.incidents.length };
  }

  /* ---------------------------------------------------------------- metrics */
  readCpu() {
    const cpus = os.cpus() || [];
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const times = cpu.times || {};
      idle += times.idle || 0;
      total += (times.user || 0) + (times.nice || 0) + (times.sys || 0)
        + (times.idle || 0) + (times.irq || 0);
    }
    const snapshot = { idle, total };
    let percent = 0;
    if (this.cpuSnapshot) {
      const idleDelta = snapshot.idle - this.cpuSnapshot.idle;
      const totalDelta = snapshot.total - this.cpuSnapshot.total;
      percent = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
    }
    this.cpuSnapshot = snapshot;
    return Number(Math.max(0, Math.min(100, percent)).toFixed(1));
  }

  readMemory() {
    const memory = process.memoryUsage();
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);
    return {
      processRssMb: Number((memory.rss / 1048576).toFixed(1)),
      processHeapMb: Number((memory.heapUsed / 1048576).toFixed(1)),
      systemTotalGb: Number((total / 1073741824).toFixed(2)),
      systemUsedGb: Number((used / 1073741824).toFixed(2)),
      systemUsedPercent: Number(((used / total) * 100).toFixed(1))
    };
  }

  evaluate(key, rawLevel) {
    const now = this.now();
    const previous = this.levels[key] || 'normal';
    if (rawLevel === 'normal') {
      this.levelCandidates[key] = null;
      this.levels[key] = 'normal';
      return { level: 'normal', changed: previous !== 'normal', previous };
    }
    const holdMs = rawLevel === 'critical'
      ? this.thresholds[key].criticalHoldMs
      : this.thresholds[key].warningHoldMs;
    const candidate = this.levelCandidates[key];
    if (!candidate || candidate.level !== rawLevel) {
      this.levelCandidates[key] = { level: rawLevel, since: now };
    }
    const active = this.levelCandidates[key];
    const held = now - active.since >= holdMs;
    const nextLevel = held ? rawLevel : previous;
    this.levels[key] = nextLevel;
    return { level: nextLevel, changed: previous !== nextLevel, previous, pending: !held ? rawLevel : null };
  }

  probeEventLoop() {
    const now = this.now();
    const lag = Math.max(0, now - this.loop.lastTickAt - this.sampleMs);
    this.loop.lastTickAt = now;
    this.loop.lagMs = Math.round(lag);
    this.loop.maxLagMs = Math.max(this.loop.maxLagMs, Math.round(lag));
    this.loop.samples += 1;
  }

  sample() {
    this.probeEventLoop();
    const snapshot = this.getSnapshot() || {};
    const cpuPercent = this.readCpu();
    const memory = this.readMemory();
    const cpuRule = this.thresholds.cpu;
    const ramRule = this.thresholds.ram;
    const loopRule = this.thresholds.eventLoop;

    const cpuLevel = cpuPercent >= cpuRule.critical ? 'critical' : cpuPercent >= cpuRule.warning ? 'warning' : 'normal';
    const ramLevel = memory.systemUsedPercent >= ramRule.critical
      ? 'critical'
      : memory.systemUsedPercent >= ramRule.warning ? 'warning' : 'normal';
    const loopLevel = this.loop.lagMs >= loopRule.critical
      ? 'critical'
      : this.loop.lagMs >= loopRule.warning ? 'warning' : 'normal';

    const cpu = this.evaluate('cpu', cpuLevel);
    const ram = this.evaluate('ram', ramLevel);
    const loop = this.evaluate('eventLoop', loopLevel);

    if (cpu.changed && cpu.level !== 'normal') {
      this.addIncident({
        component: 'cpu',
        severity: cpu.level === 'critical' ? 'error' : 'warning',
        message: `CPU usage ${cpuPercent}% sustained`,
        action: 'Monitoring only — the broadcast is not interrupted.',
        result: 'No destructive action taken'
      });
    }
    if (cpu.changed && cpu.level === 'normal') this.resolveIncidents('cpu');
    if (ram.changed && ram.level !== 'normal') {
      this.addIncident({
        component: 'ram',
        severity: ram.level === 'critical' ? 'error' : 'warning',
        message: `System memory ${memory.systemUsedPercent}% used`,
        action: 'Monitoring only.',
        result: 'No destructive action taken'
      });
    }
    if (ram.changed && ram.level === 'normal') this.resolveIncidents('ram');
    if (loop.changed && loop.level !== 'normal') {
      this.addIncident({
        component: 'event-loop',
        severity: loop.level === 'critical' ? 'error' : 'warning',
        message: `Event loop lag ${this.loop.lagMs}ms`,
        action: 'Monitoring only.',
        result: 'No destructive action taken'
      });
    }
    if (loop.changed && loop.level === 'normal') this.resolveIncidents('event-loop');

    const audio = this.audioState();
    this.lastMetrics = {
      at: iso(this.now()),
      cpuPercent,
      memory,
      eventLoopLagMs: this.loop.lagMs,
      sustained: { cpu: cpu.level, ram: ram.level, eventLoop: loop.level },
      audio
    };
    return this.lastMetrics;
  }

  /**
   * Audio state is evaluated once per report, never once per sample, so a single
   * report cannot reach the silence threshold by itself. A stage that stops
   * reporting also clears the alert instead of leaving a stale warning.
   */
  audioState() {
    const reportAge = this.audio.receivedAt ? this.now() - this.audio.receivedAt : null;
    if (reportAge !== null && reportAge > this.thresholds.audioReportMaxAgeMs) {
      if (this.audio.silent) {
        this.audio.silent = false;
        this.resolveIncidents('audio');
      }
      this.audio.silentStreak = 0;
      return { state: 'stale', reason: 'No recent playback report from the stage' };
    }
    return {
      state: this.audio.silent ? 'silent' : 'healthy',
      silentStreak: this.audio.silentStreak,
      reportAgeSeconds: reportAge === null ? null : Math.round(reportAge / 1000),
      ready: Boolean(this.audio.report)
    };
  }

  evaluateAudio(snapshot) {
    const settings = snapshot.music || {};
    const report = this.audio.report;
    const reportAge = this.audio.receivedAt ? this.now() - this.audio.receivedAt : null;
    const fresh = reportAge !== null && reportAge <= this.thresholds.audioReportMaxAgeMs;

    // Do not report silence for intentional states.
    const shouldBeAudible = Boolean(
      fresh
      && settings.enabled !== false
      && settings.paused !== true
      && Number(settings.volume) > 0.001
      && report?.muted !== true
      && report?.unlocked !== false
      && report?.playing === true
      && report?.ttsPlaying !== true
    );

    if (!shouldBeAudible) {
      this.audio.silentStreak = 0;
      if (this.audio.silent) {
        this.audio.silent = false;
        this.resolveIncidents('audio');
      }
      return { state: this.audio.silent ? 'silent' : 'not-monitored', reason: 'intentional-or-idle' };
    }

    const rawRms = report.musicRms;
    const rms = rawRms === null || rawRms === undefined || rawRms === '' ? NaN : Number(rawRms);
    if (!Number.isFinite(rms)) {
      // No analyser yet: nothing was measured, so this is not evidence of silence.
      this.audio.silentStreak = 0;
      if (this.audio.silent) {
        this.audio.silent = false;
        this.resolveIncidents('audio');
      }
      return { state: 'unmeasured', reason: 'The stage has not measured the music level yet' };
    }
    const silentSample = rms < this.thresholds.silentRms;
    this.audio.silentStreak = silentSample ? this.audio.silentStreak + 1 : 0;

    if (this.audio.silentStreak >= this.thresholds.silentReports && !this.audio.silent) {
      this.audio.silent = true;
      this.audio.recoveryRequestedAt = iso(this.now());
      this.addIncident({
        component: 'audio',
        severity: 'warning',
        message: 'Background music is playing but the audio stream measures as silent.',
        action: 'Asked the OBS stage to reload the current track.',
        result: 'Awaiting the next playback report'
      });
      try {
        this.broadcast('audio.recover', {
          trackId: report.trackId || settings.track || null,
          reason: 'silent-audio',
          rms,
          at: iso(this.now())
        });
      } catch (_) {}
    } else if (!silentSample && this.audio.silent) {
      this.audio.silent = false;
      this.audio.silentStreak = 0;
      this.audio.recoverySucceededAt = iso(this.now());
      this.counters.audioRecoveries += 1;
      this.resolveIncidents('audio');
      this.addIncident({
        component: 'audio',
        severity: 'info',
        message: 'Background music audio recovered.',
        action: 'Playback resumed without a restart.',
        result: `RMS ${Number(rms || 0).toFixed(4)}`
      });
    }

    return {
      state: this.audio.silent ? 'silent' : 'healthy',
      rms: Number.isFinite(rms) ? rms : null,
      silentStreak: this.audio.silentStreak,
      reportAgeSeconds: reportAge === null ? null : Math.round(reportAge / 1000)
    };
  }

  recordAudioReport(report = {}) {
    const previousTrack = this.audio.report?.trackId || null;
    this.audio.report = {
      ...report,
      trackId: report.trackId || previousTrack,
      at: iso(this.now())
    };
    this.audio.receivedAt = this.now();
    return this.evaluateAudio(this.getSnapshot() || {});
  }

  /* ----------------------------------------------------------------- status */
  componentStatuses(snapshot = this.getSnapshot() || {}, metrics = this.lastMetrics || {}) {
    const tts = snapshot.tts || {};
    const tiktok = snapshot.tiktok || {};
    const audio = this.audio;
    const report = audio.report;
    const clients = snapshot.clients || { total: 0, obs: 0, stage: 0 };
    const integrity = snapshot.musicIntegrity || {};
    const musicSettings = snapshot.music || {};

    const cpuLevel = metrics.sustained?.cpu || this.levels.cpu;
    const ramLevel = metrics.sustained?.ram || this.levels.ram;
    const loopLevel = metrics.sustained?.eventLoop || this.levels.eventLoop;

    const ttsStatus = tts.suspended
      ? 'error'
      : tts.status === 'ready' ? 'ready'
        : tts.status === 'restarting' ? 'restarting'
          : tts.status === 'loading' || tts.status === 'starting' ? 'starting' : 'error';

    let musicState = 'paused';
    if (musicSettings.enabled === false) musicState = 'disabled';
    else if (audio.silent) musicState = 'silent';
    else if (report?.error) musicState = 'error';
    else if (report?.playing && musicSettings.paused !== true) musicState = 'playing';
    else if (musicSettings.paused === true) musicState = 'paused';
    else if (!report) musicState = 'waiting';

    const tiktokState = tiktok.requiresAttention
      ? 'attention'
      : tiktok.connected ? 'connected'
        : tiktok.connecting || tiktok.reconnecting ? 'reconnecting' : 'disconnected';

    const bySeverity = (level) => (level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'normal');

    return {
      server: {
        status: loopLevel === 'critical' ? 'error' : loopLevel === 'warning' ? 'warning' : 'online',
        label: loopLevel === 'normal' ? 'ONLINE' : loopLevel === 'warning' ? 'WARNING' : 'ERROR'
      },
      tiktok: { status: tiktokState, label: tiktokState.toUpperCase() },
      piper: { status: ttsStatus, label: ttsStatus.toUpperCase() },
      music: { status: musicState, label: musicState.toUpperCase() },
      musicFiles: {
        status: integrity.error ? 'error' : (integrity.missingCount || 0) > 0 ? 'missing' : integrity.checkedAt ? 'healthy' : 'unknown',
        label: integrity.error ? 'ERROR' : (integrity.missingCount || 0) > 0 ? 'MISSING FILES' : integrity.checkedAt ? 'HEALTHY' : 'NOT SCANNED'
      },
      cpu: { status: bySeverity(cpuLevel), label: cpuLevel.toUpperCase() },
      ram: { status: bySeverity(ramLevel), label: ramLevel.toUpperCase() },
      obsStage: {
        status: clients.obs > 0 ? 'connected' : 'disconnected',
        label: clients.obs > 0 ? 'CONNECTED' : 'DISCONNECTED',
        clients: clients.obs
      },
      websocket: {
        status: clients.total > 0 ? 'healthy' : 'idle',
        label: clients.total > 0 ? 'HEALTHY' : 'IDLE',
        clients: clients.total
      }
    };
  }

  payload() {
    const snapshot = this.getSnapshot() || {};
    const metrics = this.lastMetrics || this.sample();
    const memory = metrics.memory || this.readMemory();
    return {
      ok: true,
      generatedAt: iso(this.now()),
      startedAt: iso(this.startedAt),
      uptimeSeconds: Math.round((this.now() - this.startedAt) / 1000),
      processUptimeSeconds: Math.round(process.uptime()),
      platform: `${os.type()} ${os.release()} · ${os.arch()}`,
      runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
      metrics: {
        cpuPercent: metrics.cpuPercent ?? 0,
        memory,
        eventLoopLagMs: this.loop.lagMs,
        eventLoopMaxLagMs: this.loop.maxLagMs,
        eventLoopSamples: this.loop.samples,
        uptimeSeconds: Math.round(process.uptime())
      },
      thresholds: this.thresholds,
      statuses: this.componentStatuses(snapshot, metrics),
      audio: {
        state: this.audio.silent ? 'silent' : 'healthy',
        silentStreak: this.audio.silentStreak,
        lastReportAt: this.audio.report ? iso(this.audio.receivedAt) : null,
        report: this.audio.report ? { ...this.audio.report } : null,
        recoveryRequestedAt: this.audio.recoveryRequestedAt,
        recoverySucceededAt: this.audio.recoverySucceededAt
      },
      counters: { ...this.counters },
      lastHealthCheckAt: this.lastHealthCheckAt,
      lastError: this.lastError,
      lastRecovery: this.lastRecovery,
      incidents: this.incidents.slice(0, 100),
      snapshot: {
        ttsQueue: snapshot.ttsQueue ?? null,
        tts: snapshot.tts || null,
        tiktok: snapshot.tiktok || null,
        clients: snapshot.clients || { total: 0, obs: 0, stage: 0 },
        musicIntegrity: snapshot.musicIntegrity || null,
        music: snapshot.music || null
      }
    };
  }

  runCheck({ reason = 'manual' } = {}) {
    this.counters.checks += 1;
    this.lastHealthCheckAt = iso(this.now());
    this.addIncident({
      component: 'system',
      severity: 'info',
      message: `Health check (${reason}).`,
      action: 'Sampled CPU, memory, event loop and component state.',
      result: 'Completed'
    });
    return this.payload();
  }

  exportReport() {
    const payload = this.payload();
    return {
      title: 'Christian Prayer Live — diagnostic report',
      generatedAt: payload.generatedAt,
      note: 'No environment variables, API keys, session tokens or viewer personal data are included.',
      runtime: payload.runtime,
      platform: payload.platform,
      uptimeSeconds: payload.uptimeSeconds,
      metrics: payload.metrics,
      thresholds: payload.thresholds,
      statuses: payload.statuses,
      audio: payload.audio,
      counters: payload.counters,
      lastError: payload.lastError,
      lastRecovery: payload.lastRecovery,
      incidents: payload.incidents
    };
  }

  start() {
    if (this.timer) return;
    this.sample();
    this.timer = setInterval(() => {
      try {
        this.sample();
      } catch (err) {
        console.warn('[Health] Sample failed:', err.message);
      }
    }, this.sampleMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { HealthMonitor, DEFAULT_THRESHOLDS, wavStats, atomicWrite };
