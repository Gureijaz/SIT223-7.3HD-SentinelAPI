'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const JsonStore = require('../../src/repositories/jsonStore');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('load', () => {
  it('starts empty when the file does not exist', () => {
    const store = new JsonStore(path.join(dir, 'missing.json'));

    expect(store.load()).toEqual({ users: [], findings: [] });
  });

  it('merges a partial file over the empty defaults', () => {
    const file = path.join(dir, 'partial.json');
    fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'u1' }] }));

    expect(new JsonStore(file).load()).toEqual({ users: [{ id: 'u1' }], findings: [] });
  });

  it('recovers from a corrupt file by starting empty', () => {
    const file = path.join(dir, 'corrupt.json');
    fs.writeFileSync(file, '{not json');

    expect(new JsonStore(file).load()).toEqual({ users: [], findings: [] });
  });

  it('rethrows errors that are not a missing or corrupt file', () => {
    expect(() => new JsonStore(dir).load()).toThrow();
  });

  it('serves repeat loads from the cache', () => {
    const store = new JsonStore(path.join(dir, 'cached.json'));

    expect(store.load()).toBe(store.load());
  });
});

describe('flush', () => {
  it('creates missing folders and persists the data', () => {
    const file = path.join(dir, 'nested', 'deep', 'data.json');
    const store = new JsonStore(file);

    store.collection('findings').push({ id: 'f1' });
    store.flush();

    expect(new JsonStore(file).load().findings).toEqual([{ id: 'f1' }]);
  });
});

describe('collection', () => {
  it('replaces a value that is not an array', () => {
    const store = new JsonStore(path.join(dir, 'bad.json'));
    store.load().users = 'broken';

    expect(store.collection('users')).toEqual([]);
  });

  it('creates a collection that does not exist yet', () => {
    const store = new JsonStore(path.join(dir, 'new.json'));

    expect(store.collection('tags')).toEqual([]);
  });
});

describe('reset', () => {
  it('clears the cache and deletes the file', () => {
    const file = path.join(dir, 'reset.json');
    const store = new JsonStore(file);
    store.collection('users').push({ id: 'u1' });
    store.flush();

    store.reset();

    expect(fs.existsSync(file)).toBe(false);
    expect(store.load()).toEqual({ users: [], findings: [] });
  });

  it('is safe when there is no file yet', () => {
    const store = new JsonStore(path.join(dir, 'none.json'));

    expect(() => store.reset()).not.toThrow();
  });
});
