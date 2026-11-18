import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.document = { baseURI: 'http://127.0.0.1:9020/' };
const values = new Map([
  ['eve-catalog-model-index', 'https://carbon-models.vanquisher.online/res/model-index.json'],
]);
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

const { preferredModelIndex } = await import('../public/res-preference.mjs');

test('local dev ignores a saved R2 model index', () => {
  assert.equal(
    preferredModelIndex({
      localResources: true,
      resourceBaseURL: 'http://127.0.0.1:9020/',
    }),
    'http://127.0.0.1:9020/res/model-index.json',
  );
});

test('published sites keep the saved model index', () => {
  assert.equal(
    preferredModelIndex({ resourceBaseURL: 'https://example.com/' }),
    'https://carbon-models.vanquisher.online/res/model-index.json',
  );
});
