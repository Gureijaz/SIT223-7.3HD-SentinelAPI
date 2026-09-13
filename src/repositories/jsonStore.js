'use strict';

const fs = require('fs');
const path = require('path');

const EMPTY = { users: [], findings: [] };

/**
 * A tiny file-backed document store.
 *
 * Deliberately dependency-free: the pipeline has to run on a Jenkins agent with
 * no database service, and every native-addon database driver adds a compile
 * step that can fail on the agent. Reads are served from an in-memory cache and
 * writes are flushed atomically via a temp file + rename.
 */
class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.cache = null;
  }

  load() {
    if (this.cache) return this.cache;

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.cache = { ...structuredClone(EMPTY), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
      this.cache = structuredClone(EMPTY);
    }

    return this.cache;
  }

  flush() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  collection(name) {
    const data = this.load();
    if (!Array.isArray(data[name])) data[name] = [];
    return data[name];
  }

  /** Drops all data. Used by the test suites to isolate cases from each other. */
  reset() {
    this.cache = structuredClone(EMPTY);
    if (fs.existsSync(this.filePath)) fs.rmSync(this.filePath);
  }
}

module.exports = JsonStore;
