/**
 * Christian Prayer Live — music file integrity scanner.
 *
 * Read-only. It never deletes or rewrites audio, and it never writes outside the
 * configured audio directory. The result tells the dashboard which manifest
 * entries point at missing or unreadable files, which files are not valid audio,
 * and which files on disk are not referenced by the manifest (orphans).
 */
const fs = require('fs');
const path = require('path');
const { AUDIO_EXTENSIONS } = require('./music-library');

const MAGIC_SNIFF_BYTES = 12;

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Best-effort container check. Returns a label when the header is recognisable. */
function sniffAudio(filePath) {
  let handle = null;
  try {
    handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(MAGIC_SNIFF_BYTES);
    const bytes = fs.readSync(handle, buffer, 0, MAGIC_SNIFF_BYTES, 0);
    if (bytes < 4) return null;
    const head = buffer.subarray(0, bytes);
    if (head.toString('ascii', 0, 3) === 'ID3') return 'MP3';
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return 'MP3';
    if (head.toString('ascii', 0, 4) === 'OggS') return 'Ogg';
    if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') return 'WAV';
    if (head.toString('ascii', 0, 4) === 'fLaC') return 'FLAC';
    if (head.toString('ascii', 4, 8) === 'ftyp') return 'M4A';
    return null;
  } catch (_) {
    return null;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch (_) {}
    }
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

class MusicIntegrity {
  constructor(options = {}) {
    this.dir = options.dir || path.join(__dirname, '..', 'public', 'assets', 'christian', 'audio');
    this.manifestPath = options.manifestPath || path.join(this.dir, 'music-manifest.json');
    this.startedAt = null;
    this.lastReport = null;
  }

  readManifest() {
    const raw = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
    return { raw, tracks };
  }

  listAudioFiles() {
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }

  /** The last full report, or a fresh scan when none has run yet. */
  report() {
    return this.lastReport || this.scan();
  }

  scan() {
    const startedAt = Date.now();
    const report = {
      checkedAt: new Date().toISOString(),
      directory: 'public/assets/christian/audio',
      entries: 0,
      presentCount: 0,
      missingCount: 0,
      pathViolations: [],
      unreadable: [],
      invalidFormat: [],
      missing: [],
      orphans: [],
      duplicates: [],
      referencedBytes: 0,
      totalFilesOnDisk: 0,
      errors: []
    };

    let manifest;
    try {
      manifest = this.readManifest();
    } catch (err) {
      report.errors.push(`Manifest could not be read: ${err.message}`);
      return report;
    }

    let filesOnDisk = [];
    try {
      filesOnDisk = this.listAudioFiles();
      report.totalFilesOnDisk = filesOnDisk.length;
    } catch (err) {
      report.errors.push(`Audio directory could not be read: ${err.message}`);
    }

    const seen = new Map();
    for (const track of manifest.tracks) {
      report.entries += 1;
      const file = String(track.file || '');
      const id = String(track.id || file);
      if (seen.has(id)) {
        report.duplicates.push({ id, files: [seen.get(id), file] });
      } else {
        seen.set(id, file);
      }

      const full = path.resolve(this.dir, file);
      if (!file || !isInside(this.dir, full)) {
        report.pathViolations.push({ id, file, reason: 'Path escapes the audio directory' });
        continue;
      }
      if (!fs.existsSync(full)) {
        report.missing.push({
          id,
          title: track.title || id,
          file,
          expectedBytes: track.bytes || null
        });
        continue;
      }

      let stats;
      try {
        stats = fs.statSync(full);
        fs.accessSync(full, fs.constants.R_OK);
      } catch (err) {
        report.unreadable.push({ id, file, reason: err.message });
        continue;
      }
      if (!stats.isFile()) {
        report.unreadable.push({ id, file, reason: 'Not a regular file' });
        continue;
      }
      if (stats.size <= 512) {
        report.invalidFormat.push({ id, file, reason: `File is only ${stats.size} bytes`, format: null });
        continue;
      }
      const declared = path.extname(full).toLowerCase();
      const sniffed = sniffAudio(full);
      if (!sniffed) {
        report.invalidFormat.push({ id, file, reason: 'Unrecognised audio container', format: null });
        continue;
      }
      report.presentCount += 1;
      report.referencedBytes += stats.size;
    }

    const referenced = new Set();
    for (const track of manifest.tracks) {
      const file = path.resolve(this.dir, String(track.file || ''));
      if (isInside(this.dir, file)) referenced.add(path.basename(file));
    }
    for (const name of filesOnDisk) {
      if (!referenced.has(name)) {
        const full = path.join(this.dir, name);
        let bytes = null;
        try {
          bytes = fs.statSync(full).size;
        } catch (_) {}
        report.orphans.push({ file: name, bytes, label: formatBytes(bytes) });
      }
    }

    report.missingCount = report.missing.length + report.pathViolations.length;
    report.durationMs = Date.now() - startedAt;
    report.healthy = report.missingCount === 0
      && report.unreadable.length === 0
      && report.invalidFormat.length === 0
      && report.errors.length === 0;
    report.summary = report.healthy
      ? `${report.presentCount} files healthy${report.orphans.length ? ` · ${report.orphans.length} unused` : ''}`
      : `${report.missingCount} missing · ${report.unreadable.length} unreadable · ${report.invalidFormat.length} invalid`;

    this.lastReport = report;
    this.startedAt = report.checkedAt;
    return report;
  }

  summary() {
    const report = this.lastReport || this.scan();
    return {
      checkedAt: report.checkedAt,
      healthy: report.healthy,
      summary: report.summary,
      entries: report.entries,
      presentCount: report.presentCount,
      missingCount: report.missingCount,
      unreadableCount: report.unreadable.length,
      invalidCount: report.invalidFormat.length,
      orphanCount: report.orphans.length,
      totalFilesOnDisk: report.totalFilesOnDisk
    };
  }
}

module.exports = { MusicIntegrity, sniffAudio, isInside };
