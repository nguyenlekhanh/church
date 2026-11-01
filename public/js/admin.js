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
  let copyrightData = null;
  let copyrightSafety = null;
  let messagesLoaded = false;
  let assetSignature = '';
  let currentSchedule = null;
  let currentHealth = null;
  let scheduleCardSignature = '';
  let musicIntegrityReport = null;
  let musicIntegrityFilter = null;

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
    renderCongregation(state.congregation);
    renderPrayerQueue(state.prayerRequests, state.settings?.prayer);
    renderChat(state.chatFeed);
    renderActivity(state.recentEvents);
    markActiveBackground(state.settings?.background?.current);
    if (copyrightData) renderCopyright(copyrightData);
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

    const autoReconnect = $('tiktokAutoReconnect');
    if (autoReconnect && state.settings?.tiktok) {
      autoReconnect.checked = state.settings.tiktok.autoReconnect !== false;
    }
    const maxRetries = $('tiktokMaxRetries');
    if (maxRetries && state.settings?.tiktok && document.activeElement !== maxRetries) {
      maxRetries.value = state.settings.tiktok.maxRetries ?? 6;
    }
    const retrySeconds = $('tiktokRetrySeconds');
    if (retrySeconds && state.settings?.tiktok && document.activeElement !== retrySeconds) {
      retrySeconds.value = state.settings.tiktok.retrySeconds ?? 10;
    }

    const retryHint = $('tiktokRetryHint');
    if (retryHint) {
      retryHint.textContent = state.tiktok?.nextRetryAt
        ? `Retry ${new Date(state.tiktok.nextRetryAt).toLocaleTimeString('en-US')}`
        : `Attempts ${state.tiktok?.reconnectAttempts || 0}`;
    }
    const retryStatus = $('tiktokRetryStatus');
    if (retryStatus) {
      const lines = [];
      if (state.tiktok?.requiresAttention) lines.push('Needs attention: automatic retries are paused until you retry or reconnect.');
      if (state.tiktok?.lastDisconnectReason) lines.push(`Last disconnect: ${state.tiktok.lastDisconnectReason}`);
      if (state.tiktok?.lastConnectedAt) {
        lines.push(`Last successful connection: ${new Date(state.tiktok.lastConnectedAt).toLocaleTimeString('en-US')}`);
      }
      retryStatus.textContent = lines.length
        ? lines.join(' ')
        : 'Reconnects reuse the configured @username with exponential backoff. Stale events are never replayed.';
    }
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
    if (!musicTrackEligible(track)) return 'Copyright blocked';
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
      if (!musicTrackEligible(track)) row.classList.add('is-blocked');

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
      if (!musicTrackEligible(track)) {
        preview.disabled = true;
        preview.title = 'Blocked by Copyright Safe Mode. Manual review or safe-mode off is required.';
      }
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
    if (!musicTrackEligible(track)) {
      setMusicRescanStatus('Blocked by Copyright Safe Mode. Manual review or safe-mode off is required.', 'error');
      return;
    }
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

  function renderCongregation(payload) {
    if (!payload?.settings) return;
    const settings = payload.settings;
    const counts = payload.counts || {};
    const enabled = settings.enabled !== false;

    const badge = $('congregationBadge');
    if (badge) {
      const hasDemo = counts.demo > 0;
      badge.textContent = !enabled
        ? 'Hidden'
        : counts.real > 0
          ? `${counts.real} seated`
          : hasDemo
            ? `${counts.demo} demo`
            : 'Waiting';
      badge.className = `badge ${!enabled ? '' : counts.real > 0 ? 'ok' : hasDemo ? 'demo' : ''}`;
    }

    const setChecked = (id, value) => {
      const el = $(id);
      if (el && document.activeElement !== el) el.checked = Boolean(value);
    };
    setChecked('congEnabled', enabled);
    setChecked('congShowNames', settings.showNames !== false);

    const inactivity = $('congInactivity');
    if (inactivity && document.activeElement !== inactivity) inactivity.value = String(settings.inactivityMinutes || 20);
    const maxVisible = $('congMaxVisible');
    if (maxVisible && document.activeElement !== maxVisible) maxVisible.value = String(settings.maxVisible || 50);

    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = String(value);
    };
    setText('congReal', formatNumber(counts.real || 0));
    setText('congDemoCount', formatNumber(counts.demo || 0));
    setText('congSeated', `${counts.seated || 0} / ${counts.capacity || settings.maxVisible || 50}`);
    setText('congIdle', `${settings.inactivityMinutes || 20}m`);

    const note = $('congregationNote');
    if (note) {
      note.textContent = `Real seats release after ${settings.inactivityMinutes || 20} minutes without a join, comment, like, follow, share or approval. `
        + `TikTok sends no leave event, so no participant is ever shown as having left.`;
    }

    const roster = $('congregationRoster');
    if (!roster) return;
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    if (participants.length === 0) {
      roster.innerHTML = '<div class="empty">No participants yet.</div>';
      return;
    }

    roster.replaceChildren();
    for (const participant of participants) {
      const row = document.createElement('div');
      row.className = `cong-person${participant.source === 'demo' ? ' demo' : ''}`;

      const seat = document.createElement('span');
      seat.className = 'cong-seat';
      seat.textContent = String(Number(participant.seat) + 1).padStart(2, '0');

      const copy = document.createElement('div');
      copy.className = 'cong-person-copy';
      const name = document.createElement('strong');
      name.textContent = participant.name || 'Friend';
      const meta = document.createElement('small');
      meta.textContent = `Joined ${relativeTime(participant.joinedAt)} · last seen ${relativeTime(participant.lastSeen)}`
        + (participant.marks?.giftName ? ` · gift: ${participant.marks.giftName}` : '');
      copy.append(name, meta);

      const tag = document.createElement('span');
      tag.className = `badge ${participant.source === 'demo' ? 'demo' : 'ok'}`;
      tag.textContent = participant.source === 'demo' ? 'DEMO' : 'LIVE';

      const marks = document.createElement('span');
      marks.className = 'cong-marks';
      const now = Date.now();
      if (participant.marks?.prayerAt && now - participant.marks.prayerAt < 120000) marks.textContent += '✝';
      if (participant.marks?.amenAt && now - participant.marks.amenAt < 10000) marks.textContent += ' AMEN';
      if (participant.marks?.giftAt && now - participant.marks.giftAt < 15000) marks.textContent += ' ✦';

      row.append(seat, copy, marks, tag);
      roster.appendChild(row);
    }
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
  function backgroundAssetForUrl(url) {
    const marker = '/assets/christian/';
    const index = String(url || '').indexOf(marker);
    if (index < 0) return null;
    const file = `public/assets/christian/${url.slice(index + marker.length)}`;
    return (copyrightData?.assets || []).find((asset) => asset.kind === 'image' && asset.file === file) || null;
  }

  function backgroundSafety(item) {
    if (item?.copyright && typeof item.copyright.eligible === 'boolean') return item.copyright;
    const asset = backgroundAssetForUrl(item?.url);
    if (!asset) return { eligible: false, status: 'UNKNOWN', reason: 'No copyright manifest entry' };
    return {
      eligible: isBroadcastEligible(asset),
      status: asset.status,
      reason: isBroadcastEligible(asset) ? 'VERIFIED' : `Blocked: ${asset.status}`
    };
  }

  function renderBackgroundHint() {
    const hint = $('backgroundHint');
    if (!hint) return;
    const eligibleCount = backgrounds.filter((item) => backgroundSafety(item).eligible).length;
    hint.textContent = `${eligibleCount} eligible · ${backgrounds.length} total images · ${categories.length} categories · auto-rotation uses every eligible image in all categories`;
  }

  function renderBackgroundCatalog() {
    const grid = $('backgroundGrid');
    if (!grid) return;
    const filter = $('bgCategory')?.value || 'all';
    const list = filter === 'all' ? backgrounds : backgrounds.filter((item) => item.category === filter);
    grid.innerHTML = '';

    list.forEach((item) => {
      const safety = backgroundSafety(item);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `bg-card${safety.eligible ? '' : ' is-blocked'}`;
      card.dataset.url = item.url;
      card.title = `${item.title}\n${item.license}\n${item.attribution || ''}\n${safety.eligible ? 'Copyright Safe Mode: eligible' : `Copyright Safe Mode: blocked — ${safety.reason}`}`;

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
      meta.textContent = safety.eligible
        ? `${item.category} · ${item.license}`
        : `${item.category} · BLOCKED · ${safety.status}`;
      copy.append(title, meta);

      card.append(image, copy);
      card.addEventListener('click', async () => {
        if (safeModeEnabled() && !safety.eligible) {
          reportError('Background blocked', new Error(`${safety.reason}. Manual review is required.`));
          return;
        }
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

      renderBackgroundHint();
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
     Copyright & licensing inventory
     --------------------------------------------------------------------- */
  function copyrightStatusClass(status) {
    if (status === 'VERIFIED') return 'verified';
    if (status === 'REJECTED') return 'rejected';
    if (status === 'NEEDS_REVIEW') return 'review';
    return 'unknown';
  }

  function copyrightUsage(asset) {
    if (asset.kind === 'music') {
      if (asset.usage === 'archive') return 'Archived music';
      return asset.enabled === false ? 'Playlist · disabled' : 'Active playlist';
    }
    if (asset.usage === 'legacy') return 'Legacy public/assets';
    if (asset.usage === 'documentation') return 'Documentation capture';
    if (asset.usage === 'reference') return 'Reference only';
    return 'Active image';
  }

  function permissionAllowed(value) {
    const text = String(value || '').toLowerCase();
    return text.startsWith('allowed') && !text.includes('unverified') && !text.includes('not permitted');
  }

  function isBroadcastEligible(asset) {
    if (!asset || asset.status !== 'VERIFIED' || asset.usage !== 'broadcast') return false;
    return ['commercial', 'livestream', 'tiktok', 'obs'].every((field) => permissionAllowed(asset[field]));
  }

  function safeModeEnabled() {
    return currentState?.settings?.copyrightSafeMode !== false;
  }

  function musicTrackEligible(track) {
    if (!safeModeEnabled()) return true;
    if (track?.copyright && typeof track.copyright.eligible === 'boolean') return track.copyright.eligible;
    return true;
  }

  function renderCopyrightList() {
    const list = $('copyrightList');
    if (!list) return;
    const query = String($('copyrightSearch')?.value || '').trim().toLowerCase();
    const kind = $('copyrightKind')?.value || 'all';
    const status = $('copyrightStatus')?.value || 'all';
    const visibility = $('copyrightVisibility')?.value || 'all';
    const assets = Array.isArray(copyrightData?.assets) ? copyrightData.assets : [];
    const visible = assets.filter((asset) => {
      if (kind !== 'all' && asset.kind !== kind) return false;
      if (status !== 'all' && asset.status !== status) return false;
      if (visibility === 'broadcast' && asset.usage !== 'broadcast') return false;
      if (visibility === 'eligible' && !isBroadcastEligible(asset)) return false;
      if (visibility === 'blocked' && !(asset.usage === 'broadcast' && !isBroadcastEligible(asset))) return false;
      if (!query) return true;
      return `${asset.title} ${asset.file} ${asset.artist} ${asset.license} ${asset.source}`.toLowerCase().includes(query);
    });

    list.innerHTML = '';
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = assets.length === 0
        ? 'No audit data yet. Run the scan after the audit module is loaded.'
        : 'No assets match these filters.';
      list.appendChild(empty);
      return;
    }

    visible.forEach((asset) => {
      const item = document.createElement('article');
      item.className = 'copyright-item';

      const head = document.createElement('div');
      head.className = 'copyright-item-head';
      const title = document.createElement('strong');
      title.textContent = asset.title || asset.file;
      const file = document.createElement('span');
      file.className = 'copyright-file';
      file.textContent = asset.file;
      const badge = document.createElement('span');
      badge.className = `copyright-status ${copyrightStatusClass(asset.status)}`;
      badge.textContent = String(asset.status || 'UNKNOWN').replace('_', ' ');
      head.append(title, file, badge);
      if (asset.usage === 'broadcast') {
        const safeBadge = document.createElement('span');
        safeBadge.className = `copyright-status ${isBroadcastEligible(asset) ? 'eligible' : 'blocked'}`;
        safeBadge.textContent = isBroadcastEligible(asset) ? 'ELIGIBLE' : 'BLOCKED';
        head.appendChild(safeBadge);
      }

      const meta = document.createElement('div');
      meta.className = 'copyright-meta';
      const addMeta = (label, value) => {
        if (!value) return;
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = `${label}: `;
        span.append(b, document.createTextNode(String(value)));
        meta.appendChild(span);
      };
      addMeta('Type', copyrightUsage(asset));
      addMeta('License', asset.license || 'Unknown');
      addMeta('Author', asset.artist || 'Unknown');
      addMeta('Commercial', asset.commercial || 'Unverified');
      addMeta('TikTok', asset.tiktok || 'Unverified');
      addMeta('Attribution', asset.attributionRequired === true ? 'Required' : asset.attributionRequired === false ? 'Not required' : 'Unknown');
      if (asset.usage === 'broadcast') {
        addMeta('Safe mode', isBroadcastEligible(asset) ? 'Eligible' : 'Blocked');
        addMeta('Manual review', asset.status === 'VERIFIED' ? 'Cleared by audit' : 'Required');
      }
      if (asset.sourceUrl && /^https?:\/\//i.test(asset.sourceUrl)) {
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = 'Source: ';
        const link = document.createElement('a');
        link.href = asset.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open original';
        span.append(b, link);
        meta.appendChild(span);
      }

      const note = document.createElement('div');
      note.className = 'copyright-note';
      note.textContent = asset.statusReason || asset.notes || '';
      if (asset.notes && asset.statusReason && asset.notes !== asset.statusReason) {
        note.textContent += ` ${asset.notes}`;
      }

      item.append(head, meta, note);
      list.appendChild(item);
    });
  }

  function renderCopyright(data) {
    if (!data) return;
    copyrightData = data;
    const totals = data.totals || data.counts || {};
    const counts = {
      cpMusic: totals.music ?? 0,
      cpImages: totals.images ?? 0,
      cpVerified: totals.verified ?? 0,
      cpReview: totals.needsReview ?? 0,
      cpRejected: totals.rejected ?? 0,
      cpUnknown: totals.unknown ?? 0
    };
    Object.entries(counts).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.textContent = formatNumber(value);
    });

    const assets = Array.isArray(data.assets) ? data.assets : [];
    const activeBroadcast = assets.filter((asset) => asset.usage === 'broadcast');
    const eligible = activeBroadcast.filter(isBroadcastEligible);
    const blocked = activeBroadcast.filter((asset) => !isBroadcastEligible(asset));
    copyrightSafety = { eligible, blocked, safeMode: safeModeEnabled() };
    const safeCounts = {
      safeEligible: eligible.length,
      safeBlocked: blocked.length,
      safeSelectable: safeModeEnabled() ? eligible.length : activeBroadcast.length
    };
    Object.entries(safeCounts).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.textContent = formatNumber(value);
    });
    const safeToggle = $('copyrightSafeMode');
    if (safeToggle && document.activeElement !== safeToggle) safeToggle.checked = safeModeEnabled();
    const safeBadge = $('safeModeBadge');
    if (safeBadge) {
      safeBadge.textContent = safeModeEnabled() ? 'Protected' : 'Off';
      safeBadge.className = `badge ${safeModeEnabled() ? 'ok' : 'error'}`;
    }
    const safeNote = $('safeReviewNote');
    if (safeNote) {
      safeNote.textContent = blocked.length
        ? `${blocked.length} active assets are blocked; manual review is required before they can be eligible.`
        : 'All active broadcast assets are currently eligible.';
    }
    const badge = $('copyrightBadge');
    if (badge) {
      badge.textContent = totals.total ? `${formatNumber(totals.total)} assets` : 'No data';
      badge.className = `badge ${totals.needsReview ? '' : 'ok'}`;
    }
    const summary = $('copyrightSummary');
    if (summary) {
      const generated = data.generatedAt
        ? new Date(data.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'not scanned';
      summary.textContent = `${formatNumber(totals.total || 0)} assets · ${formatNumber(totals.verified || 0)} verified · ${formatNumber(totals.needsReview || 0)} need review · ${formatNumber(totals.unknown || 0)} unknown · ${generated}`;
    }
    renderCopyrightList();
    renderAttributionPreview();
  }

  function renderAttributionPreview() {
    const preview = $('attributionPreview');
    const button = $('btnAttributionPreview');
    if (!preview) return;
    const eligible = copyrightSafety?.eligible || [];
    const credits = eligible.filter((asset) => asset.attributionRequired);
    const lines = credits.length
      ? credits.map((asset) => `• ${asset.title} — ${asset.artist} — ${asset.license}${asset.sourceUrl ? ` — ${asset.sourceUrl}` : ''}`)
      : ['No attribution is required for the currently eligible assets.'];
    preview.textContent = lines.join('\n');
    if (button) button.textContent = preview.hidden ? 'Attribution preview' : 'Hide attribution';
  }

  function setCopyrightStatus(text, tone = '') {
    const el = $('copyrightScanStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  async function loadCopyrightAudit() {
    let lastError = null;
    for (const url of ['/copyright-audit.json', '/api/copyright']) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        const data = await response.json();
        if (!data || !Array.isArray(data.assets)) throw new Error(`${url} returned no asset list`);
        renderCopyright(data);
        renderBackgroundCatalog();
        renderBackgroundHint();
        setCopyrightStatus('Audit data loaded. Scan again after adding or replacing files.');
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    const badge = $('copyrightBadge');
    if (badge) {
      badge.textContent = 'Unavailable';
      badge.className = 'badge error';
    }
    setCopyrightStatus(`Could not load audit data: ${lastError?.message || 'unknown error'}`, 'error');
    return null;
  }

  /* ---------------------------------------------------------------------
     Christian image library
     --------------------------------------------------------------------- */
  let imageLibraryData = null;

  function setImageStatus(text, tone = '') {
    const el = $('imageScanStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function formatScanTime(iso) {
    if (!iso) return 'Never scanned';
    try {
      return `Last scan: ${new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    } catch (_) {
      return 'Last scan: unknown';
    }
  }

  function renderImageLibrary(data) {
    if (!data) return;
    imageLibraryData = data;
    const totals = data.totals || {};
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    setText('imgTotal', formatNumber(totals.images || 0));
    setText('imgAi', formatNumber(totals.aiGenerated || 0));
    setText('imgLicensed', formatNumber(totals.licensed || 0));
    setText('imgReview', formatNumber(totals.needsReview || 0));
    setText('imgCategoryCount', formatNumber(totals.categories || (data.categories || []).length));
    setText('imageLastScan', formatScanTime(data.scannedAt));

    const badge = $('imageLibraryBadge');
    if (badge) {
      badge.textContent = totals.images ? `${formatNumber(totals.images)} images` : 'No images';
      badge.className = `badge ${totals.needsReview ? '' : 'ok'}`;
    }

    const categoryWrap = $('imageCategoryCounts');
    if (categoryWrap) {
      categoryWrap.innerHTML = '';
      (data.categories || []).forEach((category) => {
        const cell = document.createElement('div');
        cell.className = 'image-category-cell';
        const label = document.createElement('span');
        label.className = 'image-category-label';
        label.textContent = category.label;
        const count = document.createElement('strong');
        count.textContent = formatNumber(category.count || 0);
        cell.append(label, count);
        if (category.aiGenerated) {
          const ai = document.createElement('span');
          ai.className = 'image-category-ai';
          ai.textContent = `${category.aiGenerated} AI`;
          cell.appendChild(ai);
        }
        categoryWrap.appendChild(cell);
      });
    }

    const grid = $('imageLibraryGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const images = (data.images || []).slice().sort((a, b) => String(a.file).localeCompare(String(b.file)));
    if (images.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No images found in the seven category folders yet.';
      grid.appendChild(empty);
      return;
    }

    images.forEach((image) => {
      const eligible = Boolean(image.eligible);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `bg-card image-card${eligible ? '' : ' is-blocked'}`;
      card.dataset.file = image.file;
      card.dataset.url = image.url || `/assets/christian/${image.file}`;
      card.title = `${image.title || image.file}\n${image.category} · ${image.status || 'UNKNOWN'}\n${image.license || 'Unknown'}${image.attribution ? ` · ${image.attribution}` : ''}${eligible ? '' : `\nBlocked: ${image.blockReason || 'not eligible'}`}`;

      const picture = document.createElement('img');
      picture.loading = 'lazy';
      picture.src = image.url || `/assets/christian/${image.file}`;
      picture.alt = image.title || image.file;

      const copy = document.createElement('div');
      copy.className = 'bg-card-copy';
      const title = document.createElement('span');
      title.className = 'bg-card-title';
      title.textContent = image.title || image.file;
      const meta = document.createElement('span');
      meta.className = 'bg-card-meta';
      const tag = image.aiGenerated ? 'AI · VERIFIED' : (image.status || 'UNKNOWN');
      meta.textContent = `${image.category} · ${tag}`;
      copy.append(title, meta);

      if (image.aiGenerated) {
        const flag = document.createElement('span');
        flag.className = 'image-card-ai';
        flag.textContent = 'AI';
        card.appendChild(flag);
      }

      card.append(picture, copy);
      card.addEventListener('click', async () => {
        if (safeModeEnabled() && !eligible) {
          reportError('Image blocked', new Error(`${image.blockReason || image.status}. Manual review is required.`));
          return;
        }
        try {
          await callRpc('stage.setBackground', { url: image.url });
          markActiveBackground(image.url);
        } catch (error) {
          reportError('Background change failed', error);
        }
      });
      grid.appendChild(card);
    });

    markActiveBackground(currentState?.settings?.background?.current);
  }

  async function loadImageLibrary() {
    try {
      const data = await callRpc('images.state');
      renderImageLibrary(data);
      return data;
    } catch (error) {
      const badge = $('imageLibraryBadge');
      if (badge) {
        badge.textContent = 'Unavailable';
        badge.className = 'badge error';
      }
      setImageStatus(
        `Image library unavailable: ${error.message}. Restart the server to load the images.* RPC methods.`,
        'error'
      );
      return null;
    }
  }

  $('btnImageScan')?.addEventListener('click', async () => {
    const button = $('btnImageScan');
    if (button) button.disabled = true;
    setImageStatus('Scanning the seven image categories…');
    try {
      const result = await callRpc('images.scan');
      renderImageLibrary(result);
      const totals = result?.totals || {};
      const added = result?.added || [];
      const removed = result?.removed || [];
      const renamed = result?.renamed || [];
      const updated = result?.updated || [];
      const errors = result?.errors || [];
      let message = `Scan complete — ${formatNumber(totals.images || 0)} images, ${formatNumber(totals.aiGenerated || 0)} AI-generated, ` +
        `${formatNumber(added.length)} added, ${formatNumber(removed.length)} removed, ${formatNumber(renamed.length)} renamed, ` +
        `${formatNumber(updated.length)} updated.`;
      if (added.length) message += ` New: ${added.slice(0, 6).join(', ')}${added.length > 6 ? '…' : ''}.`;
      if (removed.length) message += ` Removed: ${removed.slice(0, 6).join(', ')}${removed.length > 6 ? '…' : ''}.`;
      if (errors.length) message += ` ${errors.length} error(s): ${errors[0].file} — ${errors[0].error}.`;
      setImageStatus(message, errors.length ? 'error' : '');
      await loadBackgroundCatalog();
    } catch (error) {
      setImageStatus(
        `Scan failed: ${error.message}. The last written manifest is unchanged; restart the server to load the scan RPC.`,
        'error'
      );
    } finally {
      if (button) button.disabled = false;
    }
  });

  $('btnCopyrightScan')?.addEventListener('click', async () => {
    const button = $('btnCopyrightScan');
    if (button) button.disabled = true;
    setCopyrightStatus('Scanning local audio and image folders…');
    try {
      const result = await callRpc('copyright.scan');
      renderCopyright(result);
      const changes = result?.changes || {};
      const totals = result?.totals || {};
      setCopyrightStatus(
        `Scan complete — ${formatNumber(totals.total || 0)} assets: ${formatNumber(changes.added || 0)} added, ` +
        `${formatNumber(changes.removed || 0)} removed, ${formatNumber(changes.changed || 0)} changed. Reports refreshed.`
      );
    } catch (error) {
      setCopyrightStatus(
        `Scanner unavailable: ${error.message}. The audit data above is the last written report; restart the server to load the new RPC method.`,
        'error'
      );
    } finally {
      if (button) button.disabled = false;
    }
  });

  ['copyrightKind', 'copyrightStatus', 'copyrightVisibility'].forEach((id) => {
    $(id)?.addEventListener('change', renderCopyrightList);
  });
  $('copyrightSearch')?.addEventListener('input', renderCopyrightList);

  $('copyrightSafeMode')?.addEventListener('change', async (event) => {
    const enabled = Boolean(event.target.checked);
    try {
      const result = await callRpc('copyright.setSafeMode', { enabled });
      if (currentState) {
        currentState.settings = { ...(currentState.settings || {}), copyrightSafeMode: enabled };
      }
      if (result?.counts) {
        copyrightSafety = { ...(copyrightSafety || {}), safeMode: enabled };
      }
      renderCopyright(copyrightData);
      setCopyrightStatus(`Copyright Safe Mode ${enabled ? 'enabled' : 'disabled'} by administrator.`);
    } catch (error) {
      event.target.checked = !enabled;
      setCopyrightStatus(
        `Could not change Copyright Safe Mode: ${error.message}. Restart the server to load the new control.`,
        'error'
      );
    }
  });

  $('btnAttributionPreview')?.addEventListener('click', () => {
    const preview = $('attributionPreview');
    if (!preview) return;
    preview.hidden = !preview.hidden;
    renderAttributionPreview();
  });

  /* ---------------------------------------------------------------------
     WebSocket updates
     --------------------------------------------------------------------- */
  let socket = null;
  let reconnectTimer = null;

  /* ---------------------------------------------------------------------
     Smart daily schedule
     --------------------------------------------------------------------- */
  function formatClock12(timeText) {
    const match = String(timeText || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return timeText || '—';
    const hour = Number(match[1]);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${((hour + 11) % 12) + 1}:${match[2]} ${suffix}`;
  }

  function formatRemaining(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return '—';
    const total = Math.max(0, Math.round(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${total % 60}s`;
    return `${total}s`;
  }

  function scheduleBadgeText(schedule) {
    if (!schedule?.enabled) return 'DISABLED';
    if (schedule.override) return `MANUAL · ${String(schedule.current?.label || '').toUpperCase()}`;
    return `AUTOMATIC · ${String(schedule.current?.label || '').toUpperCase()}`;
  }

  function renderScheduleProgramCards(schedule) {
    const container = $('schedulePrograms');
    if (!container || !Array.isArray(schedule.programs)) return;
    const signature = schedule.programs
      .map((program) => `${program.id}:${program.start}:${program.end}:${program.quizFrequencyMinutes}:${program.narrationPace}:${program.label}`)
      .join('|');
    if (signature === scheduleCardSignature) {
      container.querySelectorAll('.schedule-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.program === schedule.current?.id);
        card.classList.toggle('scheduled', Boolean(schedule.programs.find((program) => program.id === card.dataset.program)?.scheduledNow));
      });
      return;
    }
    scheduleCardSignature = signature;
    container.innerHTML = '';
    schedule.programs.forEach((program) => {
      const card = document.createElement('div');
      card.className = 'schedule-card';
      card.dataset.program = program.id;
      card.classList.toggle('active', program.id === schedule.current?.id);
      card.classList.toggle('scheduled', Boolean(program.scheduledNow));

      const head = document.createElement('div');
      head.className = 'schedule-card-head';
      const title = document.createElement('strong');
      title.textContent = program.label;
      const time = document.createElement('span');
      time.className = 'schedule-card-time';
      time.textContent = `${formatClock12(program.start)} – ${formatClock12(program.end)}${program.wrapsMidnight ? ' (+1 day)' : ''}`;
      head.append(title, time);

      const note = document.createElement('p');
      note.className = 'note small';
      note.textContent = program.atmosphere || '';

      const fields = document.createElement('div');
      fields.className = 'schedule-card-fields';

      const startField = document.createElement('label');
      startField.className = 'field compact';
      startField.innerHTML = '<span>Starts</span>';
      const startInput = document.createElement('input');
      startInput.type = 'time';
      startInput.value = program.start;
      startInput.dataset.field = 'start';
      startField.append(startInput);

      const endField = document.createElement('label');
      endField.className = 'field compact';
      endField.innerHTML = '<span>Ends</span>';
      const endInput = document.createElement('input');
      endInput.type = 'time';
      endInput.value = program.end;
      endInput.dataset.field = 'end';
      endField.append(endInput);

      const quizField = document.createElement('label');
      quizField.className = 'field compact';
      quizField.innerHTML = '<span>Quiz every (min)</span>';
      const quizInput = document.createElement('input');
      quizInput.type = 'number';
      quizInput.min = '2';
      quizInput.max = '120';
      quizInput.step = '1';
      quizInput.value = program.quizFrequencyMinutes;
      quizInput.dataset.field = 'quizFrequencyMinutes';
      quizField.append(quizInput);

      const paceField = document.createElement('label');
      paceField.className = 'field compact';
      paceField.innerHTML = '<span>Narration pace</span>';
      const paceSelect = document.createElement('select');
      paceSelect.dataset.field = 'narrationPace';
      [[0.9, 'Gentle'], [0.95, 'Calm'], [1, 'Standard'], [1.1, 'Frequent']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = label;
        paceSelect.append(option);
      });
      paceSelect.value = String(program.narrationPace);
      paceField.append(paceSelect);

      fields.append(startField, endField, quizField, paceField);

      const tags = document.createElement('p');
      tags.className = 'note small schedule-tags';
      tags.textContent = `Prayer themes: ${(program.prayerThemes || []).join(', ') || 'all'} · Scripture: ${(program.verseTags || []).join(', ') || 'all'} · Music: ${(program.musicCategories || []).join(', ') || 'any'} · Scenes: ${(program.backgroundCategories || []).join(', ') || 'all'}`;

      const actions = document.createElement('div');
      actions.className = 'button-row';
      const preview = document.createElement('button');
      preview.className = 'btn';
      preview.dataset.action = 'preview';
      preview.textContent = 'Preview';
      const run = document.createElement('button');
      run.className = 'btn gold';
      run.dataset.action = 'run';
      run.textContent = 'Run with override';
      actions.append(preview, run);

      card.append(head, note, fields, tags, actions);
      container.append(card);
    });
  }

  function renderSchedule(schedule) {
    if (!schedule) return;
    currentSchedule = schedule;
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    const badge = $('scheduleBadge');
    if (badge) {
      badge.textContent = scheduleBadgeText(schedule);
      badge.dataset.tone = schedule.override ? 'warn' : schedule.enabled ? 'ok' : 'idle';
    }
    setText('scheduleLocalTime', schedule.local?.clock12 || '—');
    setText('scheduleZone', `${schedule.timezone || ''} · ${schedule.local?.dateLabel || ''}`);
    setText('scheduleProgram', schedule.current?.label || 'No active program');
    setText('scheduleNextLine', schedule.next
      ? `Next: ${schedule.next.label} at ${formatClock12(schedule.next.start)}`
      : 'Next program: —');
    setText('scheduleOverrideLine', schedule.override
      ? `Manual override · ${formatRemaining(schedule.override.remainingSeconds)} remaining`
      : (schedule.enabled ? 'Following the automatic schedule' : 'Automatic switching is disabled'));
    setText('scheduleRemaining', schedule.remainingSeconds !== null && schedule.remainingSeconds !== undefined
      ? `${formatRemaining(schedule.remainingSeconds)} until the next program`
      : '—');
    const bar = $('scheduleProgressBar');
    if (bar) {
      const progress = Number(schedule.current?.dayProgress);
      bar.style.width = `${Number.isFinite(progress) ? Math.round(progress * 100) : 0}%`;
    }

    const enabled = $('scheduleEnabled');
    if (enabled) enabled.checked = Boolean(schedule.enabled);
    const tz = $('scheduleTimezone');
    if (tz) {
      if (tz.options.length === 0 && Array.isArray(schedule.timezoneOptions)) {
        schedule.timezoneOptions.forEach((zone) => {
          const option = document.createElement('option');
          option.value = zone.id;
          option.textContent = zone.label;
          tz.append(option);
        });
      }
      if (document.activeElement !== tz) tz.value = schedule.timezone;
    }

    const buttons = $('scheduleProgramButtons');
    if (buttons && Array.isArray(schedule.programs)) {
      const signature = schedule.programs.map((program) => `${program.id}:${program.label}`).join('|');
      if (buttons.dataset.signature !== signature) {
        buttons.dataset.signature = signature;
        buttons.innerHTML = '';
        schedule.programs.forEach((program) => {
          const button = document.createElement('button');
          button.className = 'btn';
          button.dataset.program = program.id;
          button.textContent = program.label;
          buttons.append(button);
        });
      }
      buttons.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('gold', button.dataset.program === schedule.current?.id);
      });
    }

    renderScheduleProgramCards(schedule);
  }

  function setScheduleStatus(text, tone = '') {
    const el = $('scheduleStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  async function loadSchedule() {
    try {
      renderSchedule(await callRpc('schedule.get'));
    } catch (error) {
      reportError('Schedule load failed', error);
    }
  }

  async function updateScheduleProgram(id, patch, successText) {
    try {
      const result = await callRpc('schedule.program.update', { id, ...patch });
      scheduleCardSignature = '';
      renderSchedule(result);
      if (successText) setScheduleStatus(successText, 'ok');
    } catch (error) {
      setScheduleStatus(error.message, 'error');
      scheduleCardSignature = '';
      await loadSchedule();
    }
  }

  /* ---------------------------------------------------------------------
     System health, incidents and music integrity
     --------------------------------------------------------------------- */
  function healthTone(status) {
    if (['online', 'ready', 'connected', 'healthy', 'playing', 'normal'].includes(status)) return 'ok';
    if (['warning', 'warn', 'restarting', 'reconnecting', 'attention', 'missing', 'idle', 'waiting'].includes(status)) return 'warn';
    if (['error', 'critical', 'disconnected', 'silent', 'failed'].includes(status)) return 'bad';
    return 'idle';
  }

  function renderHealthStatuses(statuses) {
    const grid = $('healthStatusGrid');
    if (!grid || !statuses) return;
    const labels = {
      server: 'Bun Server',
      tiktok: 'TikTok Connector',
      piper: 'Piper TTS',
      music: 'Background Music',
      musicFiles: 'Music Files',
      cpu: 'CPU',
      ram: 'RAM',
      obsStage: 'OBS Stage',
      websocket: 'WebSocket'
    };
    grid.innerHTML = '';
    Object.entries(labels).forEach(([key, label]) => {
      const status = statuses[key] || { status: 'unknown', label: 'UNKNOWN' };
      const tile = document.createElement('div');
      tile.className = `health-status health-${healthTone(status.status)}`;
      const dot = document.createElement('span');
      dot.className = 'health-dot';
      const name = document.createElement('span');
      name.className = 'health-status-label';
      name.textContent = label;
      const value = document.createElement('strong');
      value.textContent = status.label || String(status.status || '').toUpperCase();
      tile.append(dot, name, value);
      grid.append(tile);
    });
  }

  function renderHealthIncidents(incidents) {
    const list = $('healthIncidents');
    const count = $('healthIncidentCount');
    if (count) count.textContent = `${incidents?.length || 0} ${incidents?.length === 1 ? 'incident' : 'incidents'}`;
    if (!list) return;
    list.innerHTML = '';
    if (!Array.isArray(incidents) || incidents.length === 0) {
      list.innerHTML = '<div class="empty">No incidents recorded.</div>';
      return;
    }
    incidents.slice(0, 40).forEach((incident) => {
      const row = document.createElement('div');
      row.className = `incident incident-${incident.severity}${incident.resolved ? ' resolved' : ''}`;
      const head = document.createElement('div');
      head.className = 'incident-head';
      const component = document.createElement('strong');
      component.textContent = incident.component;
      const severity = document.createElement('span');
      severity.className = 'incident-severity';
      severity.textContent = incident.severity.toUpperCase();
      const time = document.createElement('span');
      time.className = 'incident-time';
      time.textContent = new Date(incident.at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      head.append(component, severity, time);
      const message = document.createElement('p');
      message.className = 'incident-message';
      message.textContent = incident.message;
      const meta = document.createElement('p');
      meta.className = 'note small';
      meta.textContent = [incident.action, incident.result].filter(Boolean).join(' → ');
      row.append(head, message, meta);
      if (incident.resolved) {
        const resolved = document.createElement('span');
        resolved.className = 'incident-resolved';
        resolved.textContent = 'RESOLVED';
        row.append(resolved);
      }
      list.append(row);
    });
  }

  function renderMusicIntegrity(rawReport) {
    if (!rawReport) return;
    const report = {
      ...rawReport,
      missing: Array.isArray(rawReport.missing) ? rawReport.missing : [],
      orphans: Array.isArray(rawReport.orphans) ? rawReport.orphans : [],
      unreadable: Array.isArray(rawReport.unreadable) ? rawReport.unreadable : [],
      invalidFormat: Array.isArray(rawReport.invalidFormat) ? rawReport.invalidFormat : [],
      pathViolations: Array.isArray(rawReport.pathViolations) ? rawReport.pathViolations : [],
      errors: Array.isArray(rawReport.errors) ? rawReport.errors : [],
      missingCount: Number(rawReport.missingCount || 0),
      presentCount: Number(rawReport.presentCount || 0),
      entries: Number(rawReport.entries || 0),
      totalFilesOnDisk: Number(rawReport.totalFilesOnDisk || 0),
      summary: rawReport.summary || 'Music library scanned'
    };
    musicIntegrityReport = report;
    const box = $('musicIntegrity');
    if (!box) return;
    const heading = document.createElement('div');
    heading.className = 'integrity-head';
    const title = document.createElement('strong');
    title.textContent = report.healthy ? 'Music library healthy' : 'Music library needs attention';
    const summary = document.createElement('span');
    summary.className = 'panel-hint';
    summary.textContent = `${report.summary} · checked ${new Date(report.checkedAt).toLocaleTimeString('en-US')}`;
    heading.append(title, summary);

    const counts = document.createElement('div');
    counts.className = 'integrity-counts';
    [
      ['Files on disk', report.totalFilesOnDisk],
      ['Manifest entries', report.entries],
      ['Present', report.presentCount],
      ['Missing', report.missingCount],
      ['Unreadable', report.unreadable.length],
      ['Invalid format', report.invalidFormat.length],
      ['Unused files', report.orphans.length]
    ].forEach(([label, value]) => {
      const item = document.createElement('span');
      item.innerHTML = `<strong>${value}</strong> ${label}`;
      counts.append(item);
    });

    box.innerHTML = '';
    box.append(heading, counts);

    const filterLabel = musicIntegrityFilter === 'missing'
      ? 'Missing files'
      : musicIntegrityFilter === 'unused' ? 'Unused files' : null;
    if (filterLabel) {
      const listTitle = document.createElement('p');
      listTitle.className = 'note small';
      listTitle.textContent = `${filterLabel} (${musicIntegrityFilter === 'missing' ? report.missing.length : report.orphans.length})`;
      box.append(listTitle);
      const list = document.createElement('div');
      list.className = 'integrity-list';
      const items = musicIntegrityFilter === 'missing' ? report.missing : report.orphans;
      if (!items.length) list.innerHTML = '<div class="empty">None.</div>';
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'integrity-row';
        row.textContent = musicIntegrityFilter === 'missing'
          ? `${item.file} — ${item.title || item.id}`
          : `${item.file}${item.label ? ` — ${item.label}` : ''}`;
        list.append(row);
      });
      box.append(list);
    }
    if (report.errors?.length) {
      const errors = document.createElement('p');
      errors.className = 'note small';
      errors.textContent = report.errors.join(' · ');
      box.append(errors);
    }
  }

  function renderHealth(health, integrityReport) {
    if (!health) return;
    currentHealth = health;
    const badge = $('healthBadge');
    if (badge) {
      const statuses = health.statuses || {};
      const hasBad = Object.values(statuses).some((entry) => healthTone(entry.status) === 'bad');
      const hasWarn = Object.values(statuses).some((entry) => healthTone(entry.status) === 'warn');
      badge.textContent = hasBad ? 'ATTENTION' : hasWarn ? 'WARNING' : 'HEALTHY';
      badge.dataset.tone = hasBad ? 'bad' : hasWarn ? 'warn' : 'ok';
    }
    renderHealthStatuses(health.statuses);
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    const metrics = health.metrics || {};
    setText('healthCpu', `${Number(metrics.cpuPercent || 0).toFixed(1)}%`);
    setText('healthRam', `${metrics.memory?.processRssMb ?? 0} MB · sys ${metrics.memory?.systemUsedPercent ?? 0}%`);
    setText('healthLoop', `${metrics.eventLoopLagMs ?? 0} ms`);
    setText('healthUptime', formatLongDuration(health.uptimeSeconds));
    setText('healthClients', `${health.snapshot?.clients?.obs ?? 0} OBS / ${health.snapshot?.clients?.total ?? 0}`);
    setText('healthQueue', String(health.snapshot?.ttsQueue ?? 0));
    setText('healthRecoveries', String(health.counters?.recoveries ?? 0));
    setText('healthFailed', String(health.counters?.failedRecoveries ?? 0));
    renderHealthIncidents(health.incidents);
    if (health.snapshot?.musicIntegrity) renderMusicIntegrity(health.snapshot.musicIntegrity);
    if (integrityReport) renderMusicIntegrity(integrityReport);
  }

  function setHealthStatus(text, tone = '') {
    const el = $('healthStatusLine');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  async function loadHealth() {
    try {
      renderHealth(await callRpc('health.get'));
    } catch (error) {
      reportError('Health load failed', error);
    }
  }

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
      } else if (method === 'congregation.state') {
        if (currentState) currentState.congregation = params;
        renderCongregation(params);
      } else if (method === 'schedule.state') {
        renderSchedule(params?.schedule);
      } else if (method === 'health.state' || method === 'health.incident') {
        if (params?.health) renderHealth(params.health);
      } else if (method === 'music.integrity.updated') {
        renderMusicIntegrity(params?.report);
      } else if (method === 'copyright.updated') {
        loadCopyrightAudit();
      } else if (method === 'images.updated') {
        loadImageLibrary();
        loadBackgroundCatalog();
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

  async function updateCongregation(patch) {
    try {
      const payload = await callRpc('congregation.update', patch);
      renderCongregation(payload);
      printOutput(payload);
      return payload;
    } catch (error) {
      reportError('Congregation update failed', error);
      return null;
    }
  }

  $('congEnabled')?.addEventListener('change', (event) => updateCongregation({ enabled: event.target.checked }));
  $('congShowNames')?.addEventListener('change', (event) => updateCongregation({ showNames: event.target.checked }));
  $('congInactivity')?.addEventListener('change', (event) => updateCongregation({ inactivityMinutes: Number(event.target.value) }));
  $('congMaxVisible')?.addEventListener('change', (event) => updateCongregation({ maxVisible: Number(event.target.value) }));

  $('btnCongDemo')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('congregation.demo', { count: 10 });
      renderCongregation(result?.payload);
      printOutput(result);
      if (result?.added === 0) {
        reportError('Demo seats', new Error('No free seats. Reset the congregation or raise the maximum.'));
      }
    } catch (error) {
      reportError('Demo seats failed', error);
    }
  });

  $('btnCongDemoClear')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('congregation.demoClear');
      renderCongregation(result?.payload);
      printOutput(result);
    } catch (error) {
      reportError('Clear demo failed', error);
    }
  });

  $('btnCongReset')?.addEventListener('click', async () => {
    if (!window.confirm('Clear every seat in the prayer congregation? Real viewers will reappear only when TikTok sends a new join event.')) return;
    try {
      const result = await callRpc('congregation.reset');
      renderCongregation(result?.payload);
      printOutput(result);
    } catch (error) {
      reportError('Congregation reset failed', error);
    }
  });

  async function runDemoCongregationEvent(action) {
    try {
      const result = await callRpc('congregation.demoEvent', { action });
      renderCongregation(result?.payload);
      printOutput(result);
    } catch (error) {
      reportError('Demo preview failed', error);
    }
  }

  $('btnCongDemoAmen')?.addEventListener('click', () => runDemoCongregationEvent('amen'));
  $('btnCongDemoPrayer')?.addEventListener('click', () => runDemoCongregationEvent('prayer'));
  $('btnCongDemoGift')?.addEventListener('click', () => runDemoCongregationEvent('gift'));

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
     Smart schedule controls
     --------------------------------------------------------------------- */
  $('scheduleEnabled')?.addEventListener('change', async (event) => {
    try {
      const schedule = await callRpc('schedule.update', { enabled: event.target.checked });
      renderSchedule(schedule);
      setScheduleStatus(event.target.checked
        ? 'Automatic schedule enabled.'
        : 'Automatic switching disabled. Manual selection still works.', 'ok');
    } catch (error) {
      setScheduleStatus(error.message, 'error');
    }
  });

  $('scheduleTimezone')?.addEventListener('change', async (event) => {
    try {
      const schedule = await callRpc('schedule.update', { timezone: event.target.value });
      renderSchedule(schedule);
      setScheduleStatus(`Timezone set to ${event.target.value}. The active program was recalculated.`, 'ok');
    } catch (error) {
      setScheduleStatus(error.message, 'error');
    }
  });

  function overrideMinutes() {
    return Number($('scheduleOverrideMinutes')?.value || 30);
  }

  $('scheduleProgramButtons')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-program]');
    if (!button) return;
    try {
      const schedule = await callRpc('schedule.override', {
        program: button.dataset.program,
        minutes: overrideMinutes()
      });
      renderSchedule(schedule);
      setScheduleStatus(`Manual override: ${schedule.current?.label || button.dataset.program} for ${overrideMinutes()} minutes. Automatic switching resumes afterwards.`, 'warn');
    } catch (error) {
      setScheduleStatus(error.message, 'error');
    }
  });

  $('btnScheduleAuto')?.addEventListener('click', async () => {
    try {
      const schedule = await callRpc('schedule.auto');
      renderSchedule(schedule);
      setScheduleStatus(`Back on the automatic schedule: ${schedule.current?.label || '—'}.`, 'ok');
    } catch (error) {
      setScheduleStatus(error.message, 'error');
    }
  });

  $('schedulePrograms')?.addEventListener('change', async (event) => {
    const field = event.target.dataset?.field;
    if (!field) return;
    const card = event.target.closest('.schedule-card');
    const id = card?.dataset.program;
    if (!id) return;
    const raw = event.target.value;
    const patch = field === 'quizFrequencyMinutes' || field === 'narrationPace' ? Number(raw) : raw;
    await updateScheduleProgram(id, { [field]: patch }, `Saved ${field === 'start' ? 'start time' : field === 'end' ? 'end time' : field} for ${id}.`);
  });

  $('schedulePrograms')?.addEventListener('click', async (event) => {
    const action = event.target.closest('button[data-action]')?.dataset.action;
    const id = event.target.closest('.schedule-card')?.dataset.program;
    if (!action || !id) return;
    try {
      if (action === 'preview') {
        const result = await callRpc('schedule.preview', { program: id });
        renderSchedule(result.schedule);
        setScheduleStatus(`Previewing ${id}. ${result.note}`, 'warn');
      } else if (action === 'run') {
        const schedule = await callRpc('schedule.override', { program: id, minutes: overrideMinutes() });
        renderSchedule(schedule);
        setScheduleStatus(`Running ${schedule.current?.label || id} for ${overrideMinutes()} minutes.`, 'warn');
      }
    } catch (error) {
      setScheduleStatus(error.message, 'error');
    }
  });

  /* ---------------------------------------------------------------------
     Health and recovery controls
     --------------------------------------------------------------------- */
  $('btnHealthCheck')?.addEventListener('click', async () => {
    try {
      const health = await callRpc('health.check', { reason: 'dashboard' });
      renderHealth(health);
      setHealthStatus(`Health check complete at ${new Date().toLocaleTimeString('en-US')}.`, 'ok');
    } catch (error) {
      setHealthStatus(error.message, 'error');
    }
  });

  $('btnHealthExport')?.addEventListener('click', async () => {
    try {
      const report = await callRpc('health.export');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `christian-prayer-live-diagnostics-${stamp}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setHealthStatus('Diagnostic report downloaded. It contains no secrets, tokens or viewer data.', 'ok');
    } catch (error) {
      setHealthStatus(error.message, 'error');
    }
  });

  $('btnHealthClear')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('health.alerts.clear');
      renderHealth(result.health);
      setHealthStatus(`Cleared ${result.removed} resolved ${result.removed === 1 ? 'alert' : 'alerts'}.`, 'ok');
    } catch (error) {
      setHealthStatus(error.message, 'error');
    }
  });

  async function retryComponent(component, label) {
    try {
      const result = await callRpc('health.retry', { component });
      renderHealth(result.health);
      setHealthStatus(`${label} requested. See the incident log for the result.`, 'warn');
    } catch (error) {
      setHealthStatus(error.message, 'error');
    }
  }

  $('btnRetryPiper')?.addEventListener('click', () => retryComponent('piper', 'Piper restart'));
  $('btnRetryTikTok')?.addEventListener('click', () => retryComponent('tiktok', 'TikTok reconnect'));
  $('btnRecoverMusic')?.addEventListener('click', () => retryComponent('music', 'Music recovery'));

  async function scanMusicIntegrity() {
    try {
      const report = await callRpc('music.integrity');
      musicIntegrityFilter = null;
      renderMusicIntegrity(report);
      setHealthStatus(`Music scan complete: ${report.summary}. Nothing was deleted.`, report.healthy ? 'ok' : 'warn');
      return report;
    } catch (error) {
      setHealthStatus(error.message, 'error');
      return null;
    }
  }

  $('btnScanMusicFiles')?.addEventListener('click', scanMusicIntegrity);

  $('btnRefreshMusicManifest')?.addEventListener('click', async () => {
    try {
      const result = await callRpc('music.integrity.refresh');
      musicIntegrityFilter = null;
      renderMusicIntegrity(result.report);
      await loadMusicCatalog();
      setHealthStatus(`Manifest refreshed: ${result.scan.found} tracks found, ${result.scan.added} new, ${result.scan.removed} missing. A backup of the previous manifest was kept.`, 'ok');
    } catch (error) {
      setHealthStatus(error.message, 'error');
    }
  });

  $('btnViewMissingMusic')?.addEventListener('click', async () => {
    const report = musicIntegrityReport || await scanMusicIntegrity();
    if (!report) return;
    musicIntegrityFilter = musicIntegrityFilter === 'missing' ? null : 'missing';
    renderMusicIntegrity(report);
  });

  $('btnViewUnusedMusic')?.addEventListener('click', async () => {
    const report = musicIntegrityReport || await scanMusicIntegrity();
    if (!report) return;
    musicIntegrityFilter = musicIntegrityFilter === 'unused' ? null : 'unused';
    renderMusicIntegrity(report);
  });

  /* ---------------------------------------------------------------------
     TikTok reconnect controls
     --------------------------------------------------------------------- */
  async function updateTikTokReconnect(patch) {
    try {
      const result = await callRpc('live.setReconnect', patch);
      const retryStatus = $('tiktokRetryStatus');
      if (retryStatus) {
        retryStatus.textContent = `Saved: auto reconnect ${result.settings.autoReconnect ? 'on' : 'off'}, ${result.settings.maxRetries} retries, ${result.settings.retrySeconds}s base delay.`;
      }
    } catch (error) {
      reportError('Reconnect settings failed', error);
    }
  }

  $('tiktokAutoReconnect')?.addEventListener('change', (event) => updateTikTokReconnect({ autoReconnect: event.target.checked }));
  $('tiktokMaxRetries')?.addEventListener('change', (event) => updateTikTokReconnect({ maxRetries: Number(event.target.value) }));
  $('tiktokRetrySeconds')?.addEventListener('change', (event) => updateTikTokReconnect({ retrySeconds: Number(event.target.value) }));
  $('btnTikTokRetry')?.addEventListener('click', async () => {
    try {
      await callRpc('live.retryNow');
      const retryStatus = $('tiktokRetryStatus');
      if (retryStatus) retryStatus.textContent = 'Manual reconnect requested. Attempting now…';
    } catch (error) {
      reportError('Retry failed', error);
    }
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
  loadCopyrightAudit();
  loadImageLibrary();
  loadSchedule();
  loadHealth();
  setInterval(() => {
    if (currentSchedule) renderSchedule(currentSchedule);
  }, 1000);
  if (!messagesLoaded) loadMessages();
  connectSocket();
})();
