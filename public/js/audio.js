/**
 * PrayerAudioEngine
 * - Original ambient worship playlist (local Ogg Opus, seamless Web Audio loops).
 * - Two-deck crossfade, shuffle/repeat, automatic volume ducking under narration.
 * - Gentle chimes and a warm church bell for community moments.
 * - Language-aware Piper narration queue: never overlaps, ducks music, caches URLs.
 */
(function () {
  'use strict';

  class PrayerAudioEngine {
    constructor() {
      this.ctx = null;
      this.unlocked = false;
      this.sfxEnabled = true;
      this.ttsEnabled = true;
      this.ttsLanguage = 'en';
      this.ttsVoice = '';
      this.ttsRate = 1.0;

      const savedTts = parseFloat(localStorage.getItem('prayer_tts_vol'));
      this.ttsVolume = Number.isFinite(savedTts) ? Math.max(0, Math.min(1, savedTts)) : 0.95;

      // Background music (ambient worship playlist).
      this.music = {
        tracks: [],
        byId: new Map(),
        enabled: false,
        paused: true,
        autoplay: true,
        currentId: '',
        volume: 0.1,
        duckVolume: 0.035,
        shuffle: false,
        repeat: 'all',
        master: null,
        limiter: null,
        deck: null,
        buffers: new Map(),
        loadingId: null,
        loadError: null,
        overrideUntil: 0,
        crossfadeUntil: 0,
        crossfadeTimer: null,
        userStarted: false,
        failed: new Set()
      };
      this.onMusicStateChange = null;

      this.ttsQueue = [];
      this.ttsPlaying = false;
      this.currentAudio = null;
      this.maxQueue = 5;
      this.recentSpoken = new Map();
      this.onTtsStateChange = null;
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        const resume = this.ctx.resume();
        if (resume && typeof resume.then === 'function') {
          resume.then(() => {
            // OBS browser sources allow autoplay; regular tabs may need a click.
            if (this.ctx.state === 'running') {
              this.unlocked = true;
              if (this.music.enabled && !this.music.paused) this.startMusic();
            }
          }).catch(() => {});
        }
      }
      this.unlocked = this.ctx.state === 'running';
      // A user gesture just happened: honour the saved autoplay state.
      if (this.unlocked && this.music.enabled && !this.music.paused) this.startMusic();
      return this.ctx;
    }

    /* ---------------------------------------------------------------------
       Background music — original ambient worship playlist
       --------------------------------------------------------------------- */
    setMusicPlaylist(tracks) {
      const music = this.music;
      const list = Array.isArray(tracks) ? tracks.filter((track) => track && track.url) : [];
      music.tracks = list;
      music.byId = new Map(list.map((track) => [track.id, track]));
      music.failed = new Set();
      if (list.length === 0) {
        music.currentId = '';
        if (music.deck || music.crossfadeTimer) this.stopMusic({ fadeMs: 1200 });
      } else if (!music.currentId || !music.byId.has(music.currentId)) {
        // The current file was removed or disabled: move to the next available track.
        music.currentId = list[0].id;
        music.loadError = null;
        if (this.unlocked && music.enabled && !music.paused) {
          this.playTrack(music.currentId, { fadeMs: 1800 });
        }
      }
      this.emitMusicState();
    }

    /** Applies the authoritative server settings without restarting playback needlessly. */
    applyMusicSettings(settings) {
      if (!settings || typeof settings !== 'object') return;
      const music = this.music;
      let nextId = String(settings.track || music.currentId || '');
      if (nextId && music.tracks.length > 0 && !music.byId.has(nextId)) {
        nextId = music.tracks[0].id;
      }
      const trackChanged = nextId && nextId !== music.currentId && Date.now() > music.overrideUntil;

      if (typeof settings.volume === 'number') music.volume = Math.max(0, Math.min(1, settings.volume));
      if (typeof settings.duckVolume === 'number') {
        music.duckVolume = Math.max(0, Math.min(1, settings.duckVolume));
      }
      if (typeof settings.shuffle === 'boolean') music.shuffle = settings.shuffle;
      if (typeof settings.repeat === 'string') music.repeat = settings.repeat;
      if (typeof settings.autoplay === 'boolean') music.autoplay = settings.autoplay;

      const shouldPlay = settings.enabled !== false && settings.paused !== true;
      const wasPlaying = music.enabled && !music.paused;
      music.enabled = settings.enabled !== false;
      music.paused = settings.paused === true;

      if (trackChanged) {
        music.currentId = nextId;
        if (shouldPlay) this.playTrack(nextId, { fadeMs: 1800 });
      } else if (!music.currentId && nextId) {
        music.currentId = nextId;
      }

      if (!shouldPlay && wasPlaying) this.stopMusic({ fadeMs: 1400 });
      else if (shouldPlay && !wasPlaying && this.unlocked && music.autoplay) this.startMusic();
      else if (shouldPlay && !music.deck && this.unlocked && music.autoplay) this.startMusic();

      this.refreshMusicGain();
      this.emitMusicState();
    }

    /** Starts (or resumes) the configured track. Safe to call repeatedly. */
    startMusic(fadeMs = 2200) {
      const music = this.music;
      if (!this.ctx || !this.unlocked) return false;
      if (!music.enabled || music.paused) return false;
      const id = music.currentId || music.tracks[0]?.id;
      if (!id) return false;
      if (music.deck && (music.deck.id === id || music.deck.track?.id === id)) {
        this.refreshMusicGain();
        return true;
      }
      if (music.loadingId === id) return true;
      music.userStarted = true;
      this.playTrack(id, { fadeMs });
      return true;
    }

    stopMusic({ fadeMs = 1200 } = {}) {
      const music = this.music;
      clearTimeout(music.crossfadeTimer);
      music.crossfadeTimer = null;
      music.paused = true;
      if (!this.ctx || !music.master) {
        music.deck = null;
        this.emitMusicState();
        return;
      }
      const now = this.ctx.currentTime;
      try {
        music.master.gain.cancelScheduledValues(now);
        music.master.gain.setValueAtTime(music.master.gain.value, now);
        music.master.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.05, fadeMs / 1000));
      } catch (_) {}
      if (music.deck) this.stopDeck(music.deck, fadeMs);
      music.deck = null;
      this.emitMusicState();
    }

    setMusicEnabled(enabled) {
      this.applyMusicSettings({ enabled: Boolean(enabled), paused: !enabled });
    }

    setMusicVolume(volume) {
      const value = Math.max(0, Math.min(1, Number(volume)));
      if (!Number.isFinite(value)) return;
      this.music.volume = value;
      try {
        localStorage.setItem('prayer_music_vol', String(value));
      } catch (_) {}
      this.refreshMusicGain();
      this.emitMusicState();
    }

    ensureMusicBus() {
      const music = this.music;
      if (!this.ctx || music.master) return music.master;
      const master = this.ctx.createGain();
      master.gain.value = 0.0001;
      // Safety limiter: narration and music can never clip the OBS source.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 8;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.006;
      limiter.release.value = 0.3;
      master.connect(limiter);
      // The analyser measures the music bus only (narration uses a separate
      // <audio> element), which is what the silent-audio monitor needs.
      if (this.ctx.createAnalyser) {
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.3;
        limiter.connect(analyser);
        analyser.connect(this.ctx.destination);
        music.analyser = analyser;
      } else {
        limiter.connect(this.ctx.destination);
      }
      music.master = master;
      music.limiter = limiter;
      return master;
    }

    musicGainTarget() {
      const music = this.music;
      if (!music.enabled || music.paused) return 0;
      return this.ttsPlaying ? Math.min(music.volume, music.duckVolume) : music.volume;
    }

    refreshMusicGain(immediate = false) {
      const music = this.music;
      if (!this.ctx || !music.master) return;
      const target = this.musicGainTarget();
      const now = this.ctx.currentTime;
      try {
        music.master.gain.cancelScheduledValues(now);
        music.master.gain.setValueAtTime(Math.max(0.0001, music.master.gain.value), now);
        if (immediate) music.master.gain.linearRampToValueAtTime(target, now + 0.08);
        else music.master.gain.setTargetAtTime(target, now, 0.5);
      } catch (_) {}
    }

    async loadMusicBuffer(track) {
      const music = this.music;
      if (!track) throw new Error('No track selected');
      if (music.buffers.has(track.id)) return music.buffers.get(track.id);
      if (music.loadingId === track.id && music.loadPromise) return music.loadPromise;
      music.loadingId = track.id;
      music.loadError = null;
      const promise = (async () => {
        const res = await fetch(track.url, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`Music file unavailable (${res.status})`);
        const bytes = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(bytes);
        // Keep at most two decoded loops in memory (current + preloaded next).
        if (music.buffers.size >= 2) {
          const firstKey = music.buffers.keys().next().value;
          if (firstKey !== track.id) music.buffers.delete(firstKey);
        }
        music.buffers.set(track.id, buffer);
        return buffer;
      })();
      music.loadPromise = promise;
      try {
        return await promise;
      } catch (err) {
        music.loadError = err.message;
        console.warn('[Music]', err.message);
        throw err;
      } finally {
        if (music.loadingId === track.id) {
          music.loadingId = null;
          music.loadPromise = null;
        }
        this.emitMusicState();
      }
    }

    playTrack(trackId, { fadeMs = 1800, preloadedBuffer = null } = {}) {
      const music = this.music;
      const track = music.byId.get(trackId);
      if (!track) return;
      if (!this.ctx || !this.unlocked) {
        music.currentId = trackId;
        this.emitMusicState();
        return;
      }
      const previous = music.deck;
      this.ensureMusicBus();
      music.currentId = trackId;
      music.paused = false;
      music.enabled = true;

      const begin = async () => {
        let buffer = preloadedBuffer;
        if (!buffer) {
          try {
            buffer = await this.loadMusicBuffer(track);
          } catch (err) {
            music.failed.add(trackId);
            music.loadError = err.message || 'Track could not be loaded';
            const fallback = music.tracks.find((item) => !music.failed.has(item.id));
            if (fallback) {
              music.currentId = fallback.id;
              this.playTrack(fallback.id, { fadeMs: 900 });
            }
            this.emitMusicState();
            return;
          }
        }
        // A newer request may have won while the file decoded.
        if (music.currentId !== trackId) return;
        if (music.deck && (music.deck.id === trackId || music.deck.track?.id === trackId)) return;

        this.startDeck(track, buffer, { fadeMs, previous });
        this.refreshMusicGain();
        this.emitMusicState();
      };
      begin();
    }

    startDeck(track, buffer, { fadeMs, previous }) {
      const ctx = this.ctx;
      const music = this.music;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      const loopOne = music.repeat === 'one';
      source.loop = loopOne;
      source.connect(gain);
      gain.connect(music.master);

      const now = ctx.currentTime;
      const fade = Math.max(0.05, fadeMs / 1000);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);

      if (previous) {
        try {
          const oldGain = previous.gain;
          oldGain.gain.cancelScheduledValues(now);
          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
          oldGain.gain.linearRampToValueAtTime(0.0001, now + fade);
          previous.source.stop(now + fade + 0.1);
        } catch (_) {}
      }

      const deck = { id: track.id, track, source, gain, startedAt: now, duration: buffer.duration };
      music.deck = deck;
      source.onended = () => {
        try {
          gain.disconnect();
        } catch (_) {}
        if (music.deck === deck) {
          music.deck = null;
          if (!music.paused && music.repeat === 'off') this.emitMusicState();
        }
      };
      source.start(now);

      // Schedule the hand-off to the next track just before this one ends.
      clearTimeout(music.crossfadeTimer);
      music.crossfadeTimer = null;
      if (!loopOne && music.repeat !== 'off') {
        const crossfade = 3.5;
        const waitMs = Math.max(1200, (buffer.duration - crossfade) * 1000);
        music.crossfadeUntil = Date.now() + waitMs;
        music.crossfadeTimer = setTimeout(() => {
          if (music.deck !== deck) return;
          this.advancePlaylist(1, { auto: true });
        }, waitMs);
        // Pre-decode the next loop while this one plays (keeps transitions gapless).
        const nextId = this.peekNextTrackId();
        if (nextId) {
          const nextTrack = music.byId.get(nextId);
          if (nextTrack && !music.buffers.has(nextId)) {
            this.loadMusicBuffer(nextTrack).catch(() => {});
          }
        }
      }
    }

    /**
     * Safe recovery for the silent-audio monitor: fades the current deck out
     * and starts the same track again. No second player, no duplicate loop.
     */
    reloadCurrentTrack({ fadeMs = 600 } = {}) {
      const music = this.music;
      if (!this.ctx || !this.unlocked) return false;
      if (!music.enabled || music.paused) return false;
      const id = music.currentId || music.tracks[0]?.id;
      if (!id) return false;
      music.failed.delete(id);
      const deck = music.deck;
      if (deck) {
        try {
          this.stopDeck(deck, 300);
        } catch (_) {}
        music.deck = null;
      }
      music.loadError = null;
      this.playTrack(id, { fadeMs });
      return true;
    }

    stopDeck(deck, fadeMs) {
      if (!deck) return;
      try {
        const now = this.ctx ? this.ctx.currentTime : 0;
        deck.gain.gain.cancelScheduledValues(now);
        deck.gain.gain.setValueAtTime(Math.max(0.0001, deck.gain.gain.value), now);
        deck.gain.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.05, fadeMs / 1000));
        deck.source.stop(now + Math.max(0.05, fadeMs / 1000) + 0.1);
      } catch (_) {}
    }

    peekNextTrackId() {
      const music = this.music;
      const order = music.tracks.map((track) => track.id);
      if (order.length < 2) return null;
      if (music.shuffle) {
        const pool = order.filter((id) => id !== music.currentId);
        return pool[Math.floor(Math.random() * pool.length)];
      }
      const index = order.indexOf(music.currentId);
      return order[(index + 1) % order.length];
    }

    /** Crossfades to the next/previous track and syncs the choice to the server. */
    advancePlaylist(direction = 1, { auto = false } = {}) {
      const music = this.music;
      const order = music.tracks.map((track) => track.id);
      if (order.length === 0) return null;
      if (music.repeat === 'off' && auto) {
        const index = order.indexOf(music.currentId);
        if (!music.shuffle && index === order.length - 1) {
          this.stopMusic({ fadeMs: 2500 });
          return null;
        }
      }
      let nextId;
      if (music.shuffle) {
        const pool = order.filter((id) => id !== music.currentId);
        nextId = pool[Math.floor(Math.random() * pool.length)];
      } else {
        const index = order.indexOf(music.currentId);
        nextId = order[(index + direction + order.length) % order.length];
      }
      music.overrideUntil = Date.now() + 5000;
      const nextTrack = music.byId.get(nextId);
      const buffer = nextTrack ? music.buffers.get(nextId) : null;
      this.playTrack(nextId, { fadeMs: 3500, preloadedBuffer: buffer || null });
      if (this.onMusicStateChange) {
        this.onMusicStateChange({ reason: 'advance', trackId: nextId, auto });
      }
      return nextId;
    }

    getMusicStatus() {
      const music = this.music;
      const track = music.byId.get(music.currentId);
      return {
        enabled: music.enabled,
        paused: music.paused,
        playing: Boolean(music.deck),
        unlocked: this.unlocked,
        trackId: music.currentId,
        title: track?.title || '',
        volume: music.volume,
        duckVolume: music.duckVolume,
        ducked: Boolean(this.ttsPlaying),
        shuffle: music.shuffle,
        repeat: music.repeat,
        loading: Boolean(music.loadingId),
        error: music.loadError,
        tracks: music.tracks.length
      };
    }

    emitMusicState() {
      if (typeof this.onMusicStateChange === 'function') {
        this.onMusicStateChange({ reason: 'state', status: this.getMusicStatus() });
      }
    }

    /** RMS of what the music bus is actually outputting, or null if unmeasured. */
    getMusicRms() {
      const music = this.music;
      if (!music.analyser) return null;
      if (!this._levelBuffer || this._levelBuffer.length !== music.analyser.fftSize) {
        this._levelBuffer = new Float32Array(music.analyser.fftSize);
      }
      try {
        music.analyser.getFloatTimeDomainData(this._levelBuffer);
      } catch (_) {
        return null;
      }
      let sum = 0;
      for (let index = 0; index < this._levelBuffer.length; index += 1) {
        const value = this._levelBuffer[index];
        sum += value * value;
      }
      return Math.sqrt(sum / this._levelBuffer.length);
    }

    /** Small, evidence-only report used by the server health monitor. */
    getAudioHealth() {
      const music = this.music;
      const status = this.getMusicStatus();
      return {
        playing: Boolean(music.deck && !music.paused),
        paused: Boolean(music.paused),
        enabled: Boolean(music.enabled),
        unlocked: Boolean(this.unlocked),
        muted: false,
        ttsPlaying: Boolean(this.ttsPlaying),
        musicRms: this.getMusicRms(),
        volume: music.volume,
        trackId: music.currentId || null,
        error: music.loadError || null
      };
    }

    setTtsVolume(volume) {
      const value = Math.max(0, Math.min(1, Number(volume)));
      if (!Number.isFinite(value)) return;
      this.ttsVolume = value;
      try {
        localStorage.setItem('prayer_tts_vol', String(value));
      } catch (_) {}
      if (this.currentAudio) this.currentAudio.volume = this.ttsVolume;
    }

    /* ---------------------------------------------------------------------
       Sound effects
       --------------------------------------------------------------------- */
    tone({ frequency, type = 'sine', start = 0, duration = 1.2, peak = 0.08, destination }) {
      if (!this.sfxEnabled) return;
      const ctx = this.ensureContext();
      if (!ctx) return;
      try {
        const now = ctx.currentTime + start;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(destination || ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.05);
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (_) {}
        };
      } catch (_) {}
    }

    playSoftChime(level = 1) {
      this.tone({ frequency: 784, duration: 2.4, peak: 0.035 * level });
      this.tone({ frequency: 1174.66, start: 0.25, duration: 2.0, peak: 0.02 * level });
    }

    playCandleChime() {
      this.tone({ frequency: 659.25, duration: 1.8, peak: 0.055 });
      this.tone({ frequency: 987.77, start: 0.16, duration: 1.6, peak: 0.04 });
      this.tone({ frequency: 1318.5, start: 0.32, duration: 1.4, peak: 0.022 });
    }

    playAmenChime() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        this.tone({ frequency: freq, start: index * 0.08, duration: 2.8, peak: 0.045 });
      });
    }

    playChurchBell(intensity = 1) {
      if (!this.sfxEnabled) return;
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.16 * Math.min(1, intensity), now);
      master.connect(ctx.destination);
      const base = 196;
      const partials = [
        { ratio: 0.5, amp: 0.22, decay: 4.4 },
        { ratio: 1.0, amp: 0.3, decay: 3.8 },
        { ratio: 2.01, amp: 0.14, decay: 2.4 },
        { ratio: 3.01, amp: 0.08, decay: 1.6 }
      ];
      partials.forEach((partial, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base * partial.ratio, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(partial.amp, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + partial.decay + 0.05);
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
            if (index === 0) master.disconnect();
          } catch (_) {}
        };
      });
    }

    playCelebration() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((freq, index) => {
        this.tone({ frequency: freq, start: index * 0.12, duration: 2.4, peak: 0.06 });
      });
      setTimeout(() => this.playChurchBell(1.1), 380);
    }

    /* ---------------------------------------------------------------------
       Narration queue
       --------------------------------------------------------------------- */
    enqueueTts(text, options = {}) {
      const onStart = typeof options.onStart === 'function' ? options.onStart : null;
      const onEnd = typeof options.onEnd === 'function' ? options.onEnd : null;

      // `force` lets an explicit operator action (the farewell blessing) speak
      // even when automatic narration is switched off.
      if (!this.ttsEnabled && !options.force) {
        if (onStart) onStart();
        if (onEnd) setTimeout(onEnd, 4800);
        return;
      }

      const clean = String(text || '').trim();
      if (!clean) {
        if (onStart) onStart();
        if (onEnd) setTimeout(onEnd, 4800);
        return;
      }

      const now = Date.now();
      const last = this.recentSpoken.get(clean);
      // Two viewers can share a display name; a welcome greeting is a distinct
      // message for a distinct viewer, so it is never deduplicated by text.
      if (!options.welcome && last && now - last < 12000) {
        if (onStart) onStart();
        if (onEnd) setTimeout(onEnd, 3200);
        return;
      }
      this.recentSpoken.set(clean, now);
      if (this.recentSpoken.size > 60) {
        this.recentSpoken.delete(this.recentSpoken.keys().next().value);
      }

      // Welcome greetings are never discarded. When the queue is full the oldest
      // non-welcome announcement makes room instead.
      if (!options.welcome && this.ttsQueue.length >= this.maxQueue) {
        const index = this.ttsQueue.findIndex((item) => !item.welcome);
        const [dropped] = this.ttsQueue.splice(index === -1 ? 0 : index, 1);
        if (dropped?.onEnd) dropped.onEnd();
      }

      const item = {
        id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: clean,
        lang: options.lang || this.ttsLanguage || 'en',
        voice: options.voice || this.ttsVoice || undefined,
        rate: Number(options.rate || this.ttsRate || 1.0),
        url: options.url || null,
        welcome: Boolean(options.welcome),
        onStart,
        onEnd,
        fetchPromise: null
      };

      if (!item.url) {
        item.fetchPromise = this.fetchTtsAudio(item.text, item.lang, item.voice, item.rate);
      }

      this.ttsQueue.push(item);
      this.processTtsQueue();
    }

    async fetchTtsAudio(text, lang, voice, rate) {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, lang, voice, rate })
        });
        const data = await res.json();
        if (data && data.ok && data.url) return data;
        return { ok: false, error: data?.error || 'Narration unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    async processTtsQueue() {
      if (this.ttsPlaying || this.ttsQueue.length === 0) return;
      this.ttsPlaying = true;
      this.refreshMusicGain();
      const item = this.ttsQueue.shift();

      try {
        let audioUrl = item.url;
        if (!audioUrl && item.fetchPromise) {
          const result = await item.fetchPromise;
          if (result && result.ok && result.url) audioUrl = result.url;
          else if (result?.error) console.warn('[Narration]', result.error);
        }

        if (audioUrl) {
          if (this.onTtsStateChange) {
            this.onTtsStateChange({ speaking: true, text: item.text, lang: item.lang });
          }
          if (item.onStart) item.onStart();
          await this.playWavUrl(audioUrl);
          if (item.onEnd) item.onEnd();
        } else {
          if (item.onStart) item.onStart();
          if (item.onEnd) setTimeout(item.onEnd, 4200);
        }
      } catch (err) {
        console.warn('[Narration playback]', err);
        if (item.onStart) item.onStart();
        if (item.onEnd) item.onEnd();
      } finally {
        this.ttsPlaying = false;
        if (this.ttsQueue.length === 0) {
          this.refreshMusicGain();
          if (this.onTtsStateChange) {
            this.onTtsStateChange({ speaking: false, text: '', lang: '' });
          }
        } else {
          setTimeout(() => this.processTtsQueue(), 220);
        }
      }
    }

    playWavUrl(url) {
      return new Promise((resolve) => {
        try {
          const audio = new Audio(url);
          this.currentAudio = audio;
          audio.volume = this.ttsVolume;
          const finish = () => {
            this.currentAudio = null;
            resolve();
          };
          audio.onended = finish;
          audio.onerror = finish;
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(finish);
          }
        } catch (_) {
          resolve();
        }
      });
    }
  }

  window.PrayerAudioEngine = PrayerAudioEngine;
  window.TempleAudioEngine = PrayerAudioEngine;
})();
