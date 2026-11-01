/**
 * CHRISTIAN PRAYER LIVE — CHRISTIAN IMAGE LIBRARY
 *
 * Discovers locally stored artwork in the seven established category folders,
 * synchronizes public/assets/christian/asset-manifest.json and reports what a
 * scan changed. It never downloads, deletes or renames an image file.
 *
 * Registration rules:
 *  - A filename that starts with "AI_" (case-insensitive) is an original,
 *    AI-generated asset. It is registered as AI_GENERATED with Verified
 *    commercial/social permissions and no attribution requirement.
 *  - Any other new file is registered as NEEDS_REVIEW with license "Unknown".
 *    Nothing is inferred from a folder name.
 *  - An already-registered file keeps its recorded title, source, license and
 *    attribution. Only technical fields (dimensions, size, hash) are refreshed.
 *
 * Writes are atomic and the previous manifest is kept as a backup.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const CATEGORIES = [
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'bible', label: 'Bible' },
  { id: 'candles', label: 'Candles' },
  { id: 'cathedral', label: 'Cathedral' },
  { id: 'church', label: 'Church' },
  { id: 'cross', label: 'Cross' },
  { id: 'jesus', label: 'Jesus' }
];

const CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id));
const AI_LICENSE = 'AI Generated (project original)';
const AI_SOURCE = 'AI Generated';

function isIgnoredName(name) {
  if (!name || name.startsWith('.')) return true;
  if (/~$/.test(name)) return true;
  if (/\.tmp$/i.test(name)) return true;
  if (/^thumbs\.db$/i.test(name)) return true;
  // Thumbnail / preview caches that editors leave behind.
  return /(^|[._-])thumb(s|nail)?([._-]|$)/i.test(name);
}

function humanTitle(file) {
  return path
    .basename(file, path.extname(file))
    .replace(/^AI[_-]+/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return '';
  }
}

/** Minimal, dependency-free dimension reader for JPEG, PNG and WebP. */
function imageDimensions(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (_) {
    return { width: null, height: null };
  }
  try {
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const format = buf.toString('ascii', 12, 16);
      if (format === 'VP8X') {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (format === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (format === 'VP8L') {
        return {
          width: 1 + (((buf[22] & 0x3f) << 8) | buf[21]),
          height: 1 + (((buf[24] & 0x0f) << 10) | (buf[23] << 2) | ((buf[22] & 0xc0) >> 6))
        };
      }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = buf.readUInt16BE(offset + 2);
        const isFrame = (marker >= 0xc0 && marker <= 0xc3)
          || (marker >= 0xc5 && marker <= 0xc7)
          || (marker >= 0xc9 && marker <= 0xcb)
          || (marker >= 0xcd && marker <= 0xcf);
        if (isFrame && length >= 7) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
        }
        if (!length) break;
        offset += 2 + length;
      }
    }
  } catch (_) {
    /* corrupted or truncated file: handled by the caller */
  }
  return { width: null, height: null };
}

class ImageLibrary {
  constructor(options = {}) {
    this.root = path.resolve(options.root || path.join(__dirname, '..'));
    this.assetsDir = path.resolve(options.assetsDir || path.join(this.root, 'public', 'assets', 'christian'));
    this.manifestPath = path.resolve(options.manifestPath || path.join(this.assetsDir, 'asset-manifest.json'));
    this.backupPath = path.resolve(options.backupPath || path.join(this.assetsDir, 'asset-manifest.backup.json'));
    this.statePath = path.resolve(
      options.statePath || path.join(this.root, 'data', 'image-library-state.json')
    );
    this.archiveDir = path.resolve(
      options.archiveDir || path.join(this.root, 'docs', 'backups', 'image-manifests')
    );
    this._scanPromise = null;
  }

  /** Only files inside one of the seven category folders may be scanned. */
  _isInsideAssets(full) {
    const resolved = path.resolve(full);
    const relative = path.relative(this.assetsDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    const [category] = relative.split(path.sep);
    return CATEGORY_IDS.has(category);
  }

  _walk(categoryDir, category, out, errors) {
    let entries = [];
    try {
      entries = fs.readdirSync(categoryDir, { withFileTypes: true });
    } catch (error) {
      errors.push({ file: `public/assets/christian/${category}`, error: error.message });
      return;
    }
    for (const entry of entries) {
      if (isIgnoredName(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(categoryDir, entry.name);
      if (!this._isInsideAssets(full)) continue;
      if (entry.isDirectory()) {
        this._walk(full, category, out, errors);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) continue;
      const relative = path.relative(this.assetsDir, full).split(path.sep).join('/');
      out.push({ file: relative, full, category, extension });
    }
  }

  _discover() {
    const files = [];
    const errors = [];
    for (const category of CATEGORIES) {
      this._walk(path.join(this.assetsDir, category.id), category.id, files, errors);
    }
    files.sort((a, b) => a.file.localeCompare(b.file));
    return { files, errors };
  }

  readManifest() {
    const data = readJson(this.manifestPath, []);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.images)) return data.images;
    return [];
  }

  _stableId(category, file, existing, used) {
    if (existing && existing.id) {
      used.add(existing.id);
      return existing.id;
    }
    const base = `img_${category}_${slug(path.basename(file, path.extname(file)))}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id;
  }

  _aiEntry(base, now) {
    return {
      ...base,
      provenance: 'AI_GENERATED',
      generated: true,
      source: AI_SOURCE,
      license: AI_LICENSE,
      licenseUrl: '',
      attribution: 'AI Generated',
      attributionRequired: false,
      commercialUse: 'Allowed',
      socialMediaUse: 'Allowed',
      reviewRequired: false,
      generatedAt: base.generatedAt || now,
      updatedAt: now
    };
  }

  _reviewEntry(base, now) {
    return {
      ...base,
      provenance: 'LOCAL_FILE',
      generated: false,
      source: 'Local file — no provenance or license recorded',
      license: 'Unknown',
      licenseUrl: '',
      attribution: 'Unknown',
      attributionRequired: null,
      commercialUse: 'Unverified',
      socialMediaUse: 'Unverified',
      reviewRequired: true,
      updatedAt: now
    };
  }

  /** True when an existing AI_-prefixed entry still has no recorded license. */
  _needsAiClassification(entry) {
    if (!entry) return true;
    const license = String(entry.license || '').trim().toLowerCase();
    const source = String(entry.source || '').trim().toLowerCase();
    const unlicensed = !license || license === 'unknown' || license === 'see asset-manifest.json';
    return unlicensed && (!source || source === 'unknown');
  }

  scan() {
    if (this._scanPromise) return this._scanPromise;
    this._scanPromise = Promise.resolve()
      .then(() => this._performScan())
      .finally(() => {
        this._scanPromise = null;
      });
    return this._scanPromise;
  }

  _performScan() {
    const startedAt = Date.now();
    const now = new Date().toISOString();
    const previous = this.readManifest();
    const previousByFile = new Map(
      previous.map((entry) => [String(entry.file || '').replace(/\\/g, '/'), entry])
    );
    const { files, errors } = this._discover();

    const usedIds = new Set();
    const entries = [];
    const added = [];
    const addedAi = [];
    const updated = [];
    const unchanged = [];
    const removed = [];
    const renamed = [];
    const discoveredFiles = new Set(files.map((item) => item.file));
    const renameSources = new Set();

    // Preserve entries that live outside the scanned category folders.
    for (const entry of previous) {
      const file = String(entry.file || '').replace(/\\/g, '/');
      if (!file) continue;
      const category = file.includes('/') ? file.split('/')[0] : '';
      if (!CATEGORY_IDS.has(category)) entries.push(entry);
    }

    for (const item of files) {
      let existing = previousByFile.get(item.file) || null;
      let bytes = null;
      let sha = '';
      try {
        bytes = fs.statSync(item.full).size;
        sha = sha256File(item.full);
      } catch (error) {
        errors.push({ file: item.file, error: error.message });
        continue;
      }
      if (!bytes) {
        errors.push({ file: item.file, error: 'Empty or unreadable image file' });
        continue;
      }
      const dimensions = imageDimensions(item.full);
      if (!dimensions.width || !dimensions.height) {
        // A file with an image extension but no readable header is corrupted
        // or misnamed. Skip new files; never drop an existing registration.
        if (!previousByFile.has(item.file)) {
          errors.push({ file: item.file, error: 'Unreadable or corrupted image; skipped' });
          continue;
        }
      }
      // A file that disappeared earlier in this scan and carries the same
      // content hash was renamed, not replaced: reuse its licensing record.
      let renamedFrom = '';
      if (!existing && sha) {
        const source = previous.find((candidate) => {
          const file = String(candidate.file || '').replace(/\\/g, '/');
          if (!file || discoveredFiles.has(file) || renameSources.has(file)) return false;
          if (!CATEGORY_IDS.has(file.split('/')[0])) return false;
          return candidate.sha256 === sha;
        });
        if (source) {
          existing = source;
          renamedFrom = String(source.file).replace(/\\/g, '/');
          renameSources.add(renamedFrom);
        }
      }
      const isAiName = /^AI_/i.test(path.basename(item.file));
      const base = {
        ...(existing || {}),
        id: '',
        file: item.file,
        category: item.category,
        title: existing?.title || humanTitle(item.file),
        width: dimensions.width || existing?.width || null,
        height: dimensions.height || existing?.height || null,
        bytes,
        sha256: sha
      };
      base.id = this._stableId(item.category, item.file, existing, usedIds);

      let entry;
      if (renamedFrom) {
        entry = { ...base, updatedAt: now };
        renamed.push({ from: renamedFrom, to: item.file });
      } else if (!existing) {
        entry = isAiName ? this._aiEntry(base, now) : this._reviewEntry(base, now);
        entry.registeredAt = now;
        added.push(item.file);
        if (isAiName) addedAi.push(item.file);
      } else if (isAiName && this._needsAiClassification(existing)) {
        entry = this._aiEntry(base, now);
        entry.registeredAt = existing.registeredAt || now;
        updated.push({ file: item.file, reason: 'AI-generated classification' });
      } else {
        entry = base;
        const technicalChange = existing.width !== entry.width
          || existing.height !== entry.height
          || existing.bytes !== entry.bytes
          || (existing.sha256 && existing.sha256 !== entry.sha256);
        if (technicalChange) {
          entry.updatedAt = now;
          updated.push({ file: item.file, reason: 'metadata' });
        } else {
          unchanged.push(item.file);
        }
      }
      entries.push(entry);
    }

    // Deleted entries: anything registered in the seven categories that is no
    // longer on disk and was not consumed as the source of a rename.
    for (const entry of previous) {
      const file = String(entry.file || '').replace(/\\/g, '/');
      if (!file || discoveredFiles.has(file) || renameSources.has(file)) continue;
      if (!CATEGORY_IDS.has(file.split('/')[0])) continue;
      removed.push(file);
    }

    entries.sort((a, b) => String(a.file).localeCompare(String(b.file)));

    // Back up the previous manifest before writing anything.
    try {
      if (fs.existsSync(this.manifestPath)) {
        fs.copyFileSync(this.manifestPath, this.backupPath);
        if (removed.length > 0) {
          const stamp = now.replace(/[:.]/g, '-');
          fs.mkdirSync(this.archiveDir, { recursive: true });
          fs.copyFileSync(this.manifestPath, path.join(this.archiveDir, `asset-manifest-${stamp}.json`));
        }
      }
    } catch (error) {
      errors.push({ file: 'asset-manifest.json', error: `Backup failed: ${error.message}` });
    }

    try {
      atomicWriteJson(this.manifestPath, entries);
    } catch (error) {
      throw new Error(`Could not write asset-manifest.json: ${error.message}`);
    }

    const result = this._buildResult({
      entries,
      files,
      errors,
      added,
      addedAi,
      removed,
      renamed,
      updated,
      unchanged,
      startedAt,
      scannedAt: now
    });

    try {
      atomicWriteJson(this.statePath, {
        scannedAt: now,
        durationMs: result.durationMs,
        totals: result.totals,
        categories: result.categories
      });
    } catch (_) {
      /* the state file is only a convenience for the dashboard */
    }
    return result;
  }

  _counts(entries) {
    // Only the seven category folders count; manifest entries for stage
    // overlays are preserved but are not part of the image library.
    const scoped = entries.filter((entry) => CATEGORY_IDS.has(entry.category));
    const categories = CATEGORIES.map((category) => {
      const list = scoped.filter((entry) => entry.category === category.id);
      return {
        id: category.id,
        label: category.label,
        count: list.length,
        aiGenerated: list.filter((entry) => entry.provenance === 'AI_GENERATED').length,
        needsReview: list.filter((entry) => entry.reviewRequired === true).length
      };
    });
    const aiGenerated = scoped.filter(
      (entry) => entry.provenance === 'AI_GENERATED' || entry.generated === true
    ).length;
    const needsReview = scoped.filter((entry) => entry.reviewRequired === true).length;
    return {
      categories,
      totals: {
        images: scoped.length,
        categories: categories.length,
        aiGenerated,
        licensed: scoped.length - needsReview,
        needsReview
      }
    };
  }

  _buildResult({ entries, files, errors, added, addedAi, removed, renamed, updated, unchanged, startedAt, scannedAt }) {
    const counts = this._counts(entries);
    return {
      scannedAt,
      durationMs: Date.now() - startedAt,
      categories: counts.categories,
      totals: counts.totals,
      added,
      addedAi,
      removed,
      renamed,
      updated,
      unchanged: unchanged.length,
      errors,
      images: entries.filter((entry) => CATEGORY_IDS.has(entry.category)).map((entry) => ({
        id: entry.id,
        file: entry.file,
        category: entry.category,
        title: entry.title,
        provenance: entry.provenance || (entry.generated ? 'AI_GENERATED' : 'RECORDED'),
        aiGenerated: entry.provenance === 'AI_GENERATED' || entry.generated === true,
        needsReview: entry.reviewRequired === true,
        license: entry.license || 'Unknown',
        attribution: entry.attribution || '',
        width: entry.width || null,
        height: entry.height || null,
        bytes: entry.bytes || null
      }))
    };
  }

  /** Read-only inventory for the dashboard; never writes a manifest. */
  summary() {
    const entries = this.readManifest();
    const { errors } = this._discover();
    const counts = this._counts(entries);
    const state = readJson(this.statePath, {});
    return {
      scannedAt: state.scannedAt || null,
      categories: counts.categories,
      totals: counts.totals,
      errors,
      images: entries
        .filter((entry) => CATEGORY_IDS.has(entry.category))
        .map((entry) => ({
          id: entry.id,
          file: entry.file,
          category: entry.category,
          title: entry.title,
          provenance: entry.provenance || (entry.generated ? 'AI_GENERATED' : 'RECORDED'),
          aiGenerated: entry.provenance === 'AI_GENERATED' || entry.generated === true,
          needsReview: entry.reviewRequired === true,
          license: entry.license || 'Unknown',
          attribution: entry.attribution || '',
          width: entry.width || null,
          height: entry.height || null,
          bytes: entry.bytes || null
        }))
    };
  }
}

module.exports = { ImageLibrary, CATEGORIES, IMAGE_EXTENSIONS, isIgnoredImageName: isIgnoredName, imageDimensions };
