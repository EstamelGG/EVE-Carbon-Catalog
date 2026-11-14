import { normalizeResBase } from './resource-location.mjs';

const key = 'eve-catalog-res-base';

export function savedResBase() {
  try {
    const value = localStorage.getItem(key);
    return value ? normalizeResBase(value) : '';
  } catch {
    return '';
  }
}

export function saveResBase(value) {
  if (value) localStorage.setItem(key, normalizeResBase(value));
  else localStorage.removeItem(key);
}

export function defaultResBase(config) {
  const root = config.resourceBaseURL ? normalizeResBase(config.resourceBaseURL) : document.baseURI;
  return new URL('res/', root).href;
}
