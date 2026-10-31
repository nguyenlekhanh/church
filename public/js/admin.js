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
  if (!messagesLoaded) loadMessages();
  connectSocket();
})();
