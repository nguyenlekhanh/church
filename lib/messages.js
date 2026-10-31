/**
 * Christian Prayer Live — English message library.
 *
 * Messages live in config/messages.en.json (separate from application logic) so
 * the stream host can edit wording without touching code. Selection avoids
 * repeating the most recently used messages within a category.
 */
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config/config');

const MESSAGES_FILE = path.join(CONFIG_DIR, 'messages.en.json');
const RECENT_WINDOW = 4;

class MessageLibrary {
  constructor(filePath = MESSAGES_FILE) {
    this.filePath = filePath;
    this.data = {};
    this.recent = new Map();
    this.load();
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (err) {
      console.error(`[Messages] Could not load ${this.filePath}: ${err.message}`);
      this.data = { templates: {}, commands: {}, categories: {}, bibleVerses: [], prayerRequestTriggers: [] };
    }
    this.normalise();
    return this.data;
  }

  normalise() {
    const data = this.data || {};
    data.templates = data.templates || {};
    data.commands = data.commands || {};
    data.categories = data.categories || {};
    data.bibleVerses = Array.isArray(data.bibleVerses) ? data.bibleVerses : [];
    data.prayerRequestTriggers = Array.isArray(data.prayerRequestTriggers)
      ? data.prayerRequestTriggers
      : ['pray for me', 'prayer request', 'please pray'];
    this.data = data;
  }

  list(category) {
    const source = this.getPool(category);
    return Array.isArray(source) ? source : [];
  }

  getPool(category) {
    if (!category) return [];
    const parts = String(category).split('.');
    let node = this.data;
    for (const part of parts) {
      if (!node || typeof node !== 'object') return null;
      node = node[part];
    }
    return node;
  }

  /** Pick a message, avoiding the last few used in the same category. */
  pick(category, vars = {}) {
    const pool = this.list(category).filter((m) => typeof m === 'string' && m.trim());
    if (pool.length === 0) return '';
    const recent = this.recent.get(category) || [];
    const window = Math.min(RECENT_WINDOW, Math.max(0, pool.length - 1));
    let candidates = pool.map((_, idx) => idx).filter((idx) => !recent.includes(idx));
    if (candidates.length === 0) candidates = pool.map((_, idx) => idx);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const updated = [chosen, ...recent].slice(0, window);
    this.recent.set(category, updated);
    return this.render(pool[chosen], vars);
  }

  pickFromList(list, vars = {}) {
    const pool = (Array.isArray(list) ? list : []).filter((m) => typeof m === 'string' && m.trim());
    if (pool.length === 0) return '';
    return this.render(pool[Math.floor(Math.random() * pool.length)], vars);
  }

  command(name) {
    const key = String(name || '').toUpperCase();
    return this.pick(`commands.${key}`);
  }

  template(name, vars = {}) {
    const pool = this.getPool(`templates.${name}`);
    if (Array.isArray(pool)) return this.pick(`templates.${name}`, vars);
    return '';
  }

  templateList(name) {
    const pool = this.getPool(`templates.${name}`);
    return Array.isArray(pool) ? pool : [];
  }

  bibleVerse() {
    const pool = this.data.bibleVerses || [];
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  triggers() {
    return (this.data.prayerRequestTriggers || []).map((t) => String(t).toLowerCase());
  }

  render(template, vars = {}) {
    if (!template) return '';
    return String(template).replace(/\{(\w+)\}/g, (match, key) => {
      const value = vars[key];
      return value === undefined || value === null ? match : String(value);
    });
  }

  /** Full editable payload for the admin message editor. */
  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  /** Replace the library from validated JSON and persist it. */
  replace(next) {
    if (!next || typeof next !== 'object') {
      throw new Error('Message library must be a JSON object');
    }
    const payload = {
      ...next,
      templates: next.templates || {},
      commands: next.commands || {},
      categories: next.categories || {},
      bibleVerses: Array.isArray(next.bibleVerses) ? next.bibleVerses : [],
      prayerRequestTriggers: Array.isArray(next.prayerRequestTriggers)
        ? next.prayerRequestTriggers
        : this.data.prayerRequestTriggers
    };
    const backupPath = `${this.filePath}.bak`;
    try {
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backupPath);
    } catch (_) {}
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.data = payload;
    this.normalise();
    this.recent.clear();
    return this.snapshot();
  }
}

module.exports = { MessageLibrary, MESSAGES_FILE };
