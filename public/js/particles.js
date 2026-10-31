/**
 * PrayerParticleEngine
 * A low-CPU canvas layer for Christian Prayer Live.
 *
 * - Ambient golden dust and soft rising light around the cross.
 * - Gold sparkle bursts for likes, prayer candles and gifts.
 * - Expanding light rings for AMEN moments.
 * - Locked to 30 FPS and paused when the tab is hidden (OBS safe).
 * - All sprites are pre-rendered once, so the frame loop only draws images.
 */
(function () {
  'use strict';

  class PrayerParticleEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      this.width = 1080;
      this.height = 1920;
      this.canvas.width = this.width;
      this.canvas.height = this.height;

      this.goldDust = [];
      this.lightMotes = [];
      this.burstParticles = [];
      this.rings = [];
      this.floatingTexts = [];
      this.time = 0;
      this.lastFrameTime = 0;
      this.frameInterval = 1000 / 30;
      this.reducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

      this.buildSprites();
      this.seedAmbient();
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
    }

    buildSprites() {
      this.sparkSprite = this.createRadialSprite(24, [
        [0, 'rgba(255, 248, 219, 1)'],
        [0.35, 'rgba(247, 224, 164, 0.72)'],
        [0.7, 'rgba(232, 200, 122, 0.22)'],
        [1, 'rgba(232, 200, 122, 0)']
      ]);

      this.moteSprite = this.createRadialSprite(64, [
        [0, 'rgba(255, 247, 222, 0.55)'],
        [0.4, 'rgba(240, 218, 164, 0.22)'],
        [1, 'rgba(232, 200, 122, 0)']
      ]);
    }

    createRadialSprite(size, stops) {
      const sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const ctx = sprite.getContext('2d');
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      return sprite;
    }

    seedAmbient() {
      const dustCount = this.reducedMotion ? 10 : 26;
      for (let i = 0; i < dustCount; i++) {
        this.goldDust.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          size: 6 + Math.random() * 10,
          vy: -(0.25 + Math.random() * 0.5),
          vx: (Math.random() - 0.5) * 0.25,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.18 + Math.random() * 0.38
        });
      }
      const moteCount = this.reducedMotion ? 5 : 12;
      for (let i = 0; i < moteCount; i++) {
        this.lightMotes.push({
          x: Math.random() * this.width,
          y: 300 + Math.random() * 900,
          size: 30 + Math.random() * 60,
          vy: -(0.35 + Math.random() * 0.7),
          drift: (Math.random() - 0.5) * 0.35,
          alpha: 0.12 + Math.random() * 0.2,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    /** Soft golden particles around the cross for likes. */
    spawnLikeBurst(x = 540, y = 470, count = 20) {
      const total = this.reducedMotion ? Math.min(6, count) : count;
      for (let i = 0; i < total; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 3.2;
        this.burstParticles.push({
          x: x + (Math.random() - 0.5) * 160,
          y: y + (Math.random() - 0.5) * 210,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.1,
          size: 10 + Math.random() * 20,
          alpha: 0.35 + Math.random() * 0.5,
          decay: 0.008 + Math.random() * 0.012,
          gravity: -0.012,
          sprite: this.sparkSprite
        });
      }
    }

    spawnAmenWave(x = 540, y = 460, count = 3) {
      for (let i = 0; i < count; i++) {
        this.rings.push({
          x,
          y,
          radius: 70 + i * 40,
          maxRadius: 420 + i * 110,
          alpha: 0.5 - i * 0.1,
          lineWidth: 2.6 - i * 0.5
        });
      }
    }

    spawnPrayerCandle(x = 900, y = 880) {
      for (let i = 0; i < 10; i++) {
        this.burstParticles.push({
          x: x + (Math.random() - 0.5) * 90,
          y,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.7 + Math.random() * 1.2),
          size: 8 + Math.random() * 14,
          alpha: 0.4 + Math.random() * 0.4,
          decay: 0.006,
          gravity: -0.004,
          sprite: this.sparkSprite
        });
      }
      this.rings.push({
        x,
        y,
        radius: 24,
        maxRadius: 170,
        alpha: 0.3,
        lineWidth: 1.4
      });
    }

    spawnBlessing() {
      for (let i = 0; i < 26; i++) {
        this.burstParticles.push({
          x: Math.random() * this.width,
          y: -20 - Math.random() * 120,
          vx: (Math.random() - 0.5) * 0.6,
          vy: 0.7 + Math.random() * 1.4,
          size: 10 + Math.random() * 16,
          alpha: 0.25 + Math.random() * 0.45,
          decay: 0.0025,
          gravity: 0.004,
          sprite: this.sparkSprite
        });
      }
    }

    spawnCelebration() {
      for (let i = 0; i < 64; i++) {
        const angle = (Math.PI * 2 * i) / 64;
        const speed = 2 + Math.random() * 5.5;
        this.burstParticles.push({
          x: 540,
          y: 470,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 10 + Math.random() * 20,
          alpha: 0.5 + Math.random() * 0.5,
          decay: 0.006 + Math.random() * 0.006,
          gravity: 0.02,
          sprite: this.sparkSprite
        });
      }
      this.rings.push({ x: 540, y: 460, radius: 90, maxRadius: 560, alpha: 0.45, lineWidth: 3 });
      this.rings.push({ x: 540, y: 460, radius: 60, maxRadius: 420, alpha: 0.3, lineWidth: 2 });
    }

    spawnFloatingText(text, x = 540, y = 700, colour = '#f7e6b8') {
      if (this.floatingTexts.length > 6) this.floatingTexts.shift();
      this.floatingTexts.push({
        text: String(text || ''),
        x,
        y,
        vy: -1.15,
        alpha: 1,
        colour
      });
    }

    animate(timestamp) {
      requestAnimationFrame(this.animate);
      if (document.hidden) return;
      if (timestamp - this.lastFrameTime < this.frameInterval) return;
      this.lastFrameTime = timestamp;
      this.time += 0.03;

      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Ambient golden dust
      for (const dust of this.goldDust) {
        dust.y += dust.vy;
        dust.x += dust.vx + Math.sin(this.time + dust.phase) * 0.22;
        if (dust.y < -30) {
          dust.y = this.height + 20;
          dust.x = Math.random() * this.width;
        }
        const twinkle = 0.6 + 0.4 * Math.sin(this.time * 1.6 + dust.phase);
        ctx.globalAlpha = dust.alpha * twinkle;
        ctx.drawImage(this.sparkSprite, dust.x - dust.size / 2, dust.y - dust.size / 2, dust.size, dust.size);
      }

      // Large soft light motes
      for (const mote of this.lightMotes) {
        mote.y += mote.vy;
        mote.x += mote.drift + Math.sin(this.time * 0.7 + mote.phase) * 0.4;
        if (mote.y < 220) {
          mote.y = 1420;
          mote.x = Math.random() * this.width;
        }
        const pulse = 0.65 + 0.35 * Math.sin(this.time * 1.1 + mote.phase);
        ctx.globalAlpha = mote.alpha * pulse;
        ctx.drawImage(this.moteSprite, mote.x - mote.size / 2, mote.y - mote.size / 2, mote.size, mote.size);
      }

      // Expanding rings
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const ring = this.rings[i];
        ring.radius += 3.4;
        ring.alpha *= 0.972;
        if (ring.radius >= ring.maxRadius || ring.alpha < 0.02) {
          this.rings.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = ring.alpha;
        ctx.strokeStyle = '#f3dea8';
        ctx.lineWidth = ring.lineWidth;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Sparkle bursts
      for (let i = this.burstParticles.length - 1; i >= 0; i--) {
        const particle = this.burstParticles[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += particle.gravity;
        particle.alpha -= particle.decay;
        if (particle.alpha <= 0 || particle.y < -60 || particle.y > this.height + 60) {
          this.burstParticles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, particle.alpha);
        ctx.drawImage(
          particle.sprite,
          particle.x - particle.size / 2,
          particle.y - particle.size / 2,
          particle.size,
          particle.size
        );
      }

      // Floating text
      if (this.floatingTexts.length > 0) {
        ctx.font = '600 27px "Palatino Linotype", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(6, 12, 22, 0.85)';
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
          const item = this.floatingTexts[i];
          item.y += item.vy;
          item.alpha -= 0.011;
          if (item.alpha <= 0) {
            this.floatingTexts.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = Math.max(0, item.alpha);
          ctx.strokeText(item.text, item.x, item.y);
          ctx.fillStyle = item.colour;
          ctx.fillText(item.text, item.x, item.y);
        }
      }

      ctx.globalAlpha = 1;
    }
  }

  window.PrayerParticleEngine = PrayerParticleEngine;
  // Legacy name kept so any existing OBS page keeps loading.
  window.TempleParticleEngine = PrayerParticleEngine;
})();
