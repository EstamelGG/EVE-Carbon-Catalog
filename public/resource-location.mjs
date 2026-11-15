// Shared by the app and the separately bundled viewer. Only resource URLs use
// this base; application modules, icons and styles remain on the website.
export function normalizeResBase(value) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('res-base (resBase) is required');
  return validatedBase(new URL(value.trim(), globalThis.document?.baseURI).href);
}

export function configureResourceBase(value = '', backgrounds = '', files = undefined, resBase) {
  if (files !== undefined && (!Array.isArray(files) || files.some(p => typeof p !== 'string' || !/^assets\/backgrounds\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p))))
    throw new Error('Invalid backgroundFiles allowlist');
  globalThis.__eveBackgroundFiles = files === undefined ? undefined : new Set(files);
  globalThis.__eveBackgroundBase = validatedBase(backgrounds);
  globalThis.__eveResourceBase = validatedBase(value);
  globalThis.__eveResBase = resBase && normalizeResBase(resBase);
}

function validatedBase(value) {
  const text = String(value).trim();
  if (!text) return '';
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid resource base URL');
  url.pathname = url.pathname.replace(/\/?$/, '/');
  return url.href;
}

export function resourceURL(value) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value;
  const path = value.replace(/^\.?\//, '');
  if (globalThis.__eveResBase && path.startsWith('res/'))
    return new URL(path.slice(4), globalThis.__eveResBase).href;
  // Published next to the app, including on project Pages under a subpath.
  // Ignore legacy Raw configuration for this dedicated website directory.
  if (path.startsWith('github-assets/')) return './' + path;
  const files = globalThis.__eveBackgroundFiles;
  const background = !!files?.has(path.split(/[?#]/)[0]);
  const base = (background && globalThis.__eveBackgroundBase) || globalThis.__eveResourceBase;
  return base ? new URL(path, base).href : value;
}

export function normalizeModelIndex(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('model-index (modelIndex) is required');
  const url = new URL(value.trim(), globalThis.document?.baseURI);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.pathname.endsWith('/'))
    throw Error('Invalid model-index URL');
  return url.href;
}

export function createResourceLocator(modelIndex) {
  const index = normalizeModelIndex(modelIndex);
  const root = new URL('../', index);
  return value => {
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value;
    const path = value.replace(/^\.?\//, '');
    return path.startsWith('res/') ? new URL(path.slice(4), index).href : new URL(path, root).href;
  };
}
