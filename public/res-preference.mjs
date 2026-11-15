import { normalizeModelIndex, normalizeResBase } from './resource-location.mjs';

const key = 'eve-catalog-model-index';
const legacyKey = 'eve-catalog-res-base';

export function savedModelIndex() {
  try {
    const value = localStorage.getItem(key);
    if (value) return normalizeModelIndex(value);
    const directory = localStorage.getItem(legacyKey);
    return directory ? new URL('model-index.json', normalizeResBase(directory)).href : '';
  } catch {
    return '';
  }
}

export function saveModelIndex(value) {
  if (value) localStorage.setItem(key, normalizeModelIndex(value));
  else localStorage.removeItem(key);
  localStorage.removeItem(legacyKey);
}

export function defaultModelIndex(config) {
  if (config.resourceBaseURL)
    return new URL('res/model-index.json', normalizeResBase(config.resourceBaseURL)).href;
  return 'https://carbon-models.vanquisher.online/res/model-index.json';
}
