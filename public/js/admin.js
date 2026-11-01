/**
 * Christian Prayer Live — Ministry Dashboard controller.
 * Uses the existing JSON-RPC 2.0 endpoints; no separate admin API.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let currentState = null;
  let backgrounds = [];
  let categories = [];
  let musicTracks = [];
  let musicLibrary = [];
  let musicMeta = null;
  let previewTrackId = null;
  const previewVolumes = new Map();
  let currentShow = null;
  let currentQuiz = null;
  let messagesLoaded = false;
  let assetSignature = '';

  /* ---------------------------------------------------------------------
     RPC
     --------------------------------------------------------------------- */
  async function callRpc(method, params = {}) {
    const response = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'RPC error');
    return data.result;
  }

  function printOutput(value) {
    const output = $('rpcOutput');
    if (output) output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  function reportError(prefix, error) {
    console.warn(prefix, error);
    const banner = $('statusSub');
    if (banner) banner.textContent = `${prefix}: ${error.message}`;
  }

  /* ---------------------------------------------------------------------
     Formatting helpers
     --------------------------------------------------------------------- */
  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function activityText(event) {
    switch (event.kind) {
      case 'candle': return `lit ${event.count || 1} prayer candle${event.count === 1 ? '' : 's'}`;
      case 'amen': return 'said Amen';
      case 'follow': return 'joined the prayer community';
      case 'share': return 'shared faith, hope and love';
      case 'gift': return `sent ${event.giftName || 'a gift'}`;
      case 'verse': return `received ${event.verse?.reference || 'a Scripture card'}`;
      case 'command': return `sent ${event.command}`;
      case 'prayerRequest': return 'asked for prayer';
      default: return event.message || 'interacted';
    }
  }

  /* ---------------------------------------------------------------------
     State rendering
     --------------------------------------------------------------------- */
  function applyState(state) {
    if (!state) return;
    currentState = state;

    const banner = $('statusBanner');
    if (banner) {
      if (state.tiktok?.connected) {
        banner.textContent = `Prayer room is live on @${state.tiktok.username}`;
        banner.className = 'status-line ok';
      } else if (state.tiktok?.connecting) {
        banner.textContent = `Connecting to @${state.tiktok.username}…`;
        banner.className = 'status-line';
      } else {
        banner.textContent = 'Prayer room ready — TikTok Live not connected';
        banner.className = 'status-line';
      }
    }

    const tts = state.tts || {};
    const queueCount = (state.prayerRequests || []).filter(
      (req) => req.status !== 'hidden' && req.status !== 'removed'
    ).length;
    const sub = $('statusSub');
    if (sub) {
      sub.textContent = `Piper: ${tts.status || 'starting'} · ${(tts.voices || []).length} voices · `
        + `${state.backgrounds?.count || 0} backgrounds · `
        + `Rotation ${state.settings?.background?.enabled ? 'on' : 'off'} · `
        + `Queue ${queueCount} · ${new Date().toLocaleTimeString('en-US')}`;
    }

    renderOverview(state, queueCount);
    renderConnection(state);
    renderSettings(state);
    renderTts(state.tts, state.settings);
    renderMusic(state.settings?.music);
    renderShow(state.show);
    renderEngagement(state.settings, state.quiz);
    renderPrayerQueue(state.prayerRequests, state.settings?.prayer);
    renderChat(state.chatFeed);
    renderActivity(state.recentEvents);
    markActiveBackground(state.settings?.background?.current);
  }

  function renderOverview(state, queueCount) {
    const set = (id, value) => {
      const el = $(id);
      if (el) el.textContent = formatNumber(value);
    };
    set('ovPrayers', state.prayerCount);
    set('ovCandles', state.candlesLit);
    set('ovAmens', state.amenCount);
    set('ovFollowers', state.followCount);
    set('ovShares', state.shareCount);
    set('ovGifts', state.giftCount);
    set('ovViewers', state.tiktok?.viewerCount || 0);
    set('ovQueue', queueCount);
    const hint = $('overviewHint');
    if (hint) hint.textContent = `Updated ${new Date().toLocaleTimeString('en-US')}`;
  }

  function renderConnection(state) {
    const badge = $('connectionBadge');
    if (badge) {
      const connected = Boolean(state.tiktok?.connected);
      badge.textContent = connected ? 'Connected' : state.tiktok?.connecting ? 'Connecting' : 'Disconnected';
      badge.className = `badge ${connected ? 'ok' : ''}`;
    }
    const note = $('connectionNote');
    if (note) {
      if (state.tiktok?.connected) {
        note.textContent = `Connected to @${state.tiktok.username} · room ${state.tiktok.roomId || '—'} · ${formatNumber(state.tiktok.viewerCount || 0)} watching.`;
      } else if (state.tiktok?.lastError) {
        note.textContent = `Not connected: ${state.tiktok.lastError}`;
      } else {
        note.textContent = 'Enter the account that is currently live, then connect.';
      }
    }
    const input = $('ttUser');
    if (input && !input.value && state.tiktok?.username) input.value = `@${state.tiktok.username}`;
    const simToggle = $('autoSimToggle');
    if (simToggle) simToggle.checked = Boolean(state.settings?.autoSim);
  }

  function renderSettings(state) {
    const settings = state.settings || {};
    const bg = settings.background || {};
    const prayers = settings.prayer || {};

    const setChecked = (id, value) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.checked = Boolean(value);
    };
    setChecked('prayerAutoApprove', prayers.autoApprove);
    setChecked('prayerPaused', prayers.paused);
    setChecked('bgRotation', bg.enabled);
    setChecked('bgRandomize', bg.randomize);

    const ttsEnabled = $('ttsEnabled');
    if (ttsEnabled && document.activeElement !== ttsEnabled) ttsEnabled.checked = settings.ttsEnabled !== false;

    const language = $('ttsLanguage');
    if (language && document.activeElement !== language) language.value = settings.ttsLanguage || 'en';

    const interval = $('bgInterval');
    if (interval && document.activeElement !== interval) interval.value = String(bg.intervalSeconds || 60);
    const transition = $('bgTransition');
    if (transition && document.activeElement !== transition) transition.value = String(bg.transitionMs || 1600);

    const category = $('bgCategory');
    if (category && document.activeElement !== category && bg.category) category.value = bg.category;

    const volume = $('ttsVolume');
    if (volume && document.activeElement !== volume) volume.value = String(Math.round((settings.ttsVolume ?? 0.95) * 100));
    const volumeValue = $('ttsVolumeValue');
    if (volumeValue) volumeValue.textContent = `${Math.round((settings.ttsVolume ?? 0.95) * 100)}%`;

    const rate = $('ttsRate');
    if (rate && document.activeElement !== rate) rate.value = String(Math.round((settings.ttsRate ?? 1) * 100));
    const rateValue = $('ttsRateValue');
    if (rateValue) rateValue.textContent = `${Number(settings.ttsRate ?? 1).toFixed(2)}×`;
  }

  /* ---------------------------------------------------------------------
     Background music
     --------------------------------------------------------------------- */
  function formatDuration(seconds) {
    if (!Number(seconds)) return 'Unknown';
    const value = Math.round(Number(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  function formatLongDuration(seconds) {
    const value = Math.round(Number(seconds) || 0);
    if (value <= 0) return '0m';
    const hours = Math.floor(value / 3600);
    const minutes = Math.round((value % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function formatBytes(bytes) {
    if (!bytes) return 'Unknown size';
    return `${(Number(bytes) / 1048576).toFixed(1)} MB`;
  }

  function setMusicRescanStatus(text, tone = '') {
    const el = $('musicRescanStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function renderMusicSummary() {
    const el = $('musicLibrarySummary');
    if (!el) return;
    const total = musicMeta?.total ?? musicLibrary.length;
    const enabled = musicMeta?.enabled ?? musicTracks.length;
    const seconds = musicMeta?.totalDurationSeconds ?? musicTracks.reduce((sum, t) => sum + (t.durationSeconds || 0), 0);
    el.textContent = `${formatNumber(total)} tracks · ${formatNumber(enabled)} enabled · ${formatLongDuration(seconds)} playlist`;
  }

  function musicRowStatus(track) {
    const settings = currentState?.settings?.music || {};
    const player = $('musicTestAudio');
    if (previewTrackId === track.id && player && !player.paused) return 'Previewing';
    if (!track.enabled) return 'Disabled';
    if (settings.track === track.id) return settings.paused ? 'Selected · paused' : 'Playing on stage';
    return 'Ready';
  }

  function renderMusicPlaylist(force = false) {
    const list = $('musicPlaylist');
    if (!list) return;
    const query = String($('musicSearch')?.value || '').trim().toLowerCase();
    const category = $('musicCategoryFilter')?.value || 'all';
    const settings = currentState?.settings?.music || {};
    const librarySignature = musicLibrary.map((t) => `${t.id}:${t.title}:${t.enabled}:${t.durationSeconds}:${t.category}`).join('|');
    const signature = `${librarySignature}|${query}|${category}|${settings.track}|${settings.paused}`;
    if (!force && list.dataset.signature === signature) return;
    if (!force && list.contains(document.activeElement) && document.activeElement?.matches('input, select')) return;
    list.dataset.signature = signature;
    list.innerHTML = '';

    const visible = musicLibrary.filter((track) => {
      if (category !== 'all' && track.category !== category) return false;
      if (!query) return true;
      return `${track.title} ${track.artist} ${track.category} ${track.file}`.toLowerCase().includes(query);
    });

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = musicLibrary.length === 0
        ? 'No audio files found. Add MP3, WAV, OGG, M4A or FLAC files to the audio folder, then rescan.'
        : 'No tracks match this search or category.';
      list.appendChild(empty);
      return;
    }

    visible.forEach((track) => {
      const row = document.createElement('div');
      row.className = 'music-track';
      row.dataset.id = track.id;
      if (settings.track === track.id) row.classList.add('is-current');
      if (!track.enabled) row.classList.add('is-disabled');

      const head = document.createElement('div');
      head.className = 'music-track-head';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'music-title-input';
      input.value = track.title;
      input.maxLength = 120;
      input.title = 'Edit the display title. The audio filename does not change.';
      input.setAttribute('aria-label', `Title for ${track.title}`);
      const status = document.createElement('span');
      status.className = 'music-track-status';
      status.textContent = musicRowStatus(track);
      head.appendChild(input);
      head.appendChild(status);

      const meta = document.createElement('small');
      meta.className = 'music-track-meta';
      meta.textContent = `${formatDuration(track.durationSeconds)} · ${track.format || 'Unknown format'} · ${formatBytes(track.bytes)} · ${track.category || 'Uncategorized'}`;
      meta.title = [track.artist, track.mood, track.license, track.sourceUrl].filter(Boolean).join('\n');

      const actions = document.createElement('div');
      actions.className = 'music-track-actions';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'btn mini';
      preview.dataset.action = 'preview';
      preview.textContent = previewTrackId === track.id && $('musicTestAudio') && !$('musicTestAudio').paused ? 'Pause' : 'Preview';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn mini';
      toggle.dataset.action = 'toggle';
      toggle.textContent = track.enabled ? 'Disable' : 'Enable';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn mini danger';
      remove.dataset.action = 'remove';
      remove.textContent = 'Remove';
      remove.title = 'Move this audio file to docs/backups/music-removed and drop it from the playlist.';
      const volume = document.createElement('input');
      volume.type = 'range';
      volume.className = 'music-track-volume';
      volume.min = '0';
      volume.max = '100';
      volume.value = String(previewVolumes.get(track.id) ?? 70);
      volume.title = 'Preview volume';
      volume.setAttribute('aria-label', `Preview volume for ${track.title}`);
      actions.append(preview, toggle, remove, volume);

      row.append(head, meta, actions);
      list.appendChild(row);
    });
  }

  function applyMusicPayload(result) {
    if (!result) return;
    if (result.settings) {
      currentState = currentState || {};
      currentState.settings = { ...(currentState.settings || {}), music: result.settings };
    }
    if (Array.isArray(result.tracks)) musicTracks = result.tracks;
    if (Array.isArray(result.library)) musicLibrary = result.library;
    if (result.meta) musicMeta = result.meta;
    if (previewTrackId && !musicLibrary.some((track) => track.id === previewTrackId)) {
      $('musicTestAudio')?.pause();
      previewTrackId = null;
    }
    renderMusic(result.settings || currentState?.settings?.music);
    renderMusicSummary();
    renderMusicPlaylist(true);
  }

  function fillMusicCategories() {
    const select = $('musicCategoryFilter');
    if (!select) return;
    const categories = musicMeta?.categories
      || Array.from(new Set(musicLibrary.map((track) => track.category).filter(Boolean))).sort();
    const signature = categories.join('|');
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    const current = select.value;
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All categories';
    select.appendChild(all);
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
    select.value = categories.includes(current) ? current : 'all';
  }

  function fillMusicSelect(selected) {
    const select = $('musicTrack');
    if (!select) return;
    const signature = musicTracks.map((track) => `${track.id}:${track.title}`).join('|');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.innerHTML = '';
      if (musicTracks.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No enabled tracks';
        select.appendChild(option);
      }
      musicTracks.forEach((track) => {
        const option = document.createElement('option');
        option.value = track.id;
        option.textContent = `${track.title} — ${track.mood || track.category}`;
        select.appendChild(option);
      });
    }
    if (selected && document.activeElement !== select && musicTracks.some((t) => t.id === selected)) {
      select.value = selected;
    }
  }

  function renderMusic(settings) {
    const music = settings || {};
    const enabled = music.enabled !== false;
    const paused = music.paused === true;

    const badge = $('musicBadge');
    if (badge) {
      badge.textContent = !enabled ? 'Off' : paused ? 'Paused' : 'Playing';
      badge.className = `badge ${enabled && !paused ? 'ok' : ''}`;
    }

    const setChecked = (id, value) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.checked = Boolean(value);
    };
    setChecked('musicEnabled', enabled);
    setChecked('musicAutoplay', music.autoplay !== false);
    setChecked('musicShuffle', Boolean(music.shuffle));

    const repeat = $('musicRepeat');
    if (repeat && document.activeElement !== repeat) repeat.value = music.repeat || 'all';

    fillMusicSelect(music.track);
    fillMusicCategories();
    renderMusicSummary();

    const volume = $('musicVolume');
    if (volume && document.activeElement !== volume) {
      volume.value = String(Math.round((music.volume ?? 0.1) * 100));
    }
    const volumeValue = $('musicVolumeValue');
    if (volumeValue) volumeValue.textContent = `${Math.round((music.volume ?? 0.1) * 100)}%`;

    const playPause = $('btnMusicPlayPause');
    if (playPause) playPause.textContent = paused ? 'Play' : 'Pause';

    const status = $('musicStatus');
    if (status) {
      if (!enabled) {
        status.textContent = 'Background music is disabled on the live stage.';
      } else if (paused) {
        status.textContent = 'Music is paused on the live stage.';
      } else {
        const track = musicTracks.find((item) => item.id === music.track);
        const name = track ? track.title : 'the selected track';
        status.textContent = `The live stage is playing ${name}. It ducks automatically while Piper narrates.`
          + (music.shuffle ? ' Shuffle is on.' : '');
      }
    }
    renderMusicPlaylist();
  }

  async function loadMusicCatalog() {
    try {
      const result = await callRpc('music.get');
      applyMusicPayload(result);
    } catch (error) {
      reportError('Music playlist failed', error);
    }
  }

  async function updateMusic(patch) {
    try {
      const result = await callRpc('music.update', patch);
      applyMusicPayload(result);
      return result;
    } catch (error) {
      reportError('Music update failed', error);
      setMusicRescanStatus(error.message, 'error');
      await loadMusicCatalog();
      return null;
    }
  }

  async function updateMusicTrack(id, patch, successText) {
    try {
      const result = await callRpc('music.track.update', { id, ...patch });
      applyMusicPayload(result);
      if (successText) setMusicRescanStatus(successText, 'ok');
      return result;
    } catch (error) {
      setMusicRescanStatus(error.message, 'error');
      await loadMusicCatalog();
      return null;
    }
  }

  function previewMusicTrack(track) {
    const player = $('musicTestAudio');
    if (!player || !track) return;
    if (previewTrackId === track.id && !player.paused) {
      player.pause();
      previewTrackId = null;
      renderMusicPlaylist(true);
      return;
    }
    previewTrackId = track.id;
    if (player.dataset.track !== track.url) {
      player.src = track.url;
      player.dataset.track = track.url;
    }
    player.volume = (previewVolumes.get(track.id) ?? 70) / 100;
    player.play().catch((error) => {
      setMusicRescanStatus(`Preview failed: ${error.message}`, 'error');
      previewTrackId = null;
      renderMusicPlaylist(true);
    });
    renderMusicPlaylist(true);
  }

  async function removeMusicTrack(track) {
    if (!track) return;
    const ok = window.confirm(`Remove “${track.title}” from the playlist?\n\nThe audio file is moved to docs/backups/music-removed — not deleted.`);
    if (!ok) return;
    try {
      const result = await callRpc('music.track.remove', { id: track.id });
      applyMusicPayload(result);
      const backup = result?.removed?.backupFile;
      setMusicRescanStatus(`Removed “${track.title}”.${backup ? ` Backup: ${backup}` : ''}`, 'ok');
    } catch (error) {
      setMusicRescanStatus(error.message, 'error');
      await loadMusicCatalog();
    }
  }

  /* ---------------------------------------------------------------------
     Automated live show
     --------------------------------------------------------------------- */
  function renderShowThemes(themes) {
    const select = $('showTheme');
    if (!select || !Array.isArray(themes) || themes.length === 0) return;
    const signature = themes.map((theme) => theme.id).join('|');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      const current = select.value;
      select.innerHTML = '';
      const auto = document.createElement('option');
      auto.value = 'auto';
      auto.textContent = 'Rotate all themes';
      select.appendChild(auto);
      themes.forEach((theme) => {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.label;
        select.appendChild(option);
      });
      select.value = current || 'auto';
    }
  }

  function showKindLabel(kind) {
    const labels = {
      welcome: 'Welcome',
      verse: 'Verse',
      reflection: 'Reflection',
      prayer: 'Prayer',
      community: 'Community',
      gratitude: 'Gratitude'
    };
    return labels[kind] || 'Cue';
  }

  function renderShowLog(history) {
    const log = $('showLog');
    if (!log) return;
    const list = Array.isArray(history) ? history : [];
    log.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No cues yet.';
      log.appendChild(empty);
      return;
    }
    list.slice(0, 12).forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'show-log-item';

      const time = document.createElement('span');
      time.className = 'show-log-time';
      time.textContent = new Date(entry.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      const kind = document.createElement('span');
      kind.className = 'show-log-kind';
      kind.textContent = showKindLabel(entry.kind);

      const title = document.createElement('span');
      title.className = 'show-log-title';
      title.textContent = `${entry.eyebrow || ''}${entry.eyebrow ? ' · ' : ''}${entry.title || ''}`;

      const source = document.createElement('span');
      const sourceLabel = entry.simulated ? 'test' : (entry.source || 'auto');
      source.className = `show-log-source ${sourceLabel}`;
      source.textContent = sourceLabel;

      row.append(time, kind, title, source);
      log.appendChild(row);
    });
  }

  function renderShow(show) {
    if (!show) return;
    currentShow = show;
    const paused = Boolean(show.paused);
    const enabled = show.enabled !== false;

    const badge = $('showBadge');
    if (badge) {
      badge.textContent = !enabled ? 'Off' : paused ? 'Paused' : 'Running';
      badge.className = `badge ${enabled && !paused ? 'ok' : ''}`;
    }

    const setChecked = (id, value) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.checked = Boolean(value);
    };
    setChecked('showEnabled', enabled);
    setChecked('showWelcome', show.welcomeEnabled);
    setChecked('showNarration', show.narration);

    renderShowThemes(show.themes);
    const theme = $('showTheme');
    if (theme && document.activeElement !== theme) theme.value = show.theme || 'auto';

    const pace = $('showPace');
    if (pace && document.activeElement !== pace) pace.value = String(show.pace || 1);

    const pauseBtn = $('btnShowPause');
    if (pauseBtn) pauseBtn.textContent = paused ? 'Resume Program' : 'Pause Program';

    const latest = Array.isArray(show.history) && show.history.length > 0 ? show.history[0] : null;

    const nowLine = $('showNowLine');
    if (nowLine) {
      const label = latest
        ? (latest.eyebrow || showKindLabel(latest.kind))
        : (show.current ? show.current.eyebrow || show.current.label : '');
      nowLine.textContent = label ? `NOW · ${String(label).toUpperCase()}` : 'PROGRAM READY';
    }

    const nextLine = $('showNextLine');
    if (nextLine) {
      if (!enabled) nextLine.textContent = 'Automation off';
      else if (paused) nextLine.textContent = 'Paused';
      else {
        const segment = show.current ? `Segment ${show.current.index}/${show.total} · ` : '';
        const nextLabel = show.next?.label || '—';
        const minutes = show.remainingSeconds != null
          ? Math.max(1, Math.round(show.remainingSeconds / 60))
          : null;
        nextLine.textContent = `${segment}next: ${nextLabel}${minutes ? ` in ~${minutes}m` : ''}`;
      }
    }
    const title = $('showNowTitle');
    if (title) {
      title.textContent = latest?.title
        || (show.current ? show.current.label : 'Waiting for the first cue…');
    }
    const body = $('showNowBody');
    if (body) {
      body.textContent = latest?.body
        || (show.current ? 'This segment is running on the live stage.' : 'The first cue appears as soon as the program starts.');
    }

    renderShowLog(show.history);
  }

  function renderEngagement(settings, quiz) {
    if (!settings) return;
    const setChecked = (id, value) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.checked = Boolean(value);
    };

    setChecked('prayerInteraction', settings.prayer?.interactionEnabled !== false);
    setChecked('giftAnnounce', settings.gifts?.announce !== false);
    setChecked('giftTts', settings.gifts?.tts !== false);
    setChecked('sceneMatch', settings.background?.sceneMatch !== false);

    if (!quiz) return;
    currentQuiz = quiz;
    const enabled = quiz.enabled !== false;
    const active = quiz.active;

    setChecked('quizEnabled', enabled);
    setChecked('quizNarration', quiz.tts !== false);
    const frequency = $('quizFrequency');
    if (frequency && document.activeElement !== frequency) frequency.value = String(quiz.frequencyMinutes || 10);
    const reveal = $('quizRevealDelay');
    if (reveal && document.activeElement !== reveal) reveal.value = String(quiz.revealSeconds || 25);

    const badge = $('quizBadge');
    if (badge) {
      badge.textContent = !enabled
        ? 'Off'
        : active
          ? (active.revealed ? 'Answer shown' : 'Question open')
          : 'Waiting';
      badge.className = `badge ${enabled && active ? 'ok' : ''}`;
    }

    const nowLine = $('quizNowLine');
    if (nowLine) {
      nowLine.textContent = !enabled
        ? 'BIBLE QUIZ · OFF'
        : active
          ? (active.revealed ? 'ANSWER REVEALED' : 'QUESTION OPEN')
          : 'BIBLE QUIZ · WAITING';
    }

    const nextLine = $('quizNextLine');
    if (nextLine) {
      nextLine.textContent = `${quiz.totalQuestions || 0} questions · ${quiz.asked || 0} asked · ${quiz.totalCorrect || 0} correct`;
    }

    const title = $('quizNowTitle');
    if (title) title.textContent = active?.question || 'No question open';

    const body = $('quizNowBody');
    if (body) {
      if (!active) {
        body.textContent = enabled
          ? 'The next question appears automatically between program segments.'
          : 'Enable the quiz to start asking questions.';
      } else if (active.revealed) {
        body.textContent = `${active.answer} · ${active.reference} — ${active.explanation}`;
      } else {
        body.textContent = `${active.correctCount || 0} correct so far · reveal in ${active.secondsLeft || 0}s · accepted case-insensitively from comments.`;
      }
    }
  }

  async function updateShow(patch) {
    try {
      const show = await callRpc('show.update', patch);
      renderShow(show);
      return show;
    } catch (error) {
      reportError('Show update failed', error);
      return null;
    }
  }

  async function triggerShow(method, params = {}) {
    try {
      const result = await callRpc(method, params);
      if (result?.show) renderShow(result.show);
      printOutput(result?.cue || result);
      return result;
    } catch (error) {
      reportError('Show cue failed', error);
      return null;
    }
  }

  function fillVoiceSelect(elementId, voices, selected) {
    const select = $(elementId);
    if (!select) return;
    const signature = `${selected}|${voices.map((voice) => `${voice.id}:${voice.label}`).join(',')}`;
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    select.innerHTML = '';
    voices.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.label;
      select.appendChild(option);
    });
    if (selected && voices.some((voice) => voice.id === selected)) select.value = selected;
  }

  function renderTts(tts, settings) {
    const status = tts || {};
    const badge = $('ttsBadge');
    if (badge) {
      badge.textContent = status.status === 'ready' ? 'Ready' : status.status === 'error' ? 'Error' : 'Starting';
      badge.className = `badge ${status.status === 'ready' ? 'ok' : status.status === 'error' ? 'error' : ''}`;
    }
    const statusText = $('ttsStatusText');
    if (statusText) {
      if (status.status === 'ready') {
        statusText.textContent = `Piper is ready · English and Vietnamese models are installed and selected.`
          + (status.loadSec ? ` Loaded in ${status.loadSec}s.` : '');
      } else if (status.status === 'error') {
        statusText.textContent = status.error
          || 'Piper could not start. Run: uv venv .venv && uv pip install --python .venv\\Scripts\\python.exe piper-tts';
      } else {
        statusText.textContent = 'Loading the local Piper worker… first start can take around 10 seconds.';
      }
    }

    const voices = Array.isArray(status.voices) ? status.voices : [];
    fillVoiceSelect('enVoice', voices.filter((voice) => voice.language === 'en'), settings?.enVoice || status.enVoice);
    fillVoiceSelect('vnVoice', voices.filter((voice) => voice.language === 'vi'), settings?.vnVoice || status.vnVoice);
  }

  function renderPrayerQueue(requests, settings) {
    const queue = $('prayerQueue');
    if (!queue) return;
    const list = Array.isArray(requests) ? requests : [];
    const note = $('prayerCountNote');
    if (note) {
      const visible = list.filter((req) => req.status !== 'hidden' && req.status !== 'removed').length;
      note.textContent = `${list.length} total · ${visible} active`
        + (settings?.paused ? ' · notifications paused' : '')
        + (settings?.autoApprove ? ' · auto-approve on' : ' · manual approval');
    }
    queue.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No prayer requests yet. Requests from the comments will appear here.';
      queue.appendChild(empty);
      return;
    }

    list.forEach((request) => {
      const row = document.createElement('div');
      row.className = `prayer-item ${request.status}`;

      const content = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'prayer-item-head';

      const name = document.createElement('span');
      name.className = 'prayer-name';
      name.textContent = request.name || 'Friend';

      const status = document.createElement('span');
      status.className = `prayer-status ${request.status}`;
      status.textContent = request.status;

      const time = document.createElement('span');
      time.className = 'prayer-time';
      time.textContent = relativeTime(request.createdAt) + (request.source ? ` · ${request.source}` : '');

      head.append(name, status, time);

      const text = document.createElement('div');
      text.className = 'prayer-text';
      text.textContent = request.text || 'General prayer request';

      content.append(head, text);

      const actions = document.createElement('div');
      actions.className = 'prayer-actions';

      const approve = document.createElement('button');
      approve.className = 'btn mini gold';
      approve.textContent = 'Approve';
      approve.addEventListener('click', async () => {
        try {
          printOutput(await callRpc('prayer.approve', { id: request.id }));
        } catch (error) {
          reportError('Approve failed', error);
        }
      });

      const hide = document.createElement('button');
      hide.className = 'btn mini';
      hide.textContent = 'Hide';
      hide.addEventListener('click', async () => {
        try {
          printOutput(await callRpc('prayer.hide', { id: request.id }));
        } catch (error) {
          reportError('Hide failed', error);
        }
      });

      const remove = document.createElement('button');
      remove.className = 'btn mini danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        try {
          printOutput(await callRpc('prayer.remove', { id: request.id }));
        } catch (error) {
          reportError('Remove failed', error);
        }
      });

      actions.append(approve, hide, remove);
      row.append(content, actions);
      queue.appendChild(row);
    });
  }

  function renderChat(feed) {
    const list = $('liveChatList');
    if (!list) return;
    const items = Array.isArray(feed) ? feed : [];
    const count = $('commentCount');
    if (count) count.textContent = String(items.length);
    list.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Comments will appear here.';
      list.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'chat-row';
      const name = document.createElement('strong');
      name.textContent = item.user || 'Friend';
      const text = document.createElement('span');
      text.textContent = item.text || '';
      row.append(name, text);
      list.appendChild(row);
    });
  }

  function renderActivity(events) {
    const list = $('activityList');
    if (!list) return;
    const items = Array.isArray(events) ? events : [];
    list.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No activity yet.';
      list.appendChild(empty);
      return;
    }
    items.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'activity-row';
      const name = document.createElement('strong');
      name.textContent = event.user || 'Friend';
      row.append(name, document.createTextNode(` ${activityText(event)}`));
      list.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------------
     Backgrounds
     --------------------------------------------------------------------- */
  function renderBackgroundCatalog() {
    const grid = $('backgroundGrid');
    if (!grid) return;
    const filter = $('bgCategory')?.value || 'all';
    const list = filter === 'all' ? backgrounds : backgrounds.filter((item) => item.category === filter);
    grid.innerHTML = '';

    list.forEach((item) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bg-card';
      card.dataset.url = item.url;
      card.title = `${item.title}\n${item.license}\n${item.attribution || ''}`;

      const image = document.createElement('img');
      image.loading = 'lazy';
      image.src = item.url;
      image.alt = item.title || item.category;

      const copy = document.createElement('div');
      copy.className = 'bg-card-copy';
      const title = document.createElement('span');
      title.className = 'bg-card-title';
      title.textContent = item.title || item.path;
      const meta = document.createElement('span');
      meta.className = 'bg-card-meta';
      meta.textContent = `${item.category} · ${item.license}`;
      copy.append(title, meta);

      card.append(image, copy);
      card.addEventListener('click', async () => {
        try {
          await callRpc('stage.setBackground', { url: item.url });
          markActiveBackground(item.url);
        } catch (error) {
          reportError('Background change failed', error);
        }
      });
      grid.appendChild(card);
    });

    markActiveBackground(currentState?.settings?.background?.current);
  }

  function markActiveBackground(url) {
    if (!url) return;
    document.querySelectorAll('.bg-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.url === url);
    });
    const current = backgrounds.find((item) => item.url === url);
    const label = $('currentBackground');
    if (label) {
      label.textContent = current
        ? `Current: ${current.title} · ${current.category} · ${current.license}${current.attribution ? ` · ${current.attribution}` : ''}`
        : `Current: ${url}`;
    }
  }

  async function loadBackgroundCatalog() {
    try {
      const response = await fetch('/api/backgrounds');
      const data = await response.json();
      backgrounds = Array.isArray(data.backgrounds) ? data.backgrounds : [];
      categories = Array.isArray(data.categories) ? data.categories : [];

      const select = $('bgCategory');
      if (select) {
        const current = select.value || data.settings?.category || 'all';
        select.innerHTML = '';
        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = 'All images';
        select.appendChild(all);
        categories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category;
          option.textContent = category.charAt(0).toUpperCase() + category.slice(1);
          select.appendChild(option);
        });
        select.value = current;
      }

      const hint = $('backgroundHint');
      if (hint) hint.textContent = `${backgrounds.length} licensed local images · ${categories.length} categories`;
      renderBackgroundCatalog();
      if (data.settings?.current) markActiveBackground(data.settings.current);
    } catch (error) {
      reportError('Background catalog failed', error);
    }
  }

  /* ---------------------------------------------------------------------
     Message library
     --------------------------------------------------------------------- */
  async function loadMessages() {
    try {
      const response = await fetch('/api/messages');
      const data = await response.json();
      const editor = $('messagesEditor');
      if (editor) editor.value = JSON.stringify(data, null, 2);
      messagesLoaded = true;
      setMessageStatus('Loaded config/messages.en.json');
    } catch (error) {
      setMessageStatus(`Could not load messages: ${error.message}`, true);
    }
  }

  function setMessageStatus(text, isError = false) {
    const el = $('messagesStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `save-status ${isError ? 'error' : 'ok'}`;
  }

  /* ---------------------------------------------------------------------
     WebSocket updates
     --------------------------------------------------------------------- */
  let socket = null;
  let reconnectTimer = null;

  function connectSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onmessage = (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch (_) {
        return;
      }
      const { method, params } = payload;
      if (method === 'temple.state') applyState(params);
      else if (method === 'temple.event') {
        if (params?.state) applyState(params.state);
      } else if (method === 'prayer.request' || method === 'prayer.state') {
        if (params?.state) applyState(params.state);
      } else if (method === 'live.chat') {
        if (params?.chatFeed && currentState) {
          currentState.chatFeed = params.chatFeed;
          renderChat(params.chatFeed);
        }
      } else if (method === 'tts.status') {
        if (currentState) {
          currentState.tts = params;
          renderTts(params, currentState.settings);
        }
      } else if (method === 'stage.background') {
        markActiveBackground(params?.url);
      } else if (method === 'music.state') {
        if (currentState && params?.settings) {
          currentState.settings = { ...(currentState.settings || {}), music: params.settings };
        }
        renderMusic(params?.settings);
      } else if (method === 'music.library.updated') {
        applyMusicPayload(params);
      } else if (method === 'show.state') {
        renderShow(params?.show);
      } else if (method === 'quiz.state' || method === 'quiz.start' || method === 'quiz.reveal' || method === 'quiz.end') {
        if (params?.quiz) renderEngagement(currentState?.settings, params.quiz);
      } else if (method === 'show.cue') {
        const cue = params?.cue;
        if (cue) {
          printOutput(cue);
          window.setTimeout(async () => {
            try {
              renderShow(await callRpc('show.status'));
            } catch (_) {}
          }, 400);
        }
      }
    };

    socket.onclose = () => {
      reconnectTimer = setTimeout(connectSocket, 2500);
    };
    socket.onerror = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }

  /* ---------------------------------------------------------------------
     Controls
     --------------------------------------------------------------------- */
  async function updateSettings(patch) {
    try {
      const state = await callRpc('temple.updateSettings', patch);
      if (state) applyState(state);
      return state;
    } catch (error) {
      reportError('Settings update failed', error);
      return null;
    }
  }

  $('btnConnect')?.addEventListener('click', async () => {
    const username = $('ttUser')?.value.trim();
    if (!username) {
      reportError('Connection', new Error('Enter a TikTok @username or Live link first.'));
      return;
    }
    const note = $('connectionNote');
    if (note) note.textContent = 'Connecting…';
    try {
      printOutput(await callRpc('live.connect', { username }));
    } catch (error) {
      reportError('TikTok connection failed', error);
    }
  });

  $('btnDisconnect')?.addEventListener('click', async () => {
    try {
      printOutput(await callRpc('live.disconnect'));
    } catch (error) {
      reportError('Disconnect failed', error);
    }
  });

  $('autoSimToggle')?.addEventListener('change', async (event) => {
    try {
      await callRpc('live.setAutoSim', { enabled: event.target.checked });
    } catch (error) {
      reportError('Demo activity failed', error);
    }
  });

  $('ttsEnabled')?.addEventListener('change', (event) => updateSettings({ ttsEnabled: event.target.checked }));
  $('ttsLanguage')?.addEventListener('change', (event) => updateSettings({ ttsLanguage: event.target.value }));
  $('enVoice')?.addEventListener('change', (event) => updateSettings({ enVoice: event.target.value }));
  $('vnVoice')?.addEventListener('change', (event) => updateSettings({ vnVoice: event.target.value }));

  $('ttsVolume')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('ttsVolumeValue').textContent = `${value}%`;
  });
  $('ttsVolume')?.addEventListener('change', (event) => updateSettings({ ttsVolume: Number(event.target.value) / 100 }));

  $('ttsRate')?.addEventListener('input', (event) => {
    $('ttsRateValue').textContent = `${(Number(event.target.value) / 100).toFixed(2)}×`;
  });
  $('ttsRate')?.addEventListener('change', (event) => updateSettings({ ttsRate: Number(event.target.value) / 100 }));

  $('musicEnabled')?.addEventListener('change', (event) => updateMusic({ enabled: event.target.checked }));
  $('musicAutoplay')?.addEventListener('change', (event) => updateMusic({ autoplay: event.target.checked }));
  $('musicShuffle')?.addEventListener('change', (event) => updateMusic({ shuffle: event.target.checked }));
  $('musicRepeat')?.addEventListener('change', (event) => updateMusic({ repeat: event.target.value }));
  $('musicTrack')?.addEventListener('change', (event) => updateMusic({ track: event.target.value }));

  $('musicSearch')?.addEventListener('input', () => renderMusicPlaylist(true));
  $('musicCategoryFilter')?.addEventListener('change', () => renderMusicPlaylist(true));

  $('btnMusicRescan')?.addEventListener('click', async () => {
    const button = $('btnMusicRescan');
    const label = button?.textContent || '🔄 Rescan Music Folder';
    if (button) {
      button.disabled = true;
      button.textContent = 'Scanning…';
    }
    setMusicRescanStatus('Scanning the audio folder…', 'working');
    try {
      const result = await callRpc('music.rescan');
      applyMusicPayload(result);
      const scan = result?.scan || {};
      setMusicRescanStatus(
        `Music library synchronized! ${formatNumber(scan.found)} tracks found · `
        + `${formatNumber(scan.added)} new · ${formatNumber(scan.removed)} missing · `
        + `${formatNumber(scan.updated)} metadata update${scan.updated === 1 ? '' : 's'}.`,
        scan.errors?.length ? 'warn' : 'ok'
      );
      if (scan.errors?.length) {
        const extra = document.createElement('span');
        extra.className = 'music-rescan-note';
        extra.textContent = scan.errors.slice(0, 3).join(' ');
        $('musicRescanStatus')?.appendChild(extra);
      }
    } catch (error) {
      setMusicRescanStatus(`Scan failed: ${error.message}`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  });

  $('musicPlaylist')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.music-track');
    const track = musicLibrary.find((item) => item.id === row?.dataset.id);
    if (!track) return;
    if (button.dataset.action === 'preview') previewMusicTrack(track);
    else if (button.dataset.action === 'toggle') {
      const wasEnabled = track.enabled;
      updateMusicTrack(track.id, { enabled: !wasEnabled }, `${wasEnabled ? 'Disabled' : 'Enabled'} “${track.title}”.`).then(() => {
        if (wasEnabled && previewTrackId === track.id) {
          const player = $('musicTestAudio');
          if (player) player.pause();
          previewTrackId = null;
          renderMusicPlaylist(true);
        }
      });
    } else if (button.dataset.action === 'remove') removeMusicTrack(track);
  });

  function commitMusicTitle(input) {
    if (!input) return;
    const row = input.closest('.music-track');
    const track = musicLibrary.find((item) => item.id === row?.dataset.id);
    if (!track) return;
    const title = input.value.trim();
    if (!title) {
      input.value = track.title;
      setMusicRescanStatus('A track title cannot be empty.', 'error');
      return;
    }
    if (title === track.title || input.dataset.committing === title) return;
    input.dataset.committing = title;
    updateMusicTrack(track.id, { title }, `Saved title “${title}”.`).then((result) => {
      if (!result) input.value = track.title;
    });
  }

  $('musicPlaylist')?.addEventListener('change', (event) => {
    if (event.target.classList.contains('music-title-input')) commitMusicTitle(event.target);
  });

  $('musicPlaylist')?.addEventListener('focusout', (event) => {
    if (event.target.classList.contains('music-title-input')) {
      // Some browsers fire focusout without a change event for programmatic edits.
      commitMusicTitle(event.target);
    }
  });

  $('musicPlaylist')?.addEventListener('keydown', (event) => {
    if (event.target.classList.contains('music-title-input') && event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    }
  });

  $('musicTestAudio')?.addEventListener('ended', () => {
    previewTrackId = null;
    renderMusicPlaylist(true);
  });
  $('musicTestAudio')?.addEventListener('pause', () => {
    if (!previewTrackId) return;
    previewTrackId = null;
    renderMusicPlaylist(true);
  });

  $('musicPlaylist')?.addEventListener('input', (event) => {
    if (!event.target.classList.contains('music-track-volume')) return;
    const row = event.target.closest('.music-track');
    if (!row) return;
    previewVolumes.set(row.dataset.id, Number(event.target.value));
    const player = $('musicTestAudio');
    if (player) player.volume = Number(event.target.value) / 100;
  });
  $('musicVolume')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    $('musicVolumeValue').textContent = `${value}%`;
    const player = $('musicTestAudio');
    if (player) player.volume = value / 100;
  });
  $('musicVolume')?.addEventListener('change', (event) => updateMusic({ volume: Number(event.target.value) / 100 }));

  $('btnMusicPlayPause')?.addEventListener('click', () => {
    const paused = currentState?.settings?.music?.paused !== true;
    updateMusic({ paused });
  });

  async function skipMusic(method) {
    try {
      applyMusicPayload(await callRpc(method));
    } catch (error) {
      reportError('Music track change failed', error);
      setMusicRescanStatus(error.message, 'error');
    }
  }

  $('btnMusicPrev')?.addEventListener('click', () => skipMusic('music.previous'));
  $('btnMusicNext')?.addEventListener('click', () => skipMusic('music.next'));

  $('btnMusicTest')?.addEventListener('click', () => {
    const selected = $('musicTrack')?.value || currentState?.settings?.music?.track;
    const track = musicTracks.find((item) => item.id === selected) || musicTracks[0];
    if (!track) {
      setMusicRescanStatus('No music tracks are installed.', 'error');
      return;
    }
    previewMusicTrack(track);
  });

  async function playPreview(result) {
    const player = $('audioPreview');
    if (!player) return;
    if (!result?.ok || !result.url) {
      reportError('Narration test failed', new Error(result?.error || 'No audio was generated'));
      return;
    }
    player.src = result.url;
    try {
      await player.play();
    } catch (_) {}
    printOutput(result);
  }

  $('btnTestEn')?.addEventListener('click', async () => {
    try {
      playPreview(await callRpc('tts.test', { lang: 'en', broadcast: false }));
    } catch (error) {
      reportError('English voice test failed', error);
    }
  });

  $('btnTestVi')?.addEventListener('click', async () => {
    try {
      playPreview(await callRpc('tts.test', { lang: 'vi', broadcast: false }));
    } catch (error) {
      reportError('Vietnamese voice test failed', error);
    }
  });

  $('btnSpeakCustom')?.addEventListener('click', async () => {
    const text = $('ttsCustomText')?.value.trim();
    if (!text) return;
    try {
      playPreview(await callRpc('temple.speak', { text, lang: 'auto', broadcast: false }));
    } catch (error) {
      reportError('Narration failed', error);
    }
  });

  $('showEnabled')?.addEventListener('change', (event) => updateShow({ enabled: event.target.checked }));
  $('showWelcome')?.addEventListener('change', (event) => updateShow({ welcomeEnabled: event.target.checked }));
  $('showNarration')?.addEventListener('change', (event) => updateShow({ narration: event.target.checked }));
  $('showTheme')?.addEventListener('change', (event) => updateShow({ theme: event.target.value }));
  $('showPace')?.addEventListener('change', (event) => updateShow({ pace: Number(event.target.value) }));
  $('btnShowPause')?.addEventListener('click', () => updateShow({ paused: !currentShow?.paused }));
  $('btnShowNext')?.addEventListener('click', () => triggerShow('show.next'));
  $('btnShowVerse')?.addEventListener('click', () => triggerShow('show.nextVerse'));
  $('btnShowReflection')?.addEventListener('click', () => triggerShow('show.nextReflection'));
  $('btnShowPrayer')?.addEventListener('click', () => triggerShow('show.nextPrayer'));
  $('btnShowGratitude')?.addEventListener('click', () => triggerShow('show.nextPrayer', { theme: 'gratitude' }));
  $('btnShowRestart')?.addEventListener('click', async () => {
    if (!window.confirm('Restart the program from the welcome segment?')) return;
    await triggerShow('show.restart');
  });
  $('btnShowTestWelcome')?.addEventListener('click', () => triggerShow('show.testWelcome', { name: 'Test Viewer (demo)' }));

  async function updateQuiz(patch) {
    try {
      const quiz = await callRpc('quiz.update', patch);
      renderEngagement(currentState?.settings, quiz);
      return quiz;
    } catch (error) {
      reportError('Quiz update failed', error);
      return null;
    }
  }

  $('quizEnabled')?.addEventListener('change', (event) => updateQuiz({ enabled: event.target.checked }));
  $('quizNarration')?.addEventListener('change', (event) => updateQuiz({ tts: event.target.checked }));
  $('quizFrequency')?.addEventListener('change', (event) => updateQuiz({ frequencyMinutes: Number(event.target.value) }));
  $('quizRevealDelay')?.addEventListener('change', (event) => updateQuiz({ revealSeconds: Number(event.target.value) }));

  $('btnQuizNext')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('quiz.next', { source: 'admin' });
      printOutput(result?.active || result);
      renderEngagement(currentState?.settings, result?.quiz);
    } catch (error) {
      reportError('Next question failed', error);
    }
  });

  $('btnQuizReveal')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('quiz.reveal');
      printOutput(result?.active || result);
      renderEngagement(currentState?.settings, result?.quiz);
    } catch (error) {
      reportError('Reveal failed', error);
    }
  });

  $('prayerInteraction')?.addEventListener('change', async (event) => {
    try {
      const state = await callRpc('temple.updateSettings', { prayer: { interactionEnabled: event.target.checked } });
      if (state) applyState(state);
    } catch (error) {
      reportError('Prayer interaction failed', error);
    }
  });

  $('giftAnnounce')?.addEventListener('change', async (event) => {
    try {
      const gifts = await callRpc('gift.update', { announce: event.target.checked });
      if (currentState?.settings) currentState.settings.gifts = gifts;
      renderEngagement(currentState?.settings, currentQuiz);
    } catch (error) {
      reportError('Gift announcement failed', error);
    }
  });

  $('giftTts')?.addEventListener('change', async (event) => {
    try {
      const gifts = await callRpc('gift.update', { tts: event.target.checked });
      if (currentState?.settings) currentState.settings.gifts = gifts;
      renderEngagement(currentState?.settings, currentQuiz);
    } catch (error) {
      reportError('Gift narration failed', error);
    }
  });

  $('sceneMatch')?.addEventListener('change', async (event) => {
    try {
      const state = await callRpc('stage.updateSettings', { sceneMatch: event.target.checked });
      if (state) applyState(state);
    } catch (error) {
      reportError('Scene matching failed', error);
    }
  });

  $('btnNextScene')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('stage.nextBackground');
      printOutput(result);
      markActiveBackground(result?.image?.url);
    } catch (error) {
      reportError('Background change failed', error);
    }
  });

  $('bgRotation')?.addEventListener('change', (event) => callRpc('stage.updateSettings', { enabled: event.target.checked }).catch((error) => reportError('Rotation failed', error)));
  $('bgRandomize')?.addEventListener('change', (event) => callRpc('stage.updateSettings', { randomize: event.target.checked }).catch((error) => reportError('Randomize failed', error)));
  $('bgCategory')?.addEventListener('change', (event) => {
    callRpc('stage.updateSettings', { category: event.target.value })
      .then(renderBackgroundCatalog)
      .catch((error) => reportError('Category failed', error));
  });
  $('bgInterval')?.addEventListener('change', (event) => callRpc('stage.updateSettings', { intervalSeconds: Number(event.target.value) }).catch((error) => reportError('Interval failed', error)));
  $('bgTransition')?.addEventListener('change', (event) => callRpc('stage.updateSettings', { transitionMs: Number(event.target.value) }).catch((error) => reportError('Fade failed', error)));
  $('btnNextBackground')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('stage.nextBackground');
      printOutput(result);
      markActiveBackground(result?.image?.url);
    } catch (error) {
      reportError('Background change failed', error);
    }
  });

  $('prayerAutoApprove')?.addEventListener('change', (event) => callRpc('prayer.setAutoApprove', { enabled: event.target.checked }).catch((error) => reportError('Auto-approve failed', error)));
  $('prayerPaused')?.addEventListener('change', (event) => callRpc('prayer.setPaused', { paused: event.target.checked }).catch((error) => reportError('Pause failed', error)));

  $('btnAddPrayer')?.addEventListener('click', async () => {
    const name = $('manualPrayerName')?.value.trim();
    const text = $('manualPrayerText')?.value.trim();
    if (!name && !text) {
      reportError('Add prayer', new Error('Enter a name or prayer request first.'));
      return;
    }
    try {
      const result = await callRpc('prayer.add', { name, text, source: 'admin' });
      printOutput(result);
      if ($('manualPrayerName')) $('manualPrayerName').value = '';
      if ($('manualPrayerText')) $('manualPrayerText').value = '';
    } catch (error) {
      reportError('Add prayer failed', error);
    }
  });

  $('btnClearPrayers')?.addEventListener('click', async () => {
    if (!window.confirm('Clear the entire prayer request queue? This cannot be undone.')) return;
    try {
      printOutput(await callRpc('prayer.clear'));
    } catch (error) {
      reportError('Clear queue failed', error);
    }
  });

  $('btnSimComment')?.addEventListener('click', async () => {
    const comment = $('simComment')?.value.trim();
    if (!comment) return;
    try {
      printOutput(await callRpc('temple.comment', { comment, user: 'Test Viewer', source: 'admin' }));
    } catch (error) {
      reportError('Comment test failed', error);
    }
  });

  document.querySelectorAll('#commandChips .chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const comment = chip.dataset.command || chip.textContent;
      if ($('simComment')) $('simComment').value = comment;
      try {
        printOutput(await callRpc('temple.comment', { comment, user: 'Test Viewer', source: 'admin' }));
      } catch (error) {
        reportError('Comment test failed', error);
      }
    });
  });

  $('btnReloadMessages')?.addEventListener('click', loadMessages);

  $('btnSaveMessages')?.addEventListener('click', async () => {
    const editor = $('messagesEditor');
    if (!editor) return;
    let parsed;
    try {
      parsed = JSON.parse(editor.value);
    } catch (error) {
      setMessageStatus(`Invalid JSON: ${error.message}`, true);
      return;
    }
    try {
      const result = await callRpc('messages.save', { messages: parsed });
      setMessageStatus('Saved. Previous file backed up as messages.en.json.bak');
      printOutput({ saved: result.saved });
    } catch (error) {
      setMessageStatus(`Save failed: ${error.message}`, true);
    }
  });

  $('btnSendRpc')?.addEventListener('click', async () => {
    const method = $('rpcMethod')?.value.trim();
    let params = {};
    try {
      params = JSON.parse($('rpcParams')?.value || '{}');
    } catch (error) {
      printOutput({ error: `Invalid params JSON: ${error.message}` });
      return;
    }
    if (!method) return;
    try {
      const result = await callRpc(method, params);
      printOutput(result);
      if (result?.state) applyState(result.state);
    } catch (error) {
      printOutput({ error: error.message });
    }
  });

  document.querySelectorAll('.rpc-preset').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.dataset.method === 'temple.resetMerit'
        && !window.confirm('Reset all counters, community data and the prayer queue?')) return;
      if ($('rpcMethod')) $('rpcMethod').value = chip.dataset.method || '';
      if ($('rpcParams')) $('rpcParams').value = chip.dataset.params || '{}';
      $('btnSendRpc')?.click();
    });
  });

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  async function loadInitialState() {
    try {
      const response = await fetch('/api/state');
      applyState(await response.json());
    } catch (error) {
      reportError('State load failed', error);
    }
  }

  loadInitialState();
  loadBackgroundCatalog();
  loadMusicCatalog();
  if (!messagesLoaded) loadMessages();
  connectSocket();
})();
