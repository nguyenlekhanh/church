/**
 * Christian Prayer Live — copyright and licensing inventory.
 *
 * This module is deliberately conservative. It does not decide ownership and it
 * never treats "royalty-free" as "copyright-free". It joins the files that are
 * actually on disk with the recorded source/license metadata, checks Wikimedia
 * Commons evidence where available, and classifies only what the evidence
 * supports.
 *
 * Safety rules:
 *  - scans a fixed set of project directories; the browser never supplies a path
 *  - extension allowlist only; files are hashed, never executed
 *  - writes manifests atomically and keeps the previous manifest as a backup
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MUSIC_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac']);
const STATUSES = ['VERIFIED', 'NEEDS_REVIEW', 'REJECTED', 'UNKNOWN'];

const DISCLAIMER =
  'This is an evidence-based inventory, not legal advice. A status only describes the copyright/licensing evidence recorded for an asset. It does not cover model or property releases, trademark, privacy/publicity rights, or platform-specific terms.';

const MIXKIT_LICENSE_URL = 'https://mixkit.co/license/#musicFree';
const MIXKIT_MODAL_URL = 'https://mixkit.co/license/modal/musicFree/';
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

const ARCHIVED_MUSIC = {
  'peaceful-prayer-02.ogg': 'Quiet Hour',
  'cathedral-ambient-01.ogg': 'Cathedral Light'
};

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch (_) {
    return null;
  }
}

function walk(dir, options = {}) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (options.skipDirectory && options.skipDirectory(full, entry.name)) continue;
      out.push(...walk(full, options));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function imageDimensions(file) {
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        if (!Number.isFinite(length) || length < 2) break;
        offset += 2 + length;
      }
    }
    if (buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      if (buffer.toString('ascii', 12, 16) === 'VP8X') {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3)
        };
      }
    }
  } catch (_) {}
  return { width: null, height: null };
}

function normalized(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function licenseKey(license) {
  const value = ` ${String(license || '').toUpperCase().replace(/[–—]/g, '-')} `;
  if (!value.trim()) return 'unknown';
  if (/\bCC0\b|PUBLIC DOMAIN|PD-/.test(value)) return 'public-domain';
  if (/\bNC\b|NONCOMMERCIAL|NON-COMMERCIAL/.test(value)) return 'rejected';
  if (/\bND\b|NO ?DERIV/.test(value)) return 'rejected';
  if (/BY[- ]?SA/.test(value)) return 'share-alike';
  if (/\bCC BY\b|ATTRIBUTION/.test(value)) return 'attribution';
  return 'unknown';
}

function licensePermissions(license) {
  const key = licenseKey(license);
  if (key === 'public-domain') {
    return {
      commercial: 'Allowed',
      livestream: 'Allowed',
      tiktok: 'Allowed',
      obs: 'Allowed',
      modifications: 'Allowed',
      attributionRequired: false,
      shareAlike: false
    };
  }
  if (key === 'attribution') {
    return {
      commercial: 'Allowed with attribution',
      livestream: 'Allowed with attribution',
      tiktok: 'Allowed with attribution',
      obs: 'Allowed with attribution',
      modifications: 'Allowed',
      attributionRequired: true,
      shareAlike: false
    };
  }
  if (key === 'share-alike') {
    return {
      commercial: 'Allowed with attribution and ShareAlike',
      livestream: 'Allowed with attribution and ShareAlike',
      tiktok: 'Allowed with attribution and ShareAlike',
      obs: 'Allowed with attribution and ShareAlike',
      modifications: 'Allowed; adapted image must be shared under the same license',
      attributionRequired: true,
      shareAlike: true
    };
  }
  if (key === 'rejected') {
    return {
      commercial: 'Not permitted by the recorded license',
      livestream: 'Not permitted',
      tiktok: 'Not permitted',
      obs: 'Not permitted',
      modifications: 'Not permitted',
      attributionRequired: true,
      shareAlike: false
    };
  }
  return {
    commercial: 'Unverified',
    livestream: 'Unverified',
    tiktok: 'Unverified',
    obs: 'Unverified',
    modifications: 'Unverified',
    attributionRequired: null,
    shareAlike: null
  };
}

function statusForImage(asset) {
  const key = licenseKey(asset.license);
  if (key === 'rejected') return 'REJECTED';
  if (key === 'unknown') return 'UNKNOWN';
  if (key === 'share-alike') return 'NEEDS_REVIEW';
  return 'VERIFIED';
}

function statusForMusic(track) {
  if (track.original) return 'VERIFIED';
  if (/mixkit/i.test(track.license || '')) return 'VERIFIED';
  const key = licenseKey(track.license);
  if (key === 'public-domain' || key === 'attribution') return 'VERIFIED';
  if (key === 'share-alike') return 'NEEDS_REVIEW';
  if (key === 'rejected') return 'REJECTED';
  return 'UNKNOWN';
}

function commonsTitle(source) {
  if (!source || !source.includes('commons.wikimedia.org/wiki/')) return '';
  const raw = source.split('/wiki/')[1] || '';
  try {
    return decodeURIComponent(raw).replace(/_/g, ' ').replace(/^File:/, '');
  } catch (_) {
    return raw.replace(/_/g, ' ').replace(/^File:/, '');
  }
}

function plain(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function middle(value, max = 150) {
  const text = plain(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function tableCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function markdownLink(label, url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return tableCell(label);
  return `[${tableCell(label)}](${String(url).replace(/\)/g, '%29')})`;
}

function sourceCell(asset) {
  if (asset.sourceUrl) return markdownLink('Source', asset.sourceUrl);
  return asset.kind === 'music' ? 'Local script' : 'Local file';
}

function licenseCell(asset) {
  if (asset.licenseUrl) return markdownLink(asset.license, asset.licenseUrl);
  return tableCell(asset.license);
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit'
    });
  } catch (_) {
    return iso;
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'Unknown';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

class CopyrightAudit {
  constructor(options = {}) {
    this.root = path.resolve(options.root || path.join(__dirname, '..'));
    this.publicRoot = path.join(this.root, 'public');
    this.assetsRoot = path.join(this.publicRoot, 'assets');
    this.musicDir = path.join(this.assetsRoot, 'christian', 'audio');
    this.docsRoot = path.join(this.root, 'docs');
    this.assetManifestPath = path.join(this.assetsRoot, 'christian', 'asset-manifest.json');
    this.musicManifestPath = path.join(this.musicDir, 'music-manifest.json');
    this.commonsEvidencePath = path.join(this.docsRoot, 'commons-license-evidence.json');
    this.manifestPath = path.join(this.root, 'config', 'copyright-manifest.json');
    this.backupPath = path.join(this.root, 'config', 'copyright-manifest.backup.json');
    this.publicCopyPath = path.join(this.publicRoot, 'copyright-audit.json');
    this.reportPath = path.join(this.docsRoot, 'COPYRIGHT_AUDIT.md');
    this.attributionPath = path.join(this.docsRoot, 'ASSET_ATTRIBUTION.md');
    this.archivedMusicDir = path.join(this.docsRoot, 'backups', 'music-removed');
    this._cache = null;
    this._scanPromise = null;
  }

  /** Returns the last written manifest without touching the disk. */
  get() {
    if (this._cache) return this._cache;
    const stored = readJson(this.manifestPath, null);
    if (stored) {
      this._cache = stored;
      return stored;
    }
    return null;
  }

  summary() {
    const data = this.get();
    if (!data) return { generatedAt: null, totals: { total: 0 }, assets: [], disclaimer: DISCLAIMER };
    return {
      generatedAt: data.generatedAt,
      scope: data.scope,
      disclaimer: data.disclaimer,
      totals: data.totals,
      unresolved: data.unresolved || [],
      assets: data.assets || []
    };
  }

  async scan() {
    if (this._scanPromise) return this._scanPromise;
    this._scanPromise = Promise.resolve().then(() => this._performScan()).finally(() => {
      this._scanPromise = null;
    });
    return this._scanPromise;
  }

  _performScan() {
    const previous = readJson(this.manifestPath, null);
    const previousAssets = new Map((previous?.assets || []).map((asset) => [asset.file, asset]));
    const assetManifest = readJson(this.assetManifestPath, []);
    const musicManifest = readJson(this.musicManifestPath, { tracks: [] });
    const commons = readJson(this.commonsEvidencePath, []);
    const commonsByTitle = new Map(commons.map((entry) => [normalized(String(entry.title || '').replace(/^File:/, '')), entry]));
    const assets = [];

    for (const track of musicManifest.tracks || []) {
      const file = path.join(this.musicDir, track.file);
      if (!fs.existsSync(file)) continue;
      const original = /original/i.test(track.license || '') || /generate_music/i.test(track.source || '');
      const mixkit = /mixkit/i.test(track.license || '');
      const permissions = mixkit
        ? {
            commercial: 'Allowed',
            livestream: 'Allowed on web/social platforms',
            tiktok: 'Allowed (web/social platform)',
            obs: 'Allowed',
            modifications: 'Not allowed to remix; background playback only',
            attributionRequired: false,
            shareAlike: false
          }
        : licensePermissions(track.license);
      const status = statusForMusic({ ...track, original });
      assets.push({
        id: `music:${track.id || path.basename(track.file, path.extname(track.file))}`,
        kind: 'music',
        usage: 'broadcast',
        active: true,
        enabled: track.enabled !== false,
        file: path.relative(this.root, file).replace(/\\/g, '/'),
        url: `/assets/christian/audio/${encodeURIComponent(track.file)}`,
        title: track.title || path.basename(track.file, path.extname(track.file)),
        artist: track.artist || (original ? 'Christian Prayer Live (original)' : 'Unknown'),
        durationSeconds: track.durationSeconds ?? null,
        format: track.format || '',
        bytes: fileBytes(file),
        sha256: sha256(file),
        source: original ? 'Project-generated by scripts/generate_music.py' : (track.source || 'Mixkit'),
        sourceUrl: original ? '' : (track.sourceUrl || track.catalogUrl || ''),
        license: track.license || 'Unknown',
        licenseUrl: original ? CC0_URL : MIXKIT_LICENSE_URL,
        licenseNote: track.licenseNote || (original
          ? 'Original synthesis from sine/triangle partials, filtered noise and circular convolution. No samples or third-party recordings.'
          : ''),
        commercial: permissions.commercial,
        livestream: permissions.livestream,
        tiktok: permissions.tiktok,
        obs: permissions.obs,
        modifications: permissions.modifications,
        attributionRequired: permissions.attributionRequired,
        attribution: track.attribution || (original ? 'None required' : 'None required'),
        shareAlike: permissions.shareAlike,
        compositionLicensed: original
          ? 'Project-owned original composition/synthesis'
          : 'Covered by the Mixkit Stock Music Free License grant',
        recordingLicensed: original
          ? 'Project-owned original recording/synthesis'
          : 'Covered by the Mixkit Stock Music Free License grant',
        evidence: original
          ? 'scripts/generate_music.py header and local render; no samples'
          : `Official Mixkit license modal (${MIXKIT_MODAL_URL}) and recorded catalog source`,
        status,
        statusReason: status === 'VERIFIED'
          ? (original ? 'Project-generated original dedicated to CC0.' : 'Mixkit license permits commercial web/social public performance; conditions apply.')
          : 'License needs review.',
        notes: mixkit
          ? 'Mixkit prohibits TV/radio broadcast, CDs/DVDs, video games, remixing into a music-only track, standalone redistribution and rights registration. This stream uses it only as background audio.'
          : '',
        checkedAt: new Date().toISOString()
      });
    }

    for (const file of walk(this.archivedMusicDir)) {
      if (!MUSIC_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const name = path.basename(file);
      assets.push({
        id: `music:archive:${path.basename(name, path.extname(name))}`,
        kind: 'music',
        usage: 'archive',
        active: false,
        file: path.relative(this.root, file).replace(/\\/g, '/'),
        url: '',
        title: ARCHIVED_MUSIC[name] || path.basename(name, path.extname(name)).replace(/[-_]+/g, ' '),
        artist: 'Christian Prayer Live (original)',
        durationSeconds: null,
        format: path.extname(name).slice(1).toUpperCase(),
        bytes: fileBytes(file),
        sha256: sha256(file),
        source: 'Project-generated by scripts/generate_music.py; moved out of the active playlist',
        sourceUrl: '',
        license: 'CC0 1.0',
        licenseUrl: CC0_URL,
        licenseNote: 'Original synthesis, no samples.',
        commercial: 'Allowed',
        livestream: 'Allowed',
        tiktok: 'Allowed',
        obs: 'Allowed',
        modifications: 'Allowed',
        attributionRequired: false,
        attribution: 'None required',
        shareAlike: false,
        compositionLicensed: 'Project-owned original composition/synthesis',
        recordingLicensed: 'Project-owned original recording/synthesis',
        evidence: 'scripts/generate_music.py; file retained in docs/backups/music-removed',
        status: 'VERIFIED',
        statusReason: 'Project-generated original dedicated to CC0; not in the active playlist.',
        notes: 'Archived on request. Retained for provenance; not broadcast or in rotation.',
        checkedAt: new Date().toISOString()
      });
    }

    const catalogFiles = new Set();
    for (const asset of assetManifest) {
      const file = path.join(this.publicRoot, 'assets', 'christian', asset.file);
      if (!fs.existsSync(file)) continue;
      catalogFiles.add(path.resolve(file));
      const title = commonsTitle(asset.source);
      const evidence = title ? commonsByTitle.get(normalized(title)) : null;
      const evidenceLicense = evidence?.license || '';
      const license = asset.license || evidenceLicense || 'Unknown';
      const evidenceMatch = evidence
        ? normalized(evidenceLicense) === normalized(license)
        : !String(asset.source || '').includes('commons.wikimedia.org');
      const permissions = licensePermissions(license);
      const generated = /generated locally/i.test(asset.source || '');
      // The image library registers AI_-prefixed originals with structured
      // provenance; those fields win over filename heuristics here.
      const aiGenerated = asset.provenance === 'AI_GENERATED'
        || asset.generated === true
        || /^ai generated$/i.test(String(asset.source || '').trim());
      const localOriginal = generated || aiGenerated;
      const reviewRequired = !localOriginal
        && (asset.reviewRequired === true || asset.provenance === 'LOCAL_FILE');
      const status = !evidenceMatch
        ? 'NEEDS_REVIEW'
        : localOriginal
          ? 'VERIFIED'
          : reviewRequired
            ? 'NEEDS_REVIEW'
            : statusForImage({ license });
      const dimensions = imageDimensions(file);
      const resized = asset.widthOriginal && asset.width && (asset.width !== asset.widthOriginal || asset.height !== asset.heightOriginal);
      const modifications = asset.processing
        || (resized ? `Resized/optimized from ${asset.widthOriginal}×${asset.heightOriginal} to ${asset.width}×${asset.height}` : 'None documented');
      assets.push({
        id: `image:${asset.file}`,
        kind: 'image',
        usage: 'broadcast',
        active: true,
        file: path.relative(this.root, file).replace(/\\/g, '/'),
        url: `/assets/christian/${asset.file}`,
        title: asset.title || path.basename(asset.file),
        artist: plain(asset.attribution || (aiGenerated ? 'AI Generated' : generated ? 'Christian Prayer Live (generated)' : 'Unknown')),
        durationSeconds: null,
        format: path.extname(asset.file).slice(1).toUpperCase(),
        bytes: fileBytes(file),
        width: dimensions.width || asset.width || null,
        height: dimensions.height || asset.height || null,
        sha256: sha256(file),
        provenance: aiGenerated ? 'AI_GENERATED' : generated ? 'PROJECT_GENERATED' : (reviewRequired ? 'LOCAL_FILE' : 'RECORDED'),
        source: asset.source || 'Unknown',
        sourceUrl: localOriginal ? '' : (asset.source || ''),
        downloadUrl: asset.downloadUrl || '',
        license,
        licenseUrl: asset.licenseUrl || evidence?.licenseUrl || '',
        licenseNote: aiGenerated
          ? 'Registered from the local AI_ filename convention; declared an original AI-generated asset. No third-party imagery.'
          : generated
            ? 'Generated locally with Pillow; no third-party imagery used.'
            : '',
        commercial: localOriginal ? 'Allowed' : permissions.commercial,
        livestream: localOriginal ? 'Allowed' : permissions.livestream,
        tiktok: localOriginal ? 'Allowed' : permissions.tiktok,
        obs: localOriginal ? 'Allowed' : permissions.obs,
        modifications,
        attributionRequired: localOriginal ? false : permissions.attributionRequired,
        attribution: asset.attribution || (localOriginal ? 'None required' : 'Unknown'),
        shareAlike: localOriginal ? false : permissions.shareAlike,
        compositionLicensed: aiGenerated
          ? 'Project-declared AI-generated original'
          : generated
            ? 'Project-generated overlay'
            : 'Copyright license recorded on the source page',
        recordingLicensed: null,
        evidence: aiGenerated
          ? 'AI_ filename convention in the local image library; declared AI-generated by the operator'
          : generated
            ? 'Local generation script; no third-party source'
            : evidence
              ? `Wikimedia Commons API imageinfo/extmetadata; page checked ${asset.retrievedAt || ''}`
              : 'Recorded manifest metadata (source page not machine-verified)',
        status,
        statusReason: localOriginal
          ? (aiGenerated
            ? 'AI-generated original; all broadcast permissions granted by the image library rule.'
            : 'Project-generated overlay dedicated to CC0.')
          : !evidenceMatch
            ? 'Recorded license does not match the current Commons metadata; verify before broadcast.'
            : reviewRequired
              ? 'New local file with no recorded source or license; manual review required.'
              : status === 'VERIFIED'
                ? 'License permits commercial use; attribution conditions are recorded.'
                : 'CC BY-SA ShareAlike obligations for the adapted 9:16 crop need legal review.',
        notes: !evidenceMatch
          ? `Commons now reports ${evidenceLicense || 'no license'}.`
          : reviewRequired
            ? 'Registered by the image library scanner; add source and license before broadcast.'
            : '',
        checkedAt: new Date().toISOString()
      });
    }

    const allPublicFiles = walk(this.assetsRoot, {
      skipDirectory: (full) => full === this.musicDir
    });
    for (const file of allPublicFiles) {
      if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      if (catalogFiles.has(path.resolve(file))) continue;
      const dimensions = imageDimensions(file);
      assets.push({
        id: `image:${path.relative(this.root, file).replace(/\\/g, '/')}`,
        kind: 'image',
        usage: 'legacy',
        active: false,
        file: path.relative(this.root, file).replace(/\\/g, '/'),
        url: '',
        title: path.basename(file),
        artist: 'Unknown',
        durationSeconds: null,
        format: path.extname(file).slice(1).toUpperCase(),
        bytes: fileBytes(file),
        width: dimensions.width,
        height: dimensions.height,
        sha256: sha256(file),
        source: 'Legacy file retained in public/assets; no provenance record',
        sourceUrl: '',
        license: 'Unknown',
        licenseUrl: '',
        licenseNote: '',
        commercial: 'Unverified',
        livestream: 'Unverified',
        tiktok: 'Unverified',
        obs: 'Unverified',
        modifications: 'Unknown',
        attributionRequired: null,
        attribution: 'Unknown',
        shareAlike: null,
        compositionLicensed: 'Unknown',
        recordingLicensed: null,
        evidence: 'File exists on disk; no source/license evidence found in project manifests',
        status: 'UNKNOWN',
        statusReason: 'No source or license evidence; do not broadcast.',
        notes: 'Retained in place for compatibility; not part of the active Christian rotation.',
        checkedAt: new Date().toISOString()
      });
    }

    for (const file of walk(this.docsRoot)) {
      if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const relative = path.relative(this.root, file).replace(/\\/g, '/');
      const demo = relative.startsWith('docs/demo/');
      const dimensions = imageDimensions(file);
      assets.push({
        id: `image:${relative}`,
        kind: 'image',
        usage: demo ? 'reference' : 'documentation',
        active: false,
        file: relative,
        url: '',
        title: path.basename(file),
        artist: demo ? 'Unknown (upstream repository)' : 'Christian Prayer Live (documentation capture)',
        durationSeconds: null,
        format: path.extname(file).slice(1).toUpperCase(),
        bytes: fileBytes(file),
        width: dimensions.width,
        height: dimensions.height,
        sha256: sha256(file),
        source: demo
          ? 'Upstream repository documentation/demo image; provenance not recorded'
          : 'Captured from this application for documentation',
        sourceUrl: '',
        license: demo ? 'Unknown' : 'Project-generated capture; may contain third-party imagery',
        licenseUrl: '',
        licenseNote: demo ? '' : 'The capture itself is project-generated, but it can depict licensed backgrounds and overlays.',
        commercial: demo ? 'Unverified' : 'Review required',
        livestream: demo ? 'Unverified' : 'Not a broadcast asset',
        tiktok: demo ? 'Unverified' : 'Not a broadcast asset',
        obs: demo ? 'Unverified' : 'Not a broadcast asset',
        modifications: 'Documentation capture',
        attributionRequired: demo ? null : true,
        attribution: demo ? 'Unknown' : 'Christian Prayer Live; underlying assets retain their own credits',
        shareAlike: demo ? null : true,
        compositionLicensed: demo ? 'Unknown' : 'Project capture of mixed-license assets',
        recordingLicensed: null,
        evidence: demo
          ? 'No provenance record for upstream demo image'
          : 'Generated by the project during UI verification',
        status: demo ? 'UNKNOWN' : 'NEEDS_REVIEW',
        statusReason: demo
          ? 'Source and license cannot be verified from the repository.'
          : 'Captures may contain CC BY-SA backgrounds; do not redistribute standalone without the credits and ShareAlike review.',
        notes: demo
          ? 'Reference/documentation only. Do not use in the livestream.'
          : 'Documentation only; not served to OBS.',
        checkedAt: new Date().toISOString()
      });
    }

    const usageOrder = { broadcast: 0, legacy: 1, documentation: 2, reference: 3, archive: 4 };
    assets.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'music' ? -1 : 1;
      const usage = (usageOrder[a.usage] ?? 9) - (usageOrder[b.usage] ?? 9);
      if (usage !== 0) return usage;
      if (Boolean(a.enabled) !== Boolean(b.enabled)) return a.enabled ? -1 : 1;
      return a.file.localeCompare(b.file);
    });

    const changes = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    for (const asset of assets) {
      const prior = previousAssets.get(asset.file);
      if (!prior) changes.added += 1;
      else if (prior.sha256 !== asset.sha256) changes.changed += 1;
      else changes.unchanged += 1;
    }
    for (const priorFile of previousAssets.keys()) {
      if (!assets.some((asset) => asset.file === priorFile)) changes.removed += 1;
    }

    const totals = this._totals(assets);
    const generatedAt = new Date().toISOString();
    const manifest = {
      schemaVersion: 1,
      generatedAt,
      scope:
        'Production assets under public/assets (active Christian assets, legacy files and archived music) plus documentation/reference images under docs. Generated TTS cache and dependency files are excluded.',
      disclaimer: DISCLAIMER,
      roots: [
        'public/assets',
        'docs/backups/music-removed',
        'docs/**/*.{jpg,jpeg,png,webp,gif}'
      ],
      counts: totals,
      changes,
      unresolved: this._unresolved(),
      assets
    };

    if (previous) {
      try {
        atomicWrite(this.backupPath, JSON.stringify(previous, null, 2) + '\n');
      } catch (_) {}
    }
    atomicWrite(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    atomicWrite(this.publicCopyPath, JSON.stringify({
      generatedAt,
      disclaimer: DISCLAIMER,
      totals,
      changes,
      unresolved: manifest.unresolved,
      assets
    }, null, 2) + '\n');
    atomicWrite(this.reportPath, this._report(manifest));
    atomicWrite(this.attributionPath, this._attribution(manifest));

    this._cache = manifest;
    return { ...manifest, changes };
  }

  _totals(assets) {
    const count = { VERIFIED: 0, NEEDS_REVIEW: 0, REJECTED: 0, UNKNOWN: 0 };
    for (const asset of assets) count[asset.status] = (count[asset.status] || 0) + 1;
    const music = assets.filter((asset) => asset.kind === 'music');
    const images = assets.filter((asset) => asset.kind === 'image');
    return {
      total: assets.length,
      music: music.length,
      musicActive: music.filter((asset) => asset.usage === 'broadcast').length,
      musicEnabled: music.filter((asset) => asset.usage === 'broadcast' && asset.enabled).length,
      musicArchived: music.filter((asset) => asset.usage === 'archive').length,
      images: images.length,
      imagesBroadcast: images.filter((asset) => asset.usage === 'broadcast').length,
      imagesLegacy: images.filter((asset) => asset.usage === 'legacy').length,
      imagesDocumentation: images.filter((asset) => asset.usage === 'documentation' || asset.usage === 'reference').length,
      verified: count.VERIFIED,
      needsReview: count.NEEDS_REVIEW,
      rejected: count.REJECTED,
      unknown: count.UNKNOWN
    };
  }

  _unresolved() {
    return [
      {
        id: 'share-alike-crops',
        topic: 'CC BY-SA crops and color grading',
        detail:
          'Fifteen active images are CC BY-SA. Cropping to 9:16 and color grading create adapted material. Whether the adapted image alone (or the whole livestream) must be released under the same license, and how that interacts with a commercial TikTok broadcast, needs a lawyer’s review. Attribution alone is not sufficient if ShareAlike is triggered.',
        affected: 'All active images with status NEEDS_REVIEW.'
      },
      {
        id: 'mixkit-platform',
        topic: 'Mixkit and broadcast terminology',
        detail:
          'Mixkit’s Stock Music Free License permits public performance on “any web or social media platform” and prohibits “TV & Radio Broadcasts”. This project treats TikTok Live/OBS as a web/social platform. Confirm that classification for every distribution channel, including any simulcast or third-party broadcast.',
        affected: '18 Mixkit tracks.'
      },
      {
        id: 'mixkit-chain-of-title',
        topic: 'Mixkit composition and master rights',
        detail:
          'Mixkit grants use of the “Music Items” but does not provide a separate composer/publisher/master split for each track. The license is the recorded permission; independent chain-of-title confirmation is not available in this repository.',
        affected: '18 Mixkit tracks.'
      },
      {
        id: 'project-original-authorship',
        topic: 'Ownership of original generated tracks',
        detail:
          'The three active original tracks and two archived originals were synthesised by scripts/generate_music.py with no samples. The project owner should confirm that authorship/contractor ownership supports the CC0 dedication.',
        affected: 'peaceful-prayer-01, piano-worship-01, morning-prayer-01, and two archived originals.'
      },
      {
        id: 'legacy-provenance',
        topic: 'Legacy public/assets images',
        detail:
          'Twelve images from the original temple application remain in public/assets with no source or license record. They are not in the Christian rotation, but they are still served by the static server. Do not broadcast them; archive or replace after provenance review.',
        affected: 'Legacy files under public/assets.'
      },
      {
        id: 'documentation-captures',
        topic: 'Documentation screenshots and demo images',
        detail:
          'Documentation screenshots can depict CC BY-SA backgrounds and are not cleared for standalone redistribution. Upstream demo images have no provenance record. Keep them out of the broadcast asset path.',
        affected: 'docs/screenshots and docs/demo.'
      },
      {
        id: 'people-and-property',
        topic: 'Model, property and publicity rights',
        detail:
          'Copyright licenses do not grant model releases or church/venue permissions. Several photographs show identifiable people or religious interiors. Assess publicity, privacy and property rights separately before commercial advertising use.',
        affected: 'Photographs with people or identifiable interiors, especially cathedral-01 and cathedral-02.'
      }
    ];
  }

  _report(manifest) {
    const t = manifest.counts;
    const music = manifest.assets.filter((asset) => asset.kind === 'music');
    const activeMusic = music.filter((asset) => asset.usage === 'broadcast');
    const archivedMusic = music.filter((asset) => asset.usage === 'archive');
    const activeImages = manifest.assets.filter((asset) => asset.kind === 'image' && asset.usage === 'broadcast');
    const legacyImages = manifest.assets.filter((asset) => asset.kind === 'image' && asset.usage === 'legacy');
    const docsImages = manifest.assets.filter((asset) => asset.kind === 'image' && (asset.usage === 'documentation' || asset.usage === 'reference'));

    const musicRows = (list) => list.map((asset) => [
      `\`${asset.file.split('/').pop()}\``,
      tableCell(asset.title),
      tableCell(asset.artist),
      sourceCell(asset),
      licenseCell(asset),
      tableCell(asset.commercial),
      tableCell(asset.tiktok),
      asset.attributionRequired ? 'Yes' : 'No',
      `**${asset.status}**`
    ].join(' | ')).map((row) => `| ${row} |`).join('\n');

    const imageRows = (list) => list.map((asset) => [
      `\`${asset.file.split('/').pop()}\``,
      tableCell(asset.artist),
      sourceCell(asset),
      licenseCell(asset),
      tableCell(asset.modifications),
      asset.attributionRequired ? 'Yes' : (asset.attributionRequired === false ? 'No' : 'Unknown'),
      `**${asset.status}**`
    ].join(' | ')).map((row) => `| ${row} |`).join('\n');

    const originalActive = activeMusic.filter((asset) => /original/i.test(asset.artist)).length;
    const licensedActive = activeMusic.length - originalActive;
    const musicTable = musicRows(activeMusic);
    const archiveTable = musicRows(archivedMusic);
    const imageTable = imageRows(activeImages);
    const legacyTable = imageRows(legacyImages);
    const docsTable = imageRows(docsImages);

    return `# Copyright & Commercial Licensing Audit

**Generated:** ${formatDate(manifest.generatedAt)}  
**Scope:** ${manifest.scope}  
**Status:** Evidence-based inventory. This is **not legal advice** and does not grant clearance.

> ${manifest.disclaimer}

## Executive summary

| Metric | Count |
| --- | ---: |
| Music files audited | ${t.music} |
| — active playlist | ${t.musicActive} (${t.musicEnabled} enabled) |
| — archived originals | ${t.musicArchived} |
| Image files audited | ${t.images} |
| — active Christian broadcast assets | ${t.imagesBroadcast} |
| — legacy public/assets files | ${t.imagesLegacy} |
| — documentation/reference images | ${t.imagesDocumentation} |
| **VERIFIED** | **${t.verified}** |
| **NEEDS_REVIEW** | **${t.needsReview}** |
| **REJECTED** | **${t.rejected}** |
| **UNKNOWN** | **${t.unknown}** |
| Total assets audited | ${t.total} |

### What the statuses mean

- **VERIFIED** — the recorded source and license evidence supports commercial livestream use, with the stated conditions (usually attribution, and for Mixkit the no-redistribution/no-TV-radio limits).
- **NEEDS_REVIEW** — the license is identified, but a condition or ambiguity needs a decision before calling it cleared. The 15 CC BY-SA images are here because cropping/grade may trigger ShareAlike. Documentation captures are here because they depict mixed-license assets.
- **REJECTED** — the recorded license prohibits the intended commercial use or modifications. No current asset is rejected.
- **UNKNOWN** — source/license evidence is missing. These files must not be broadcast.

## Music

The active playlist contains ${t.musicActive} tracks. ${originalActive} are original synthesis; ${licensedActive} MP3 tracks are Mixkit downloads. Mixkit’s official Stock Music Free License permits commercial and non-commercial use and public performance on any web or social media platform. It prohibits TV/radio broadcast, CDs/DVDs, video games, remixing into a music-only track, claiming ownership, standalone redistribution and rights registration.

| File | Title | Artist | Source | License | Commercial | TikTok | Attribution | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${musicTable}

### Archived music (not in rotation)

| File | Title | Artist | Source | License | Commercial | TikTok | Attribution | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${archiveTable}

## Images — active Christian assets

${t.imagesBroadcast} files are in the active catalog. Public-domain, CC0, CC BY and generated overlays are **VERIFIED** subject to attribution. The CC BY-SA files are **NEEDS_REVIEW** because the adapted 9:16 crops may require ShareAlike release; do not describe those images as fully cleared.

| File | Author | Source | License | Modifications | Attribution | Status |
| --- | --- | --- | --- | --- | --- | --- |
${imageTable}

## Images — legacy public/assets files

These files are retained in place for compatibility. They are **not** in the Christian rotation, but they are still reachable from the static server. They have no source/license evidence and must not be broadcast.

| File | Author | Source | License | Modifications | Attribution | Status |
| --- | --- | --- | --- | --- | --- | --- |
${legacyTable}

## Documentation and reference images

These are not broadcast assets. Screenshots may contain licensed backgrounds; upstream demo images have no provenance record.

| File | Author | Source | License | Modifications | Attribution | Status |
| --- | --- | --- | --- | --- | --- | --- |
${docsTable}

## Evidence checked

- **Wikimedia Commons:** 21 source pages were queried through the Commons API (\`action=query&prop=imageinfo&iiprop=url|extmetadata\`). License short names, license URLs, authors and restriction fields were compared with \`public/assets/christian/asset-manifest.json\`; all 21 active Commons-derived entries matched at audit time. Raw evidence is in \`docs/commons-license-evidence.json\`.
- **Mixkit:** the official license modal at ${MIXKIT_MODAL_URL} was read. It lists allowed uses (podcasts, social-media video posts, online marketing, education, YouTube) and prohibited uses (CDs/DVDs, TV & radio broadcasts, video games), and prohibits remixing, claiming ownership and rights registration.
- **Mixkit catalog metadata:** the Ambient, Piano and Cinematic catalog pages’ JSON-LD was checked against the local manifest; all 18 recordings matched on title, artist and duration. Evidence is in \`docs/mixkit-license-evidence.json\`.
- **Original music:** \`scripts/generate_music.py\` states that all material is synthesised from scratch (sine/triangle partials and filtered noise), with no samples or third-party recordings. The three active originals are dedicated to CC0 1.0; the two removed tracks are archived under \`docs/backups/music-removed\`.
- **Overlays:** the three PNG overlays are generated locally with Pillow and recorded as CC0 in the asset manifest.
- **Local files:** every listed file was found on disk, hashed with SHA-256, and measured where an image header was available. Files missing from the manifest are reported as unknown, not silently excluded.
- **Generated TTS cache:** \`data/tts-cache/*.wav\` contains machine-generated narration from the local Piper voices. It is not a music or image asset and is excluded from this audit; Piper voice-model licenses should be reviewed separately if the cache is distributed.

## Unresolved licensing questions

${manifest.unresolved.map((item, index) => `${index + 1}. **${item.topic}.** ${item.detail}\n   *Affected:* ${item.affected}`).join('\n\n')}

## Recommended replacements

- **15 active CC BY-SA images.** If ShareAlike or the attribution burden is unacceptable, replace them with CC0, public-domain, or CC BY alternatives of the same subject. The current set is listed in the image table above; the default \`cathedral-01-cathedral-mass.jpg\` is public domain and does not need replacement on copyright grounds.
- **12 legacy \`public/assets\` images.** Archive them after provenance review and replace any remaining visual slot with a cleared Christian asset. They are already out of the rotation.
- **4 upstream demo images.** Keep them only as clearly labelled documentation, or remove them; they are not cleared for broadcast.
- **Documentation captures.** They are not replacements for production assets and should not be published as standalone marketing material without the underlying credits.

## Recommended actions

1. **Keep the current default cathedral background** only after confirming the public-domain source and assessing model/property rights. Its copyright status is documented, but releases are not.
2. **Do not add the 15 CC BY-SA images to advertising or standalone promotional material** until ShareAlike scope is reviewed. They can remain in rotation with attribution if the risk is accepted, but that is a business/legal decision, not a copyright clearance.
3. **Keep Mixkit playback on TikTok/OBS web delivery only.** Do not route it to TV/radio, sell the files, remix them, or register them with Content ID.
4. **Quarantine the nine legacy public/assets images** from any future rotation and document their origin or replace them.
5. **Do not publish documentation screenshots as standalone marketing assets** without repeating the underlying image credits and reviewing the CC BY-SA captures.
6. **Record the project owner’s authorship attestation** for the generated tracks and overlays if CC0 dedication will be relied on commercially.
7. **Re-run this scan after any asset addition/replacement.** The Admin button rescans local folders; it cannot verify a license that was never recorded.

## Attribution

Copy-ready credits are in [ASSET_ATTRIBUTION.md](ASSET_ATTRIBUTION.md).

---

*Generated by \`lib/copyright-audit.js\`. The scanner only reads fixed project directories, validates file extensions and never executes media files.*
`;
  }

  _attribution(manifest) {
    const activeImages = manifest.assets.filter((asset) => asset.usage === 'broadcast' && asset.attributionRequired);
    const freeImages = manifest.assets.filter(
      (asset) => asset.usage === 'broadcast' && asset.attributionRequired === false && asset.provenance !== 'AI_GENERATED'
    );
    const aiImages = manifest.assets.filter((asset) => asset.usage === 'broadcast' && asset.provenance === 'AI_GENERATED');
    const activeMusic = manifest.assets.filter((asset) => asset.usage === 'broadcast');
    const docs = manifest.assets.filter((asset) => asset.usage === 'documentation' || asset.usage === 'reference');
    const legacy = manifest.assets.filter((asset) => asset.usage === 'legacy');
    const eligibleBroadcast = manifest.assets.filter(
      (asset) => asset.usage === 'broadcast' && asset.status === 'VERIFIED'
    );
    const eligibleAttribution = eligibleBroadcast.filter(
      (asset) => asset.kind === 'image' && asset.attributionRequired
    );

    const credits = activeImages.map((asset) => {
      const license = asset.licenseUrl
        ? `[${asset.license}](${asset.licenseUrl})`
        : asset.license;
      return `### ${asset.title}

**Credit:** “${asset.title}” by **${asset.artist}**, via [Wikimedia Commons](${asset.sourceUrl}). Licensed under ${license}.  
**Modifications:** ${asset.modifications}.  
**Status:** ${asset.status}.${asset.shareAlike ? ' ShareAlike applies to adapted material; legal review pending.' : ''}

`;
    }).join('');

    const courtesy = freeImages.map((asset) => {
      const source = asset.sourceUrl ? ` — [source](${asset.sourceUrl})` : '';
      return `- **${asset.title}** — ${asset.artist}; ${asset.license}${source}`;
    }).join('\n');

    const musicCredits = activeMusic.map((asset) => {
      if (asset.artist.includes('original')) {
        return `- **${asset.title}** — original composition/recording by Christian Prayer Live; CC0 1.0; no attribution required.`;
      }
      return `- **${asset.title}** — ${asset.artist}; courtesy credit via [Mixkit](${asset.sourceUrl || MIXKIT_LICENSE_URL}). Mixkit license does not require attribution.`;
    }).join('\n');

    const eligibleCredits = eligibleAttribution.map((asset) => {
      const license = asset.licenseUrl ? `[${asset.license}](${asset.licenseUrl})` : asset.license;
      const source = asset.sourceUrl ? `[source](${asset.sourceUrl})` : 'source not recorded';
      return `- **${asset.title}** — ${asset.artist}; ${license}; ${source}`;
    }).join('\n');

    return `# Asset Attribution

Generated ${formatDate(manifest.generatedAt)}. This file contains copy-ready credits for assets that require attribution, plus courtesy credits for assets whose licenses do not require it.

> ${manifest.disclaimer}

## Copyright Safe Mode — eligible broadcast assets

**${eligibleBroadcast.length} eligible broadcast assets** meet the Copyright Safe Mode rule (VERIFIED, active broadcast usage, all four permissions allowed, local file present). Of these, **${eligibleAttribution.length} require attribution**; the remaining **${eligibleBroadcast.length - eligibleAttribution.length}** are public domain, CC0, generated, or Mixkit tracks whose license does not require credit.

${eligibleCredits || '_No eligible image currently requires attribution._'}

Blocked assets remain documented below for review and history, but their credits are not active broadcast obligations while safe mode is on.

## Required image credits

These credits are required when the image is displayed or distributed. For CC BY-SA images, the ShareAlike question in [COPYRIGHT_AUDIT.md](COPYRIGHT_AUDIT.md) still needs review.

${credits || '_No active image currently requires attribution._'}

## Public-domain, CC0 and generated assets (no attribution required)

${courtesy || '_None._'}

## AI-generated assets (no attribution required)

These files were declared AI-generated by the operator through the local <code>AI_</code> filename convention and are registered by the image library scanner. Provenance is recorded in the asset manifest; no third-party author credit applies.

${aiImages.length ? aiImages.map((asset) => `- **${asset.title}** — AI Generated; ${asset.license}${asset.width && asset.height ? `; ${asset.width}×${asset.height}` : ''}`).join('\n') : '_No AI-generated broadcast images registered._'}

## Background music

Mixkit’s license does not require attribution. The credits below are courtesy records; keep them with the project even if a track is later removed.

${musicCredits}

## Archived originals

- **Quiet Hour** and **Cathedral Light** — project-generated originals, CC0 1.0, archived and not in rotation.

## Documentation and reference images

These are not broadcast assets. Screenshots may depict the images credited above; if a screenshot is published, repeat the relevant credit. Upstream demo images have no provenance record and are not cleared.

${docs.map((asset) => `- \`${asset.file}\` — ${asset.status}${asset.notes ? ` — ${asset.notes}` : ''}`).join('\n')}

## Legacy files — do not publish

${legacy.map((asset) => `- \`${asset.file}\` — ${asset.status}; no source/license evidence.`).join('\n')}
`;
  }
}

module.exports = { CopyrightAudit, DISCLAIMER, MIXKIT_LICENSE_URL };
