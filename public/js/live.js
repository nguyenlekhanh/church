/**
 * Christian Prayer Live — 9:16 livestream controller.
 *
 * Rebuilt on top of the existing WebSocket JSON-RPC pipeline. Handles:
 *  - scaled 1080x1920 stage plus OBS clean mode (?obs=1)
 *  - cross-fading background rotation driven by the server
 *  - prayer request display, live comments and community counters
 *  - AMEN / devotional / gift animations
 *  - quick control dock for narration, backgrounds and prayer moderation
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const isObs = params.get('obs') === '1';
  if (isObs) document.body.classList.add('obs-mode');

  const stageWrapper = document.getElementById('stageWrapper');
  const stage = document.getElementById('stage9x16');
  const prayerCard = document.getElementById('prayerCard');
  const prayerAsk = document.getElementById('prayerAsk');
  const prayerCommunity = document.getElementById('prayerCommunity');
  const verseCard = document.getElementById('verseCard');
  const verseText = document.getElementById('verseText');
  const verseRef = document.getElementById('verseRef');
  const commentsList = document.getElementById('commentsList');
  const commentsEmpty = document.getElementById('commentsEmpty');
  const commentsCount = document.getElementById('commentsCount');
  const stageActivityList = document.getElementById('stageActivityList');
  const candleStrip = document.getElementById('candleStrip');
  const amenOverlay = document.getElementById('amenOverlay');
  const amenSub = document.getElementById('amenSub');
  const eventToast = document.getElementById('eventToast');
  const toastMark = document.getElementById('toastMark');
  const toastTitle = document.getElementById('toastTitle');
  const toastSub = document.getElementById('toastSub');
  const celebrationBanner = document.getElementById('celebrationBanner');
  const celebrationTitle = document.getElementById('celebrationTitle');
  const celebrationSub = document.getElementById('celebrationSub');
  const connectionWarning = document.getElementById('connectionWarning');
  const eventFeed = document.getElementById('eventFeed');
  const showCard = document.getElementById('showCard');
  const showEyebrow = document.getElementById('showEyebrow');
  const showTitle = document.getElementById('showTitle');
  const showBody = document.getElementById('showBody');
  const showNote = document.getElementById('showNote');
  const showRef = document.getElementById('showRef');
  const programLine = document.getElementById('programLine');
  const programText = document.getElementById('programText');
  const prayerWallEl = document.getElementById('prayerWall');
  const quizCard = document.getElementById('quizCard');
  const quizQuestion = document.getElementById('quizQuestion');
  const quizTimer = document.getElementById('quizTimer');
  const quizAnswerText = document.getElementById('quizAnswerText');
  const quizRef = document.getElementById('quizRef');
  const quizExplanation = document.getElementById('quizExplanation');
  const quizFoot = document.getElementById('quizFoot');
  const giftCard = document.getElementById('giftCard');
  const giftMark = document.getElementById('giftMark');
  const giftSender = document.getElementById('giftSender');
  const giftName = document.getElementById('giftName');
  const giftThanks = document.getElementById('giftThanks');
  const prayerInvite = document.getElementById('prayerInvite');
  const prayerInviteTitle = document.getElementById('prayerInviteTitle');
  const prayerInviteSub = document.getElementById('prayerInviteSub');

  const particleEngine = new window.PrayerParticleEngine(document.getElementById('prayerCanvas'));
  const audio = new window.PrayerAudioEngine();
  // Exposed for OBS troubleshooting and for the admin test console.
  window.prayerAudio = audio;

  const DEFAULT_PRAYER_ASK = 'You are welcome here. Type PRAY FOR ME in the comments to share a prayer request.';
  const DEFAULT_PRAYER_COMMUNITY = 'Let us pray together and encourage one another in faith, hope and love.';
  const DEFAULT_VERSE = { text: 'The Lord is my shepherd; I shall not want.', reference: 'Psalm 23:1 (KJV)' };

  let currentState = null;
  let backgroundList = [];
  let backgroundCategories = [];
  let backgroundUrl = '';
  let activeBgLayer = 0;
  let currentVerse = DEFAULT_VERSE;
  let prayerCountdownTimer = null;
  let amenTimer = null;
  let bannerTimer = null;
  let toastTimer = null;
  let toastQueue = [];
  let toastBusy = false;
  let rotationSaveTimer = null;

  /* ---------------------------------------------------------------------
     Stage scaling
     --------------------------------------------------------------------- */
  function fitStage() {
    if (!stageWrapper || !stage) return;
    const width = stageWrapper.clientWidth;
    const height = stageWrapper.clientHeight;
    const scale = Math.min(width / 1080, height / 1920);
    stage.style.setProperty('--stage-scale', String(Math.max(0.2, scale)));
  }
  window.addEventListener('resize', fitStage);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fitStage).observe(stageWrapper);
  }
  fitStage();

  /* ---------------------------------------------------------------------
     Audio unlock
     --------------------------------------------------------------------- */
  function unlockAudio() {
    audio.ensureContext();
    if (currentState?.settings?.music) audio.applyMusicSettings(currentState.settings.music);
    const btn = document.getElementById('btnUnlockAudio');
    if (btn) {
      btn.textContent = 'Audio Ready ✓';
      btn.classList.remove('gold');
      btn.classList.add('toggle', 'on');
    }
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  document.getElementById('btnUnlockAudio')?.addEventListener('click', unlockAudio);

  /* ---------------------------------------------------------------------
     Backgrounds
     --------------------------------------------------------------------- */
  const bgLayers = [document.getElementById('bgLayerA'), document.getElementById('bgLayerB')];

  function backgroundMeta(url) {
    return backgroundList.find((item) => item.url === url) || null;
  }

  // CC BY / CC BY-SA backgrounds require visible credit during broadcast.
  function updateBackgroundCredit(meta) {
    const text = meta
      ? `${meta.title} — ${meta.license}${meta.attribution ? ` · ${meta.attribution}` : ''}`
      : '';
    ['assetCredit', 'stageCredit'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    });
  }

  function applyBackground(url, transitionMs = 1600) {
    if (!url || url === backgroundUrl) return;
    const outgoing = bgLayers[activeBgLayer];
    const incoming = bgLayers[1 - activeBgLayer];
    const meta = backgroundMeta(url);

    const commit = () => {
      incoming.style.transitionDuration = `${Math.max(0, transitionMs)}ms`;
      outgoing.style.transitionDuration = `${Math.max(0, transitionMs)}ms`;
      incoming.classList.add('visible');
      outgoing.classList.remove('visible');
      activeBgLayer = 1 - activeBgLayer;
      backgroundUrl = url;
      updateBackgroundCredit(meta);
      const manualSelect = document.getElementById('selectBackgroundManual');
      if (manualSelect && document.activeElement !== manualSelect) manualSelect.value = url;
    };

    incoming.classList.remove('visible');
    incoming.style.transitionDuration = '0ms';

    if (!meta && !backgroundList.length) {
      // Before the list loads, still show the initial server-provided image.
      incoming.onload = commit;
      incoming.src = url;
      return;
    }

    const probe = new Image();
    probe.onload = () => {
      incoming.onload = null;
      incoming.src = url;
      if (incoming.complete) commit();
      else incoming.onload = commit;
    };
    probe.onerror = () => console.warn('[Background] Could not load', url);
    probe.src = url;
  }

  function setInitialBackground(url) {
    if (!url || backgroundUrl) return;
    const layer = bgLayers[activeBgLayer];
    layer.style.transitionDuration = '0ms';
    layer.src = url;
    layer.onload = () => {
      layer.classList.add('visible');
      backgroundUrl = url;
      const meta = backgroundMeta(url);
      updateBackgroundCredit(meta);
      const manualSelect = document.getElementById('selectBackgroundManual');
      if (manualSelect && document.activeElement !== manualSelect) manualSelect.value = url;
    };
  }

  async function loadBackgroundCatalog() {
    try {
      const res = await fetch('/api/backgrounds');
      const data = await res.json();
      backgroundList = Array.isArray(data.backgrounds) ? data.backgrounds : [];
      backgroundCategories = Array.isArray(data.categories) ? data.categories : [];
      // The first background may render before this catalog arrives; credit it now.
      if (backgroundUrl) updateBackgroundCredit(backgroundMeta(backgroundUrl));

      const categorySelect = document.getElementById('selectBackgroundCategory');
      if (categorySelect) {
        const current = categorySelect.value;
        categorySelect.innerHTML = '';
        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = 'All images';
        categorySelect.appendChild(all);
        backgroundCategories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category;
          option.textContent = category.charAt(0).toUpperCase() + category.slice(1);
          categorySelect.appendChild(option);
        });
        categorySelect.value = data.settings?.category || current || 'all';
      }

      const manualSelect = document.getElementById('selectBackgroundManual');
      if (manualSelect) {
        manualSelect.innerHTML = '';
        backgroundList.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.url;
          option.textContent = `${item.category} · ${item.title.slice(0, 46)}`;
          manualSelect.appendChild(option);
        });
        manualSelect.value = data.settings?.current || backgroundUrl || '';
      }
      if (data.settings?.current) applyBackground(data.settings.current, 0);
    } catch (err) {
      console.warn('[Background] Catalog unavailable:', err.message);
    }
  }

  /* ---------------------------------------------------------------------
     UI rendering
     --------------------------------------------------------------------- */
  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function renderStats(state) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatNumber(value);
    };
    set('statPrayers', state.prayerCount);
    set('statCandles', state.candlesLit);
    set('statAmens', state.amenCount);
    set('statFollowers', state.followCount);
    set('statGifts', state.giftCount);
    set('viewerCount', state.tiktok?.viewerCount || 0);

    const liveText = document.getElementById('liveStatusText');
    const liveDot = document.getElementById('liveDot');
    if (liveText && liveDot) {
      if (state.tiktok?.connected) {
        liveDot.classList.add('connected');
        liveText.textContent = `LIVE @${state.tiktok.username}`;
      } else if (state.tiktok?.connecting) {
        liveDot.classList.remove('connected');
        liveText.textContent = 'Connecting…';
      } else {
        liveDot.classList.remove('connected');
        liveText.textContent = 'LIVE • PRAYER ROOM';
      }
    }

    renderCandles(state.activeCandles);
  }

  function renderCandles(count) {
    if (!candleStrip) return;
    const visible = Math.max(1, Math.min(6, Number(count) || 1));
    if (candleStrip.children.length === visible) return;
    candleStrip.innerHTML = '';
    for (let i = 0; i < visible; i++) {
      const candle = document.createElement('span');
      candle.className = 'mini-candle';
      candle.style.animationDelay = `${(i * 0.35) % 2}s`;
      candleStrip.appendChild(candle);
    }
  }

  function renderChat(feed) {
    if (!commentsList) return;
    const list = Array.isArray(feed) ? feed.slice(0, 5) : [];
    commentsList.innerHTML = '';
    if (commentsCount) commentsCount.textContent = list.length ? `${list.length}` : '';
    if (list.length === 0) {
      const empty = commentsEmpty || document.createElement('div');
      empty.className = 'comments-empty';
      empty.textContent = 'Comments from TikTok will appear here.';
      commentsList.appendChild(empty);
      return;
    }
    list.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'comment-item';

      const user = document.createElement('span');
      user.className = 'comment-user';
      user.textContent = entry.user || 'Friend';

      const dot = document.createElement('span');
      dot.className = 'comment-dot';
      dot.textContent = '·';

      const text = document.createElement('span');
      text.className = 'comment-text';
      text.textContent = entry.text || '';

      row.append(user, dot, text);
      commentsList.appendChild(row);
    });
  }

  function activityShort(event) {
    switch (event.kind) {
      case 'candle': return `lit ${event.count || 1} prayer candle${event.count === 1 ? '' : 's'}`;
      case 'amen': return 'said Amen';
      case 'follow': return 'joined the prayer community';
      case 'share': return 'shared faith, hope and love';
      case 'gift': return `sent ${event.giftName || 'a gift'}`;
      case 'verse': return `received ${event.verse?.reference || 'a Scripture card'}`;
      case 'command': return `sent ${event.command}`;
      case 'prayerRequest': return 'asked for prayer';
      default: return 'joined us in prayer';
    }
  }

  function renderStageActivity(events) {
    if (!stageActivityList) return;
    const list = Array.isArray(events) ? events.slice(0, 4) : [];
    stageActivityList.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'comments-empty';
      empty.textContent = 'Recent activity will appear here.';
      stageActivityList.appendChild(empty);
      return;
    }
    list.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'activity-line';
      const name = document.createElement('strong');
      name.textContent = event.user || 'Friend';
      row.appendChild(name);
      row.appendChild(document.createTextNode(` ${activityShort(event)}`));
      stageActivityList.appendChild(row);
    });
  }

  function defaultPrayerTexts() {
    prayerAsk.textContent = DEFAULT_PRAYER_ASK;
    prayerCommunity.textContent = DEFAULT_PRAYER_COMMUNITY;
  }

  function renderPrayerFromState(state) {
    const current = state.currentPrayer;
    if (!current) {
      defaultPrayerTexts();
      return;
    }
    const ask = current.ask
      || (current.text
        ? `${current.name} is asking for prayer: “${current.text}”`
        : `${current.name} is asking for prayers.`);
    prayerAsk.textContent = ask;
    prayerCommunity.textContent = current.community || `Let us keep ${current.name} in our prayers.`;
    prayerAsk.classList.toggle('prayer-long', ask.length > 110);
  }

  function showPrayer(params) {
    const ask = params.ask || (params.request
      ? (params.request.text
        ? `${params.request.name} is asking for prayer: “${params.request.text}”`
        : `${params.request.name} is asking for prayers.`)
      : '');
    if (!ask) return;
    prayerAsk.textContent = ask;
    prayerCommunity.textContent = params.community || 'Let us pray together.';
    prayerCard.classList.add('pulse');
    clearTimeout(prayerCountdownTimer);
    prayerCountdownTimer = setTimeout(() => prayerCard.classList.remove('pulse'), 6000);

    particleEngine.spawnPrayerCandle(870, 900);
    audio.playCandleChime();

    if (params.event?.ttsText) {
      audio.enqueueTts(params.event.ttsText, { lang: params.event.ttsLang || 'en' });
    }
  }

  function showVerse(verse, { flash = true } = {}) {
    if (!verse || !verse.text) return;
    currentVerse = verse;
    verseText.textContent = verse.text;
    verseRef.textContent = verse.reference || '';
    if (flash) {
      verseCard.classList.add('verse-flash');
      particleEngine.spawnBlessing();
      audio.playSoftChime(0.9);
      clearTimeout(prayerCountdownTimer);
      setTimeout(() => verseCard.classList.remove('verse-flash'), 6500);
    }
  }

  /* ---------------------------------------------------------------------
     Toasts, AMEN and celebration overlays
     --------------------------------------------------------------------- */
  function queueToast(mark, title, sub, duration = 4500) {
    toastQueue.push({ mark, title, sub, duration });
    if (!toastBusy) nextToast();
  }

  function nextToast() {
    const item = toastQueue.shift();
    if (!item) {
      toastBusy = false;
      return;
    }
    toastBusy = true;
    toastMark.textContent = item.mark || '✝';
    toastTitle.textContent = item.title || '';
    toastSub.textContent = item.sub || '';
    toastSub.style.display = item.sub ? '' : 'none';
    eventToast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      eventToast.classList.remove('visible');
      setTimeout(nextToast, 400);
    }, item.duration);
  }

  function showAmen(subtitle = 'Let us pray together.') {
    amenSub.textContent = subtitle;
    amenOverlay.classList.remove('visible');
    void amenOverlay.offsetWidth;

    // Restart the keyframes synchronously (rAF can be paused in a background
    // tab, which OBS hosts can report while the scene is not selected).
    const parts = [
      amenOverlay.querySelector('.amen-glow'),
      amenOverlay.querySelector('.amen-word'),
      amenSub
    ];
    parts.forEach((element) => {
      if (element) element.style.animation = 'none';
    });
    void amenOverlay.offsetWidth;
    parts.forEach((element) => {
      if (element) element.style.animation = '';
    });

    amenOverlay.classList.add('visible');
    particleEngine.spawnAmenWave(540, 470, 3);
    audio.playAmenChime();
    clearTimeout(amenTimer);
    amenTimer = setTimeout(() => amenOverlay.classList.remove('visible'), 3800);
  }

  function showCelebration(title, subtitle) {
    celebrationTitle.textContent = title || 'Thank you';
    celebrationSub.textContent = subtitle || '';
    celebrationBanner.classList.add('visible');
    particleEngine.spawnCelebration();
    audio.playCelebration();
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => celebrationBanner.classList.remove('visible'), 7000);
  }

  /* ---------------------------------------------------------------------
     Event handling
     --------------------------------------------------------------------- */
  function enqueueEventTts(event) {
    if (!event?.ttsText) return;
    audio.enqueueTts(event.ttsText, {
      lang: event.ttsLang || 'en',
      voice: event.ttsLang === 'vi' ? currentState?.settings?.vnVoice : currentState?.settings?.enVoice
    });
  }

  function handleCommandEvent(event) {
    const command = event.command;
    const message = event.message || '';
    if (command === 'AMEN') {
      showAmen(message || 'Let us pray together.');
      return;
    }
    if (command === 'PRAY') {
      showAmen(message || 'Let us pray together.');
      queueToast('✝', message || 'Let us pray together.', `${event.user} is praying`);
      showPrayerInvite('Let us pray with you', 'Type PRAY FOR ME in the comments to share a request.');
      return;
    }
    if (command === 'THANK YOU') {
      queueToast('♡', message || 'Thank you for being here.', `${event.user} says thank you`);
      particleEngine.spawnBlessing();
      audio.playSoftChime(1);
      return;
    }
    if (command === 'PRAYER') {
      queueToast('✝', message || 'Share your prayer request in the comments.', `${event.user} is praying`);
      particleEngine.spawnAmenWave(540, 470, 2);
      showPrayerInvite('Share a prayer request', 'Type PRAY FOR ME and our community will pray with you.');
      return;
    }
    const marks = { JESUS: '✝', FAITH: '✝', HOPE: '✦', LOVE: '♡', GOD: '✝' };
    queueToast(marks[command] || '✝', message, `${event.user} · ${command}`);
    particleEngine.spawnLikeBurst(540, 470, 12);
    audio.playSoftChime(0.8);
  }

  /* ---------------------------------------------------------------------
     Community engagement — Bible quiz, gift spotlight, prayer invitation
     --------------------------------------------------------------------- */
  let quizSignature = '';
  let quizActive = null;
  let quizTickTimer = null;
  let quizHideTimer = null;
  let giftTimer = null;
  let inviteTimer = null;
  let lastInviteAt = 0;

  function quizIsActive(quiz) {
    return Boolean(quiz && quiz.active && quiz.active.question);
  }

  function hideQuizCard() {
    if (!quizCard) return;
    clearInterval(quizTickTimer);
    quizTickTimer = null;
    quizSignature = '';
    quizActive = null;
    quizCard.classList.remove('visible');
    stage?.classList.remove('quiz-open');
  }

  function updateQuizCountdown(quiz) {
    if (!quizActive || !quizTimer) return;
    if (quizActive.revealed) return;
    const revealAt = new Date(quizActive.revealAt).getTime();
    const remaining = Math.max(0, Math.ceil((revealAt - Date.now()) / 1000));
    quizTimer.textContent = `${remaining}s`;
    if (remaining <= 0) clearInterval(quizTickTimer);
  }

  function quizFootText(active) {
    if (!active.revealed) return 'Type your answer in the comments';
    const count = Number(active.correctCount) || 0;
    if (count === 0) return 'No correct answers yet — join the next round';
    const names = Array.isArray(active.correctNames) ? active.correctNames.slice(0, 3) : [];
    const who = names.length > 0 ? ` — ${names.join(', ')}` : '';
    return `${count} correct ${count === 1 ? 'answer' : 'answers'}${who}`;
  }

  function renderQuiz(quiz) {
    if (!quizCard) return;
    if (!quizIsActive(quiz)) {
      hideQuizCard();
      return;
    }
    const active = quiz.active;
    const revealed = Boolean(active.revealed);
    const signature = `${active.id}:${revealed}`;
    quizActive = active;

    quizQuestion.textContent = active.question || '';
    quizCard.classList.toggle('revealed', revealed);
    quizFoot.textContent = quizFootText(active);

    if (revealed) {
      quizAnswerText.textContent = active.answer || '';
      quizRef.textContent = active.reference || '';
      quizExplanation.textContent = active.explanation || '';
      quizTimer.textContent = 'ANSWER';
      clearInterval(quizTickTimer);
      quizTickTimer = null;
    } else {
      const total = Math.max(5, Number(active.secondsLeft) || Number(quiz.revealSeconds) || 25);
      quizCard.style.setProperty('--quiz-ms', `${total * 1000}ms`);
    }

    if (quizSignature !== signature) {
      // Only restart the entrance animation when a new question opens or the
      // answer is revealed — regular state broadcasts must not flicker the card.
      quizSignature = signature;
      quizCard.classList.remove('visible');
      void quizCard.offsetWidth;
    }

    quizCard.classList.add('visible');
    stage?.classList.add('quiz-open');
    clearTimeout(quizHideTimer);
    quizHideTimer = null;

    if (!revealed) {
      updateQuizCountdown(quiz);
      clearInterval(quizTickTimer);
      quizTickTimer = setInterval(() => updateQuizCountdown(quiz), 500);
    }
  }

  function showGiftCard(event) {
    if (!giftCard) return;
    if (event.announce === false) return;
    const tier = event.tier || 'small';
    giftSender.textContent = event.user || 'A friend';
    giftName.textContent = event.giftName || 'a gift';
    giftThanks.textContent = event.message || 'Thank you for your kindness.';
    giftMark.textContent = tier === 'large' ? '✝' : tier === 'medium' ? '✦' : '♡';
    giftCard.classList.remove('visible');
    void giftCard.offsetWidth;
    giftCard.classList.add('visible');
    clearTimeout(giftTimer);
    giftTimer = setTimeout(() => giftCard.classList.remove('visible'), tier === 'large' ? 9000 : 6500);
  }

  function showPrayerInvite(title, sub) {
    if (!prayerInvite) return;
    const now = Date.now();
    if (now - lastInviteAt < 15000) return;
    lastInviteAt = now;
    prayerInviteTitle.textContent = title;
    prayerInviteSub.textContent = sub;
    prayerInvite.classList.add('visible');
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => prayerInvite.classList.remove('visible'), 7500);
  }

  function handleGiftEvent(event) {
    const tier = event.tier || 'small';
    showGiftCard(event);
    if (tier === 'large') {
      showCelebration(event.giftName || 'A gift of kindness', event.message || 'Thank you for supporting our prayer community.');
      particleEngine.spawnCelebration();
      audio.playChurchBell(0.9);
    } else if (tier === 'medium') {
      particleEngine.spawnAmenWave(540, 470, 2);
      particleEngine.spawnLikeBurst(540, 470, 22);
      audio.playChurchBell(0.85);
    } else {
      particleEngine.spawnPrayerCandle(870, 900);
      audio.playCandleChime();
    }
    particleEngine.spawnFloatingText(`Thank you, ${event.user}`, 540, 760, '#f7e6b8');
  }

  function handleEvent(event) {
    if (!event) return;

    switch (event.kind) {
      case 'candle': {
        queueToast('✦', `${event.user} lit ${event.count} prayer ${event.count === 1 ? 'candle' : 'candles'}.`, 'Thank you for adding your light.');
        particleEngine.spawnPrayerCandle(870, 900);
        particleEngine.spawnFloatingText(`+${event.count} candle${event.count === 1 ? '' : 's'}`, 540, 760);
        audio.playCandleChime();
        break;
      }
      case 'amen': {
        particleEngine.spawnLikeBurst(540, 470, Math.min(28, 8 + (event.count || 1) * 2));
        audio.playSoftChime(0.45);
        break;
      }
      case 'follow': {
        queueToast('♡', event.message || 'Welcome to our prayer community. God bless you!', `${event.user} just followed`);
        particleEngine.spawnBlessing();
        audio.playSoftChime(1);
        break;
      }
      case 'share': {
        queueToast('✧', event.message || 'Thank you for sharing faith, hope and love!', `${event.user} shared the prayer room`);
        particleEngine.spawnBlessing();
        audio.playSoftChime(0.8);
        break;
      }
      case 'blessing': {
        queueToast('✝', event.message || 'Thank you for being here.', event.user || '');
        particleEngine.spawnAmenWave(540, 470, 1);
        break;
      }
      case 'verse': {
        if (event.verse) showVerse(event.verse, { flash: true });
        break;
      }
      case 'gift': {
        handleGiftEvent(event);
        break;
      }
      case 'command': {
        handleCommandEvent(event);
        break;
      }
      case 'prayerRequest': {
        // The dedicated prayer.request notification owns display + narration.
        break;
      }
      default: {
        if (event.message) queueToast('✝', event.message, event.user || '');
      }
    }

    const footerActivity = document.getElementById('footerActivity');
    if (footerActivity) {
      footerActivity.textContent = activityLine(event);
    }

    enqueueEventTts(event);
  }

  function activityLine(event) {
    switch (event.kind) {
      case 'candle': return `${event.user} lit a prayer candle.`;
      case 'amen': return 'Amen — thank you for praying with us.';
      case 'follow': return `${event.user} joined our prayer community.`;
      case 'share': return `${event.user} shared faith, hope and love.`;
      case 'gift': return `Thank you, ${event.user}, for your kindness.`;
      case 'verse': return event.verse?.reference || 'A word from Scripture.';
      case 'command': return `${event.user} · ${event.command}`;
      case 'prayerRequest': return 'Let us pray for one another.';
      default: return 'Pray Together. Grow in Faith.';
    }
  }

  function renderEventFeed(events) {
    if (!eventFeed) return;
    const list = Array.isArray(events) ? events.slice(0, 8) : [];
    eventFeed.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'feed-empty';
      empty.textContent = 'No activity yet.';
      eventFeed.appendChild(empty);
      return;
    }
    list.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'feed-item';
      const strong = document.createElement('strong');
      strong.textContent = event.user || 'Friend';
      row.appendChild(strong);
      row.appendChild(document.createTextNode(` — ${activityLine(event)}`));
      eventFeed.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------------
     Automated live show — cue card, program line, prayer wall
     --------------------------------------------------------------------- */
  const cueQueue = [];
  let activeCue = null;
  let cueAdvanceTimer = null;
  let cueLeaveTimer = null;
  let currentShow = null;
  let wallRequests = [];
  let wallOffset = 0;
  let wallSignature = '';

  function scheduleCueAdvance(ms) {
    clearTimeout(cueAdvanceTimer);
    cueAdvanceTimer = setTimeout(advanceCue, Math.max(1200, ms));
  }

  function advanceCue() {
    if (!activeCue || !showCard) return;
    showCard.classList.remove('visible');
    showCard.classList.add('leaving');
    clearTimeout(cueLeaveTimer);
    cueLeaveTimer = setTimeout(() => {
      showCard.classList.remove('leaving');
      activeCue = null;
      displayNextCue();
    }, 950);
  }

  function displayNextCue() {
    if (activeCue || !showCard) return;
    const cue = cueQueue.shift();
    if (!cue) return;
    activeCue = cue;
    const duration = Math.max(5000, Number(cue.displayMs) || 15000);

    showCard.dataset.kind = cue.kind || 'prayer';
    showEyebrow.textContent = cue.eyebrow || '';
    showTitle.textContent = cue.title || '';
    showBody.textContent = cue.body || '';
    showNote.textContent = cue.note || '';
    showRef.textContent = cue.reference || '';
    showCard.style.setProperty('--cue-ms', `${duration}ms`);

    showCard.classList.remove('leaving', 'visible');
    void showCard.offsetWidth;
    showCard.classList.add('visible');
    scheduleCueAdvance(duration + 800);

    if (cue.verse) showVerse(cue.verse, { flash: false });

    if (cue.kind === 'welcome') {
      particleEngine.spawnBlessing();
      audio.playSoftChime(0.95);
    } else if (cue.kind === 'prayer' || cue.kind === 'gratitude') {
      particleEngine.spawnPrayerCandle(540, 880);
      audio.playSoftChime(0.55);
    } else if (cue.kind === 'community') {
      particleEngine.spawnAmenWave(540, 620, 2);
      audio.playSoftChime(0.7);
    } else {
      particleEngine.spawnBlessing();
      audio.playSoftChime(0.6);
    }
  }

  function handleShowCue(cue) {
    if (!cue) return;
    if (cueQueue.length > 3) cueQueue.shift();
    cueQueue.push(cue);
    if (!activeCue) displayNextCue();
  }

  function renderShow(show) {
    if (!show) return;
    currentShow = show;
    const paused = !show.enabled || show.paused;
    const label = show.current?.eyebrow || show.current?.label || '';

    if (programText) {
      programText.textContent = paused
        ? (show.enabled ? 'PROGRAM PAUSED' : 'PROGRAM OFF')
        : (label ? `NOW · ${label}` : 'PREPARING THE PRAYER ROOM');
    }
    if (programLine) programLine.classList.toggle('paused', paused);

    setToggle(document.getElementById('btnToggleShow'), show.enabled, 'Program: On', 'Program: Off');

    const nowEl = document.getElementById('showNow');
    if (nowEl) {
      const currentLabel = label || 'Idle';
      const nextLabel = show.next?.label || '—';
      nowEl.textContent = paused ? `${currentLabel} · paused` : `${currentLabel} · next: ${nextLabel}`;
    }

    const statusEl = document.getElementById('showStatus');
    if (statusEl) {
      if (!show.enabled) {
        statusEl.textContent = 'Automated program is off. Cues appear only when you trigger them.';
      } else if (show.paused) {
        statusEl.textContent = 'Program paused. Welcome greetings follow their own setting.';
      } else if (show.current) {
        statusEl.textContent = `Segment ${show.current.index} of ${show.total} · ${show.current.label}. `
          + `Welcome greetings ${show.welcomeEnabled ? 'on' : 'off'}. `
          + (show.narrationBusySeconds > 0
            ? `Narration speaking (${show.narrationBusySeconds}s).`
            : 'Narration ready.');
      } else {
        statusEl.textContent = 'The program will start with a welcome cue.';
      }
    }
  }

  function paintPrayerWall() {
    if (!prayerWallEl) return;
    prayerWallEl.innerHTML = '';
    if (wallRequests.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'comments-empty';
      empty.textContent = 'Approved prayer requests will appear here.';
      prayerWallEl.appendChild(empty);
      return;
    }
    const count = Math.min(2, wallRequests.length);
    for (let i = 0; i < count; i += 1) {
      const item = wallRequests[(wallOffset + i) % wallRequests.length];
      const row = document.createElement('div');
      row.className = 'wall-item';
      const name = document.createElement('span');
      name.className = 'wall-name';
      // First names only — never the full TikTok display name.
      name.textContent = item.displayName || item.name || 'Friend';
      const text = document.createElement('div');
      text.className = 'wall-text';
      text.textContent = item.text || 'Asking for prayer today.';
      row.append(name, text);
      prayerWallEl.appendChild(row);
    }
  }

  function renderPrayerWall(requests) {
    const next = (Array.isArray(requests) ? requests : []).filter(
      (request) => request && request.name && request.status === 'approved' && request.source !== 'simulation'
    );
    const signature = next.map((request) => request.id).join('|');
    if (signature === wallSignature) return;
    wallSignature = signature;
    wallRequests = next.slice(0, 12);
    if (wallOffset >= wallRequests.length) wallOffset = 0;
    paintPrayerWall();
  }

  // Rotate the wall gently so recent requests stay visible without scrolling.
  setInterval(() => {
    if (wallRequests.length > 2) {
      wallOffset = (wallOffset + 2) % wallRequests.length;
      paintPrayerWall();
    }
  }, 15000);

  /* ---------------------------------------------------------------------
     Settings reflected in the quick dock
     --------------------------------------------------------------------- */
  function setToggle(button, on, labelOn, labelOff) {
    if (!button) return;
    button.classList.toggle('on', Boolean(on));
    button.textContent = on ? labelOn : labelOff;
  }

  /* ---------------------------------------------------------------------
     Background worship music
     --------------------------------------------------------------------- */
  let musicTracks = [];

  function musicTrackById(id) {
    return musicTracks.find((track) => track.id === id) || null;
  }

  function renderMusicStatus(statusOverride) {
    const status = statusOverride || audio.getMusicStatus();
    const track = musicTrackById(status.trackId);
    const nowEl = document.getElementById('musicNowPlaying');
    if (nowEl) nowEl.textContent = track ? `${track.title} · ${track.bpm} BPM` : 'No worship track selected';

    const stateEl = document.getElementById('musicStatus');
    if (stateEl) {
      if (!status.enabled) stateEl.textContent = 'Background music disabled.';
      else if (status.paused) stateEl.textContent = 'Music paused.';
      else if (!status.unlocked) stateEl.textContent = 'Enable audio to hear the worship playlist.';
      else if (status.loading) stateEl.textContent = 'Loading track…';
      else if (status.error) stateEl.textContent = `Music error: ${status.error}`;
      else if (status.playing) stateEl.textContent = status.ducked ? 'Music playing · ducked under narration' : 'Music playing';
      else stateEl.textContent = 'Music idle.';
    }

    setToggle(document.getElementById('btnToggleMusic'), status.enabled, 'Music: On', 'Music: Off');
    const playBtn = document.getElementById('btnToggleMusicPlay');
    if (playBtn) playBtn.textContent = status.playing ? 'Pause Music' : 'Play Music';
    const shuffleBtn = document.getElementById('btnShuffleMusic');
    if (shuffleBtn) {
      shuffleBtn.textContent = status.shuffle ? 'Shuffle: On' : 'Shuffle: Off';
      shuffleBtn.classList.toggle('on', Boolean(status.shuffle));
    }
  }

  async function loadMusicCatalog() {
    try {
      const res = await fetch('/api/music');
      const data = await res.json();
      musicTracks = Array.isArray(data.tracks) ? data.tracks : [];
      audio.setMusicPlaylist(musicTracks);
      if (currentState?.settings?.music) audio.applyMusicSettings(currentState.settings.music);
      else if (data.settings) audio.applyMusicSettings(data.settings);
    } catch (err) {
      console.warn('[Music] Catalog unavailable:', err.message);
    }
    renderMusicStatus();
  }

  audio.onMusicStateChange = (event) => {
    renderMusicStatus(event?.status);
    if (event?.reason === 'advance' && event.trackId) {
      // Keep the shared state (and any other stage window) on the same track.
      callRpc('music.update', { track: event.trackId });
    }
  };
  audio.onTtsStateChange = (event) => {
    renderMusicStatus();
    if (!activeCue) return;
    // Keep the cue on screen while Piper is still speaking to this room.
    if (event?.speaking) clearTimeout(cueAdvanceTimer);
    else scheduleCueAdvance(2400);
  };

  function applySettings(settings, ttsStatus) {
    if (!settings) return;
    audio.ttsEnabled = settings.ttsEnabled !== false;
    audio.ttsLanguage = settings.ttsLanguage || 'en';
    audio.ttsRate = Number(settings.ttsRate) || 1.0;

    if (typeof settings.ttsVolume === 'number') {
      audio.setTtsVolume(settings.ttsVolume);
      const slider = document.getElementById('sliderTtsVol');
      if (slider && document.activeElement !== slider) slider.value = String(Math.round(settings.ttsVolume * 100));
      const label = document.getElementById('valTtsVol');
      if (label) label.textContent = `${Math.round(settings.ttsVolume * 100)}%`;
    }

    const music = settings.music || {};
    audio.applyMusicSettings(music);
    if (typeof music.volume === 'number') {
      const slider = document.getElementById('sliderMusicVol');
      if (slider && document.activeElement !== slider) slider.value = String(Math.round(music.volume * 100));
      const label = document.getElementById('valMusicVol');
      if (label) label.textContent = `${Math.round(music.volume * 100)}%`;
    }
    renderMusicStatus();
    setToggle(document.getElementById('btnToggleTts'), audio.ttsEnabled, 'Narration: On', 'Narration: Off');

    const languageSelect = document.getElementById('selectTtsLanguage');
    if (languageSelect && document.activeElement !== languageSelect) {
      languageSelect.value = settings.ttsLanguage || 'en';
    }

    const bg = settings.background || {};
    setToggle(document.getElementById('btnToggleRotation'), bg.enabled, 'Rotation: On', 'Rotation: Off');
    const category = document.getElementById('selectBackgroundCategory');
    if (category && bg.category && document.activeElement !== category) category.value = bg.category;
    const interval = document.getElementById('sliderRotationInterval');
    if (interval && document.activeElement !== interval && bg.intervalSeconds) {
      interval.value = String(bg.intervalSeconds);
      const label = document.getElementById('valRotationInterval');
      if (label) label.textContent = `${bg.intervalSeconds}s`;
    }

    const pauseBtn = document.getElementById('btnPausePrayers');
    if (pauseBtn) {
      pauseBtn.textContent = settings.prayer?.paused ? 'Resume Notifications' : 'Pause Notifications';
      pauseBtn.classList.toggle('on', Boolean(settings.prayer?.paused));
    }

    const autoSimBtn = document.getElementById('btnToggleAutoSim');
    if (autoSimBtn) {
      autoSimBtn.textContent = settings.autoSim ? 'Demo activity: On' : 'Demo activity: Off';
      autoSimBtn.classList.toggle('on', Boolean(settings.autoSim));
    }
    // Simulated activity is always visible on screen so it is never mistaken
    // for a real viewer, comment or gift during a broadcast.
    document.body.classList.toggle('demo-mode', Boolean(settings.autoSim));

    updateVoiceStatus(ttsStatus);
  }

  function updateVoiceStatus(status) {
    const el = document.getElementById('voiceStatus');
    if (!el) return;
    if (!status) {
      el.textContent = 'Voice engine starting…';
      el.className = 'voice-status';
      return;
    }
    if (status.status === 'ready') {
      const en = status.voices?.find((voice) => voice.language === 'en' && voice.id === status.enVoice);
      const vi = status.voices?.find((voice) => voice.language === 'vi' && voice.id === status.vnVoice);
      el.textContent = `Piper ready · EN ${en?.id || status.enVoice} · VI ${vi?.id || status.vnVoice}`;
      el.className = 'voice-status ok';
    } else if (status.status === 'error') {
      el.textContent = status.error || 'Voice engine unavailable. Run: uv pip install piper-tts';
      el.className = 'voice-status error';
    } else {
      el.textContent = 'Voice engine loading (first start can take ~10s)…';
      el.className = 'voice-status';
    }
  }

  function updateConnectionStatus(state) {
    const note = document.getElementById('connectionNote');
    if (!note) return;
    if (state.tiktok?.connected) {
      note.textContent = `Connected to @${state.tiktok.username} · ${formatNumber(state.tiktok.viewerCount || 0)} watching`;
    } else if (state.tiktok?.connecting) {
      note.textContent = `Connecting to @${state.tiktok.username}…`;
    } else if (state.tiktok?.lastError) {
      note.textContent = `Not connected · ${state.tiktok.lastError}`;
    } else {
      note.textContent = 'Not connected to TikTok Live.';
    }
    const input = document.getElementById('inputTikTokUser');
    if (input && !input.value && state.tiktok?.username) input.value = `@${state.tiktok.username}`;

    const queueNote = document.getElementById('prayerDockNote');
    if (queueNote) {
      const total = Array.isArray(state.prayerRequests)
        ? state.prayerRequests.filter((req) => req.status !== 'hidden' && req.status !== 'removed').length
        : 0;
      queueNote.textContent = `${total} ${total === 1 ? 'request' : 'requests'} in the queue${state.settings?.prayer?.paused ? ' · notifications paused' : ''}`;
    }
  }

  /* ---------------------------------------------------------------------
     State updates
     --------------------------------------------------------------------- */
  function updateState(state) {
    if (!state) return;
    const firstState = !currentState;
    currentState = state;

    renderStats(state);
    renderChat(state.chatFeed);
    renderPrayerFromState(state);
    if (state.featuredVerse) showVerse(state.featuredVerse, { flash: false });
    else showVerse(DEFAULT_VERSE, { flash: false });
    applySettings(state.settings, state.tts);
    updateConnectionStatus(state);
    renderShow(state.show);
    renderQuiz(state.quiz);
    renderPrayerWall(state.prayerRequests);
    renderEventFeed(state.recentEvents);
    renderStageActivity(state.recentEvents);

    if (state.backgrounds?.current) {
      if (firstState) setInitialBackground(state.backgrounds.current);
      else applyBackground(state.backgrounds.current, state.settings?.background?.transitionMs || 1600);
    }
  }

  /* ---------------------------------------------------------------------
     WebSocket JSON-RPC 2.0
     --------------------------------------------------------------------- */
  let ws = null;
  let rpcId = 1;
  let reconnectTimer = null;

  function setConnectionWarning(visible) {
    if (!connectionWarning) return;
    connectionWarning.classList.toggle('visible', visible);
  }

  function connectWebSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => setConnectionWarning(false);

    ws.onmessage = (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch (_) {
        return;
      }
      const { method, params: data } = payload;
      switch (method) {
        case 'temple.state':
          updateState(data);
          break;
        case 'temple.event':
          if (data?.state) updateState(data.state);
          if (data?.event) handleEvent(data.event);
          break;
        case 'prayer.request':
          if (data?.state) updateState(data.state);
          showPrayer(data || {});
          if (data?.request) {
            showPrayerInvite(
              `Thank you, ${data.request.name || 'friend'}`,
              'Your request is on the prayer wall — we are praying with you.'
            );
          }
          break;
        case 'prayer.state':
          if (data?.state) updateState(data.state);
          break;
        case 'prayer.hide': {
          const current = currentState?.currentPrayer;
          if (data?.id === '*' || (current && current.id === data?.id)) {
            defaultPrayerTexts();
          }
          break;
        }
        case 'live.chat':
          if (data?.chatFeed) renderChat(data.chatFeed);
          else if (currentState) {
            currentState.chatFeed = [data.entry, ...(currentState.chatFeed || [])].slice(0, 8);
            renderChat(currentState.chatFeed);
          }
          break;
        case 'stage.background':
          if (data?.url) applyBackground(data.url, data.transitionMs ?? 1600);
          break;
        case 'tts.status':
          if (currentState) currentState.tts = data;
          updateVoiceStatus(data);
          break;
        case 'music.state':
          if (data?.settings) {
            if (currentState) {
              currentState.settings = { ...(currentState.settings || {}), music: data.settings };
            }
            audio.applyMusicSettings(data.settings);
            renderMusicStatus();
          }
          break;
        case 'tts.play':
          if (data?.url) {
            audio.enqueueTts(data.text || '', {
              lang: data.language || 'en',
              url: data.url
            });
          }
          break;
        case 'show.cue':
          if (data?.cue) handleShowCue(data.cue);
          break;
        case 'show.state':
          if (data?.show) renderShow(data.show);
          break;
        case 'quiz.state':
        case 'quiz.start':
        case 'quiz.reveal':
        case 'quiz.end':
          if (data?.quiz) renderQuiz(data.quiz);
          break;
        case 'quiz.correct':
          if (data?.quiz) renderQuiz(data.quiz);
          if (data?.name) {
            queueToast('✓', `Correct, ${data.name}!`, `${data.correctCount} ${data.correctCount === 1 ? 'answer' : 'answers'} so far`);
            particleEngine.spawnLikeBurst(540, 470, 18);
            audio.playSoftChime(0.9);
          }
          break;
        case 'temple.viewerCount':
          if (currentState) {
            currentState.tiktok = { ...(currentState.tiktok || {}), viewerCount: data?.viewerCount || 0 };
            renderStats(currentState);
          }
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      setConnectionWarning(true);
      reconnectTimer = setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
      setConnectionWarning(true);
    };
  }

  async function callRpc(method, rpcParams = {}) {
    audio.ensureContext();
    const payload = { jsonrpc: '2.0', id: rpcId++, method, params: rpcParams };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return null;
    }
    try {
      const res = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data?.result?.state) updateState(data.result.state);
      return data;
    } catch (err) {
      console.warn('[RPC]', err.message);
      return null;
    }
  }

  /* ---------------------------------------------------------------------
     Quick dock wiring
     --------------------------------------------------------------------- */
  function formValues() {
    return {
      user: document.getElementById('inputDevoteeName')?.value.trim() || 'Friend',
      wish: document.getElementById('inputDevoteeWish')?.value.trim() || ''
    };
  }

  document.getElementById('btnToggleTts')?.addEventListener('click', () => {
    const enabled = !(currentState?.settings?.ttsEnabled);
    callRpc('temple.updateSettings', { ttsEnabled: enabled });
    audio.ttsEnabled = enabled;
  });

  document.getElementById('btnToggleMusic')?.addEventListener('click', () => {
    const enabled = !(currentState?.settings?.music?.enabled);
    audio.ensureContext();
    if (enabled) audio.startMusic();
    else audio.stopMusic();
    callRpc('music.update', { enabled });
  });

  document.getElementById('btnToggleMusicPlay')?.addEventListener('click', () => {
    const paused = !(currentState?.settings?.music?.paused);
    audio.ensureContext();
    if (paused) audio.stopMusic({ fadeMs: 900 });
    else audio.startMusic();
    callRpc('music.update', { paused });
  });

  document.getElementById('btnNextMusic')?.addEventListener('click', () => {
    audio.ensureContext();
    const nextId = audio.advancePlaylist(1);
    if (nextId) callRpc('music.update', { track: nextId });
    renderMusicStatus();
  });

  document.getElementById('btnPrevMusic')?.addEventListener('click', () => {
    audio.ensureContext();
    const prevId = audio.advancePlaylist(-1);
    if (prevId) callRpc('music.update', { track: prevId });
    renderMusicStatus();
  });

  document.getElementById('btnShuffleMusic')?.addEventListener('click', () => {
    const shuffle = !(currentState?.settings?.music?.shuffle);
    callRpc('music.update', { shuffle });
  });

  document.getElementById('selectTtsLanguage')?.addEventListener('change', (event) => {
    audio.ttsLanguage = event.target.value;
    callRpc('temple.updateSettings', { ttsLanguage: event.target.value });
  });

  const musicSlider = document.getElementById('sliderMusicVol');
  const ttsSlider = document.getElementById('sliderTtsVol');

  musicSlider?.addEventListener('input', (event) => {
    const value = Number(event.target.value) / 100;
    document.getElementById('valMusicVol').textContent = `${event.target.value}%`;
    audio.ensureContext();
    audio.setMusicVolume(value);
  });
  musicSlider?.addEventListener('change', (event) => {
    callRpc('music.update', { volume: Number(event.target.value) / 100 });
  });

  ttsSlider?.addEventListener('input', (event) => {
    document.getElementById('valTtsVol').textContent = `${event.target.value}%`;
    audio.setTtsVolume(Number(event.target.value) / 100);
  });
  ttsSlider?.addEventListener('change', (event) => {
    callRpc('temple.updateSettings', { ttsVolume: Number(event.target.value) / 100 });
  });

  document.getElementById('btnConnectTikTok')?.addEventListener('click', () => {
    const username = document.getElementById('inputTikTokUser')?.value.trim();
    if (!username) {
      queueToast('✝', 'Enter your TikTok @username first.', 'Example: @yourchannel');
      return;
    }
    callRpc('live.connect', { username });
  });

  document.getElementById('btnDisconnectTikTok')?.addEventListener('click', () => callRpc('live.disconnect'));

  document.getElementById('btnToggleAutoSim')?.addEventListener('click', () => {
    const enabled = !(currentState?.settings?.autoSim);
    callRpc('live.setAutoSim', { enabled });
  });

  document.getElementById('btnToggleShow')?.addEventListener('click', () => {
    const enabled = !(currentShow?.enabled);
    callRpc('show.update', { enabled });
  });

  document.getElementById('btnNextShow')?.addEventListener('click', () => callRpc('show.next'));
  document.getElementById('btnShowVerse')?.addEventListener('click', () => callRpc('show.nextVerse'));
  document.getElementById('btnShowPrayer')?.addEventListener('click', () => callRpc('show.nextPrayer', {}));

  document.getElementById('btnToggleRotation')?.addEventListener('click', () => {
    const enabled = !(currentState?.settings?.background?.enabled);
    callRpc('stage.updateSettings', { enabled });
  });

  document.getElementById('selectBackgroundCategory')?.addEventListener('change', (event) => {
    callRpc('stage.updateSettings', { category: event.target.value });
  });

  document.getElementById('selectBackgroundManual')?.addEventListener('change', (event) => {
    if (!event.target.value) return;
    callRpc('stage.setBackground', { url: event.target.value });
  });

  document.getElementById('btnNextBackground')?.addEventListener('click', () => {
    callRpc('stage.nextBackground');
  });

  document.getElementById('sliderRotationInterval')?.addEventListener('input', (event) => {
    document.getElementById('valRotationInterval').textContent = `${event.target.value}s`;
    clearTimeout(rotationSaveTimer);
    rotationSaveTimer = setTimeout(() => {
      callRpc('stage.updateSettings', { intervalSeconds: Number(event.target.value) });
    }, 450);
  });

  document.getElementById('btnPausePrayers')?.addEventListener('click', () => {
    const paused = !(currentState?.settings?.prayer?.paused);
    callRpc('prayer.setPaused', { paused });
  });

  document.getElementById('btnRpcCandle')?.addEventListener('click', () => {
    const { user } = formValues();
    callRpc('temple.burnIncense', { user, count: 1 });
  });

  document.getElementById('btnRpcPrayer')?.addEventListener('click', () => {
    const { user, wish } = formValues();
    callRpc('prayer.add', { name: user, text: wish || 'Please pray for my family and for peace.', source: 'admin' });
  });

  document.getElementById('btnRpcVerse')?.addEventListener('click', () => {
    const { user } = formValues();
    callRpc('temple.drawFortune', { user });
  });

  document.getElementById('btnRpcAmen')?.addEventListener('click', () => {
    const { user } = formValues();
    callRpc('temple.comment', { comment: 'AMEN', user });
  });

  document.getElementById('btnRpcGift')?.addEventListener('click', () => {
    const { user } = formValues();
    callRpc('temple.offerGift', { user, coins: 25, giftName: 'Prayer candle' });
  });

  document.getElementById('btnRpcCelebration')?.addEventListener('click', () => {
    const { user } = formValues();
    callRpc('temple.grandCeremony', {
      user,
      coins: 250,
      giftName: 'A gift of encouragement'
    });
  });

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  showVerse(DEFAULT_VERSE, { flash: false });
  defaultPrayerTexts();
  renderEventFeed([]);
  renderStageActivity([]);
  loadBackgroundCatalog();
  loadMusicCatalog();
  // OBS browser sources can autoplay; regular browsers stay silent until a click.
  audio.ensureContext();
  connectWebSocket();
})();
