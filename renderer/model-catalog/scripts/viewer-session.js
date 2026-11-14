import { createEffectResources } from './effect-resources.js';
import { resourceURL } from '../src/resource-location.mjs';
import { loadJSON, loadArrayBuffer } from '../src/resource-activity.mjs';
import { createHangarBundleCache } from './hangar-bundle-cache.js';

// One open dialog owns the decoded shared textures and metadata. Appearance
// scopes borrow them; only closing the dialog releases their storage.
export function createViewerSession(resolveURL = resourceURL) {
  const bundles = createHangarBundleCache(resolveURL);
  const resources = createEffectResources(undefined, resolveURL, bundles.objectURL), documents = new Map(), reflections = new Map(), buffers = new Map();
  return {
    resources, reflections, resolveURL, bundles,
    binaryURL: bundles.objectURL,
    arrayBuffer(url, options, kind) {
      return bundles.has(url) ? Promise.resolve(bundles.arrayBuffer(url)) : loadArrayBuffer(resolveURL(url), options, kind);
    },
    buffer(key, load) {
      if (!buffers.has(key)) buffers.set(key, Promise.resolve().then(load).catch(error => { buffers.delete(key); throw error; }));
      return buffers.get(key);
    },
    json(url) {
      const key = new URL(resolveURL(url), location.href).href;
      if (!documents.has(key)) {
        let pending;
        try { pending = bundles.has(url) ? Promise.resolve(bundles.json(url)) : loadJSON(key); }
        catch (error) { pending = Promise.reject(error); }
        documents.set(key, pending.catch(error => { documents.delete(key); throw error; }));
      }
      return documents.get(key);
    },
    remember(url, value) { documents.set(new URL(resolveURL(url), location.href).href, Promise.resolve(value)); },
    dispose() { this.skybox?.dispose(); resources.dispose(); bundles.dispose(); documents.clear(); reflections.clear(); buffers.clear(); },
  };
}
