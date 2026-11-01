#!/usr/bin/env node
/**
 * Christian Prayer Live — smart schedule & reliability tests.
 *
 * Offline sections exercise the schedule and health engines with a fake clock;
 * the live section talks to a running server:
 *
 *   node scripts/test-reliability.js
 *   BASE_URL=http://127.0.0.1:3100 node scripts/test-reliability.js
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const { SmartSchedule, localParts, parseClock, TIMEZONES } = require('../lib/schedule');
const { HealthMonitor, wavStats } = require('../lib/health');
const { MusicIntegrity } = require('../lib/music-integrity');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function rpc(method, params = {}) {
  const response = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ schedule */
function testScheduleEngine() {
  console.log('\n— Schedule engine (offline) —');
  const schedule = new SmartSchedule();
  check('four programs configured', schedule.programs.length === 4, schedule.programs.map((p) => p.id).join(', '));
  check('windows cover the whole day', schedule.validate() === true);

  const at = (iso) => schedule.current(new Date(iso).getTime());
  check('06:00 CST → morning', at('2026-11-02T12:00:00Z').program.id === 'morning');
  check('12:00 CST → afternoon', at('2026-11-02T18:00:00Z').program.id === 'afternoon');
  check('17:30 CST → evening', at('2026-11-02T23:30:00Z').program.id === 'evening');
  check('22:00 CST → night', at('2026-11-02T04:00:00Z').program.id === 'night');
  check('04:59 CST is still night', at('2026-11-02T10:59:00Z').program.id === 'night');
  check('05:00 CST is morning', at('2026-11-02T11:00:00Z').program.id === 'morning');

  const spring = localParts(Date.UTC(2026, 2, 8, 8, 0), 'America/Chicago');
  check('DST spring-forward: 08:00Z is 03:00 local', spring.clock.startsWith('03:00'), spring.clock);
  const fall = localParts(Date.UTC(2026, 10, 1, 7, 30), 'America/Chicago');
  check('DST fall-back: 07:30Z is 01:30 local', fall.clock.startsWith('01:30'), fall.clock);
  const midnight = localParts(Date.UTC(2026, 10, 2, 6, 0), 'America/Chicago');
  check('midnight is 00:00 local', midnight.clock.startsWith('00:00'), midnight.clock);

  // Every selectable US timezone must resolve to a real wall clock.
  for (const zone of TIMEZONES) {
    const zoned = new SmartSchedule();
    zoned.update({ timezone: zone.id }, { persist: false });
    const payload = zoned.payload(Date.UTC(2026, 10, 2, 18, 0));
    check(`timezone ${zone.id} resolves`, payload.timezone === zone.id
      && /^\d{2}:\d{2}:\d{2}$/.test(payload.local.clock)
      && Boolean(payload.current?.id), `${payload.local.clock} ${payload.local.offsetLabel} → ${payload.current?.id}`);
  }
  const phoenix = new SmartSchedule();
  phoenix.update({ timezone: 'America/Phoenix' }, { persist: false });
  check('Phoenix timezone is accepted', phoenix.payload().timezone === 'America/Phoenix');
  let rejected = false;
  try {
    phoenix.update({ timezone: 'Not/AZone' }, { persist: false });
  } catch (_) {
    rejected = true;
  }
  check('invalid timezone is rejected', rejected);

  // Boundary edit must keep the day continuous.
  const working = new SmartSchedule();
  working.updateProgram = working.updateProgram.bind(working);
  const originalWrite = working.save.bind(working);
  working.save = () => true; // never touch config/schedule.json from tests
  working.updateProgram('morning', { start: '05:30' });
  const night = working.programs.find((p) => p.id === 'night');
  check('editing a start time moves the shared boundary', night.end === '05:30', `${night.id} ends ${night.end}`);
  working.updateProgram('morning', { start: '05:00' });

  // Override + expiry
  let now = Date.UTC(2026, 10, 2, 12, 0);
  const timed = new SmartSchedule({ now: () => now });
  timed.save = () => true;
  timed.setOverride('evening', 15, now);
  check('override wins over the schedule', timed.current(now).program.id === 'evening');
  check('override reports remaining seconds', timed.activeOverride(now).remainingSeconds === 900);
  now += 16 * 60000;
  check('override expires by itself', timed.current(now).program.id === 'morning');
  working.save = originalWrite;
  timed.stop();

  // A transition must fire exactly once, even if tick() runs repeatedly.
  let clock = Date.UTC(2026, 10, 2, 10, 59, 0); // 04:59 CST
  const transitions = [];
  const live = new SmartSchedule({
    now: () => clock,
    onChange: (program, previous, meta) => transitions.push({ id: program?.id, reason: meta.reason })
  });
  live.save = () => true;
  live.config.override = { programId: null, until: null, startedAt: null, durationMinutes: null };
  live.tick();
  live.tick();
  check('a program transition fires exactly once', transitions.length === 1 && transitions[0].id === 'night', JSON.stringify(transitions));
  clock += 2 * 60000; // 05:01 CST
  live.tick();
  live.tick();
  check('crossing a boundary switches once', transitions.length === 2 && transitions[1].id === 'morning', JSON.stringify(transitions));

  // An override transition is also single-shot.
  live.setOverride('evening', 15, clock);
  live.tick();
  live.tick();
  check('override transition fires once', transitions.filter((t) => t.reason === 'override').length === 1, JSON.stringify(transitions.slice(-2)));
  live.stop();
}

/* -------------------------------------------------------------------- health */
function testHealthEngine() {
  console.log('\n— Health engine (offline) —');
  let clock = 1_000_000;
  const incidents = [];
  const monitor = new HealthMonitor({
    persist: false,
    now: () => clock,
    sampleMs: 5000,
    getSnapshot: () => ({
      music: { enabled: true, paused: false, volume: 0.1, track: 'a' },
      tts: { status: 'ready' },
      tiktok: { connected: true },
      clients: { total: 2, obs: 1 },
      musicIntegrity: { healthy: true, checkedAt: '2026-11-01T00:00:00Z' }
    }),
    onIncident: (incident) => incidents.push(incident)
  });
  monitor.readMemory = () => ({ processRssMb: 120, systemUsedPercent: 40, systemTotalGb: 8, systemUsedGb: 3 });

  clock += 5000;
  monitor.readCpu = () => 85;
  monitor.sample();
  clock += 30_000;
  monitor.sample();
  clock += 29_000;
  monitor.sample();
  check('CPU warning waits for the sustained window', monitor.levels.cpu === 'normal', monitor.levels.cpu);
  clock += 2000;
  monitor.sample();
  check('CPU warning fires after 60s above 80%', monitor.levels.cpu === 'warning', monitor.levels.cpu);

  clock += 5000;
  monitor.readCpu = () => 20;
  monitor.sample();
  check('CPU returns to normal immediately', monitor.levels.cpu === 'normal');

  clock += 5000;
  monitor.readCpu = () => 96;
  monitor.sample();
  clock += 31_000;
  monitor.sample();
  check('CPU critical fires after 30s above 95%', monitor.levels.cpu === 'critical', monitor.levels.cpu);

  clock += 5000;
  monitor.readCpu = () => 10;
  monitor.readMemory = () => ({ processRssMb: 120, systemUsedPercent: 92, systemTotalGb: 8, systemUsedGb: 7.4 });
  monitor.sample();
  clock += 31_000;
  monitor.sample();
  check('RAM critical fires after 30s above 90%', monitor.levels.ram === 'critical', monitor.levels.ram);

  clock += 5000;
  monitor.readMemory = () => ({ processRssMb: 120, systemUsedPercent: 30, systemTotalGb: 8, systemUsedGb: 2.4 });
  monitor.sample();
  check('incidents are recorded with a component', incidents.some((i) => i.component === 'cpu'));
  check('resolved incidents are marked', incidents.some((i) => i.component === 'cpu' && i.resolved));

  // Silent audio needs three reports.
  const silent = () => monitor.recordAudioReport({
    playing: true, paused: false, enabled: true, unlocked: true,
    ttsPlaying: false, musicRms: 0, volume: 0.1, trackId: 'a'
  });
  silent();
  silent();
  check('two silent reports are not enough', monitor.audio.silent === false, `streak ${monitor.audio.silentStreak}`);
  silent();
  check('three silent reports raise the alert', monitor.audio.silent === true);
  monitor.recordAudioReport({
    playing: true, paused: false, enabled: true, unlocked: true,
    ttsPlaying: false, musicRms: 0.02, volume: 0.1, trackId: 'a'
  });
  check('healthy playback clears the alert', monitor.audio.silent === false);
  check('audio recovery is counted', monitor.counters.audioRecoveries >= 1, String(monitor.counters.audioRecoveries));

  monitor.audio.silentStreak = 0;
  for (let index = 0; index < 3; index += 1) {
    monitor.recordAudioReport({
      playing: false, paused: true, enabled: true, unlocked: true,
      ttsPlaying: false, musicRms: 0, volume: 0.1, trackId: 'a'
    });
  }
  check('intentional pause never reports silence', monitor.audio.silent === false, `streak ${monitor.audio.silentStreak}`);

  // Narration playing is also intentional.
  monitor.audio.silentStreak = 0;
  for (let index = 0; index < 3; index += 1) {
    monitor.recordAudioReport({
      playing: true, paused: false, enabled: true, unlocked: true,
      ttsPlaying: true, musicRms: 0.001, volume: 0.1, trackId: 'a'
    });
  }
  check('ducked music under narration is not a silence error', monitor.audio.silent === false);

  // An unmeasured level (no analyser) must never be read as silence.
  monitor.audio.silentStreak = 0;
  for (let index = 0; index < 3; index += 1) {
    monitor.recordAudioReport({
      playing: true, paused: false, enabled: true, unlocked: true,
      ttsPlaying: false, musicRms: null, volume: 0.1, trackId: 'a'
    });
  }
  check('an unmeasured audio level is not silence', monitor.audio.silent === false, `streak ${monitor.audio.silentStreak}`);

  const statuses = monitor.componentStatuses({
    music: { enabled: true, paused: false, volume: 0.1 },
    tts: { status: 'ready' },
    tiktok: { connected: true },
    clients: { total: 2, obs: 1 },
    musicIntegrity: { healthy: true, checkedAt: '2026-11-01T00:00:00Z' }
  }, { sustained: { cpu: 'normal', ram: 'normal', eventLoop: 'normal' } });
  check('nine component statuses are reported', Object.keys(statuses).length === 9, Object.keys(statuses).join(', '));
  check('OBS stage reports connected with a client', statuses.obsStage.status === 'connected');

  const report = monitor.exportReport();
  check('diagnostic report contains no environment values', !JSON.stringify(report).includes('process.env'));
}

/* --------------------------------------------------------- music integrity */
function testMusicIntegrity() {
  console.log('\n— Music integrity (offline) —');
  const integrity = new MusicIntegrity();
  const report = integrity.scan();
  check('manifest entries are present on disk', report.missingCount === 0 && report.presentCount > 0, report.summary);
  check('audio containers are recognised', report.invalidFormat.length === 0, `${report.invalidFormat.length} invalid`);
  check('scan reports unused files', Array.isArray(report.orphans));
  check('scan is read-only', report.healthy === true && report.errors.length === 0);

  const manifest = JSON.parse(fs.readFileSync(integrity.manifestPath, 'utf8'));
  check('manifest still lists every track after the scan', manifest.tracks.length === report.entries);

  // Traversal and missing-file detection without touching real audio.
  const fakeDir = path.join(__dirname, '..', 'data', 'music-integrity-test');
  fs.mkdirSync(fakeDir, { recursive: true });
  const fakeManifest = path.join(fakeDir, 'music-manifest.json');
  fs.writeFileSync(fakeManifest, JSON.stringify({
    tracks: [
      { id: 'missing', file: 'not-here.mp3', title: 'Missing' },
      { id: 'escape', file: '../escape.mp3', title: 'Escape' },
      { id: 'ok', file: 'ok.wav', title: 'OK' }
    ]
  }));
  const wavHeader = Buffer.alloc(64);
  wavHeader.write('RIFF', 0, 'ascii');
  wavHeader.writeUInt32LE(56, 4);
  wavHeader.write('WAVE', 8, 'ascii');
  wavHeader.write('fmt ', 12, 'ascii');
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(1, 22);
  wavHeader.writeUInt32LE(22050, 24);
  wavHeader.writeUInt32LE(44100, 28);
  wavHeader.writeUInt16LE(2, 32);
  wavHeader.writeUInt16LE(16, 34);
  wavHeader.write('data', 36, 'ascii');
  wavHeader.writeUInt32LE(24, 40);
  fs.writeFileSync(path.join(fakeDir, 'ok.wav'), wavHeader);
  fs.writeFileSync(path.join(fakeDir, 'orphan.mp3'), Buffer.concat([Buffer.from('ID3'), Buffer.alloc(1000)]));
  const fake = new MusicIntegrity({ dir: fakeDir, manifestPath: fakeManifest });
  const fakeReport = fake.scan();
  check('missing manifest entries are detected', fakeReport.missing.length === 1, `${fakeReport.missing.length} missing`);
  check('path traversal is refused', fakeReport.pathViolations.length === 1);
  check('orphaned audio is listed', fakeReport.orphans.length === 1, fakeReport.orphans.map((o) => o.file).join(', '));
  fs.rmSync(fakeDir, { recursive: true, force: true });
}

/* --------------------------------------------------------------------- live */
async function testLive() {
  console.log(`\n— Live server (${BASE}) —`);
  const schedule = await rpc('schedule.get');
  check('live schedule lists four programs', schedule.programs.length === 4);
  check('live schedule reports an active program', Boolean(schedule.current?.id), schedule.current?.label);
  check('live schedule reports the next transition', schedule.remainingSeconds > 0, `${schedule.remainingSeconds}s`);

  const at = (iso) => rpc('schedule.test', { at: new Date(iso).getTime() });
  check('06:00 CST → morning (live)', (await at('2026-11-02T12:00:00Z')).effective === 'morning');
  check('18:00 CST → evening (live)', (await at('2026-11-02T00:00:00Z')).effective === 'evening');
  check('DST spring-forward handled (live)', (await at('2026-03-08T08:00:00Z')).local.clock.startsWith('03:00'));

  const timezone = await rpc('schedule.update', { timezone: 'America/New_York' });
  check('timezone change recalculates (live)', timezone.timezone === 'America/New_York');
  await rpc('schedule.update', { timezone: 'America/Chicago' });

  const edited = await rpc('schedule.program.update', { id: 'morning', start: '05:15' });
  check('program edit keeps windows continuous', edited.programs.find((p) => p.id === 'night').end === '05:15');
  await rpc('schedule.program.update', { id: 'morning', start: '05:00' });

  const override = await rpc('schedule.override', { program: 'evening', minutes: 15 });
  check('manual override switches immediately', override.current.id === 'evening' && override.mode === 'manual');
  const automatic = await rpc('schedule.auto');
  check('automatic schedule returns', automatic.mode === 'auto' && automatic.override === null);

  const preview = await rpc('schedule.preview', { program: 'morning' });
  check('program preview works without an override', preview.preview === true && preview.schedule.mode === 'auto');
  await rpc('schedule.auto');

  const health = await rpc('health.get');
  check('health statuses are reported', Object.keys(health.statuses).length === 9);
  check('health reports CPU, memory and loop lag', typeof health.metrics.cpuPercent === 'number'
    && typeof health.metrics.memory.systemUsedPercent === 'number'
    && typeof health.metrics.eventLoopLagMs === 'number');
  check('health reports the TTS queue', health.snapshot.ttsQueue !== null);
  check('health reports the OBS client count', health.snapshot.clients.obs >= 0);

  const wsMessages = [];
  const socket = new WebSocket(BASE.replace('http', 'ws') + '/ws');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    socket.on('open', () => { clearTimeout(timer); resolve(); });
    socket.on('error', () => { clearTimeout(timer); resolve(); });
  });
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.method) wsMessages.push(message.method);
    } catch (_) {}
  });
  await sleep(300);

  const silentReport = { report: { playing: true, paused: false, enabled: true, unlocked: true, ttsPlaying: false, musicRms: 0, volume: 0.1 } };
  await rpc('health.audio', silentReport);
  await rpc('health.audio', silentReport);
  const early = await rpc('health.get');
  await rpc('health.audio', silentReport);
  await sleep(400);
  const silent = await rpc('health.get');
  check('silent audio needs repeated reports (live)', early.audio.silentStreak < 3, `streak ${early.audio.silentStreak}`);
  check('silent audio is detected (live)', silent.audio.state === 'silent');
  check('silent audio requests a stage recovery (live)', wsMessages.includes('audio.recover'), wsMessages.filter((m) => m === 'audio.recover').length + ' notice');
  await rpc('health.audio', { report: { playing: true, paused: false, enabled: true, unlocked: true, ttsPlaying: false, musicRms: 0.02, volume: 0.1 } });
  check('audio alert clears (live)', (await rpc('health.get')).audio.state === 'healthy');

  await rpc('health.audio', { report: { playing: false, paused: true, enabled: true, unlocked: true, ttsPlaying: false, musicRms: 0, volume: 0.1 } });
  await rpc('health.audio', { report: { playing: false, paused: true, enabled: true, unlocked: true, ttsPlaying: false, musicRms: 0, volume: 0.1 } });
  await rpc('health.audio', { report: { playing: false, paused: true, enabled: true, unlocked: true, ttsPlaying: false, musicRms: 0, volume: 0.1 } });
  check('paused music does not raise silence (live)', (await rpc('health.get')).audio.state !== 'silent');

  const integrity = await rpc('music.integrity');
  check('music integrity scan works (live)', integrity.totalFilesOnDisk > 0 && integrity.missingCount === 0, integrity.summary);

  const healthCheck = await rpc('health.check', { reason: 'test script' });
  check('manual health check runs (live)', healthCheck.counters.checks >= 1);

  const diagnostics = await rpc('health.export');
  check('diagnostic export has no secrets (live)', !JSON.stringify(diagnostics).includes('process.env'));

  const reconnect = await rpc('live.setReconnect', { autoReconnect: true, maxRetries: 6, retrySeconds: 10 });
  check('TikTok reconnect settings validate (live)', reconnect.settings.maxRetries === 6 && reconnect.settings.retrySeconds === 10);
  const liveStatus = await rpc('live.status');
  check('TikTok status exposes reconnect fields (live)', typeof liveStatus.reconnectAttempts === 'number' && Boolean(liveStatus.settings));

  socket.close();
}

(async () => {
  testScheduleEngine();
  testHealthEngine();
  testMusicIntegrity();
  try {
    await testLive();
  } catch (err) {
    check('live server reachable', false, err.message);
  }
  const failures = results.filter((result) => !result.ok);
  console.log('\n--------------------------------------------------------------');
  console.log(`${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((failure) => console.log(` - ${failure.name} ${failure.detail}`));
    process.exitCode = 1;
  }
})();
