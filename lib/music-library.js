/**
 * Christian Prayer Live — local music library manager.
 *
 * The audio folder is the source of truth: this module scans it, keeps
 * `music-manifest.json` in sync (atomically, with a rolling backup) and reports
 * what changed so the dashboard can refresh without a restart.
 *
 * Safety rules:
 *  - only the configured audio directory is ever read or written
 *  - only known audio extensions are accepted
 *  - the browser never sends a filesystem path, only a track id
 *  - audio files are never executed; metadata comes from ffprobe when available
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const AUDIO_EXTENSIONS = new Map([
  ['.mp3', 'MP3'],
  ['.wav', 'WAV'],
  ['.ogg', 'Ogg'],
  ['.oga', 'Ogg'],
  ['.m4a', 'M4A'],
  ['.flac', 'FLAC']
]);

const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'for', 'to', 'at', 'by', 'with', 'my', 'your']);

const CATEGORY_HINTS = [
  [/piano|keys/i, 'Piano'],
  [/string|violin|cello|viola/i, 'Strings'],
  [/guitar|acoustic|harp/i, 'Guitar'],
  [/pad|ambient|atmos|drone|meditat|calm|peace/i, 'Ambient'],
  [/organ|choir|hymn|worship|praise|gospel/i, 'Worship'],
  [/night|evening|moon|star/i, 'Night'],
  [/morning|sunrise|dawn|day/i, 'Morning'],
  [/cinematic|orchestr|film|score/i, 'Cinematic']
];

const UNKNOWN_LICENSE = 'Unknown — verify the license before publishing';
const UNKNOWN_SOURCE = 'Local file (added outside the catalog)';

function friendlyTitle(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '')
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/[._]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'Untitled track';
  return base.split(' ').map((word, index) => {
    if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function slugify(value) {
  const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'track';
}

function inferCategory(fileName, title) {
  const haystack = `${fileName} ${title}`;
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(haystack)) return category;
  }
  return 'Uncategorized';
}

function clampText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function probeFile(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate:stream=codec_name,sample_rate,channels',
      '-of', 'json',
      file
    ], { timeout: 12000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const parsed = JSON.parse(stdout);
        const format = parsed.format || {};
        const stream = (parsed.streams || [])[0] || {};
        const duration = Number(format.duration);
        const bitrate = Number(format.bit_rate) || Number(stream.bit_rate) || 0;
        const rate = Number(stream.sample_rate) || 0;
        const channels = Number(stream.channels) || 0;
        const parts = [];
        const codec = String(stream.codec_name || '').trim();
        if (codec) parts.push(codec.toUpperCase());
        if (bitrate) parts.push(`${Math.round(bitrate / 1000)} kb/s`);
        if (rate) parts.push(`${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`);
        if (channels === 2) parts.push('stereo');
        else if (channels === 1) parts.push('mono');
        resolve({
          durationSeconds: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : null,
          format: parts.join(' · ')
        });
      } catch (_) {
        resolve(null);
      }
    });
  });
}

class MusicLibrary {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || 'public/assets/christian/audio');
    this.manifestPath = path.resolve(options.manifestPath || path.join(this.dir, 'music-manifest.json'));
    this.backupPath = path.resolve(options.backupPath || path.join(this.dir, 'music-manifest.backup.json'));
    this.removedDir = path.resolve(options.removedDir || path.join('docs', 'backups', 'music-removed'));
    this.publicUrl = String(options.publicUrl || '/assets/christian/audio').replace(/\/+$/, '');
    this.logger = options.logger || console;
    this.defaultVolume = Number(options.defaultVolume) || 0.1;
    this.duckedVolume = Number(options.duckedVolume) || 0.035;
    this.scanPromise = null;
    this.lastScanAt = null;
  }

  isInsideDir(target) {
    const resolved = path.resolve(target);
    return resolved === this.dir || resolved.startsWith(this.dir + path.sep);
  }

  /** Absolute path for a manifest entry, or null when it would escape the folder. */
  resolveFile(fileName) {
    const safe = path.basename(String(fileName || ''));
    if (!safe || !AUDIO_EXTENSIONS.has(path.extname(safe).toLowerCase())) return null;
    const target = path.join(this.dir, safe);
    return this.isInsideDir(target) ? target : null;
  }

  readManifest() {
    try {
      if (!fs.existsSync(this.manifestPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.tracks)) return null;
      return parsed;
    } catch (err) {
      this.logger.warn(`[Music] Could not read music manifest (${err.message})`);
      return null;
    }
  }

  emptyManifest() {
    return {
      description: 'Ambient worship instrumentals for Christian Prayer Live.',
      generatedBy: 'lib/music-library.js',
      defaultVolume: this.defaultVolume,
      duckedVolume: this.duckedVolume,
      tracks: []
    };
  }

  /** Atomic write: previous manifest is preserved as music-manifest.backup.json. */
  saveManifest(manifest) {
    manifest.defaultVolume = Number(manifest.defaultVolume) || this.defaultVolume;
    manifest.duckedVolume = Number(manifest.duckedVolume) || this.duckedVolume;
    manifest.updatedAt = new Date().toISOString();
    const payload = `${JSON.stringify(manifest, null, 2)}\n`;
    const temp = path.join(this.dir, `.music-manifest.${process.pid}.${Date.now()}.tmp`);
    if (fs.existsSync(this.manifestPath)) {
      try {
        fs.copyFileSync(this.manifestPath, this.backupPath);
      } catch (err) {
        this.logger.warn(`[Music] Could not write manifest backup (${err.message})`);
      }
    }
    fs.writeFileSync(temp, payload, 'utf8');
    fs.renameSync(temp, this.manifestPath);
  }

  listAudioFiles() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }

  enrich(entry, index) {
    const file = path.basename(entry.file);
    const full = path.join(this.dir, file);
    let bytes = Number(entry.bytes) || 0;
    try {
      bytes = fs.statSync(full).size;
    } catch (_) {}
    return {
      id: entry.id,
      title: entry.title || friendlyTitle(file),
      file,
      url: `${this.publicUrl}/${encodeURIComponent(file)}`,
      category: entry.category || inferCategory(file, entry.title || ''),
      artist: entry.artist || '',
      mood: entry.mood || '',
      bpm: Number.isFinite(Number(entry.bpm)) && Number(entry.bpm) > 0 ? Number(entry.bpm) : null,
      durationSeconds: Number.isFinite(Number(entry.durationSeconds)) && Number(entry.durationSeconds) > 0
        ? Number(entry.durationSeconds)
        : null,
      format: entry.format || AUDIO_EXTENSIONS.get(path.extname(file).toLowerCase()) || '',
      bytes: bytes || null,
      license: entry.license || UNKNOWN_LICENSE,
      licenseNote: entry.licenseNote || '',
      source: entry.source || UNKNOWN_SOURCE,
      sourceUrl: entry.sourceUrl || '',
      catalogUrl: entry.catalogUrl || '',
      attribution: entry.attribution || '',
      titleSource: entry.titleSource === 'custom' ? 'custom' : 'filename',
      enabled: entry.enabled !== false,
      addedAt: entry.addedAt || null,
      index
    };
  }

  buildCatalog(manifest) {
    const source = manifest || this.emptyManifest();
    const allTracks = [];
    (source.tracks || []).forEach((entry) => {
      if (!entry || !entry.file) return;
      const full = this.resolveFile(entry.file);
      if (!full || !fs.existsSync(full)) return;
      allTracks.push(this.enrich(entry, allTracks.length));
    });
    const tracks = allTracks.filter((track) => track.enabled);
    const categories = Array.from(new Set(allTracks.map((track) => track.category).filter(Boolean))).sort();
    const totalDurationSeconds = tracks.reduce((sum, track) => sum + (track.durationSeconds || 0), 0);
    return {
      tracks,
      allTracks,
      byId: new Map(tracks.map((track) => [track.id, track])),
      libraryById: new Map(allTracks.map((track) => [track.id, track])),
      manifest: source,
      categories,
      totalDurationSeconds: Math.round(totalDurationSeconds),
      libraryMeta: {
        directory: path.relative(process.cwd(), this.dir).split(path.sep).join('/'),
        total: allTracks.length,
        enabled: tracks.length,
        disabled: allTracks.length - tracks.length,
        totalDurationSeconds: Math.round(totalDurationSeconds),
        allDurationSeconds: Math.round(allTracks.reduce((sum, track) => sum + (track.durationSeconds || 0), 0)),
        categories,
        scannedAt: this.lastScanAt,
        backupFile: path.relative(process.cwd(), this.backupPath).split(path.sep).join('/')
      }
    };
  }

  /** Synchronous catalog read used at boot; missing files are simply skipped. */
  readCatalog() {
    return this.buildCatalog(this.readManifest() || this.emptyManifest());
  }

  async probeFiles(entries) {
    const results = new Map();
    if (entries.length === 0) return results;
    const queue = entries.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        const full = path.join(this.dir, entry.file);
        const probed = await probeFile(full);
        if (probed) results.set(entry.file, probed);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return results;
  }

  /**
   * Reconcile the manifest with the audio folder.
   * Never runs twice at once; a second call joins the in-flight scan.
   */
  scan({ probe = true } = {}) {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.runScan({ probe }).finally(() => {
      this.scanPromise = null;
    });
    return this.scanPromise;
  }

  async runScan({ probe }) {
    const errors = [];
    if (!fs.existsSync(this.dir)) {
      return {
        found: 0, added: 0, removed: 0, updated: 0, errors: [`Audio directory not found: ${this.dir}`],
        catalog: this.readCatalog(), scannedAt: this.lastScanAt
      };
    }

    const manifest = this.readManifest() || this.emptyManifest();
    const byFile = new Map();
    const usedIds = new Set();
    for (const entry of manifest.tracks) {
      if (!entry || !entry.file) continue;
      const file = path.basename(entry.file);
      if (byFile.has(file)) continue;
      byFile.set(file, { ...entry, file });
      if (entry.id) usedIds.add(entry.id);
    }

    const files = this.listAudioFiles();
    const present = new Set(files);
    const orderedFiles = [];
    const seenFiles = new Set();
    for (const entry of manifest.tracks) {
      if (!entry || !entry.file) continue;
      const file = path.basename(entry.file);
      if (seenFiles.has(file) || !present.has(file)) continue;
      seenFiles.add(file);
      orderedFiles.push(file);
    }
    files.forEach((file) => {
      if (!seenFiles.has(file)) orderedFiles.push(file);
    });

    const removed = [];
    const added = [];
    const updated = [];
    const kept = [];

    const probeTargets = [];
    for (const file of orderedFiles) {
      const existing = byFile.get(file);
      if (!existing && probe) probeTargets.push({ file });
      if (existing && probe) probeTargets.push({ file });
    }
    const probed = probe ? await this.probeFiles(probeTargets) : new Map();

    for (const file of orderedFiles) {
      const ext = path.extname(file).toLowerCase();
      const label = AUDIO_EXTENSIONS.get(ext) || ext.replace('.', '').toUpperCase();
      const existing = byFile.get(file);
      if (existing) {
        const meta = probed.get(file);
        const next = { ...existing };
        let changed = false;
        if (meta && meta.durationSeconds && meta.durationSeconds !== existing.durationSeconds) {
          next.durationSeconds = meta.durationSeconds;
          changed = true;
        }
        if (meta && meta.format && meta.format !== existing.format) {
          next.format = meta.format;
          changed = true;
        }
        if (!next.category) {
          next.category = inferCategory(file, next.title || '');
          changed = true;
        }
        if (!next.license) {
          next.license = UNKNOWN_LICENSE;
          changed = true;
        }
        if (changed) updated.push(next);
        kept.push(next);
        byFile.delete(file);
        continue;
      }

      let id = slugify(path.basename(file, ext));
      if (usedIds.has(id)) {
        let suffix = 2;
        while (usedIds.has(`${id}-${suffix}`)) suffix += 1;
        id = `${id}-${suffix}`;
      }
      usedIds.add(id);
      const title = friendlyTitle(file);
      const meta = probed.get(file);
      const entry = {
        id,
        title,
        file,
        category: inferCategory(file, title),
        artist: '',
        mood: '',
        bpm: null,
        durationSeconds: meta && meta.durationSeconds ? meta.durationSeconds : null,
        format: (meta && meta.format) || label,
        bytes: fs.statSync(path.join(this.dir, file)).size,
        license: UNKNOWN_LICENSE,
        source: UNKNOWN_SOURCE,
        sourceUrl: '',
        attribution: '',
        titleSource: 'filename',
        enabled: true,
        addedAt: new Date().toISOString()
      };
      kept.push(entry);
      added.push(entry);
      errors.push(`New file detected: ${file}. Set its title, category and license before broadcasting.`);
    }

    for (const [file, entry] of byFile) {
      removed.push(entry);
    }

    const changedCount = added.length + removed.length + updated.length;
    const manifestChanged = changedCount > 0 || !fs.existsSync(this.manifestPath);
    const nextManifest = { ...manifest, tracks: kept };
    if (manifestChanged) {
      try {
        this.saveManifest(nextManifest);
      } catch (err) {
        errors.push(`Could not write the music manifest: ${err.message}`);
      }
    }
    this.lastScanAt = new Date().toISOString();

    return {
      found: kept.length,
      added: added.map((entry) => entry.file),
      removed: removed.map((entry) => entry.file),
      updated: updated.map((entry) => entry.file),
      errors,
      addedCount: added.length,
      removedCount: removed.length,
      updatedCount: updated.length,
      catalog: this.buildCatalog({ ...nextManifest, tracks: kept }),
      scannedAt: this.lastScanAt
    };
  }

  /** Persist an editable title, category or enable/disable flag. Never touches the file. */
  updateTrack(id, patch = {}) {
    const trackId = clampText(id, 80);
    const manifest = this.readManifest() || this.emptyManifest();
    const entry = manifest.tracks.find((item) => item && item.id === trackId);
    if (!entry) throw new Error(`Unknown music track: ${trackId || '(empty)'}`);

    if (patch.title !== undefined) {
      const title = clampText(patch.title, 120);
      if (!title) throw new Error('A track title cannot be empty.');
      entry.title = title;
      entry.titleSource = 'custom';
    }
    if (patch.category !== undefined) {
      const category = clampText(patch.category, 40);
      if (!category) throw new Error('A category cannot be empty.');
      entry.category = category;
    }
    if (patch.enabled !== undefined) entry.enabled = Boolean(patch.enabled);

    this.saveManifest(manifest);
    return this.buildCatalog(manifest);
  }

  /** Moves the audio file into the backup folder and drops it from the playlist. */
  removeTrack(id) {
    const trackId = clampText(id, 80);
    const manifest = this.readManifest() || this.emptyManifest();
    const index = manifest.tracks.findIndex((item) => item && item.id === trackId);
    if (index < 0) throw new Error(`Unknown music track: ${trackId || '(empty)'}`);
    const entry = manifest.tracks[index];
    const full = this.resolveFile(entry.file);
    if (!full) throw new Error('Refusing to remove a file outside the audio folder.');
    if (!this.isInsideDir(full)) throw new Error('Refusing to remove a file outside the audio folder.');

    let backupFile = '';
    if (fs.existsSync(full)) {
      fs.mkdirSync(this.removedDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupFile = path.join(this.removedDir, `${stamp}--${path.basename(full)}`);
      fs.renameSync(full, backupFile);
    }
    manifest.tracks.splice(index, 1);
    this.saveManifest(manifest);
    return { id: trackId, file: path.basename(entry.file), backupFile: backupFile ? path.relative(process.cwd(), backupFile).split(path.sep).join('/') : '', catalog: this.buildCatalog(manifest) };
  }
}

module.exports = {
  MusicLibrary,
  AUDIO_EXTENSIONS,
  friendlyTitle,
  slugify,
  inferCategory,
  probeFile
};
