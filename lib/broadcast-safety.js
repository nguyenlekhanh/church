/**
 * CHRISTIAN PRAYER LIVE — COPYRIGHT SAFE BROADCAST MODE
 *
 * One eligibility decision shared by background rotation, music playback and
 * the admin dashboard. The copyright manifest is the only source of truth.
 * Nothing in this module changes an asset's status or its original manifest.
 *
 * Safe mode is ON by default. When it is on, an asset is selectable only when:
 *  - it has a matching entry in config/copyright-manifest.json
 *  - the entry's status is VERIFIED
 *  - the entry is an active broadcast asset (not documentation/legacy)
 *  - commercial, livestream, TikTok and OBS permissions start with "Allowed"
 *  - the local file still exists
 *
 * A missing manifest entry is blocked, never inferred from a filename or folder.
 */

const fs = require('fs');
const path = require('path');

const STATUS = 'VERIFIED';
const IMAGE_PREFIX = '/assets/christian/';
const MUSIC_PREFIX = '/assets/christian/audio/';

function normalizeImage(key) {
  const value = String(key || '').replace(/\\/g, '/').trim();
  if (!value || /^https?:\/\//i.test(value)) return '';
  if (value.startsWith('public/assets/')) return value;
  if (value.startsWith(IMAGE_PREFIX)) return `public${value}`;
  if (value.startsWith('assets/christian/')) return `public/${value}`;
  if (value.startsWith('/')) return '';
  return `public/assets/christian/${value}`;
}

function normalizeMusic(key) {
  const value = String(key || '').replace(/\\/g, '/').trim();
  if (!value || /^https?:\/\//i.test(value)) return '';
  if (value.startsWith('public/assets/')) return value;
  if (value.startsWith(MUSIC_PREFIX)) return `public${value}`;
  if (value.startsWith('assets/christian/audio/')) return `public/${value}`;
  return `public/assets/christian/audio/${path.basename(value)}`;
}

function allowed(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.startsWith('allowed') && !text.includes('unverified') && !text.includes('not permitted');
}

function installHint(manifestPath) {
  return `No copyright manifest entry for this asset. Add it through the audit workflow before broadcast.`;
}

class BroadcastSafety {
  constructor(options = {}) {
    this.root = path.resolve(options.root || path.join(__dirname, '..'));
    this.manifestPath = path.resolve(
      options.manifestPath || path.join(this.root, 'config', 'copyright-manifest.json')
    );
    this._cache = null;
    this._cacheKey = '';
  }

  load() {
    try {
      const stat = fs.statSync(this.manifestPath);
      const key = `${stat.mtimeMs}:${stat.size}`;
      if (this._cache && key === this._cacheKey) return this._cache;
      const data = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      const assets = Array.isArray(data.assets) ? data.assets : [];
      this._cache = {
        available: true,
        generatedAt: data.generatedAt || null,
        assets,
        byFile: new Map(assets.map((asset) => [String(asset.file || '').replace(/\\/g, '/'), asset]))
      };
      this._cacheKey = key;
      return this._cache;
    } catch (error) {
      this._cache = {
        available: false,
        error: error.message,
        assets: [],
        byFile: new Map()
      };
      this._cacheKey = '';
      return this._cache;
    }
  }

  _entry(kind, key) {
    const manifest = this.load();
    const file = kind === 'music' ? normalizeMusic(key) : normalizeImage(key);
    if (!file) return { manifest, file: '', entry: null };
    return { manifest, file, entry: manifest.byFile.get(file) || null };
  }

  _evaluate(kind, key, safeMode = true) {
    const { manifest, file, entry } = this._entry(kind, key);
    const base = {
      eligible: false,
      selectable: false,
      status: 'UNKNOWN',
      reason: '',
      file,
      asset: entry ? {
        id: entry.id,
        title: entry.title,
        artist: entry.artist,
        license: entry.license,
        licenseUrl: entry.licenseUrl,
        sourceUrl: entry.sourceUrl,
        attribution: entry.attribution,
        attributionRequired: entry.attributionRequired,
        usage: entry.usage,
        kind: entry.kind
      } : null
    };

    if (!manifest.available) {
      return {
        ...base,
        reason: `Copyright manifest unavailable: ${manifest.error || 'unknown error'}`,
        selectable: !safeMode
      };
    }
    if (!file) {
      return { ...base, reason: 'No usable local asset path', selectable: !safeMode };
    }
    if (!entry) {
      return { ...base, reason: installHint(this.manifestPath), selectable: !safeMode };
    }

    base.status = entry.status || 'UNKNOWN';
    base.asset = {
      ...base.asset,
      status: entry.status,
      commercial: entry.commercial,
      livestream: entry.livestream,
      tiktok: entry.tiktok,
      obs: entry.obs,
      file: entry.file
    };

    if (entry.kind && entry.kind !== kind) {
      base.reason = `Manifest kind is ${entry.kind}, expected ${kind}`;
      return { ...base, selectable: !safeMode };
    }
    if (entry.usage !== 'broadcast') {
      base.reason = `Not an active broadcast asset (usage: ${entry.usage || 'unknown'})`;
      return { ...base, selectable: !safeMode };
    }
    if (entry.status !== STATUS) {
      base.reason = `Copyright status is ${entry.status || 'UNKNOWN'}, not VERIFIED`;
      return { ...base, selectable: !safeMode };
    }
    const permissionFields = ['commercial', 'livestream', 'tiktok', 'obs'];
    const denied = permissionFields.find((field) => !allowed(entry[field]));
    if (denied) {
      base.reason = `${denied} permission is not allowed: ${entry[denied] || 'missing'}`;
      return { ...base, selectable: !safeMode };
    }
    const fullPath = path.join(this.root, entry.file);
    if (!fs.existsSync(fullPath)) {
      base.reason = `Asset file is missing: ${entry.file}`;
      return { ...base, selectable: !safeMode };
    }

    return {
      ...base,
      eligible: true,
      selectable: true,
      reason: safeMode ? 'Eligible: VERIFIED and all broadcast permissions are allowed.' : 'Eligible: VERIFIED; Copyright Safe Mode is off.'
    };
  }

  image(url, options = {}) {
    return this._evaluate('image', url, options.safeMode !== false);
  }

  music(file, options = {}) {
    return this._evaluate('music', file, options.safeMode !== false);
  }

  /** Adds a `copyright` decision to every image without mutating the source array. */
  annotateImages(images, safeMode = true) {
    return (Array.isArray(images) ? images : []).map((image) => ({
      ...image,
      copyright: this.image(image.url || image.path || image.file, { safeMode })
    }));
  }

  /** Adds a `copyright` decision to every track without mutating the source array. */
  annotateMusic(tracks, safeMode = true) {
    return (Array.isArray(tracks) ? tracks : []).map((track) => ({
      ...track,
      copyright: this.music(track.file || track.url, { safeMode })
    }));
  }

  imagePool(images, safeMode = true) {
    const annotated = this.annotateImages(images, safeMode);
    return {
      all: annotated,
      selectable: annotated.filter((image) => image.copyright.selectable),
      blocked: annotated.filter((image) => !image.copyright.eligible)
    };
  }

  musicPool(tracks, safeMode = true) {
    const annotated = this.annotateMusic(tracks, safeMode);
    return {
      all: annotated,
      selectable: annotated.filter((track) => track.copyright.selectable),
      blocked: annotated.filter((track) => !track.copyright.eligible)
    };
  }

  _credit(item) {
    const asset = item.copyright?.asset || {};
    return {
      id: item.id || asset.id,
      title: item.title || asset.title || item.file,
      artist: item.artist || asset.artist || 'Unknown',
      license: item.license || asset.license || 'Unknown',
      sourceUrl: item.sourceUrl || asset.sourceUrl || '',
      attribution: item.attribution || asset.attribution || '',
      attributionRequired: Boolean(item.attributionRequired || asset.attributionRequired)
    };
  }

  summary(images, tracks, safeMode = true) {
    const imagePool = this.imagePool(images, safeMode);
    const musicPool = this.musicPool(tracks, safeMode);
    const eligible = [
      ...imagePool.selectable.map((image) => ({ ...image, kind: 'image' })),
      ...musicPool.selectable.map((track) => ({ ...track, kind: 'music' }))
    ];
    const blocked = [
      ...imagePool.blocked.map((image) => ({ ...image, kind: 'image' })),
      ...musicPool.blocked.map((track) => ({ ...track, kind: 'music' }))
    ];
    const imagesEligible = imagePool.selectable.length;
    const musicEligible = musicPool.selectable.length;
    const imagesBlocked = imagePool.blocked.length;
    const musicBlocked = musicPool.blocked.length;
    const attribution = eligible
      .map((item) => this._credit(item))
      .filter((credit) => credit.attributionRequired);
    return {
      available: this.load().available,
      generatedAt: this.load().generatedAt,
      safeMode: safeMode !== false,
      counts: {
        images: imagePool.all.length,
        music: musicPool.all.length,
        total: imagePool.all.length + musicPool.all.length,
        imageEligible: imagesEligible,
        musicEligible,
        eligible: imagesEligible + musicEligible,
        imageBlocked: imagesBlocked,
        musicBlocked,
        blocked: imagesBlocked + musicBlocked,
        imageSelectable: imagePool.selectable.length,
        musicSelectable: musicPool.selectable.length,
        selectable: imagePool.selectable.length + musicPool.selectable.length
      },
      blocked: blocked.map((item) => ({
        kind: item.kind,
        id: item.id,
        title: item.title || item.file,
        file: item.copyright?.file || item.file || item.path || item.url || '',
        url: item.url || '',
        status: item.copyright.status,
        reason: item.copyright.reason,
        manualReview: item.copyright.status !== 'VERIFIED' ? 'Required' : 'Cleared'
      })),
      attribution
    };
  }
}

module.exports = {
  BroadcastSafety,
  normalizeImage,
  normalizeMusic,
  allowed
};
