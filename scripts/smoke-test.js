#!/usr/bin/env node
/**
 * Christian Prayer Live — smoke test.
 * Exercises the live HTTP JSON-RPC API, WebSocket notifications, narration,
 * prayer moderation, backgrounds and static assets.
 *
 * Run while the Bun server is listening:
 *   node scripts/smoke-test.js
 */
const WebSocket = require('ws');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function main() {
  console.log(`Christian Prayer Live smoke test → ${BASE}\n`);

  // 1. Health + brand
  const health = await fetch(`${BASE}/api/health`).then((res) => res.json());
  check('health endpoint responds', health.ok === true);
  check('brand is Christian Prayer Live', health.brand?.name === 'CHRISTIAN PRAYER LIVE', health.brand?.name);
  check('tagline is Faith Hope Love', health.brand?.tagline === 'FAITH • HOPE • LOVE');

  // 2. State compatibility
  const state = await rpc('temple.getState');
  check('legacy temple.getState works', Boolean(state.brand));
  check('state exposes new counters', typeof state.prayerCount === 'number' && typeof state.candlesLit === 'number');
  check(
    'state keeps legacy counter aliases',
    typeof state.totalIncense === 'number' && typeof state.woodenFishHits === 'number' && typeof state.fortuneCount === 'number'
  );
  check('background rotation settings present', Boolean(state.settings?.background?.current));
  check('TTS reports ready', state.tts?.status === 'ready', `${state.tts?.status} · ${state.tts?.voices?.length || 0} voices`);

  // 3. Background catalog + local asset serving
  const catalog = await rpc('stage.listBackgrounds');
  check('background catalog discovered', catalog.backgrounds.length >= 10, `${catalog.backgrounds.length} images`);
  const categories = ['cathedral', 'church', 'cross', 'bible', 'candles', 'jesus', 'backgrounds'];
  check('required categories present', categories.every((category) => catalog.categories.includes(category)), catalog.categories.join(', '));
  const firstBackground = catalog.backgrounds[0];
  const backgroundResponse = await fetch(`${BASE}${firstBackground.url}`);
  check('background image served locally', backgroundResponse.status === 200 && backgroundResponse.headers.get('content-type')?.startsWith('image/'));
  const overlayResponse = await fetch(`${BASE}/assets/christian/overlays/golden-light-rays.png`);
  check('overlay assets served locally', overlayResponse.status === 200);

  // 4. Background selection
  const initialBackground = state.settings.background.current;
  const changed = await rpc('stage.setBackground', { url: firstBackground.url });
  check('manual background change', changed.image?.url === firstBackground.url);
  const afterChange = await rpc('temple.getState');
  check('state reflects background change', afterChange.settings.background.current === firstBackground.url);
  if (initialBackground && initialBackground !== firstBackground.url) {
    await rpc('stage.setBackground', { url: initialBackground });
  }

  // 5. Prayer requests
  await rpc('prayer.clear');
  const prayer = await rpc('prayer.add', {
    name: 'Sarah M.',
    text: 'Please pray for my family and for peace this week.',
    source: 'admin'
  });
  check('prayer request queued', Boolean(prayer.request?.id));
  const afterPrayer = await rpc('temple.getState');
  check('current prayer displayed', Boolean(afterPrayer.currentPrayer));
  check('prayer display uses first name', afterPrayer.currentPrayer?.name === 'Sarah', afterPrayer.currentPrayer?.name);
  check('prayer text keeps subject', /family/i.test(afterPrayer.currentPrayer?.ask || ''), afterPrayer.currentPrayer?.ask);
  check('prayer TTS text does not promise outcomes', !/heal|wealth|miracle|salvation/i.test(afterPrayer.currentPrayer?.ask || ''));

  // 6. Comment commands and prayer detection
  const amen = await rpc('temple.comment', { comment: 'AMEN', user: 'Michael R.', uniqueId: 'smoke.michael' });
  check('AMEN comment handled', amen.command === 'AMEN', amen.command);

  // Commands are intentionally rate limited to one every 2.5s to protect narration.
  await sleep(2700);
  await rpc('temple.comment', { comment: 'PRAY', user: 'Grace L.', uniqueId: 'smoke.grace' });
  const stateAfterPray = await rpc('temple.getState');
  const commandEvents = stateAfterPray.recentEvents.filter((event) => event.kind === 'command');
  check('PRAY command created an event', commandEvents.some((event) => event.command === 'PRAY'));

  await rpc('prayer.clear');
  const requestComment = await rpc('temple.comment', {
    comment: 'pray for me please my family is struggling',
    user: 'Emily T.',
    uniqueId: 'smoke.emily',
    source: 'rpc'
  });
  check('prayer request detected from comment', Boolean(requestComment.id), JSON.stringify(requestComment).slice(0, 90));
  check('prayer text sanitized of trigger phrase', !/pray for me/i.test(requestComment.text || '') && /family/i.test(requestComment.text || ''), requestComment.text);
  const queue = await rpc('prayer.list');
  check('prayer queue lists request', queue.requests.some((item) => item.name.includes('Emily')));
  check('comments feed populated', (await rpc('temple.getState')).chatFeed.length > 0);

  // 7. Moderation
  const paused = await rpc('prayer.setPaused', { paused: true });
  check('prayer notifications can pause', paused.settings.paused === true);
  await rpc('prayer.setPaused', { paused: false });

  const target = queue.requests.find((item) => item.name.includes('Emily'));
  if (target) {
    const hidden = await rpc('prayer.hide', { id: target.id });
    check('prayer request can be hidden', hidden.requests.every((item) => item.id !== target.id || item.status === 'hidden'));
    const removed = await rpc('prayer.remove', { id: target.id });
    check('prayer request can be removed', removed.requests.every((item) => item.id !== target.id));
  }

  // 8. TTS English + Vietnamese
  const en = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Welcome to Christian Prayer Live. Faith, hope and love.', lang: 'en' })
  }).then((res) => res.json());
  check('English narration synthesized', en.ok === true && en.language === 'en', `${en.voice} · ${en.durationSec}s`);
  check('English narration uses US voice', String(en.voice || '').startsWith('en_US'), en.voice);
  if (en.url) {
    const audio = await fetch(`${BASE}${en.url}`);
    check('English WAV served', audio.status === 200 && audio.headers.get('content-type')?.includes('audio'));
  }

  const vi = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Xin chào quý vị. Chúng ta hãy cùng nhau cầu nguyện.', lang: 'vi' })
  }).then((res) => res.json());
  check('Vietnamese narration synthesized', vi.ok === true && vi.language === 'vi', `${vi.voice} · ${vi.durationSec}s`);
  check('Vietnamese narration uses Vietnamese voice', String(vi.voice || '').length > 0 && !String(vi.voice).startsWith('en_'), vi.voice);

  const cached = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Welcome to Christian Prayer Live. Faith, hope and love.', lang: 'en' })
  }).then((res) => res.json());
  check('narration cache works', cached.cached === true && cached.url === en.url);

  // 9. Voice selection
  const voices = await rpc('tts.voices');
  check('English voices discovered', voices.en.length >= 1, voices.en.map((voice) => voice.id).join(', '));
  check('Vietnamese voices discovered', voices.vi.length >= 5, `${voices.vi.length} voices`);

  // 10. Settings
  const updated = await rpc('temple.updateSettings', { ttsVolume: 0.8, ttsRate: 1.05 });
  check('settings update works', updated.settings.ttsVolume === 0.8 && updated.settings.ttsRate === 1.05);

  // 10b. Automated live show
  const show = await rpc('show.status');
  check('show program has a full sequence', Array.isArray(show.sequence) && show.sequence.length >= 8, `${show.sequence?.length} segments`);
  check('show program offers eight prayer themes', show.themes?.length === 8, (show.themes || []).map((theme) => theme.id).join(', '));
  check('show settings are exposed', typeof show.enabled === 'boolean' && typeof show.welcomeEnabled === 'boolean');
  check('show tracks its own cue history', Array.isArray(show.history));

  const library = await rpc('messages.get');
  check(
    'every Bible verse has a reflection',
    library.bibleVerses.every((verse) => typeof verse.reflection === 'string' && verse.reflection.length > 20),
    `${library.bibleVerses.length} verses`
  );
  check(
    'Scripture references are KJV',
    library.bibleVerses.every((verse) => /\(KJV\)$/.test(verse.reference))
  );

  const welcomeBefore = show.welcomesSent || 0;
  const testWelcome = await rpc('show.testWelcome', { name: 'Smoke Viewer (demo)' });
  check(
    'test welcome is clearly labelled',
    testWelcome.cue?.simulated === true && testWelcome.show.history[0].source === 'test',
    testWelcome.cue?.title
  );
  check('test welcome never counts as a real viewer', (testWelcome.show.welcomesSent || 0) === welcomeBefore);

  const verseCue = await rpc('show.nextVerse');
  check('manual verse cue uses a KJV reference', /\(KJV\)$/.test(verseCue.cue?.reference || ''), verseCue.cue?.reference);
  check('verse cue includes a spoken reflection', Boolean(verseCue.cue?.ttsText && verseCue.cue.ttsText.length > verseCue.cue.body.length));

  const prayerCue = await rpc('show.nextPrayer', { theme: 'family' });
  check('prayer theme can be selected', prayerCue.cue?.eyebrow === 'PRAYER FOR FAMILY', prayerCue.cue?.eyebrow);
  check(
    'prayer avoids promised outcomes',
    !/guarantee|guaranteed|will heal|wealth|miracle|salvation/i.test(prayerCue.cue?.body || ''),
    prayerCue.cue?.title
  );

  const reflectionCue = await rpc('show.nextReflection');
  check('reflection cue carries a reflection', reflectionCue.cue?.kind === 'reflection' && reflectionCue.cue?.body?.length > 20);

  const pausedShow = await rpc('show.update', { paused: true });
  check('program can pause', pausedShow.paused === true && pausedShow.running === false);
  const resumedShow = await rpc('show.update', { paused: false, theme: 'auto' });
  check('program can resume', resumedShow.paused === false && resumedShow.running === true);

  const pacedShow = await rpc('show.update', { pace: 1.3 });
  check('program pace is configurable', pacedShow.pace === 1.3, `pace ${pacedShow.pace}`);
  await rpc('show.update', { pace: 1 });

  const cueSeen = await new Promise((resolve) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
    const timer = setTimeout(() => { ws.close(); resolve(false); }, 8000);
    ws.on('open', () => { rpc('show.nextVerse').catch(() => {}); });
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.method === 'show.cue' && message.params?.cue?.kind === 'verse') {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        }
      } catch (_) {}
    });
    ws.on('error', () => { clearTimeout(timer); resolve(false); });
  });
  check('show cue broadcast over WebSocket', cueSeen === true);

  // 10c. Bible quiz (answers are never exposed before the reveal)
  const { QUESTIONS } = require('../lib/quiz.js');
  const questionsById = new Map(QUESTIONS.map((question) => [question.id, question]));
  const quizStatus = await rpc('quiz.status');
  check('quiz has at least 100 questions', quizStatus.totalQuestions >= 100, `${quizStatus.totalQuestions} questions`);
  check('quiz settings are exposed', typeof quizStatus.frequencyMinutes === 'number' && typeof quizStatus.revealSeconds === 'number',
    `every ${quizStatus.frequencyMinutes}m · reveal ${quizStatus.revealSeconds}s`);
  check('quiz questions carry verified KJV references', QUESTIONS.every((question) => /\(KJV\)$/.test(question.reference)));
  check('every quiz answer is short enough for a comment', QUESTIONS.every((question) => question.answer.length <= 40));

  const openedQuiz = await rpc('quiz.next', { source: 'test' });
  const openQuestion = questionsById.get(openedQuiz.active?.id);
  check('quiz question opens', Boolean(openedQuiz.active?.question && openQuestion));
  check('quiz answer hidden before reveal', openedQuiz.active?.answer === null && openedQuiz.active?.reference === null);

  const correctAnswer = await rpc('quiz.answer', {
    text: `  ${openQuestion.answer.toUpperCase()} `,
    name: 'Grace L.',
    uniqueId: 'smoke.quiz.grace'
  });
  check('quiz accepts case-insensitive answers with whitespace', correctAnswer.result?.correct === true && correctAnswer.result?.already === false);
  const duplicateAnswer = await rpc('quiz.answer', {
    text: openQuestion.answer.toLowerCase(),
    name: 'Grace L.',
    uniqueId: 'smoke.quiz.grace'
  });
  check('quiz ignores a repeated answer from the same viewer', duplicateAnswer.result?.already === true);
  const wrongAnswer = await rpc('quiz.answer', {
    text: 'definitely not the answer',
    name: 'Michael R.',
    uniqueId: 'smoke.quiz.michael'
  });
  check('quiz ignores wrong answers without shaming the viewer', wrongAnswer.result === null && wrongAnswer.quiz.active.correctCount === 1);

  const revealedQuiz = await rpc('quiz.reveal');
  check('quiz reveals the answer', revealedQuiz.active?.revealed === true && revealedQuiz.active.answer === openQuestion.answer);
  check('quiz reveal includes reference and explanation',
    revealedQuiz.active.reference === openQuestion.reference && revealedQuiz.active.explanation?.length > 20);
  const lateAnswer = await rpc('quiz.answer', { text: openQuestion.answer, name: 'Late Viewer', uniqueId: 'smoke.quiz.late' });
  check('quiz rejects answers after the reveal', lateAnswer.result === null);

  const updatedQuiz = await rpc('quiz.update', { enabled: true, frequencyMinutes: 12, revealSeconds: 20, tts: true });
  check('quiz frequency and reveal delay are configurable', updatedQuiz.frequencyMinutes === 12 && updatedQuiz.revealSeconds === 20);
  await rpc('quiz.update', { frequencyMinutes: 10, revealSeconds: 25 });

  // 10d. Real gift events and personalized thanks
  const giftEvent = await rpc('temple.offerGift', {
    user: 'Grace L.',
    uniqueId: 'smoke.gift.grace',
    coins: 60,
    giftName: 'Prayer candle',
    quantity: 3
  });
  check('gift records the sender and quantity', giftEvent.event.user === 'Grace L.' && giftEvent.event.quantity === 3, giftEvent.event.giftName);
  check('gift announcement is personalized', /Grace L/.test(giftEvent.event.message) && /Prayer candle/i.test(giftEvent.event.message), giftEvent.event.message);
  check('gift thanks never imply gifts buy blessings', !/purchase|guarantee|buy|heal|wealth|miracle|salvation/i.test(giftEvent.event.message));
  const giftSettingsOff = await rpc('gift.update', { announce: false, tts: false });
  check('gift announcements can be turned off', giftSettingsOff.announce === false && giftSettingsOff.tts === false);
  const silentGift = await rpc('temple.offerGift', { user: 'Michael R.', coins: 5, giftName: 'Rose', quantity: 1 });
  check('silenced gifts keep their TTS text empty', silentGift.event.announce === false && silentGift.event.ttsText === '');
  await rpc('gift.update', { announce: true, tts: true });

  // 10e. Prayer interaction toggle + scene matching
  const interactionOff = await rpc('temple.updateSettings', { prayer: { interactionEnabled: false } });
  check('prayer interaction can be disabled', interactionOff.settings.prayer.interactionEnabled === false);
  const ignoredPrayer = await rpc('temple.comment', {
    comment: 'pray for my family please',
    user: 'Toggle Tester',
    uniqueId: 'smoke.toggle',
    source: 'rpc'
  });
  check('disabled prayer interaction does not queue requests', ignoredPrayer?.prayerDisabled === true, JSON.stringify(ignoredPrayer).slice(0, 80));
  await rpc('temple.updateSettings', { prayer: { interactionEnabled: true } });

  await rpc('stage.updateSettings', { sceneMatch: true });
  const sceneCue = await rpc('show.nextPrayer', { theme: 'healing' });
  await sleep(400);
  const sceneState = await rpc('temple.getState');
  check('healing prayer switches to the candle scene', sceneState.settings.background.category === 'candles',
    `${sceneCue.cue?.eyebrow} → ${sceneState.settings.background.category}`);
  const sceneOff = await rpc('stage.updateSettings', { sceneMatch: false });
  check('scene matching can be disabled', sceneOff.settings.background.sceneMatch === false);
  await rpc('stage.updateSettings', { sceneMatch: true });

  // 11. Message library editable + command responses avoid overuse
  const messages = await rpc('messages.get');
  check('message library exposes commands', Array.isArray(messages.commands?.AMEN) && messages.commands.AMEN.length >= 3);
  check('gift thanks are tiered', Boolean(messages.templates?.giftThanks?.small && messages.templates?.giftThanks?.large));
  check('Bible references are present', messages.bibleVerses.every((verse) => verse.reference && verse.text));

  // 12. Ambient worship music
  const music = await rpc('music.get');
  check('music playlist loaded', music.tracks.length >= 5, `${music.tracks.length} tracks`);
  check('music settings define ducking', typeof music.settings?.volume === 'number' && typeof music.settings?.duckVolume === 'number',
    `volume ${music.settings?.volume} · duck ${music.settings?.duckVolume}`);
  check('music defaults to 8-12% volume', music.settings?.volume >= 0.08 && music.settings?.volume <= 0.12, String(music.settings?.volume));
  check('music tracks are 3-5 minutes', music.tracks.every((track) => track.durationSeconds >= 175 && track.durationSeconds <= 300),
    music.tracks.map((track) => Math.round(track.durationSeconds)).join(', '));
  if (music.tracks[0]) {
    const audioFile = await fetch(`${BASE}${music.tracks[0].url}`);
    check('music file served locally', audioFile.status === 200 && (audioFile.headers.get('content-type') || '').includes('audio'),
      `${music.tracks[0].url} → ${audioFile.status}`);
  }
  const musicUpdate = await rpc('music.update', { track: music.tracks[0]?.id, volume: 0.1, enabled: true, paused: false });
  check('music track can change without a restart', musicUpdate.settings.track === music.tracks[0]?.id && musicUpdate.settings.paused === false);

  // 13. Static pages
  for (const pathname of ['/', '/admin', '/css/live.css', '/css/admin.css', '/js/live.js', '/js/admin.js', '/js/audio.js', '/js/particles.js']) {
    const res = await fetch(`${BASE}${pathname}`);
    check(`static ${pathname}`, res.status === 200, String(res.status));
  }

  // 14. WebSocket + notifications
  await sleep(2700);
  await new Promise((resolve) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
    const seen = new Set();
    const timer = setTimeout(() => {
      check('websocket notified about prayer request', seen.has('prayer.request'), [...seen].join(', '));
      check('websocket notified about AMEN event', seen.has('temple.event'));
      check('websocket notified about a new quiz question', seen.has('quiz.start'), [...seen].join(', '));
      ws.close();
      resolve();
    }, 9000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'temple.getState', params: {} }));
      setTimeout(async () => {
        await rpc('prayer.add', { name: 'David K.', text: 'Please pray for wisdom and peace.', source: 'admin' });
        await rpc('temple.comment', { comment: 'AMEN', user: 'WebSocket Tester', uniqueId: 'smoke.ws' });
        await rpc('quiz.next', { source: 'test' }).catch(() => {});
      }, 350);
    });

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.method) seen.add(message.method);
        if (message.id === 99) check('websocket JSON-RPC result received', Boolean(message.result?.brand));
      } catch (_) {}
    });

    ws.on('error', (err) => {
      check('websocket connection', false, err.message);
      clearTimeout(timer);
      resolve();
    });
  });

  // 14. Cleanup: leave a pleasant demo state
  await rpc('prayer.clear');
  await rpc('prayer.add', { name: 'Sarah M.', text: 'Please pray for my family and for peace this week.', source: 'admin' });
  await rpc('prayer.add', { name: 'Michael R.', text: 'Please pray for my mother as she recovers.', source: 'admin' });
  await rpc('temple.updateSettings', { ttsVolume: 0.95, ttsRate: 1.0 });
  await rpc('show.update', { paused: false });

  const failures = results.filter((result) => !result.ok);
  console.log('\n--------------------------------------------------------------');
  console.log(`${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((failure) => console.log(` - ${failure.name} ${failure.detail}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exitCode = 1;
});
