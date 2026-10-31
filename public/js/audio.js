/**
 * PrayerAudioEngine
 * - Soft, generated worship ambience (no external music files, no licensing issues).
 * - Gentle chimes and a warm church bell for community moments.
 * - Language-aware Piper narration queue: never overlaps, ducks ambience, caches URLs.
 */
(function () {
  'use strict';

  class PrayerAudioEngine {
    constructor() {
      this.ctx = null;
      this.unlocked = false;
      this.sfxEnabled = true;
      this.bgMusicEnabled = false;
      this.ttsEnabled = true;
      this.ttsLanguage = 'en';
      this.ttsVoice = '';
      this.ttsRate = 1.0;

      const savedMusic = parseFloat(localStorage.getItem('prayer_music_vol'));
      const savedTts = parseFloat(localStorage.getItem('prayer_tts_vol'));
      this.bgBaseVolume = Number.isFinite(savedMusic) ? Math.max(0, Math.min(1, savedMusic)) : 0.45;
      this.ttsVolume = Number.isFinite(savedTts) ? Math.max(0, Math.min(1, savedTts)) : 0.95;

      this.ambience = null;
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
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.unlocked = true;
      if (this.bgMusicEnabled) this.startAmbience();
      return this.ctx;
    }

    /* ---------------------------------------------------------------------
       Ambience
       --------------------------------------------------------------------- */
    startAmbience() {
      // Never create the audio context here: ensureContext() calls this method
      // after unlocking, so requiring an existing context avoids recursion.
      if (!this.bgMusicEnabled || this.ambience || !this.ctx) return;
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();

      const master = ctx.createGain();
      master.gain.value = this.getAmbienceGain();
      master.connect(ctx.destination);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.4;
      filter.connect(master);

      const notes = [110, 164.81, 220, 329.63];
      const oscillators = [];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = index % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        gain.gain.value = 0.035 / (index + 1);

        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 0.05 + index * 0.013;
        lfoGain.gain.value = 0.012;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start();

        osc.connect(gain);
        gain.connect(filter);
        osc.start();
        oscillators.push({ osc, gain, lfo, lfoGain });
      });

      const chimeTimer = setInterval(() => {
        if (!this.bgMusicEnabled) return;
        this.playSoftChime(0.35);
      }, 8200);

      this.ambience = { master, filter, oscillators, chimeTimer };
    }

    stopAmbience() {
      if (!this.ambience) return;
      const { master, oscillators, chimeTimer } = this.ambience;
      clearInterval(chimeTimer);
      oscillators.forEach(({ osc, gain, lfo, lfoGain }) => {
        try {
          osc.stop();
          lfo.stop();
          osc.disconnect();
          lfo.disconnect();
          gain.disconnect();
          lfoGain.disconnect();
        } catch (_) {}
      });
      try {
        master.disconnect();
      } catch (_) {}
      this.ambience = null;
    }

    getAmbienceGain() {
      return this.ttsPlaying ? Math.max(0.015, this.bgBaseVolume * 0.14) : this.bgBaseVolume * 0.32;
    }

    refreshAmbienceGain() {
      if (!this.ambience) return;
      try {
        this.ambience.master.gain.setTargetAtTime(this.getAmbienceGain(), this.ctx.currentTime, 0.4);
      } catch (_) {}
    }

    setMusicEnabled(enabled) {
      this.bgMusicEnabled = Boolean(enabled);
      if (this.bgMusicEnabled) {
        this.startAmbience();
      } else {
        this.stopAmbience();
      }
    }

    setMusicVolume(volume) {
      const value = Math.max(0, Math.min(1, Number(volume)));
      if (!Number.isFinite(value)) return;
      this.bgBaseVolume = value;
      try {
        localStorage.setItem('prayer_music_vol', String(value));
      } catch (_) {}
      this.refreshAmbienceGain();
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

      if (!this.ttsEnabled) {
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
      if (last && now - last < 12000) {
        if (onStart) onStart();
        if (onEnd) setTimeout(onEnd, 3200);
        return;
      }
      this.recentSpoken.set(clean, now);
      if (this.recentSpoken.size > 60) {
        this.recentSpoken.delete(this.recentSpoken.keys().next().value);
      }

      if (this.ttsQueue.length >= this.maxQueue) {
        const dropped = this.ttsQueue.shift();
        if (dropped?.onEnd) dropped.onEnd();
      }

      const item = {
        id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: clean,
        lang: options.lang || this.ttsLanguage || 'en',
        voice: options.voice || this.ttsVoice || undefined,
        rate: Number(options.rate || this.ttsRate || 1.0),
        url: options.url || null,
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
      this.refreshAmbienceGain();
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
          this.refreshAmbienceGain();
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
